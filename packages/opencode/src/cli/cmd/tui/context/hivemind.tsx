// grunt-it: hivemind-state context for the TUI sidebar (#229).
//
// Polls hivemind-api at localhost:7890 every N seconds. Falls back to a "hivemind-api offline"
// state when the API isn't reachable (api is auto-started via launchd but may be down during dev).
//
// We chose polling over SSE for v1 because:
// 1. SSE in a long-lived TUI process needs reconnect-on-error logic + heartbeat handling
// 2. The per-turn read cadence of hivemind is fine with a 2s poll — agents aren't watching
//    realtime updates between turns anyway; the panel is for ambient awareness, not live alerts
// 3. Polling has zero state to recover from on api restart
//
// If we need sub-second updates later, swap the polling for an EventSource subscription to
// /api/events (same wire format).

import { createSimpleContext } from "./helper"
import { createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { getPeerID } from "@opencode-ai/core/util/opencode-process"

const DEFAULT_API = "http://127.0.0.1:7890"
const POLL_INTERVAL_MS = 2000

export type Peer = {
  id: string
  engine: string
  cwd?: string | null
  repo?: string | null
  summary?: string | null
  http_port?: number | null
  session_id?: string | null
  last_seen_at: string
  stale: boolean
}

export type Task = {
  id: number
  title: string
  scope?: string | null
  zone?: string | null
  priority: "high" | "normal" | "low"
  status: "open" | "claimed" | "done" | "cancelled"
  owner?: string | null
  stale?: boolean
}

export type Message = {
  id: number
  from_peer: string
  to_peer: string
  subject?: string | null
  body: string
  sent_at: string
  read_at?: string | null
}

export type WakeEvent = {
  id: number
  waker_peer_id: string
  waked_peer_id: string
  trigger_kind: string
  trigger_payload?: string | null
  waked_at: string
  http_status?: number | null
  error_message?: string | null
}

type State = {
  /** http://127.0.0.1:7890 by default; configurable via opencode.json tui.hivemindSidebar.apiBase */
  apiBase: string
  /** API liveness — flips false when a fetch fails; flips back true on success. */
  apiOnline: boolean
  /** Last fetch timestamp (ms epoch) so the UI can show "stale by Ns" if poll is hung. */
  lastFetchAt: number
  /** This peer's own row (looked up from /api/peers/<self-id>). null if not announced yet. */
  self: Peer | null
  /** Other alive peers. */
  peers: Peer[]
  /** Unread DMs for self (newest first). */
  inbox: Message[]
  /** Recent wakes targeting self (newest first, capped). */
  wakes: WakeEvent[]
  /** Board pulse — minimal aggregate counts. */
  board: {
    open: number
    claimed: number
    done24h: number
    stale: number
    /** Open tickets where the current peer is the owner. */
    mineClaimedCount: number
    /** High-priority opens in YOUR zones (zones the self peer has worked recently). */
    highPrioMine: number
  }
}

const emptyBoard = (): State["board"] => ({
  open: 0,
  claimed: 0,
  done24h: 0,
  stale: 0,
  mineClaimedCount: 0,
  highPrioMine: 0,
})

export const { use: useHivemind, provider: HivemindProvider } = createSimpleContext({
  name: "Hivemind",
  init: () => {
    const apiBase = process.env.HIVEMIND_API_BASE ?? DEFAULT_API
    const [state, setState] = createStore<State>({
      apiBase,
      apiOnline: false,
      lastFetchAt: 0,
      self: null,
      peers: [],
      inbox: [],
      wakes: [],
      board: emptyBoard(),
    })

    const peerId = getPeerID()
    let timer: ReturnType<typeof setInterval> | undefined

    async function fetchJson<T>(path: string): Promise<T | null> {
      try {
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), 1500)
        const res = await fetch(`${apiBase}${path}`, { signal: controller.signal })
        clearTimeout(t)
        if (!res.ok) return null
        return (await res.json()) as T
      } catch {
        return null
      }
    }

    async function poll() {
      // peers — /api/peers returns { peers: [...] }
      const peersWrap = await fetchJson<{ peers: Peer[] }>("/api/peers")
      if (peersWrap === null) {
        setState("apiOnline", false)
        setState("lastFetchAt", Date.now())
        return
      }
      setState("apiOnline", true)
      setState("lastFetchAt", Date.now())

      const peers = peersWrap.peers ?? []
      const self = peerId ? peers.find((p) => p.id === peerId) ?? null : null
      setState("self", self)
      setState(
        "peers",
        peers.filter((p) => !p.stale && p.id !== peerId),
      )

      // inbox + tasks — only fetch when peerId is known (otherwise these are meaningless).
      // wakes deferred to a future iteration — hivemind-api doesn't expose wake_log yet.
      // Filed as follow-up; until then, the sidebar just shows the other 4 sections.
      if (peerId) {
        // includeRead=true so we don't accidentally mark all unread messages read just by polling.
        // markRead=false explicit-flag for safety. We filter unread client-side.
        const [inboxWrap, tasksWrap] = await Promise.all([
          fetchJson<{ messages: Message[] }>(
            `/api/messages/inbox?peerId=${encodeURIComponent(peerId)}&includeRead=true&markRead=false&limit=20`,
          ),
          fetchJson<{ tasks: Task[] }>("/api/tasks"),
        ])
        if (inboxWrap) {
          const unread = (inboxWrap.messages ?? []).filter((m) => !m.read_at).slice(0, 10)
          setState("inbox", unread)
        }
        if (tasksWrap) {
          const tasks = tasksWrap.tasks ?? []
          const open = tasks.filter((t) => t.status === "open")
          const claimed = tasks.filter((t) => t.status === "claimed")
          const stale = tasks.filter((t) => t.stale).length
          const mineClaimed = claimed.filter((t) => t.owner === peerId).length
          // High-prio "in my area" — heuristic: zone of the ticket matches a zone the self peer
          // has worked recently. Without an explicit "my zones" affordance yet, just count all
          // high-priority opens; future iteration can refine.
          const highPrioMine = open.filter((t) => t.priority === "high").length
          setState("board", {
            open: open.length,
            claimed: claimed.length,
            done24h: 0,
            stale,
            mineClaimedCount: mineClaimed,
            highPrioMine,
          })
        }
      }
    }

    onMount(() => {
      // Fire once immediately so the panel populates without a delay; then poll on interval.
      poll().catch(() => {})
      timer = setInterval(() => poll().catch(() => {}), POLL_INTERVAL_MS)
    })

    onCleanup(() => {
      if (timer) clearInterval(timer)
    })

    /** Manual refresh hook for UI actions that want fresh data NOW. */
    function refresh() {
      poll().catch(() => {})
    }

    return {
      get state() {
        return state
      },
      refresh,
    }
  },
})
