import { expect, test, describe } from "bun:test"
import {
  hasTicketRef,
  splitTextIntoBlocks,
  splitOnTicketRefs,
} from "@/cli/cmd/tui/component/ticket-ref-scan"

describe("hasTicketRef", () => {
  test("detects a ref", () => {
    expect(hasTicketRef("see #331 here")).toBe(true)
  })
  test("ignores hex colors and paths and headings", () => {
    expect(hasTicketRef("color #fff")).toBe(false)
    expect(hasTicketRef("path foo/#3")).toBe(false)
    expect(hasTicketRef("## Heading")).toBe(false)
  })
  test("empty → false", () => {
    expect(hasTicketRef("")).toBe(false)
  })
})

describe("splitOnTicketRefs", () => {
  test("alternates text and ticket segments", () => {
    expect(splitOnTicketRefs("see #331 now")).toEqual([
      { kind: "text", text: "see " },
      { kind: "ticket", id: 331 },
      { kind: "text", text: " now" },
    ])
  })
  test("multiple refs", () => {
    const segs = splitOnTicketRefs("#11 and #22")
    expect(segs).toEqual([
      { kind: "ticket", id: 11 },
      { kind: "text", text: " and " },
      { kind: "ticket", id: 22 },
    ])
  })
  test("no refs → single text segment", () => {
    expect(splitOnTicketRefs("plain text")).toEqual([{ kind: "text", text: "plain text" }])
  })
  test("does not match hex/path", () => {
    expect(splitOnTicketRefs("#fff and foo/#3")).toEqual([{ kind: "text", text: "#fff and foo/#3" }])
  })
})

describe("splitTextIntoBlocks", () => {
  test("tags ref-bearing vs ref-free paragraphs", () => {
    const text = "Intro paragraph no ref.\n\nThis mentions #42 ticket.\n\nOutro no ref."
    const blocks = splitTextIntoBlocks(text)
    const nonBlank = blocks.filter((b) => b.text !== "")
    expect(nonBlank.map((b) => b.hasRef)).toEqual([false, true, false])
  })

  test("preserves blank-line separators for re-render spacing", () => {
    const text = "a\n\nb"
    const blocks = splitTextIntoBlocks(text)
    expect(blocks.map((b) => b.text)).toEqual(["a", "", "b"])
  })

  test("does not split inside fenced code blocks", () => {
    const text = "```\ncode line 1\n\ncode line 2\n```\n\nafter #5"
    const blocks = splitTextIntoBlocks(text)
    // The fenced block (with its internal blank line) stays one block; the #5 paragraph is separate.
    const code = blocks.find((b) => b.text.includes("code line 1"))
    expect(code?.text).toContain("code line 2") // not split on the blank line inside the fence
    expect(code?.hasRef).toBe(false)
    const refBlock = blocks.find((b) => b.text.includes("#5"))
    expect(refBlock?.hasRef).toBe(true)
  })

  test("a #N inside a code fence is NOT treated as a ref", () => {
    const text = "```\nrun task #99 now\n```"
    const blocks = splitTextIntoBlocks(text)
    expect(blocks.every((b) => b.hasRef === false)).toBe(true)
  })

  test("single paragraph with ref → one ref block", () => {
    const blocks = splitTextIntoBlocks("just #7 inline")
    expect(blocks).toEqual([{ text: "just #7 inline", hasRef: true }])
  })
})
