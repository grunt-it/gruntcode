import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tool-parser" })

const TOOL_CALL_RE = /\[TOOL_CALL\]\s*(\{[\s\S]*?\})\s*\[\/TOOL_CALL\]/gi

const XML_WRAPPER_RE = /<(?:[\w]+:)?(?:tool_call|function_call)>\s*([\s\S]*?)<\/(?:[\w]+:)?(?:tool_call|function_call)>/gi
const XML_INVOKE_RE = /<invoke\s+name=["'](\w+)["']>\s*([\s\S]*?)<\/invoke>/gi
const XML_PARAM_RE = /<parameter\s+name=["'](\w+)["']>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/parameter>/gi

const TOOL_CODE_RE = /<tool_code>\s*(\{[\s\S]*?\})\s*<\/tool_code>/gi

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
  let match: RegExpExecArray | null
  XML_PARAM_RE.lastIndex = 0
  while ((match = XML_PARAM_RE.exec(xml)) !== null) {
    args[match[1]] = match[2].trim()
  }
  return args
}

function normalizeDsml(text: string): string {
  // DeepSeek DSML uses pipe delimiters instead of standard XML open brackets.
  // Strip the pipe+DSML prefix from any XML tag, preserving the bracket+slash.
  //
  //   <|DSML|tool_calls>      ->  <tool_calls>
  //   </|DSML|tool_calls>     ->  </tool_calls>
  //   <｜DSML｜invoke name=""> ->  <invoke name="">
  //   </｜DSML｜/invoke>       ->  </invoke>
  return text
    .replace(/<[\/]?\s*[｜|]+\s*(?:DSML)\s*[｜|]+\s*/gi, (m) => {
      if (m.startsWith("</")) return "</"
      if (m.startsWith("<")) return "<"
      return "<"
    })
    .replace(/[｜|]+\s*(?:DSML)\s*[｜|]+\s*/gi, "")
    .replace(/<\/\s*\//g, "</")
}

function extractInvokes(text: string): ParsedToolCall[] {
  const results: ParsedToolCall[] = []
  let match: RegExpExecArray | null
  XML_INVOKE_RE.lastIndex = 0
  while ((match = XML_INVOKE_RE.exec(text)) !== null) {
    results.push({
      toolName: match[1].toLowerCase(),
      args: parseXmlParams(match[2]),
    })
  }
  return results
}

export function parseToolCalls(text: string): ParsedToolCall[] {
  if (!text || typeof text !== "string") return []

  const results: ParsedToolCall[] = []
  let match: RegExpExecArray | null
  let processed: string[] = []

  // Format 1: [TOOL_CALL] { ... } [/TOOL_CALL]
  TOOL_CALL_RE.lastIndex = 0
  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    const parsed = parseToolCallJson(match[1])
    if (parsed) results.push(parsed)
  }

  // Format 2: DSML normalization first, then parse as XML
  const normalized = normalizeDsml(text)
  let xmlSource = normalized

  // Format 3: Strip tool_call/function_call wrappers, parse inner content
  XML_WRAPPER_RE.lastIndex = 0
  while ((match = XML_WRAPPER_RE.exec(xmlSource)) !== null) {
    const invokes = extractInvokes(match[1])
    for (const inv of invokes) {
      if (!processed.includes(inv.toolName + JSON.stringify(inv.args))) {
        results.push(inv)
        processed.push(inv.toolName + JSON.stringify(inv.args))
      }
    }
    // Replace the wrapper so standalone invokes don't re-count it
    xmlSource = xmlSource.slice(0, match.index) + xmlSource.slice(match.index + match[0].length)
    XML_WRAPPER_RE.lastIndex = 0
  }

  // Format 4: Standalone <invoke> outside wrappers (on the stripped source)
  XML_INVOKE_RE.lastIndex = 0
  while ((match = XML_INVOKE_RE.exec(xmlSource)) !== null) {
    const key = match[1].toLowerCase() + JSON.stringify(parseXmlParams(match[2]))
    if (!processed.includes(key)) {
      results.push({
        toolName: match[1].toLowerCase(),
        args: parseXmlParams(match[2]),
      })
      processed.push(key)
    }
  }

  // Format 5: <tool_code> { ... } </tool_code>
  TOOL_CODE_RE.lastIndex = 0
  while ((match = TOOL_CODE_RE.exec(text)) !== null) {
    const parsed = parseToolCallJson(match[1])
    if (parsed) results.push(parsed)
  }

  return results
}
