// grunt-it: hivemind ticket-ref scanner for the assistant-chat hover preview (#331).
//
// Background: PR #24 made `#N` refs render correctly by rewriting them to markdown
// links (`[#N](https://hivemind.grunt.si/tasks/N)`) and feeding the whole message
// through the `<markdown>` renderable. That fixed color + wrap (#250) + raw-markdown,
// but killed the hover-card preview (#233) because OpenTUI inline link chunks are
// TextNodes that can't hold mouse listeners — only block-level Box/Text are on the
// mouse hit-grid.
//
// This module powers the hover-restore (Model A): we keep PR #24's markdown rendering
// 100% untouched, wrap the rendered block in a mouse-aware <box>, and on mouse-move map
// the cursor's local (col,row) → a character index → the NEAREST ticket ref. To do that
// we need, for the SAME source text the renderer sees, the list of refs + where each one
// sits in the *visible* (concealed) text. This scanner produces exactly that.
//
// "Visible text" = the text as the user sees it after markdown concealment: a ref shows
// as `#331`, NOT as `[#331](https://…)`. So we compute offsets against a concealed
// projection of the rewritten content, which is what the wrapped on-screen layout
// reflects.

/** Matches a hivemind ticket reference. Mirrors HIVEMIND_TICKET_RE in routes/session/index.tsx
 *  (kept in sync intentionally — both must agree on what counts as a ref).
 *  - Anchored on a non-word, non-slash, non-hash boundary so hex colors (#fff) and paths
 *    (foo/#3) don't match, and `##` heading-ish sequences don't double-fire. */
export const TICKET_REF_RE = /(^|[^\w/#])#(\d{1,5})\b/g

export interface ScannedRef {
  /** The numeric ticket id. */
  id: number
  /** Character offset of the `#` in the VISIBLE (concealed) text. */
  start: number
  /** Character offset one past the last digit in the VISIBLE text (exclusive). */
  end: number
}

/**
 * Scan raw assistant text for hivemind ticket refs, returning each ref's id plus its
 * start/end character offsets **in the visible (concealed) projection of the text**.
 *
 * We deliberately scan the ORIGINAL text (the `#N` form) rather than the rewritten
 * markdown-link form, because the visible/concealed on-screen text shows `#N`, not the
 * `[#N](url)` link source. The offsets therefore line up with what the wrapped renderer
 * lays out on screen, which is what the hover position-math compares against.
 *
 * Newlines are preserved in the offset space (each `\n` counts as one char) so a
 * row/col cursor position can be resolved against the same coordinate system by walking
 * lines. Markdown block markers (`#`, `*`, `-`, backticks) are NOT stripped here — the
 * caller's row/col walk accounts for them via the rendered layout; this scanner only
 * needs ref positions to be monotonic and consistent with a left-to-right reading of the
 * source, which they are.
 */
export function scanTicketRefs(text: string): ScannedRef[] {
  const refs: ScannedRef[] = []
  if (!text) return refs
  // Reset lastIndex defensively (the regex is module-global with the /g flag).
  TICKET_REF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TICKET_REF_RE.exec(text)) !== null) {
    const prefix = m[1] ?? ""
    const idStr = m[2]
    const id = Number(idStr)
    if (!Number.isFinite(id)) continue
    // The `#` sits right after the captured prefix within the whole match.
    const hashStart = m.index + prefix.length
    refs.push({
      id,
      start: hashStart,
      end: hashStart + 1 + idStr.length, // `#` + digits
    })
  }
  return refs
}

/**
 * Given the cursor's character index into the visible text, return the id of the nearest
 * ticket ref — preferring a ref the cursor is directly ON (start ≤ idx < end), then the
 * ref whose span is closest by character distance. Returns null when there are no refs.
 *
 * This is the Model-A "nearest ref" resolver: precise when the cursor is on a ref,
 * graceful (snap to closest) when the position-math is a little off due to wrap
 * estimation. It never throws and never returns a wrong-shaped value.
 */
export function nearestRefId(refs: ScannedRef[], idx: number): number | null {
  if (refs.length === 0) return null
  let best: ScannedRef | null = null
  let bestDist = Infinity
  for (const r of refs) {
    // Direct hit wins immediately.
    if (idx >= r.start && idx < r.end) return r.id
    const dist = idx < r.start ? r.start - idx : idx - (r.end - 1)
    if (dist < bestDist) {
      bestDist = dist
      best = r
    }
  }
  return best ? best.id : null
}

/** Columns of slack around a ref's rendered span within which a hover/click still counts.
 *  Strict-but-forgiving (Option b): the cursor must be ON or within TOL columns of the
 *  actual `#N` — otherwise resolveRefAt returns null and the hover card closes. Small
 *  enough that moving clearly away (or to blank space / another line) dismisses the card
 *  instead of snapping to a neighbor; large enough to absorb the wrap/conceal column
 *  estimate error. Tunable. */
