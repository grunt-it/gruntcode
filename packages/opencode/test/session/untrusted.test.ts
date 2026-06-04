import { describe, expect, test } from "bun:test"
import {
  UNTRUSTED_CONTEXT_POLICY,
  UNTRUSTED_CONTEXT_HEADER,
  isUntrustedTool,
  wrapUntrustedContent,
  UNTRUSTED_TOOLS,
} from "@/session/untrusted"

describe("untrusted content", () => {
  test("policy string is non-empty", () => {
    expect(UNTRUSTED_CONTEXT_POLICY.length).toBeGreaterThan(0)
    expect(UNTRUSTED_CONTEXT_POLICY).toInclude("Prompt-safety policy")
    expect(UNTRUSTED_CONTEXT_POLICY).toInclude("</system-reminder>")
  })

  test("header string is non-empty", () => {
    expect(UNTRUSTED_CONTEXT_HEADER.length).toBeGreaterThan(0)
    expect(UNTRUSTED_CONTEXT_HEADER).toInclude("UNTRUSTED SOURCE DATA")
  })

  describe("isUntrustedTool", () => {
    test("classifies tools correctly", () => {
      const trusted = ["read", "edit", "grep", "glob", "create_document", "manage_session", "app_api"]
      for (const tool of UNTRUSTED_TOOLS) {
        expect(isUntrustedTool(tool)).toBe(true)
      }
      for (const tool of trusted) {
        expect(isUntrustedTool(tool)).toBe(false)
      }
    })
  })

  describe("wrapUntrustedContent", () => {
    test("wraps content with source tag", () => {
      const result = wrapUntrustedContent("web_search", "some search result")
      expect(result).toInclude("UNTRUSTED SOURCE DATA")
      expect(result).toInclude("Source: tool call `web_search`")
      expect(result).toInclude("<<<UNTRUSTED_SOURCE_DATA>>>")
      expect(result).toInclude("some search result")
      expect(result).toInclude("<<<END_UNTRUSTED_SOURCE_DATA>>>")
    })

    test("includes full content in wrapper", () => {
      const content = "Line 1\nLine 2\nLine 3 with <script>alert('xss')</script>"
      const result = wrapUntrustedContent("web_fetch", content)
      expect(result).toInclude(content)
      expect(result).toInclude(UNTRUSTED_CONTEXT_HEADER)
    })

    test("works for all untrusted tools", () => {
      for (const tool of UNTRUSTED_TOOLS) {
        const result = wrapUntrustedContent(tool, "content")
        expect(result).toInclude(`Source: tool call \`${tool}\``)
        expect(result).toInclude("content")
      }
    })
  })
})
