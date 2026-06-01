import { expect, test, describe } from "bun:test"
import {
  ticketIdAtCell,
  recolorTicketRefs,
  type FrameBufferLike,
  type RecolorBufferLike,
} from "@/cli/cmd/tui/component/ticket-ref-scan"

/** Build a single-row framebuffer from a string for hit-testing. */
function fb(row: string, width = Math.max(row.length, 40)): FrameBufferLike {
  const char = new Uint32Array(width * 1)
  for (let x = 0; x < row.length; x++) char[x] = row.codePointAt(x)!
  return { width, height: 1, buffers: { char } }
}

/** Build a recolor-capable framebuffer that records drawText calls. */
function recolorFb(row: string, width = Math.max(row.length, 40)): {
  buf: RecolorBufferLike
  draws: Array<{ text: string; x: number; y: number }>
} {
  const char = new Uint32Array(width * 1)
  for (let x = 0; x < row.length; x++) char[x] = row.codePointAt(x)!
  const draws: Array<{ text: string; x: number; y: number }> = []
  const buf: RecolorBufferLike = {
    width,
    height: 1,
    buffers: { char },
    drawText(text, x, y) {
      draws.push({ text, x, y })
    },
  }
  return { buf, draws }
}

describe("ticketIdAtCell", () => {
  test("cursor on the # returns the id", () => {
    const buf = fb("see #331 here")
    expect(ticketIdAtCell(buf, 4, 0)).toBe(331) // '#'
  })

  test("cursor on a digit returns the id", () => {
    const buf = fb("see #331 here")
    expect(ticketIdAtCell(buf, 5, 0)).toBe(331) // '3'
    expect(ticketIdAtCell(buf, 7, 0)).toBe(331) // last '1'
  })

  test("cursor off the ref returns null", () => {
    const buf = fb("see #331 here")
    expect(ticketIdAtCell(buf, 0, 0)).toBeNull() // 's'
    expect(ticketIdAtCell(buf, 9, 0)).toBeNull() // 'h'
    expect(ticketIdAtCell(buf, 8, 0)).toBeNull() // space after id
  })

  test("two refs on a row resolve independently by exact position", () => {
    const buf = fb("a #11 b #22 c")
    expect(ticketIdAtCell(buf, 2, 0)).toBe(11) // '#11'
    expect(ticketIdAtCell(buf, 3, 0)).toBe(11)
    expect(ticketIdAtCell(buf, 8, 0)).toBe(22) // '#22'
    expect(ticketIdAtCell(buf, 6, 0)).toBeNull() // 'b' between them
  })

  test("does not match #word or hex-ish (# followed by non-digit)", () => {
    const buf = fb("color #fff x")
    expect(ticketIdAtCell(buf, 6, 0)).toBeNull() // '#'
    expect(ticketIdAtCell(buf, 7, 0)).toBeNull() // 'f'
  })

  test("does not match when # is preceded by a word char (foo#12)", () => {
    const buf = fb("foo#12 bar")
    expect(ticketIdAtCell(buf, 3, 0)).toBeNull() // '#'
    expect(ticketIdAtCell(buf, 4, 0)).toBeNull() // '1'
  })

  test("does not match double-hash ##12", () => {
    const buf = fb("see ##12 x")
    // cursor on the second '#': preceded by '#' → reject
    expect(ticketIdAtCell(buf, 5, 0)).toBeNull()
    // cursor on a digit: walks left to second '#', whose left is '#' → boundary reject
    expect(ticketIdAtCell(buf, 6, 0)).toBeNull()
  })

  test("ref at start of row matches", () => {
    const buf = fb("#42 leads")
    expect(ticketIdAtCell(buf, 0, 0)).toBe(42)
    expect(ticketIdAtCell(buf, 2, 0)).toBe(42)
  })

  test("empty cell / out of range → null", () => {
    const buf = fb("see #5")
    expect(ticketIdAtCell(buf, 100, 0)).toBeNull()
    expect(ticketIdAtCell(buf, 5, 5)).toBeNull()
    expect(ticketIdAtCell(buf, -1, 0)).toBeNull()
  })

  test("caps id length at 5 digits", () => {
    const buf = fb("see #123456 here")
    // reads first 5 digits → 12345 (matches the <=5 digit rule)
    expect(ticketIdAtCell(buf, 4, 0)).toBe(12345)
  })
})

describe("recolorTicketRefs", () => {
  test("redraws each valid #N run, in position", () => {
    const { buf, draws } = recolorFb("a #11 b #22 c")
    recolorTicketRefs(buf, { r: 0, g: 0, b: 1, a: 1 })
    expect(draws).toEqual([
      { text: "#11", x: 2, y: 0 },
      { text: "#22", x: 8, y: 0 },
    ])
  })

  test("ignores #word, foo#12, ##12", () => {
    const a = recolorFb("color #fff x")
    recolorTicketRefs(a.buf, {})
    expect(a.draws).toEqual([])

    const b = recolorFb("foo#12 bar")
    recolorTicketRefs(b.buf, {})
    expect(b.draws).toEqual([])

    const c = recolorFb("see ##12 x")
    recolorTicketRefs(c.buf, {})
    expect(c.draws).toEqual([])
  })

  test("ref at start of row", () => {
    const { buf, draws } = recolorFb("#42 leads")
    recolorTicketRefs(buf, {})
    expect(draws).toEqual([{ text: "#42", x: 0, y: 0 }])
  })

  test("no refs → no draws", () => {
    const { buf, draws } = recolorFb("plain prose here")
    recolorTicketRefs(buf, {})
    expect(draws).toEqual([])
  })
})
