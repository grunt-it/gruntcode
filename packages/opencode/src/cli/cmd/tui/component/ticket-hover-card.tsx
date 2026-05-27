// grunt-it: shadcn-svelte HoverCard-style tooltip for hivemind ticket-ref hovers (#233).
//
// Rendered ONCE at the app-root level. Reads the global hoveredTicket signal from the
// Hivemind context; when set, shows the ticket detail at a position anchored near the
// trigger's cursor coords (just below + slightly right, with right-edge overflow guard).
//
// Sticky-hover semantics: the card also has its own onMouseOver/Out — entering the card
// cancels the trigger's close-timer (so the cursor can traverse the gap between trigger
// and card without dismissing). Leaving the card schedules a close-timer of its own.
// Net result: shadcn HoverCard ergonomics in the terminal.

import { Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useHivemind } from "../context/hivemind"
import { useTheme } from "../context/theme"

const CARD_WIDTH = 60
const CARD_MAX_HEIGHT = 16

export function TicketHoverCard() {
  const hive = useHivemind()
  const { theme } = useTheme()
  const dims = useTerminalDimensions()

  return (
    <Show when={hive.hoveredTicket()}>
      {(anchor) => {
        // Position: just below the trigger cursor, offset right by 2 cols. If that would
        // push off the right edge, flip the card so its right edge aligns with the cursor.
        const left = () => {
          const desired = anchor().anchorX + 1
          const overflow = desired + CARD_WIDTH - dims().width
          if (overflow > 0) return Math.max(0, anchor().anchorX - CARD_WIDTH)
          return desired
        }
        const top = () => {
          const desired = anchor().anchorY + 1
          // If near the bottom, flip above the cursor.
          if (desired + CARD_MAX_HEIGHT > dims().height) {
            return Math.max(0, anchor().anchorY - CARD_MAX_HEIGHT)
          }
          return desired
        }

        return (
          <box
            position="absolute"
            left={left()}
            top={top()}
            backgroundColor={theme.backgroundPanel}
            border={true}
            borderColor={theme.border}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={0}
            paddingBottom={0}
            zIndex={3000}
            maxWidth={CARD_WIDTH}
            onMouseOver={() => hive.setCardHovered(true)}
            onMouseOut={() => hive.setCardHovered(false)}
          >
            {(() => {
              const id = anchor().id
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
        )
      }}
    </Show>
  )
}
