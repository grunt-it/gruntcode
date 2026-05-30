import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer, Context } from "effect"
import type { SessionID } from "./schema"

export interface Violation {
  readonly sessionID: SessionID
  readonly type: "repeated-tool" | "other"
  readonly tool: string
  readonly input: Record<string, unknown>
  readonly turns: number
  readonly timestamp: number
}

interface SessionFeedbackState {
  readonly violations: Violation[]
}

export interface Interface {
  readonly record: (violation: Violation) => Effect.Effect<void>
  readonly inject: (sessionID: SessionID) => Effect.Effect<string[]>
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Feedback") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // Per-instance state: Map of sessionID → violations
    // InstanceState persists across turns AND across compaction (in-memory, scoped to process)
    const state = yield* InstanceState.make(
      Effect.fn("Feedback.state")(() => Effect.succeed(new Map<SessionID, SessionFeedbackState>())),
    )

    const getSessionState = Effect.fn("Feedback.getSessionState")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      let s = data.get(sessionID)
      if (!s) {
        s = { violations: [] }
        data.set(sessionID, s)
      }
      return s
    })

    const record: Interface["record"] = Effect.fn("Feedback.record")(function* (violation: Violation) {
      const s = yield* getSessionState(violation.sessionID)
      s.violations.push(violation)
    })

    // Always inject ALL violations into the system prompt. This ensures violations survive
    // compaction (InstanceState persists but conversation history is reset). The overhead is
    // minimal (~100 chars per violation) and the model always has its full violation history.
    const inject: Interface["inject"] = Effect.fn("Feedback.inject")(function* (sessionID: SessionID) {
      const s = yield* getSessionState(sessionID)
      if (s.violations.length === 0) return []

      // Deduplicate: group by tool+input, keep highest turn count
      const seen = new Map<string, Violation>()
      for (const v of s.violations) {
        const key = `${v.tool}:${JSON.stringify(v.input)}`
        const existing = seen.get(key)
        if (!existing || v.turns > existing.turns) {
          seen.set(key, v)
        }
      }

      const messages = [...seen.values()].map((v) => {
        const inputSummary = JSON.stringify(v.input).slice(0, 100)
        return [
          `<system-reminder>`,
          `BLOCKED: You called \`${v.tool}\` with identical arguments ${v.turns} consecutive turns.`,
          `Input: ${inputSummary}`,
          `You MUST use the existing result or produce a text answer. Do NOT call this tool again with the same arguments.`,
          `</system-reminder>`,
        ].join("\n")
      })

      return messages
    })

    const clear: Interface["clear"] = Effect.fn("Feedback.clear")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      data.delete(sessionID)
    })

    return Service.of({ record, inject, clear })
  }),
)

export const defaultLayer = layer

export * as Feedback from "./feedback"
