// grunt-it: shadcn-svelte HoverCard-style tooltip for hivemind ticket-ref hovers (#233).
//
// Rendered ONCE at the app-root level. Reads the global hoveredTicket signal from the
// Hivemind context; when set, shows the ticket detail at a position anchored near the
// trigger's cursor coords (just below + slightly right, with overflow guards).
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
const SCOPE_PREVIEW_CHARS = 180

/** Flatten a multi-line markdown-flavored scope into a single-paragraph preview for the
 * tooltip. The hover card is a small preview, not a full doc render — newlines, markdown
 * headings, code fences, and stacked whitespace would otherwise wreck the layout (caught
 * 2026-05-27: a multi-line scope with `## heading` + blank-line gaps was rendering as
 * mangled bleed when the text renderable's wrap-word mode joined adjacent lines). */
function flattenScope(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw
    .replace(/```[\s\S]*?```/g, " ") // strip fenced code blocks
    .replace(/^#+\s*/gm, "") // strip markdown headings
    .replace(/[*_`>]/g, "") // strip emphasis / quote markers
    .replace(/\s+/g, " ") // collapse all whitespace to single spaces
    .trim()
}

export function TicketHoverCard() {
  const hive = useHivemind()
  const { theme } = useTheme()
  const dims = useTerminalDimensions()

  return (
    <Show when={hive.hoveredTicket()}>
      {(anchor) => {
        // Position: just below the trigger cursor, offset right by 1 col. If that would
        // push off the right edge, flip the card so its right edge aligns with the cursor.
        const left = () => {
          const desired = anchor().anchorX + 1
          const overflow = desired + CARD_WIDTH - dims().width
          if (overflow > 0) return Math.max(0, anchor().anchorX - CARD_WIDTH)
          return desired
        }
        const top = () => {
          const desired = anchor().anchorY + 1
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
            flexDirection="column"
            backgroundColor={theme.backgroundPanel}
            border={true}
            borderColor={theme.border}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={0}
            paddingBottom={0}
            zIndex={3000}
            width={CARD_WIDTH}
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
              const titleLine = `#${d.id} ${d.title}`
              const metaParts: string[] = [d.status, d.priority]
              if (d.zone) metaParts.push(`zone=${d.zone}`)
              if (d.owner) metaParts.push(`owner=${d.owner}`)
              const metaLine = metaParts.join(" · ")
              const scopeFlat = flattenScope(d.scope)
              const scopePreview =
                scopeFlat.length > SCOPE_PREVIEW_CHARS
                  ? scopeFlat.slice(0, SCOPE_PREVIEW_CHARS) + "…"
                  : scopeFlat
              return (
                <box flexDirection="column">
                  <text fg={theme.text} attributes={1}>
                    {titleLine}
                  </text>
                  <text fg={theme.textMuted}>{metaLine}</text>
                  <Show when={scopePreview}>
                    <text fg={theme.textMuted}>{scopePreview}</text>
                  </Show>
                  <text fg={theme.textMuted}>click to open in hivemind-ui</text>
                </box>
              )
            })()}
          </box>
        )
      }}
    </Show>
  )
}
