// grunt-it: hivemind ticket-ref splitting for the assistant-chat inline links (#331).
//
// Approach (build-verified): render `#N` refs as inline `<a href>` OpenTUI LinkRenderables
// — clean label, OSC-8 hyperlink metadata (no URL leak), native terminal hover-highlight
// + click. The catch is OpenTUI's hard tradeoff: a `#N` ref can only flow correctly inline
// inside a parent `<text>` (TextNode wrap math, #250), and `<text>`+`<span>` don't render
// markdown. So a PARAGRAPH that contains a ref is rendered as plain inline text+links;
// paragraphs WITHOUT refs keep full `<markdown>`.
//
// This module provides:
//  - `splitTextIntoBlocks`: split a message into paragraph blocks, tagging which contain
//    refs (so the caller renders ref-blocks inline and ref-free blocks as markdown).
//  - `splitOnTicketRefs`: split one block into alternating text / ticket segments.

/** Matches a hivemind ticket reference. Anchored on a non-word, non-slash, non-hash
 *  boundary so hex colors (#fff), paths (foo/#3) and `##` heading sequences don't match. */
export const TICKET_REF_RE = /(^|[^\w/#])#(\d{1,5})\b/g

export type TextSegment = { kind: "text"; text: string } | { kind: "ticket"; id: number }

export interface TextBlock {
  /** The raw text of this paragraph block (without the trailing blank-line separator). */
  text: string
  /** True if the block contains at least one ticket ref. */
  hasRef: boolean
}

/** Does this text contain at least one hivemind ticket ref? */
export function hasTicketRef(text: string): boolean {
  TICKET_REF_RE.lastIndex = 0
  return TICKET_REF_RE.test(text)
}

/**
 * Split assistant text into paragraph blocks on blank-line boundaries, preserving the
 * blank lines as their own separator blocks so re-joining reproduces the original spacing.
 * Each non-blank block is tagged with whether it contains a ticket ref.
 *
 * Why paragraph-level: it minimizes the markdown-formatting loss from the inline-`<a>`
 * tradeoff — only the specific paragraphs that mention a `#N` render as plain text; every
 * other paragraph (and all headings, lists, code blocks that don't contain a bare `#N`)
 * keeps full markdown rendering.
 *
 * Note: a fenced code block can contain blank lines; splitting on blank lines would break
 * it. To stay safe we DON'T split inside fenced code (``` ... ```). Blocks that are inside
 * a code fence are always treated as markdown (hasRef=false) so code is never linkified.
 */
export function splitTextIntoBlocks(text: string): TextBlock[] {
  const lines = text.split("\n")
  const blocks: TextBlock[] = []
  let current: string[] = []
  let inFence = false
  // True if the block being accumulated touches a code fence at any point — such a block
  // must render as markdown (never linkified), so a `#N` inside code isn't turned into a link.
  let blockTouchesFence = false

  const flush = () => {
    if (current.length === 0) return
    const blockText = current.join("\n")
    blocks.push({ text: blockText, hasRef: blockTouchesFence ? false : hasTicketRef(blockText) })
    current = []
    blockTouchesFence = false
  }

  for (const line of lines) {
    const isFenceMarker = /^\s*```/.test(line)
    if (isFenceMarker) {
      inFence = !inFence
      blockTouchesFence = true
    }
    // A blank line outside a fence ends the current paragraph block.
    if (!inFence && line.trim() === "" && !isFenceMarker) {
      flush()
      // Keep the blank line as a separator block so spacing is preserved on re-render.
      blocks.push({ text: "", hasRef: false })
      continue
    }
    current.push(line)
  }
  flush()
  return blocks
}

/**
 * Split one block of text into alternating plain-text and ticket-ref segments. Used to
 * render a ref-bearing block as a single `<text>` with inline `<span>` (text) and
 * `<TicketRef>` (`<a href>`) children, so refs flow correctly with the surrounding prose.
 */
export function splitOnTicketRefs(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let lastIndex = 0
  TICKET_REF_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TICKET_REF_RE.exec(text)) !== null) {
    const whole = match[0]
    const prefix = match[1] ?? ""
    const idStr = match[2]
    const start = match.index + prefix.length
    if (start > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, start) })
    }
    segments.push({ kind: "ticket", id: Number(idStr) })
    lastIndex = match.index + whole.length
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) })
  }
  return segments.length > 0 ? segments : [{ kind: "text", text }]
}
