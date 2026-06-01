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

/**
 * Resolve which ticket ref the cursor is nearest, given the cursor's LOCAL position
 * inside the rendered block (row + col, 0-based, relative to the block's top-left) and
 * the block's content width in columns.
 *
 * Strategy — robust over precise (Model A):
 * 1. Walk the source text line-by-line, estimating how many WRAPPED visual rows each
 *    source line occupies at the given width (ceil(lineDisplayWidth / width), min 1).
 *    This mirrors how the markdown renderable word-wraps each logical line. It's an
 *    estimate (concealment + markdown block markers shift columns), but it's monotonic
 *    and good enough to land on the right source line in the common case.
 * 2. Find the source line under `row`. Collect refs whose offsets fall on that line.
 *    - If the line has refs → return nearest by column within the line.
 *    - If not → fall back to the globally-nearest ref by character index (so hovering a
 *      ref-free continuation row of a wrapped paragraph still resolves to that
 *      paragraph's ref). Returns null only when the whole block has no refs.
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
  if (width <= 0) return nearestRefId(refs, 0)

  const lines = text.split("\n")
  // Precompute the [start,end) source-char range of each source line.
  const lineRanges: Array<{ start: number; end: number; rows: number }> = []
  let offset = 0
  for (const line of lines) {
    const visibleWidth = displayWidth(line)
    const rows = Math.max(1, Math.ceil(visibleWidth / width))
    lineRanges.push({ start: offset, end: offset + line.length, rows })
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
  // Refs on this source line.
  const onLine = refs.filter((r) => r.start >= range.start && r.start < range.end)
  if (onLine.length > 0) {
    // Cursor's estimated char index within this line: the row-within-line * width + col.
    const rowsBefore = lineRanges.slice(0, lineIdx).reduce((s, r) => s + r.rows, 0)
    const rowWithinLine = Math.max(0, clampedRow - rowsBefore)
    const colInLine = rowWithinLine * width + Math.max(0, col)
    const idx = range.start + colInLine
    return nearestRefId(onLine, idx)
  }

  // No ref on the hovered line → globally nearest by the line's start index.
  return nearestRefId(refs, range.start)
}

/** Approximate display width of a string in terminal columns. Treats most code points as
 *  width-1; this is sufficient for ref position estimation (we don't need grapheme-perfect
 *  width, just a monotonic estimate to pick the right source line). */
function displayWidth(s: string): number {
  // Strip the heaviest markdown markers that get concealed so width estimate tracks the
  // visible render a little better (headings/list bullets/emphasis). Conservative.
  const visible = s
    .replace(/^\s*#{1,6}\s+/, "") // heading marker
    .replace(/^\s*[-*+]\s+/, "") // list bullet
    .replace(/[*_`]/g, "") // emphasis / code markers
  return visible.length
}
