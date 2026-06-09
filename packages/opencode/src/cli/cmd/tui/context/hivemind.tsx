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
import { createHmac } from "crypto"
import { appendFileSync } from "fs"

const DEFAULT_API = "https://hivemind.grunt.si"
const POLL_INTERVAL_MS = 2000
const SHARED_SECRET = process.env.MCP_HTTP_TOKEN_SECRET || ""
const LOGFILE = "/tmp/hivemind-tui.log"

function logError(msg: string, err?: unknown) {
  try { appendFileSync(LOGFILE, `${new Date().toISOString()} ${msg}${err ? ": " + ((err as Error)?.message || String(err)) : ""}\n`) } catch {}
}

// Sign a short-lived HMAC-SHA256 bearer token matching the hivemind MCP auth scheme.
// Token shape: <base64url(payload)>.<base64url(hmac)>
// Payload: { iss: "hivemind-mcp-local", sub: peerId, scope: "agent", iat, exp }
function signToken(peerId: string): string {
  if (!SHARED_SECRET) return ""
  const now = Math.floor(Date.now() / 1000)
  const claims = { iss: "hivemind-mcp-local", sub: peerId, scope: "agent", iat: now, exp: now + 30 }
  const payloadB64 = btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const sigB64 = createHmac("sha256", SHARED_SECRET).update(payloadB64).digest("base64url")
  return `${payloadB64}.${sigB64}`
}

