import { Effect, Schedule, Scope } from "effect"
import { MCP } from "@/mcp"

export type HivePeer = {
  id: string; engine: string
  cwd?: string | null; repo?: string | null; summary?: string | null
  http_port?: number | null; session_id?: string | null
  last_seen_at: string; stale: boolean
}

export type HiveTask = {
  id: number; title: string; scope?: string | null; zone?: string | null
  priority: "high" | "normal" | "low"
  status: "open" | "claimed" | "done" | "cancelled"
  owner?: string | null; stale?: boolean
}

export type HiveMessage = {
  id: number; from_peer: string; to_peer: string
  subject?: string | null; body: string; sent_at: string; read_at?: string | null
}

export type HiveBoard = { open: number; claimed: number; stale: number; mineClaimedCount: number; highPrioMine: number }

export type HiveState = {
  apiOnline: boolean; lastFetchAt: number
  self: HivePeer | null; peers: HivePeer[]
  inbox: HiveMessage[]; board: HiveBoard
}

let cached: HiveState = {
  apiOnline: false, lastFetchAt: 0, self: null,
  peers: [], inbox: [],
  board: { open: 0, claimed: 0, stale: 0, mineClaimedCount: 0, highPrioMine: 0 },
}

export function getCached(): HiveState { return cached }

export function resetForTest(): void {
  cached = {
    apiOnline: false, lastFetchAt: 0, self: null,
    peers: [], inbox: [],
    board: { open: 0, claimed: 0, stale: 0, mineClaimedCount: 0, highPrioMine: 0 },
  }
}

function parseContent(res: any): any {
  try { return JSON.parse(res?.content?.[0]?.text || "null") } catch { return null }
}

export const startPoll = Effect.fn("HivemindSidebar.startPoll")(function* (mcp: MCP.Interface, peerId: string, scope: Scope.Scope) {
  const poll = Effect.fnUntraced(function* () {
    const clients = yield* mcp.clients()
    const client = clients["hivemind"]
    if (!client) return

    try {
      const peersRes: any = yield* Effect.promise(() => client.callTool({ name: "hivemind_peers", arguments: {} }))
      const peersData = parseContent(peersRes)
      const peers: HivePeer[] = peersData?.peers ?? peersData ?? []
      const self = peerId ? peers.find((p: HivePeer) => p.id === peerId) ?? null : null
      const alive = peers.filter((p: HivePeer) => !p.stale && p.id !== peerId)

      const safeCall = async (name: string, args: any) => {
        try { return await client.callTool({ name, arguments: args }) } catch { return null }
      }
      const inboxRes = yield* Effect.promise(() => safeCall("hivemind_inbox", { peerId, includeRead: true, markRead: false, limit: 20 }))
      const tasksRes = yield* Effect.promise(() => safeCall("hivemind_list", {}))

      const inboxData = parseContent(inboxRes)
      const inbox: HiveMessage[] = inboxData?.messages
        ? inboxData.messages.filter((m: HiveMessage) => !m.read_at).slice(0, 10)
        : []

      const tasksData = parseContent(tasksRes)
      const tasks: HiveTask[] = tasksData?.tasks ?? tasksData ?? []
      const board: HiveBoard = {
        open: tasks.filter((t) => t.status === "open").length,
        claimed: tasks.filter((t) => t.status === "claimed").length,
        stale: tasks.filter((t) => t.stale).length,
        mineClaimedCount: tasks.filter((t) => t.owner === peerId && t.status === "claimed").length,
        highPrioMine: tasks.filter((t) => t.priority === "high" && t.status === "open").length,
      }

      cached = { apiOnline: true, lastFetchAt: Date.now(), self, peers: alive, inbox, board }
    } catch {
      cached = { ...cached, apiOnline: false, lastFetchAt: Date.now() }
    }
  })

  yield* Effect.repeat(poll(), Schedule.fixed(2000)).pipe(Effect.forkIn(scope))
})

export * as HivemindSidebar from "./hivemind-sidebar"