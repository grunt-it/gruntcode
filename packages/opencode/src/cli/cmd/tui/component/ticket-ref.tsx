// grunt-it: clickable hivemind ticket-ref (#229) component for assistant chat (#233).
//
// Renders `#229` colored + underlined inline. Hover lazily fetches the ticket detail
// from hivemind-api (localhost:7890) and shows a tooltip overlay with title + status +
// scope-preview. Click opens hivemind-ui at /tasks/<id> in the system browser.
//
// Why not markdown links: opentui's markdown component renders `[label](url)` literally
// (with brackets + URL visible) and has no hover/click hooks for inline tokens. We bypass
// it for ticket refs and render directly.

import { createSignal, Show } from "solid-js"
import open from "open"
import { useTheme } from "../context/theme"
import { useHivemind } from "../context/hivemind"

const HIVEMIND_UI_BASE = process.env.HIVEMIND_UI_BASE ?? "http://localhost:5173"
const HIVEMIND_API_BASE = process.env.HIVEMIND_API_BASE ?? "http://127.0.0.1:7890"

type TicketDetail = {
  id: number
  title: string
  scope?: string | null
  status: string
  priority: string
  zone?: string | null
  owner?: string | null
}

const cache = new Map<number, TicketDetail | null>()
const inflight = new Map<number, Promise<TicketDetail | null>>()

function fetchTicket(id: number): Promise<TicketDetail | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id)!)
  const existing = inflight.get(id)
  if (existing) return existing
  const p = (async () => {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 1500)
      const res = await fetch(`${HIVEMIND_API_BASE}/api/tasks/${id}`, { signal: controller.signal })
      clearTimeout(t)
      if (!res.ok) {
        cache.set(id, null)
        return null
      }
      const body = (await res.json()) as { task?: TicketDetail } | TicketDetail
      const task = (body as { task?: TicketDetail }).task ?? (body as TicketDetail)
      cache.set(id, task ?? null)
      return task ?? null
    } catch {
      cache.set(id, null)
      return null
    } finally {
      inflight.delete(id)
    }
  })()
  inflight.set(id, p)
  return p
}

export function TicketRef(props: { id: number }) {
  const { theme } = useTheme()
  const hive = useHivemind()
  const [hovered, setHovered] = createSignal(false)
  const [detail, setDetail] = createSignal<TicketDetail | null | undefined>(cache.get(props.id))

  function onEnter() {
    setHovered(true)
    if (detail() === undefined) {
      void fetchTicket(props.id).then((d) => setDetail(d))
    }
  }

  function onLeave() {
    setHovered(false)
  }

  function onClick() {
    open(`${HIVEMIND_UI_BASE}/tasks/${props.id}`).catch(() => {})
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      <text
        fg={theme.markdownLink ?? theme.primary}
        attributes={1}
        onMouseOver={onEnter}
        onMouseOut={onLeave}
        onMouseUp={onClick}
      >
        #{props.id}
      </text>
      <Show when={hovered() && hive.state.apiOnline}>
        <box
          position="absolute"
          backgroundColor={theme.backgroundPanel}
          border={true}
          borderColor={theme.border}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={0}
          paddingBottom={0}
          zIndex={2000}
          maxWidth={60}
        >
          <Show
            when={detail() !== undefined}
            fallback={<text fg={theme.textMuted}>loading #{props.id}...</text>}
          >
            <Show
              when={detail()}
              fallback={<text fg={theme.textMuted}>#{props.id}: (not found)</text>}
            >
              {(d) => (
                <>
                  <text fg={theme.text}>
                    <b>#{d().id} {d().title}</b>
                  </text>
                  <text fg={theme.textMuted}>
                    <span>{d().status}</span>
                    {" · "}
                    <span>{d().priority}</span>
                    <Show when={d().zone}>
                      {" · "}
                      <span>zone={d().zone}</span>
                    </Show>
                    <Show when={d().owner}>
                      {" · "}
                      <span>owner={d().owner}</span>
                    </Show>
                  </text>
                  <Show when={d().scope}>
                    <text fg={theme.textMuted} wrapMode="word">
                      {(d().scope ?? "").slice(0, 200)}
                      {(d().scope ?? "").length > 200 ? "..." : ""}
                    </text>
                  </Show>
                  <text fg={theme.textMuted}>
                    <span>click to open in hivemind-ui</span>
                  </text>
                </>
              )}
            </Show>
          </Show>
        </box>
      </Show>
    </box>
  )
}
