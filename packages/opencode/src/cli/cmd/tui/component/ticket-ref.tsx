// grunt-it: clickable hivemind ticket-ref (#229) component for assistant chat (#233).
//
// shadcn-svelte HoverCard parity: hover the trigger → after a small open delay the card
// appears near the trigger; cursor can move INTO the card and it stays open; close happens
// after a small leave delay so a brief detour doesn't dismiss it. All the timer + sticky
// behavior lives in the Hivemind context — this component just emits hover-enter / leave +
// the cursor coords for anchoring.
//
// Click opens hivemind-ui at /tasks/<id> in the system browser.

import open from "open"
import { useTheme } from "../context/theme"
import { useHivemind } from "../context/hivemind"

const HIVEMIND_UI_BASE = process.env.HIVEMIND_UI_BASE ?? "http://localhost:5173"

type MouseEventLike = { x: number; y: number }

export function TicketRef(props: { id: number }) {
  const { theme } = useTheme()
  const hive = useHivemind()

  return (
    <text
      fg={theme.markdownLink ?? theme.primary}
      attributes={1}
      onMouseOver={(evt: MouseEventLike) => {
        hive.triggerHoverEnter(props.id, evt.x, evt.y)
      }}
      onMouseOut={() => {
        hive.triggerHoverLeave()
      }}
      onMouseUp={() => {
        open(`${HIVEMIND_UI_BASE}/tasks/${props.id}`).catch(() => {})
      }}
    >
      #{props.id}
    </text>
  )
}