// Cached + dedup'd ticket-detail fetches used by TicketRef hover (#233). Lives in the
// context (not in the component) so multiple TicketRefs share a single fetch per id and
// hover→unhover→hover doesn't refire the request.
export type TicketDetail = {
  id: number
  title: string
  scope?: string | null
  status: string
  priority: string
  zone?: string | null
  owner?: string | null
}

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
        const t = setTimeout(() => controller.abort(), 5000)
        const headers: Record<string, string> = {}
        const token = signToken(peerId || "tui")
        if (token) headers["Authorization"] = `Bearer ${token}`
        const res = await fetch(`${apiBase}${path}`, { signal: controller.signal, headers })
        clearTimeout(t)
        if (!res.ok) return null
        return (await res.json()) as T
      } catch (e) {
        logError("fetchJson failed", e)
        return null
      }
    }

    // Defensive shape guards (#276): an API response we don't trust to be well-shaped
    // can't poison the store. Coerce non-arrays to []; coerce non-objects-with-id (peers)
    // or non-objects-with-from_peer (messages) to "discarded" by filtering them out.
    // The setState calls that follow can then rely on a clean array shape — which is what
    // SolidJS <For> requires to avoid the "U.length on undefined" crash from #276.
    const ensureArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
    const validPeer = (p: unknown): p is Peer =>
      typeof p === "object" && p !== null && typeof (p as Peer).id === "string"
    const validMessage = (m: unknown): m is Message =>
      typeof m === "object" && m !== null && typeof (m as Message).from_peer === "string"
    const validTask = (t: unknown): t is Task =>
      typeof t === "object" && t !== null && typeof (t as Task).status === "string"

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

      const peers = ensureArray<Peer>(peersWrap.peers).filter(validPeer)
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
          const unread = ensureArray<Message>(inboxWrap.messages)
            .filter(validMessage)
            .filter((m) => !m.read_at)
            .slice(0, 10)
          setState("inbox", unread)
        }
        if (tasksWrap) {
          const tasks = ensureArray<Task>(tasksWrap.tasks).filter(validTask)
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

    // ----- ticket-hover state (#233) ---------------------------------------------------------
    // shadcn-svelte-style HoverCard: card pops up near the trigger after a small open delay,
    // STAYS open if the cursor moves into the card (close delay gives time to traverse the gap),
    // closes after a small leave delay so a brief detour doesn't dismiss it.
    //
    // Three signals power this:
    //   hoveredTicket   — { id, anchorX, anchorY } | null. What the card renders + anchors to.
    //   The card itself also calls setCardHover(true/false) on its own onMouseOver/Out to
    //   suppress the close timer while the cursor is inside the card body.
    type HoverAnchor = { id: number; anchorX: number; anchorY: number }
    const [hoveredTicket, setHoveredTicketSignal] = createSignal<HoverAnchor | null>(null)
    const ticketCache = new Map<number, TicketDetail | null>()
    const ticketInflight = new Map<number, Promise<TicketDetail | null>>()
    const [ticketCacheTick, setTicketCacheTick] = createSignal(0)
    let openTimer: ReturnType<typeof setTimeout> | undefined
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    let cardHovered = false
    const OPEN_DELAY_MS = 150
    const CLOSE_DELAY_MS = 200

    function ticketDetail(id: number): TicketDetail | null | undefined {
      ticketCacheTick()
      return ticketCache.get(id)
    }

    function fetchTicket(id: number): Promise<TicketDetail | null> {
      if (ticketCache.has(id)) return Promise.resolve(ticketCache.get(id) ?? null)
      const existing = ticketInflight.get(id)
      if (existing) return existing
      const p = (async () => {
        try {
          const controller = new AbortController()
          const t = setTimeout(() => controller.abort(), 5000)
          const headers: Record<string, string> = {}
          const token = signToken("tui")
          if (token) headers["Authorization"] = `Bearer ${token}`
          const res = await fetch(`${apiBase}/api/tasks/${id}`, { signal: controller.signal, headers })
          clearTimeout(t)
          if (!res.ok) {
            ticketCache.set(id, null)
            return null
          }
          const body = (await res.json()) as { task?: TicketDetail } | TicketDetail
          const task = (body as { task?: TicketDetail }).task ?? (body as TicketDetail)
          ticketCache.set(id, task ?? null)
          return task ?? null
        } catch (e) {
          logError("fetchTicket failed", e)
          ticketCache.set(id, null)
          return null
        } finally {
          ticketInflight.delete(id)
          setTicketCacheTick((n) => n + 1)
        }
      })()
      ticketInflight.set(id, p)
      return p
    }

    /** TicketRef calls this when mouse enters the trigger. Schedules the card open. */
    function triggerHoverEnter(id: number, anchorX: number, anchorY: number) {
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = undefined
      }
      // Already showing this ticket? Just keep it open.
      const current = hoveredTicket()
      if (current?.id === id) return
      // Schedule open. If user moves off the trigger before delay elapses, openTimer is
      // cleared and nothing renders — no flash for accidental hovers.
      if (openTimer) clearTimeout(openTimer)
      openTimer = setTimeout(() => {
        openTimer = undefined
        setHoveredTicketSignal({ id, anchorX, anchorY })
        if (!ticketCache.has(id)) void fetchTicket(id)
      }, OPEN_DELAY_MS)
    }

    /** TicketRef calls this when mouse leaves the trigger. Schedules close, can be cancelled
     * if the cursor moves into the card body (via setCardHovered(true)). */
    function triggerHoverLeave() {
      if (openTimer) {
        clearTimeout(openTimer)
        openTimer = undefined
      }
      if (closeTimer) clearTimeout(closeTimer)
      closeTimer = setTimeout(() => {
        closeTimer = undefined
        if (!cardHovered) setHoveredTicketSignal(null)
      }, CLOSE_DELAY_MS)
    }

    /** TicketHoverCard calls this when mouse enters/leaves the card body. Entering keeps
     * the card open even after the trigger's leave-timer fires. */
    function setCardHovered(hovered: boolean) {
      cardHovered = hovered
      if (hovered) {
        if (closeTimer) {
          clearTimeout(closeTimer)
          closeTimer = undefined
        }
      } else {
        // Mouse left the card → start the close timer (in case the trigger is also unhovered).
        if (closeTimer) clearTimeout(closeTimer)
        closeTimer = setTimeout(() => {
          closeTimer = undefined
          if (!cardHovered) setHoveredTicketSignal(null)
        }, CLOSE_DELAY_MS)
      }
    }

    return {
      get state() {
        return state
      },
      refresh,
      // ticket-hover
      hoveredTicket,
      triggerHoverEnter,
      triggerHoverLeave,
      setCardHovered,
      ticketDetail,
      fetchTicket,
    }
  },
})
