import { describe, expect, test } from "bun:test"
import { parseToolCalls } from "@/tool/parser"

describe("tool parser", () => {
  test("returns empty array for empty input", () => {
    expect(parseToolCalls("")).toEqual([])
    expect(parseToolCalls(null as any)).toEqual([])
    expect(parseToolCalls(undefined as any)).toEqual([])
  })

  test("returns empty array for plain text", () => {
    expect(parseToolCalls("just some regular text")).toEqual([])
    expect(parseToolCalls("no tools here")).toEqual([])
  })

  describe("format 1: [TOOL_CALL]", () => {
    test("parses basic tool call", () => {
      const result = parseToolCalls(`[TOOL_CALL] {"tool": "bash", "args": {"command": "ls"}} [/TOOL_CALL]`)
      expect(result).toHaveLength(1)
      expect(result[0].toolName).toBe("bash")
    })

    test("parses with 'name' key", () => {
      const result = parseToolCalls(`[TOOL_CALL] {"name": "bash", "args": {"command": "echo hi"}} [/TOOL_CALL]`)
      expect(result).toHaveLength(1)
      expect(result[0].toolName).toBe("bash")
    })

    test("handles multiple tool calls", () => {
      const result = parseToolCalls(`
        [TOOL_CALL] {"tool": "bash", "args": {"command": "ls"}} [/TOOL_CALL]
        some text
        [TOOL_CALL] {"tool": "read_file", "args": {"path": "/tmp/x"}} [/TOOL_CALL]
      `)
      expect(result).toHaveLength(2)
      expect(result[0].toolName).toBe("bash")
      expect(result[1].toolName).toBe("read_file")
    })
  })

  describe("format 2: XML <invoke> inside <tool_call>", () => {
    test("parses basic XML tool call", () => {
      const result = parseToolCalls(`
        <tool_call>
          <invoke name="bash">
            <parameter name="command">echo hi</parameter>
          </invoke>
        </tool_call>
      `)
      expect(result).toHaveLength(1)
      expect(result[0].toolName).toBe("bash")
      expect(result[0].args).toEqual({ command: "echo hi" })
    })

    test("parses <function_call> wrapper", () => {
      const result = parseToolCalls(`
        <function_call>
          <invoke name="web_search">
            <parameter name="query">weather today</parameter>
          </invoke>
        </function_call>
      `)
      expect(result).toHaveLength(1)
      expect(result[0].toolName).toBe("web_search")
    })

    test("handles namespaced wrapper", () => {
      const result = parseToolCalls(`
        <minimax:tool_call>
          <invoke name="read_file">
            <parameter name="path">/tmp/x</parameter>
          </invoke>
        </minimax:tool_call>
      `)
      expect(result).toHaveLength(1)
      expect(result[0].toolName).toBe("read_file")
    })

    test("extracts CDATA-wrapped params", () => {
      const result = parseToolCalls(`
        <tool_call>
          <invoke name="bash">
            <parameter name="command"><![CDATA[pip install openai]]></parameter>
          </invoke>
        </tool_call>
      `)
      expect(result).toHaveLength(1)
      expect(result[0].toolName).toBe("bash")
      expect(result[0].args?.command).toBe("pip install openai")
    })
  })

  describe("format 3: standalone XML <invoke>", () => {
    test("parses standalone invoke", () => {
      const result = parseToolCalls(`
        <invoke name="write_file">
          <parameter name="path">/tmp/test.txt</parameter>
          <parameter name="content">hello</parameter>
        </invoke>
      `)
      expect(result).toHaveLength(1)
      expect(result[0].toolName).toBe("write_file")
      expect(result[0].args).toEqual({ path: "/tmp/test.txt", content: "hello" })
    })
  })

  describe("format 4: <tool_code>", () => {
    test("parses tool_code with JSON", () => {
      const result = parseToolCalls(`
        <tool_code>{"tool": "bash", "args": {"command": "ls"}}</tool_code>
      `)
      expect(result).toHaveLength(1)
      expect(result[0].toolName).toBe("bash")
    })
  })

  describe("format 5: DeepSeek DSML", () => {
    test("parses DSML fullwidth pipe format", () => {
      const result = parseToolCalls(`
        <｜DSML｜tool_calls>
          <｜DSML｜invoke name="bash">
            <parameter name="command">echo hi</parameter>
          </｜DSML｜/invoke>
        </｜DSML｜tool_calls>
      `)
      expect(result).toHaveLength(1)
      expect(result[0].toolName).toBe("bash")
    })

    test("parses DSML ascii pipe format", () => {
      const result = parseToolCalls(`
        <|DSML|tool_calls>
          <|DSML|invoke name="web_search">
            <parameter name="query">latest news</parameter>
          </|DSML|/invoke>
        </|DSML|tool_calls>
      `)
      expect(result).toHaveLength(1)
      expect(result[0].toolName).toBe("web_search")
    })
  })

  describe("mixed content with text", () => {
    test("extracts tool calls from chat text", () => {
      const text = `Let me check that for you.

[TOOL_CALL] {"tool": "bash", "args": {"command": "ls -la"}} [/TOOL_CALL]

The output shows the files.`
      const result = parseToolCalls(text)
      expect(result).toHaveLength(1)
      expect(result[0].toolName).toBe("bash")
    })
  })
})
