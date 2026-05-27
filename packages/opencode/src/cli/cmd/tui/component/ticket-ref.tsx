// grunt-it: clickable hivemind ticket-ref (#229) component for assistant chat (#233).
//
// v2 architecture (after v1 flicker bug):
// - This component is just a colored clickable text. NO local tooltip — that was the source
//   of the flicker (per-ref tooltip box overlapped its own text, hover→unhover→hover loop).
// - Hover/leave events set a SINGLE global "currentlyHoveredTicket" signal in the Hivemind
//   context. Detail fetch + caching also lives there (shared across all refs).
// - The single floating <TicketHoverCard /> reads that signal and renders the detail at a
//   fixed screen anchor — no overlap with any text, so no flicker.
//
// Click opens hivemind-ui at /tasks/<id> in the system browser.

import open from "open"
import { useTheme } from "../context/theme"
import { useHivemind } from "../context/hivemind"

const HIVEMIND_UI_BASE = process.env.HIVEMIND_UI_BASE ?? "http://localhost:5173"

export function TicketRef(props: { id: number }) {
  const { theme } = useTheme()
  const hive = useHivemind()

  return (
    <text
      fg={theme.markdownLink ?? theme.primary}
      attributes={1}
      onMouseOver={() => hive.setHoveredTicket(props.id)}
      onMouseOut={() => hive.setHoveredTicket(null)}
      onMouseUp={() => {
        open(`${HIVEMIND_UI_BASE}/tasks/${props.id}`).catch(() => {})
      }}
    >
      #{props.id}
    </text>
  )
}
