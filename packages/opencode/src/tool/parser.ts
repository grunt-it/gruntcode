import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tool-parser" })

const TOOL_CALL_RE = /\[TOOL_CALL\]\s*\{([\s\S]*?)\}\s*\[\/TOOL_CALL\]/gi

const XML_TOOL_CALL_RE = /<(?:[\w]+:)?(?:tool_call|function_call)>\s*([\s\S]*?)<\/(?:[\w]+:)?(?:tool_call|function_call)>/gi
const XML_INVOKE_RE = /<invoke\s+name=["'](\w+)["']>\s*([\s\S]*?)<\/invoke>/gi
const XML_PARAM_RE = /<parameter\s+name=["'](\w+)["']>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/parameter>/gi

const TOOL_CODE_RE = /<tool_code>\s*\{([\s\S]*?)\}\s*<\/tool_code>/gi

const DSML_PIPES = /[｜|]+/g
const DSML_TOOL_CALLS_RE = /<\s*[｜|]+\s*DSML\s*[｜|]+\s*tool_calls\s*>([\s\S]*?)<\s*\/\s*[｜|]+\s*DSML\s*[｜|]+\s*tool_calls\s*>/gi
const DSML_INVOKE_RE = /<\s*[｜|]+\s*DSML\s*[｜|]+\s*invoke\s+name=["'](\w+)["']\s*>([\s\S]*?)<\s*\/\s*[｜|]+\s*DSML\s*[｜|]+\s*invoke\s*>/gi

export type ParsedToolCall = {
  toolName: string
  args: Record<string, string>
}

function parseToolCallJson(text: string): ParsedToolCall | null {
  try {
    const parsed = JSON.parse(text.trim())
    if (!parsed || typeof parsed !== "object") return null
    const toolName = parsed.tool ?? parsed.name ?? parsed.tool_name ?? parsed.function
    if (!toolName) return null
    const args = parsed.args ?? parsed.arguments ?? parsed.parameters ?? {}
    return {
      toolName: String(toolName).toLowerCase(),
      args: typeof args === "object" && args !== null ? args : { value: String(args) },
    }
  } catch {
    return null
  }
}

function parseXmlParams(xml: string): Record<string, string> {
  const args: Record<string, string> = {}
  let match
  XML_PARAM_RE.lastIndex = 0
  while ((match = XML_PARAM_RE.exec(xml)) !== null) {
    args[match[1]] = match[2].trim()
  }
  return args
}

export function parseToolCalls(text: string): ParsedToolCall[] {
  if (!text || typeof text !== "string") return []

  const results: ParsedToolCall[] = []

  // Format 1: [TOOL_CALL] { ... } [/TOOL_CALL]
  let match: RegExpExecArray | null
  TOOL_CALL_RE.lastIndex = 0
  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    const parsed = parseToolCallJson(match[1])
    if (parsed) results.push(parsed)
  }

  // Format 2: XML <invoke name="tool">...</invoke> inside <tool_call>
  XML_TOOL_CALL_RE.lastIndex = 0
  while ((match = XML_TOOL_CALL_RE.exec(text)) !== null) {
    const invokeMatch = XML_INVOKE_RE.exec(match[1])
    if (invokeMatch) {
      results.push({
        toolName: invokeMatch[1].toLowerCase(),
        args: parseXmlParams(invokeMatch[2]),
      })
    }
  }

  // Format 3: Standalone <invoke name="tool">...</invoke>
  XML_INVOKE_RE.lastIndex = 0
  while ((match = XML_INVOKE_RE.exec(text)) !== null) {
    results.push({
      toolName: match[1].toLowerCase(),
      args: parseXmlParams(match[2]),
    })
  }

  // Format 4: <tool_code> { ... } </tool_code>
  TOOL_CODE_RE.lastIndex = 0
  while ((match = TOOL_CODE_RE.exec(text)) !== null) {
    const parsed = parseToolCallJson(match[1])
    if (parsed) results.push(parsed)
  }

  // Format 5: DeepSeek DSML | DSML | tool_calls markup
  DSML_TOOL_CALLS_RE.lastIndex = 0
  while ((match = DSML_TOOL_CALLS_RE.exec(text)) !== null) {
    const invokeMatch = DSML_INVOKE_RE.exec(match[1])
    if (invokeMatch) {
      results.push({
        toolName: invokeMatch[1].toLowerCase(),
        args: parseXmlParams(invokeMatch[2]),
      })
    }
  }

  return results
}