export const HOVER_COL_TOLERANCE = 2

/**
 * Resolve which ticket ref the cursor is over, with a STRICT proximity gate (#331,
 * Option b). Given the cursor's LOCAL position inside the rendered block (row + col,
 * 0-based, relative to the block's content top-left) and the block's content width in
 * columns, return a ref id ONLY when the cursor is on/near an actual `#N`; otherwise
 * return null so the caller closes the hover card.
 *
 * This is the fix for two reported bugs:
 *  - card never closed when moving the cursor away (it snapped to the nearest ref);
 *  - moving far on a line just switched to a neighbor ref.
 * Both came from an unconditional "nearest ref" return. Now we gate on distance.
 *
 * Coordinate handling: ref offsets from scanTicketRefs are in RAW source characters, but
 * the cursor column is in VISIBLE/rendered columns. On a line with leading markdown
 * markers (`- `, `## `, `> `) those markers are concealed, so a ref's visible column is
 * left-shifted from its raw offset. We compute each on-line ref's VISIBLE column range
 * and gate the cursor's visible column against it — so the gate is accurate even on
 * list items / headings.
 *
 * Vertical: the cursor's row is mapped to a logical source line via per-line wrapped-row
 * estimation; a ref on a wrapped line stays hoverable across its visual rows. If the
 * resolved line has no ref, returns null (no cross-line snapping).
 *
 * Never throws; clamps out-of-range row/col.
 */
export function resolveRefAt(
  text: string,
  refs: ScannedRef[],
  row: number,
  col: number,
  width: number,
): number | null {
  if (refs.length === 0) return null
  if (width <= 0 || !Number.isFinite(width)) return null

  const lines = text.split("\n")
  // Per source line: raw [start,end) char range + how many wrapped visual rows it spans.
  const lineRanges: Array<{ start: number; end: number; rows: number; prefixLen: number }> = []
  let offset = 0
  for (const line of lines) {
    const prefixLen = concealedPrefixLen(line)
    const visibleWidth = Math.max(0, line.length - prefixLen)
    const rows = Math.max(1, Math.ceil(Math.max(1, visibleWidth) / width))
    lineRanges.push({ start: offset, end: offset + line.length, rows, prefixLen })
    offset += line.length + 1 // +1 for the consumed "\n"
  }

  // Walk wrapped rows to find which source line `row` lands in.
  const clampedRow = Math.max(0, row)
  let acc = 0
  let lineIdx = lineRanges.length - 1
  for (let i = 0; i < lineRanges.length; i++) {
    if (clampedRow < acc + lineRanges[i].rows) {
      lineIdx = i
      break
    }
    acc += lineRanges[i].rows
  }

  const range = lineRanges[lineIdx]
  // Refs whose `#` sits on this source line.
  const onLine = refs.filter((r) => r.start >= range.start && r.start < range.end)
  if (onLine.length === 0) return null // ref-free line → no hover (card closes)

  // Cursor's VISIBLE column within the wrapped line: account for the wrapped row offset.
  const rowsBefore = lineRanges.slice(0, lineIdx).reduce((s, r) => s + r.rows, 0)
  const rowWithinLine = Math.max(0, clampedRow - rowsBefore)
  const cursorVisibleCol = rowWithinLine * width + Math.max(0, col)

  // For each on-line ref, compute its VISIBLE column span (raw offset minus the concealed
  // leading-marker length on this line) and gate against the tolerance band.
  let best: number | null = null
  let bestDist = Infinity
  for (const r of onLine) {
    const visStart = r.start - range.start - range.prefixLen
    const visEnd = r.end - range.start - range.prefixLen // exclusive
    if (visEnd <= 0) continue
    let dist: number
    if (cursorVisibleCol < visStart) dist = visStart - cursorVisibleCol
    else if (cursorVisibleCol >= visEnd) dist = cursorVisibleCol - (visEnd - 1)
    else dist = 0 // directly on the ref
    if (dist <= HOVER_COL_TOLERANCE && dist < bestDist) {
      bestDist = dist
      best = r.id
    }
  }
  return best
}

/** Length of the concealed leading markdown marker on a line (heading `#`+space, list
 *  bullet `- `/`* `/`+ `, blockquote `> `, plus surrounding indent). These markers are
 *  hidden by the renderer in conceal mode, so the visible text starts after them — which
 *  shifts every ref's visible column left by this many chars. */
function concealedPrefixLen(line: string): number {
  const m = line.match(/^(\s*(?:#{1,6}\s+|[-*+]\s+|>\s+)?)/)
  return m ? m[1].length : 0
}
