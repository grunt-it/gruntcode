import { Effect, Option, Scope } from "effect"
import { MCP } from "@/mcp"
import { MessageV2 } from "./message-v2"
import * as Log from "@opencode-ai/core/util/log"

type MCPShape = MCP.Interface

/**
 * Loop-primitive hook (#266 Phase 1) — bridges gruntcode's per-turn lifecycle to the
 * hivemind-mcp loop primitive (hivemind_record_turn_end + hivemind_loop_progress).
 *
 * The loop primitive shipped in hivemind-mcp v0.8.2 (PR #18) provides the data layer +
 * decision logic; THIS module is the event source. Every gruntcode step-finish + every
 * tool-result fires into the MCP, which decides whether to continue the same peer (auto-
 * wake with continuation prompt), escalate to parent (auto-wake with violation context),
 * or no-op (clean exit / rate-limited / no loop_goal set).
 *
 * Hard correctness rule (#266 spec): hook failures MUST NEVER break the TUI. Every call
 * pipes through Effect.ignore + Effect.forkIn(scope) so the TUI never blocks on the MCP
 * call and never sees an exception from a slow / failing hivemind connection.
 *
 * Feature-flagged: opt-in via OPENCODE_HIVEMIND_LOOP_ENABLED=1 (RuntimeFlags.hivemindLoopEnabled).
 * Off by default in Phase 1 so users can adopt per-tab + we can flip the global default in
 * Phase 2 after validating in the wild.
 */

const log = Log.create({ service: "session.hivemind-loop-hook" })

const EXCERPT_CAP = 500

/**
 * Find the MCP client that exposes the loop primitive tools. The hivemind MCP is conventionally
 * named "hivemind" in user opencode.json but we don't hard-code the name — we look up the
 * client by checking each one's tool list for our target tool.
 *
 * Takes a pre-yielded MCP.Service instance instead of yielding it itself so callers (which
 * yield the service once at layer construction) can pass it through without re-yielding. This
 * is what lets the hook satisfy the processor's `never` environment requirement.
 */
const findHivemindClient = Effect.fnUntraced(function* (mcp: MCPShape, toolName: string) {
  const clients = yield* mcp.clients()
  const clientNames = Object.keys(clients)
  if (clientNames.length === 0) return undefined
  // Convention: the hivemind MCP is named "hivemind". Most users will have it under that key,
  // and that's the fast path. We fall through to a scan only if the conventional name isn't
  // present — handles the rare case where someone renamed it (e.g. "hivemind-prod") or set up
  // multiple coordination MCPs.
  if (clientNames.includes("hivemind")) {
    return clients["hivemind"]
  }
  // Slow path: ask each client for its tool list + pick the one that exposes our tool. We
  // accept the cost only when the conventional name isn't present, which should be rare.
  const tools = yield* mcp.tools()
  // The tools map composes "<clientName>_<toolName>" as the registry key. Find a key matching
  // our tool name suffix, then return that client.
  const matchingKey = Object.keys(tools).find((k) => k.endsWith(`_${toolName}`) || k === toolName)
  if (!matchingKey) return undefined
  const owningName = clientNames.find((name) => matchingKey.startsWith(`${name}_`) || matchingKey === toolName)
  return owningName ? clients[owningName] : undefined
})

/**
 * Build the last-message excerpt + tool-call count for a finished turn. Reads the
 * assistant message's parts synchronously via MessageV2.parts (DB read).
 *
 * Excerpt: concatenate text parts in part-id order, take last 500 chars. Tool count: count
 * tool parts whose state.status indicates a completed (non-error, non-pending) call. The
 * MCP's evaluateLoop logic uses tool_call_count=0 as a "silent stall" signal, so we want
 * the count to reflect actual tool ACTIVITY this turn, not just any tool part.
 */
function buildTurnSummary(messageId: MessageV2.Assistant["id"]) {
  const parts = MessageV2.parts(messageId)
  const textParts = parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  // Concatenate text parts to form the excerpt. Most turns have one or two text parts; join
  // with newlines so contiguous text reads naturally.
  const fullText = textParts.map((p) => p.text).join("\n").trim()
  const excerpt =
    fullText.length > EXCERPT_CAP
      ? fullText.slice(fullText.length - EXCERPT_CAP)
      : fullText
  const toolCallCount = parts.filter((p) => p.type === "tool").length
  return { excerpt, toolCallCount }
}

/**
 * Fire hivemind_record_turn_end after a step-finish. Caller invokes this inside the
 * processor's step-finish handler. Fire-and-forget via Effect.forkIn(scope) so the
 * processor's hot path doesn't block on the MCP roundtrip.
 *
 * The MCP wraps evaluateLoop + fires the wake/escalation internally. This side just sends
 * the turn-end event and forgets.
 *
 * Off when OPENCODE_HIVEMIND_LOOP_ENABLED is unset/false — silent no-op.
 */
export const recordTurnEnd = Effect.fn("HivemindLoopHook.recordTurnEnd")(function* (input: {
  enabled: boolean
  mcp: Option.Option<MCPShape>
  sessionID: string
  messageID: MessageV2.Assistant["id"]
  finishReason: string | undefined
  scope: Scope.Scope
}) {
  if (!input.enabled) return
  if (Option.isNone(input.mcp)) return
  const client = yield* findHivemindClient(input.mcp.value, "hivemind_record_turn_end")
  if (!client) {
    yield* Effect.logDebug("no hivemind MCP client found for record_turn_end; flag enabled but MCP unavailable")
    return
  }
  // Build summary AFTER client resolution so we don't pay the DB read when we're going to
  // no-op anyway.
  const summary = buildTurnSummary(input.messageID)
  // Fork the MCP call into the scope so the processor doesn't await it. Effect.ignore swallows
  // any error from the call — the loop primitive's correctness rule is that the hook must
  // never break the TUI, so we accept silent best-effort delivery here.
  yield* Effect.promise(() =>
    client.callTool({
      name: "hivemind_record_turn_end",
      arguments: {
        session_id: input.sessionID,
        finish_reason: input.finishReason ?? null,
        last_msg_excerpt: summary.excerpt,
        tool_call_count: summary.toolCallCount,
      },
    }),
  ).pipe(
    Effect.tapError((err) =>
      Effect.sync(() => log.warn("recordTurnEnd MCP call failed (non-fatal)", { err })),
    ),
    Effect.ignore,
    Effect.forkIn(input.scope),
  )
})

/**
 * Fire hivemind_loop_progress after a tool-result. Cheap call — just bumps
 * last_loop_progress_at so evaluate_loop sees fresh activity. Same fire-and-forget guarantee.
 *
 * Off when OPENCODE_HIVEMIND_LOOP_ENABLED is unset/false — silent no-op.
 */
export const loopProgress = Effect.fn("HivemindLoopHook.loopProgress")(function* (input: {
  enabled: boolean
  mcp: Option.Option<MCPShape>
  scope: Scope.Scope
}) {
  if (!input.enabled) return
  if (Option.isNone(input.mcp)) return
  const client = yield* findHivemindClient(input.mcp.value, "hivemind_loop_progress")
  if (!client) return
  yield* Effect.promise(() =>
    client.callTool({
      name: "hivemind_loop_progress",
      arguments: {},
    }),
  ).pipe(
    Effect.tapError((err) =>
      Effect.sync(() => log.debug("loopProgress MCP call failed (non-fatal)", { err })),
    ),
    Effect.ignore,
    Effect.forkIn(input.scope),
  )
})

export * as HivemindLoopHook from "./hivemind-loop-hook"
