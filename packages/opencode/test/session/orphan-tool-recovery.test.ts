import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Session as SessionNs } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { Database } from "@/storage/db"
import { MessageTable, PartTable } from "@/session/session.sql"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const it = testEffect(SessionNs.defaultLayer)

// Stale enough that the orphan-recovery threshold fires (60s).
const ANCIENT_MS = Date.now() - 5 * 60_000

// Insert a raw orphan tool row directly into the part table, simulating the
// state on disk after a process was killed mid-tool-call (hivemind #254
// repro). Bypasses session.updatePart on purpose — that path would refuse a
// freshly-created running tool because the message hasn't been authored yet,
// and we want exactly the kill-9 shape (orphan row, message present, no
// follow-up part).
const seedOrphan = Effect.fn("Test.seedOrphan")(function* (
  sessionID: SessionID,
  tool: string,
  status: "running" | "pending",
) {
  const messageID = MessageID.ascending()
  const partID = PartID.ascending()
  yield* Effect.sync(() =>
    Database.use((db) => {
      db.insert(MessageTable)
        .values({
          id: messageID,
          session_id: sessionID,
          time_created: ANCIENT_MS,
          time_updated: ANCIENT_MS,
          data: {
            role: "assistant",
            time: { created: ANCIENT_MS },
            agent: "test",
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            mode: "",
            model: { providerID: "test", modelID: "test" },
            path: { cwd: "/", root: "/" },
            system: [],
            tools: {},
          } as never,
        })
        .run()
      db.insert(PartTable)
        .values({
          id: partID,
          message_id: messageID,
          session_id: sessionID,
          time_created: ANCIENT_MS,
          time_updated: ANCIENT_MS,
          data:
            status === "running"
              ? ({
                  type: "tool",
                  callID: `call_${tool}`,
                  tool,
                  state: {
                    status: "running",
                    input: { foo: "bar" },
                    title: tool,
                    time: { start: ANCIENT_MS },
                  },
                } as never)
              : ({
                  type: "tool",
                  callID: `call_${tool}`,
                  tool,
                  state: {
                    status: "pending",
                    input: { foo: "bar" },
                    raw: "",
                  },
                } as never),
        })
        .run()
    }),
  )
  return { messageID, partID }
})

const withSession = <A, E, R>(
  fn: (input: { session: SessionNs.Interface; sessionID: SessionID }) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const created = yield* session.create({})
      return { session, sessionID: created.id }
    }),
    fn,
    (input) => input.session.remove(input.sessionID).pipe(Effect.ignore),
  )

