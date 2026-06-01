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

describe("resolveRefAt (line-based)", () => {
  test("single ref on hovered line resolves regardless of column drift", () => {
    const text = "line zero no ref\nline one mentions #777 ticket\nline two no ref"
    const refs = scanTicketRefs(text)
    // row 1 (second line), any column → must resolve to 777
    expect(resolveRefAt(text, refs, 1, 0, 80)).toBe(777)
    expect(resolveRefAt(text, refs, 1, 40, 80)).toBe(777)
  })

  test("ref-free line falls back to globally nearest by line start", () => {
    const text = "intro #100 here\njust prose with no ref at all"
    const refs = scanTicketRefs(text)
    // hovering the ref-free second line still resolves to the only ref
    expect(resolveRefAt(text, refs, 1, 5, 80)).toBe(100)
  })

  test("multi-ref line picks nearest by column", () => {
    const text = "tickets #11 and #99 on one line"
    const refs = scanTicketRefs(text)
    // "#11" at col 8, "#99" at col 16. Cursor near start → 11; near end → 99.
    expect(resolveRefAt(text, refs, 0, 8, 80)).toBe(11)
    expect(resolveRefAt(text, refs, 0, 17, 80)).toBe(99)
  })

  test("wrapped long line: row maps into the right logical line", () => {
    // First logical line is 100 chars wide → wraps to 2 visual rows at width 60.
    const longA = "A".repeat(100)
    const text = `${longA}\nsecond line has #555`
    const refs = scanTicketRefs(text)
    // Visual rows: 0,1 = first logical line (no ref); row 2 = second line (#555).
    expect(resolveRefAt(text, refs, 2, 0, 60)).toBe(555)
  })

  test("no refs → null", () => {
    expect(resolveRefAt("no refs here", [], 0, 0, 80)).toBeNull()
  })
})
