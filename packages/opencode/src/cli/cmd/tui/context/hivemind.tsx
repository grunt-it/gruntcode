// grunt-it: hivemind-state context for the TUI sidebar (#229).
//
// Reads cached state from HivemindSidebar (polled by session processor fiber via MCP).
// Falls back to "api offline" when the fiber isn't running or returns stale data.

import { createSimpleContext } from "./helper"
import { createSignal, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { getPeerID } from "@opencode-ai/core/util/opencode-process"
import { HivemindSidebar } from "@/session/hivemind-sidebar"

const POLL_INTERVAL_MS = 2000
const STALE_MS = 5000

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

type BoardState = {
  open: number
  claimed: number
  done24h: number
  stale: number
  mineClaimedCount: number
  highPrioMine: number
}

const emptyBoard = (): BoardState => ({ open: 0, claimed: 0, done24h: 0, stale: 0, mineClaimedCount: 0, highPrioMine: 0 })

export const { use: useHivemind, provider: HivemindProvider } = createSimpleContext({
  name: "Hivemind",
  init: () => {
    const [state, setState] = createStore<{
      apiOnline: boolean
      lastFetchAt: number
      self: Peer | null
      peers: Peer[]
      inbox: Message[]
      board: BoardState
    }>({
      apiOnline: false,
      lastFetchAt: 0,
      self: null,
      peers: [],
      inbox: [],
      board: emptyBoard(),
    })

    let timer: ReturnType<typeof setInterval> | undefined

    function pollFromCache() {
      const cached = HivemindSidebar.getCached()
      const stale = Date.now() - cached.lastFetchAt > STALE_MS
      setState(reconcile({
        apiOnline: cached.apiOnline && !stale,
        lastFetchAt: cached.lastFetchAt,
        self: cached.self,
        peers: cached.peers,
        inbox: cached.inbox,
        board: cached.apiOnline && !stale
          ? { ...cached.board, done24h: 0 }
          : emptyBoard(),
      }))
    }

    onMount(() => {
      pollFromCache()
      timer = setInterval(pollFromCache, POLL_INTERVAL_MS)
    })

    onCleanup(() => {
      if (timer) clearInterval(timer)
    })

    function refresh() { pollFromCache() }

    // ----- ticket-hover state (#233) ---------------------------------------------------------
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
        ticketCache.set(id, null)
        return null
      })()
      ticketInflight.set(id, p)
      return p
    }

    function triggerHoverEnter(id: number, anchorX: number, anchorY: number) {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = undefined }
      const current = hoveredTicket()
      if (current?.id === id) return
      if (openTimer) clearTimeout(openTimer)
      openTimer = setTimeout(() => {
        openTimer = undefined
        setHoveredTicketSignal({ id, anchorX, anchorY })
        if (!ticketCache.has(id)) void fetchTicket(id)
      }, OPEN_DELAY_MS)
    }

    function triggerHoverLeave() {
      if (openTimer) { clearTimeout(openTimer); openTimer = undefined }
      if (closeTimer) clearTimeout(closeTimer)
      closeTimer = setTimeout(() => {
        closeTimer = undefined
        if (!cardHovered) setHoveredTicketSignal(null)
      }, CLOSE_DELAY_MS)
    }

    function setCardHovered(hovered: boolean) {
      cardHovered = hovered
      if (hovered) {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = undefined }
      } else {
        if (closeTimer) clearTimeout(closeTimer)
        closeTimer = setTimeout(() => {
          closeTimer = undefined
          if (!cardHovered) setHoveredTicketSignal(null)
        }, CLOSE_DELAY_MS)
      }
    }

    return {
      get state() { return state },
      refresh,
      hoveredTicket,
      triggerHoverEnter,
      triggerHoverLeave,
      setCardHovered,
      ticketDetail,
      fetchTicket,
    }
  },
})
