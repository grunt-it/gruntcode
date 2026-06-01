// grunt-it: hivemind ticket-ref hit-testing for the assistant-chat hover preview (#331).
//
// The accurate, flicker-free approach: the message renders as a SINGLE <markdown> block
// with refs as PLAIN `#N` text (no link rewrite → no URL leak, full markdown, no flicker).
// To know which ref the cursor is over WITHOUT fragile column estimation, we read the
// renderer's actual framebuffer: the characters truly painted on screen at the cursor's
// row. We find the `#`+digits token the cursor sits on and return its id. This is exact
// because it uses rendered cells, not a reconstruction of wrapped/concealed layout.
//
// Buffer shape (OpenTUI OptimizedBuffer, all public): `buffers.char` is a Uint32Array of
// code points indexed `y * width + x`.

export interface FrameBufferLike {
  readonly width: number
  readonly height: number
  readonly buffers: { char: Uint32Array }
}

const HASH = "#".codePointAt(0)!
const ZERO = "0".codePointAt(0)!
const NINE = "9".codePointAt(0)!

function codeAt(buf: FrameBufferLike, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return 0
  return buf.buffers.char[y * buf.width + x] ?? 0
}

const isDigit = (c: number) => c >= ZERO && c <= NINE

/**
 * Given the absolute screen cell (x,y) under the cursor, read the framebuffer and return
 * the hivemind ticket id of the `#N` token the cursor is on — or null if the cursor isn't
 * over a `#<digits>` token. Pixel-accurate: it inspects the characters actually rendered.
 *
 * Algorithm: from the cursor cell, walk left while we're inside a digit run; then require
 * the char immediately left of the run's first digit to be `#`. Also handles the cursor
 * sitting directly on the `#`. Then read digits rightward to form the full id. A leading
 * `#` must not itself be preceded by another `#`/digit/word char (mirrors the text regex's
 * boundary rule so `##2` or `a1#2` style noise doesn't match).
 */
export function ticketIdAtCell(buf: FrameBufferLike, x: number, y: number): number | null {
  const here = codeAt(buf, x, y)
  const onHash = here === HASH
  const onDigit = isDigit(here)
  if (!onHash && !onDigit) return null

  // Find the hash column: either we're on it, or walk left across digits to find it.
  let hashX = x
  if (onDigit) {
    let i = x
    while (i - 1 >= 0 && isDigit(codeAt(buf, i - 1, y))) i--
    // The char just left of the first digit must be '#'.
    if (codeAt(buf, i - 1, y) !== HASH) return null
    hashX = i - 1
  }

  // Boundary: the char before '#' must not be a word char, '/', or '#' (matches the
  // TICKET_REF_RE rule; prevents matching inside e.g. `foo#12` or `##12`).
  const before = codeAt(buf, hashX - 1, y)
  if (before === HASH || before === 0x2f /* / */ || isWordChar(before)) {
    // Allow start-of-line (before === 0 means empty cell / line start).
    if (before !== 0) return null
  }

  // Read digits right of '#'.
  let n = 0
  let count = 0
  let i = hashX + 1
  while (count < 5 && isDigit(codeAt(buf, i, y))) {
    n = n * 10 + (codeAt(buf, i, y) - ZERO)
    i++
    count++
  }
  if (count === 0) return null
  return n
}

function isWordChar(c: number): boolean {
  if (c === 0) return false
  // a-z, A-Z, 0-9, _
  return (
    (c >= 0x61 && c <= 0x7a) ||
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x30 && c <= 0x39) ||
    c === 0x5f
  )
}

/** Minimal slice of OptimizedBuffer needed to recolor cells in a post-process pass. */
export interface RecolorBufferLike extends FrameBufferLike {
  drawText(text: string, x: number, y: number, fg: unknown, bg?: unknown, attributes?: number): void
}

/**
 * Find every valid `#N` ticket-ref token painted in the framebuffer and re-draw it in the
 * given foreground color (so refs stand out from base text). Runs as a per-frame
 * post-process (#331): cheap single linear scan; re-drawing only the matched `#N` runs.
 *
 * `fg` is passed straight to `buffer.drawText` (an RGBA in practice — kept `unknown` here
 * so this module needs no @opentui/core import). `attributes` lets the caller add e.g.
 * underline. Uses the SAME boundary rules as ticketIdAtCell so it never tints `foo#12`,
 * `##12`, or `#fff`.
 */
export function recolorTicketRefs(
  buf: RecolorBufferLike,
  fg: unknown,
  attributes?: number,
): void {
  for (let y = 0; y < buf.height; y++) {
    let x = 0
    while (x < buf.width) {
      if (codeAt(buf, x, y) !== HASH) {
        x++
        continue
      }
      // Boundary before '#': reject when preceded by word char, '/', or '#'.
      const before = codeAt(buf, x - 1, y)
      if (before !== 0 && (before === HASH || before === 0x2f || isWordChar(before))) {
        x++
        continue
      }
      // Count digits after '#'.
      let count = 0
      let j = x + 1
      while (count < 5 && isDigit(codeAt(buf, j, y))) {
        j++
        count++
      }
      if (count === 0) {
        x++
        continue
      }
      // Re-draw the `#<digits>` run in the ref color. Read the chars back from the buffer
      // so we reproduce exactly what's painted.
      let token = "#"
      for (let k = x + 1; k < j; k++) token += String.fromCodePoint(codeAt(buf, k, y))
      buf.drawText(token, x, y, fg, undefined, attributes)
      x = j
    }
  }
}