describe("orphan tool-part recovery on session resume (#254)", () => {
  it.instance("transforms an orphaned running `question` tool-part into a synthetic error", () =>
    withSession(({ session, sessionID }) =>
      Effect.gen(function* () {
        yield* seedOrphan(sessionID, "question", "running")

        const messages = yield* session.messages({ sessionID })
        const orphan = messages
          .flatMap((m) => m.parts)
          .find((p) => p.type === "tool")
        expect(orphan).toBeDefined()
        if (orphan?.type !== "tool") throw new Error("expected tool part")
        expect(orphan.state.status).toBe("error")
        if (orphan.state.status !== "error") throw new Error("narrowing failed")
        expect(orphan.state.error).toContain("interrupted")
        expect(orphan.state.metadata?.interrupted).toBe(true)
        // The synthetic timeline must satisfy ToolStateError's schema invariant
        // (end >= start) — otherwise downstream consumers panic.
        expect(orphan.state.time.end).toBeGreaterThanOrEqual(orphan.state.time.start)
      }),
    ),
  )

  it.instance("transforms an orphaned pending bash tool-part into a synthetic error", () =>
    withSession(({ session, sessionID }) =>
      Effect.gen(function* () {
        yield* seedOrphan(sessionID, "bash", "pending")

        const messages = yield* session.messages({ sessionID })
        const orphan = messages.flatMap((m) => m.parts).find((p) => p.type === "tool")
        if (orphan?.type !== "tool") throw new Error("expected tool part")
        expect(orphan.state.status).toBe("error")
      }),
    ),
  )

  it.instance("does not transform a tool-part whose state is already completed", () =>
    withSession(({ session, sessionID }) =>
      Effect.gen(function* () {
        const messageID = MessageID.ascending()
        const partID = PartID.ascending()
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.insert(MessageTable)
              .values({
                id: messageID,
                session_id: sessionID,
                time_created: ANCIENT_MS,
                time_updated: ANCIENT_MS,
                data: {
                  role: "assistant",
                  time: { created: ANCIENT_MS },
                  agent: "test",
                  cost: 0,
                  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                  mode: "",
                  model: { providerID: "test", modelID: "test" },
                  path: { cwd: "/", root: "/" },
                  system: [],
                  tools: {},
                } as never,
              })
              .run()
            db.insert(PartTable)
              .values({
                id: partID,
                message_id: messageID,
                session_id: sessionID,
                time_created: ANCIENT_MS,
                time_updated: ANCIENT_MS,
                data: {
                  type: "tool",
                  callID: "call_done",
                  tool: "read",
                  state: {
                    status: "completed",
                    input: { path: "/etc/hostname" },
                    output: "ok",
                    title: "read",
                    metadata: { exit: 0 },
                    time: { start: ANCIENT_MS - 1, end: ANCIENT_MS },
                  },
                } as never,
              })
              .run()
          }),
        )

        const messages = yield* session.messages({ sessionID })
        const completed = messages.flatMap((m) => m.parts).find((p) => p.type === "tool")
        if (completed?.type !== "tool") throw new Error("expected tool part")
        expect(completed.state.status).toBe("completed")
      }),
    ),
  )

  it.instance("does not transform a running tool-part that's still within the 60s window", () =>
    withSession(({ session, sessionID }) =>
      Effect.gen(function* () {
        const messageID = MessageID.ascending()
        const partID = PartID.ascending()
        // start = NOW. Recovery threshold is 60s; this should be untouched.
        const now = Date.now()
        yield* Effect.sync(() =>
          Database.use((db) => {
            db.insert(MessageTable)
              .values({
                id: messageID,
                session_id: sessionID,
                time_created: now,
                time_updated: now,
                data: {
                  role: "assistant",
                  time: { created: now },
                  agent: "test",
                  cost: 0,
                  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                  mode: "",
                  model: { providerID: "test", modelID: "test" },
                  path: { cwd: "/", root: "/" },
                  system: [],
                  tools: {},
                } as never,
              })
              .run()
            db.insert(PartTable)
              .values({
                id: partID,
                message_id: messageID,
                session_id: sessionID,
                time_created: now,
                time_updated: now,
                data: {
                  type: "tool",
                  callID: "call_live",
                  tool: "bash",
                  state: {
                    status: "running",
                    input: { cmd: "sleep 1" },
                    title: "bash",
                    time: { start: now },
                  },
                } as never,
              })
              .run()
          }),
        )

        const messages = yield* session.messages({ sessionID })
        const live = messages.flatMap((m) => m.parts).find((p) => p.type === "tool")
        if (live?.type !== "tool") throw new Error("expected tool part")
        // Fresh running tool must stay running — would be wrong to clobber a
        // tool call that's actually in flight in some other process.
        expect(live.state.status).toBe("running")
      }),
    ),
  )

  it.instance("covers multiple orphan tool types simultaneously (bash, read, edit, question)", () =>
    withSession(({ session, sessionID }) =>
      Effect.gen(function* () {
        for (const tool of ["bash", "read", "edit", "question"]) {
          yield* seedOrphan(sessionID, tool, "running")
        }

        const messages = yield* session.messages({ sessionID })
        const tools = messages.flatMap((m) => m.parts).filter((p) => p.type === "tool")
        expect(tools).toHaveLength(4)
        for (const t of tools) {
          if (t.type !== "tool") throw new Error("expected tool part")
          expect(t.state.status).toBe("error")
        }
      }),
    ),
  )
})
