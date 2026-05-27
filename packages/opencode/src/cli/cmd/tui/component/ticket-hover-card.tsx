// grunt-it: single floating tooltip for hivemind ticket-ref hovers (#233).
//
// Rendered ONCE at the app-root level (NOT as a child of any TicketRef). Reads the
// global hoveredTicketId signal from the Hivemind context; when set, shows the ticket
// detail at a fixed screen anchor (top of screen, right-aligned). When null, renders
// nothing (and consumes no space).
//
// Architecture motivation: a per-ref tooltip box rendered inside the same column as
// the ref's text caused a hover-flicker loop in v1 — the tooltip overlapped the text
// region, mouse moved off the text onto the tooltip, onMouseOut fired, tooltip hid,
// mouse was back on text, onMouseOver fired, tooltip showed again. By rendering the
// tooltip at a screen anchor far from any mouse-interactive surface, the hover state
// is stable.

import { Show } from "solid-js"
import { useHivemind } from "../context/hivemind"
import { useTheme } from "../context/theme"

export function TicketHoverCard() {
  const hive = useHivemind()
  const { theme } = useTheme()

  return (
    <Show when={hive.hoveredTicketId() !== null}>
      <box
        position="absolute"
        top={1}
        right={2}
        backgroundColor={theme.backgroundPanel}
        border={true}
        borderColor={theme.border}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={0}
        paddingBottom={0}
        zIndex={3000}
        maxWidth={70}
      >
        {(() => {
          const id = hive.hoveredTicketId()
          if (id === null) return null
          const d = hive.ticketDetail(id)
          if (d === undefined) {
            return <text fg={theme.textMuted}>loading #{id}...</text>
          }
          if (d === null) {
            return <text fg={theme.textMuted}>#{id}: not found</text>
          }
          return (
            <>
              <text fg={theme.text} wrapMode="word">
                <b>
                  #{d.id} {d.title}
                </b>
              </text>
              <text fg={theme.textMuted}>
                <span>{d.status}</span>
                {" · "}
                <span>{d.priority}</span>
                <Show when={d.zone}>
                  {" · "}
                  <span>zone={d.zone}</span>
                </Show>
                <Show when={d.owner}>
                  {" · "}
                  <span>owner={d.owner}</span>
                </Show>
              </text>
              <Show when={d.scope}>
                <text fg={theme.textMuted} wrapMode="word">
                  {(d.scope ?? "").slice(0, 220)}
                  {(d.scope ?? "").length > 220 ? "..." : ""}
                </text>
              </Show>
              <text fg={theme.textMuted}>
                <span>click to open in hivemind-ui</span>
              </text>
            </>
          )
        })()}
      </box>
    </Show>
  )
}
