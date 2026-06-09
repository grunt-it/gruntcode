import { describe, expect, test, beforeEach } from "bun:test"
import { Effect, Layer, Scope, Exit } from "effect"
import { MCP } from "@/mcp"
import { HivemindSidebar } from "@/session/hivemind-sidebar"
import { testEffect } from "../lib/effect"

// Stub MCP client that returns deterministic mock data for hivemind tools.
function stubClient(data: {
  peers?: any
  inbox?: any
  tasks?: any
}) {
  return {
    callTool: async (req: { name: string; arguments: Record<string, unknown> }) => {
      const canned: Record<string, (args: any) => any> = {
        hivemind_peers: () => data.peers ?? { peers: [{ id: "test-peer", engine: "opencode", stale: false }] },
        hivemind_inbox: () => data.inbox ?? { messages: [] },
        hivemind_list: () => data.tasks ?? { tasks: [] },
      }
      const handler = canned[req.name]
      if (!handler) throw new Error(`unexpected tool: ${req.name}`)
      const result = handler(req.arguments)
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] }
    },
  } as any
}

// Build a stub MCP interface with a configurable clients() return.
function makeStubMcp(clientOrClients: any): MCP.Interface {
  const getClients = typeof clientOrClients === "function"
    ? clientOrClients
    : () => ({ hivemind: clientOrClients })
  return {
    status: () => Effect.succeed({ hivemind: { status: "connected" as const } }),
    clients: () => Effect.succeed(getClients()),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: {} }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.succeed({ authorizationUrl: "", oauthState: "" }),
    authenticate: () => Effect.succeed({ status: "connected" as const }),
    finishAuth: () => Effect.succeed({ status: "connected" as const }),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed({ kind: "none" as const }),
  } as unknown as MCP.Interface
}

const peersData = {
  peers: [
    { id: "test-peer", engine: "opencode", stale: false, last_seen_at: "2026-06-09T12:00:00Z" },
    { id: "other-peer", engine: "opencode", stale: false, last_seen_at: "2026-06-09T12:00:00Z" },
    { id: "stale-peer", engine: "opencode", stale: true, last_seen_at: "2026-06-09T11:00:00Z" },
  ],
}

const inboxData = {
  messages: [
    { id: 1, from_peer: "other-peer", to_peer: "test-peer", body: "hello", sent_at: "2026-06-09T12:00:00Z" },
    { id: 2, from_peer: "other-peer", to_peer: "test-peer", body: "read msg", sent_at: "2026-06-09T11:00:00Z", read_at: "2026-06-09T11:30:00Z" },
  ],
}

const tasksData = {
  tasks: [
    { id: 1, title: "Open task", status: "open", priority: "high", zone: "frontend" },
    { id: 2, title: "Claimed task", status: "claimed", priority: "normal", owner: "test-peer" },
    { id: 3, title: "Stale claimed task", status: "claimed", priority: "low", owner: "other-peer", stale: true },
    { id: 4, title: "Done task", status: "done", priority: "normal" },
  ],
}

describe("HivemindSidebar", () => {
  beforeEach(() => {
    HivemindSidebar.resetForTest()
  })

  describe("getCached", () => {
    test("returns default offline state before any poll", () => {
      const state = HivemindSidebar.getCached()
      expect(state.apiOnline).toBe(false)
      expect(state.lastFetchAt).toBe(0)
      expect(state.peers).toEqual([])
      expect(state.self).toBeNull()
      expect(state.inbox).toEqual([])
      expect(state.board).toEqual({
        open: 0, claimed: 0, stale: 0, mineClaimedCount: 0, highPrioMine: 0,
      })
    })
  })

  describe("startPoll", () => {
    const it = testEffect(Layer.empty)

    it.live("poll updates cached state with peers, inbox, board", () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const client = stubClient({ peers: peersData, inbox: inboxData, tasks: tasksData })
        const mcp = makeStubMcp(client)

        yield* HivemindSidebar.startPoll(mcp, "test-peer", scope)
        yield* Effect.sleep("2100 millis")

        const state = HivemindSidebar.getCached()
        expect(state.apiOnline).toBe(true)
        expect(state.lastFetchAt).toBeGreaterThan(0)
        expect(state.self).not.toBeNull()
        expect(state.self!.id).toBe("test-peer")
        expect(state.peers.length).toBe(1)
        expect(state.peers[0].id).toBe("other-peer")
        expect(state.inbox.length).toBe(1)
        expect(state.inbox[0].id).toBe(1)
        expect(state.board.open).toBe(1)
        expect(state.board.claimed).toBe(2)
        expect(state.board.stale).toBe(1)
        expect(state.board.mineClaimedCount).toBe(1)
        expect(state.board.highPrioMine).toBe(1)

        yield* Scope.close(scope, Exit.succeed(undefined))
      }),
      30000,
    )

    it.live("stays offline when MCP client not yet available", () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const mcp = makeStubMcp(() => ({}))

        yield* HivemindSidebar.startPoll(mcp, "test-peer", scope)
        yield* Effect.sleep("2500 millis")

        expect(HivemindSidebar.getCached().apiOnline).toBe(false)
        yield* Scope.close(scope, Exit.succeed(undefined))
      }),
      30000,
    )

    it.live("comes online when client appears after a delay", () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const client = stubClient({ peers: peersData, inbox: inboxData, tasks: tasksData })
        let available = false
        const mcp = makeStubMcp(() => (available ? { hivemind: client } : {}))

        yield* HivemindSidebar.startPoll(mcp, "test-peer", scope)
        yield* Effect.sleep("2500 millis")
        expect(HivemindSidebar.getCached().apiOnline).toBe(false)

        available = true
        yield* Effect.sleep("2500 millis")
        expect(HivemindSidebar.getCached().apiOnline).toBe(true)
        expect(HivemindSidebar.getCached().peers.length).toBe(1)

        yield* Scope.close(scope, Exit.succeed(undefined))
      }),
      30000,
    )
  })
})
