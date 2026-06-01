import { expect, test, describe } from "bun:test"
import { scanTicketRefs, nearestRefId, resolveRefAt } from "@/cli/cmd/tui/component/ticket-ref-scan"

describe("scanTicketRefs", () => {
  test("finds refs with correct ids and offsets", () => {
    const refs = scanTicketRefs("see #331 here")
    expect(refs).toEqual([{ id: 331, start: 4, end: 8 }])
  })

  test("finds multiple refs on one line", () => {
    const refs = scanTicketRefs("refs #222, #233 and #24")
    expect(refs.map((r) => r.id)).toEqual([222, 233, 24])
  })

  test("ignores hex colors and paths", () => {
    expect(scanTicketRefs("color #fff and #a3f9")).toEqual([])
    expect(scanTicketRefs("path foo/#3")).toEqual([])
  })

  test("matches ref at start of string", () => {
    const refs = scanTicketRefs("#42 leads")
    expect(refs).toEqual([{ id: 42, start: 0, end: 3 }])
  })

  test("empty text → no refs", () => {
    expect(scanTicketRefs("")).toEqual([])
  })
})

describe("nearestRefId", () => {
  const refs = scanTicketRefs("a #10 b #20 c #30")
  test("direct hit returns that ref", () => {
    // "#20" sits at index 8..11
    expect(nearestRefId(refs, 9)).toBe(20)
  })
  test("between refs snaps to nearest", () => {
    expect(nearestRefId(refs, 0)).toBe(10)
    expect(nearestRefId(refs, 99)).toBe(30)
  })
  test("no refs → null", () => {
    expect(nearestRefId([], 5)).toBeNull()
  })
})

describe("resolveRefAt (strict proximity gate, Option b)", () => {
  test("cursor directly on the ref resolves it", () => {
    const text = "line zero no ref\nline one mentions #777 ticket\nline two no ref"
    const refs = scanTicketRefs(text)
    // "#777" on line 1 starts at visible col 18 ("line one mentions " = 18 chars).
    expect(resolveRefAt(text, refs, 1, 18, 80)).toBe(777)
    expect(resolveRefAt(text, refs, 1, 20, 80)).toBe(777) // mid-ref
  })

  test("cursor within tolerance of the ref resolves it", () => {
    const text = "line one mentions #777 ticket"
    const refs = scanTicketRefs(text)
    // ref visible span is cols 18..21 (inclusive of #,7,7,7). Within ±2 cols still hits.
    expect(resolveRefAt(text, refs, 0, 16, 80)).toBe(777) // 2 left of start
    expect(resolveRefAt(text, refs, 0, 23, 80)).toBe(777) // 2 right of end
  })

  test("cursor far on the SAME line → null (no snapping, card closes)", () => {
    const text = "line one mentions #777 ticket and lots more text here padding"
    const refs = scanTicketRefs(text)
    expect(resolveRefAt(text, refs, 0, 0, 80)).toBeNull() // far left
    expect(resolveRefAt(text, refs, 0, 50, 80)).toBeNull() // far right
  })

  test("cursor on a ref-free line → null (no cross-line snapping)", () => {
    const text = "intro #100 here\njust prose with no ref at all"
    const refs = scanTicketRefs(text)
    expect(resolveRefAt(text, refs, 1, 5, 80)).toBeNull()
    expect(resolveRefAt(text, refs, 1, 20, 80)).toBeNull()
  })

  test("multi-ref line: resolves the one under the cursor, null when between/away", () => {
    const text = "tickets #11 and #99 on one line"
    const refs = scanTicketRefs(text)
    // "#11" visible cols 8..10; "#99" visible cols 16..18.
    expect(resolveRefAt(text, refs, 0, 8, 80)).toBe(11)
    expect(resolveRefAt(text, refs, 0, 17, 80)).toBe(99)
    // Between them (col 13, >2 from either) → null.
    expect(resolveRefAt(text, refs, 0, 13, 80)).toBeNull()
  })

  test("list-item ref: concealed '- ' prefix shifts visible column left", () => {
    // "- see #42 now": raw '#' at index 6, but '- ' (2 chars) is concealed →
    // visible col of '#42' is 4.
    const text = "- see #42 now"
    const refs = scanTicketRefs(text)
    expect(resolveRefAt(text, refs, 0, 4, 80)).toBe(42) // visible position
    expect(resolveRefAt(text, refs, 0, 6, 80)).toBe(42) // raw position still within TOL
  })

  test("wrapped ref-bearing line stays hoverable on its 2nd visual row", () => {
    // Line: 70 chars of prose then '#555' near the end → wraps at width 60.
    const prefix = "x".repeat(66) + " "
    const text = `${prefix}#555` // length 71, wraps to 2 rows at width 60
    const refs = scanTicketRefs(text)
    // '#555' visible col = 67 → on 2nd visual row (row 1), col 67-60=7.
    expect(resolveRefAt(text, refs, 1, 7, 60)).toBe(555)
    // far left on row 0 → null
    expect(resolveRefAt(text, refs, 0, 0, 60)).toBeNull()
  })

  test("no refs → null", () => {
    expect(resolveRefAt("no refs here", [], 0, 0, 80)).toBeNull()
  })

  test("invalid width → null", () => {
    const refs = scanTicketRefs("see #5")
    expect(resolveRefAt("see #5", refs, 0, 0, 0)).toBeNull()
  })
})
