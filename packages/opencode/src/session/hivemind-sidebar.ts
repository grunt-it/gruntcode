import { Effect, Schedule, Scope } from "effect"
import { MCP } from "@/mcp"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "session.hivemind-sidebar" })

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

export type HiveBoard = {
  open: number; claimed: number; stale: number
  mineClaimedCount: number; highPrioMine: number
}

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

export function getCached(): HiveState {
  return cached
}

const findClient = Effect.fnUntraced(function* (mcp: MCP.Interface) {
  const clients = yield* mcp.clients()
  const tools = yield* mcp.tools()
  if (clients["hivemind"]) return clients["hivemind"]
  const matchingKey = Object.keys(tools).find((k) => k.endsWith("_hivemind_peers"))
  if (!matchingKey) return undefined
  const name = Object.keys(clients).find((n) => matchingKey.startsWith(`${n}_`))
  return name ? clients[name] : undefined
})

async function callTool(client: unknown, name: string, args: Record<string, unknown> = {}) {
  const c = client as { callTool: (p: { name: string; arguments: Record<string, unknown> }) => Promise<{ content: Array<{ text?: string }> }> }
  const r = await c.callTool({ name, arguments: args })
  const text = r.content?.[0]?.text
  if (!text) return null
  return JSON.parse(text)
}

async function doPoll(client: unknown, peerId: string) {
  try {
    const peersRaw = await callTool(client, "hivemind_peers", { aliveOnly: false })
    if (!peersRaw) { cached = { ...cached, apiOnline: false, lastFetchAt: Date.now() }; return }
    const peers: HivePeer[] = peersRaw.peers ?? peersRaw ?? []
    const self = peerId ? peers.find((p) => p.id === peerId) ?? null : null
    const alive = peers.filter((p) => !p.stale && p.id !== peerId)

    const [inboxRaw, tasksRaw] = await Promise.all([
      callTool(client, "hivemind_inbox", { peerId, includeRead: true, markRead: false, limit: 20 }),
      callTool(client, "hivemind_list", {}),
    ]).catch(() => [null, null] as const)

    const inbox: HiveMessage[] = inboxRaw
      ? (inboxRaw.messages ?? inboxRaw ?? []).filter((m: HiveMessage) => !m.read_at).slice(0, 10)
      : []
    const board: HiveBoard = { open: 0, claimed: 0, stale: 0, mineClaimedCount: 0, highPrioMine: 0 }
    if (tasksRaw) {
      const tasks: HiveTask[] = tasksRaw.tasks ?? tasksRaw ?? []
      const open = tasks.filter((t) => t.status === "open")
      const claimed = tasks.filter((t) => t.status === "claimed")
      board.open = open.length
      board.claimed = claimed.length
      board.stale = tasks.filter((t) => t.stale).length
      board.mineClaimedCount = claimed.filter((t) => t.owner === peerId).length
      board.highPrioMine = open.filter((t) => t.priority === "high").length
    }

    cached = { apiOnline: true, lastFetchAt: Date.now(), self, peers: alive, inbox, board }
  } catch {
    cached = { ...cached, apiOnline: false, lastFetchAt: Date.now() }
  }
}

export const startPoll = Effect.fn("HivemindSidebar.startPoll")(function* (mcp: MCP.Interface, peerId: string) {
  const poll = Effect.fnUntraced(function* () {
    const client = yield* findClient(mcp)
    if (!client) return
    yield* Effect.promise(() => doPoll(client, peerId))
  })

  yield* Effect.repeat(poll(), Schedule.fixed(2000)).pipe(
    Effect.forkScoped,
  )
})

export * as HivemindSidebar from "./hivemind-sidebar"
