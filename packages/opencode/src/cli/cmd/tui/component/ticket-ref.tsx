// grunt-it: clickable hivemind ticket-ref (#229) component for assistant chat (#233).
//
// **Inline-flowing rendering** (#250): TicketRef renders as an `<a>` (LinkRenderable)
// — an OpenTUI TextNode that flows inline within a parent `<text>` block. Previously
// this was a top-level `<text>` widget, which when interleaved with `<markdown>` text
// segments under `<box flexDirection="row" flexWrap="wrap">` caused refs to land on
// the wrong line: each segment became its own flex item and the flex-wrap engine
// reordered them per-item instead of flowing per-character. As an inline TextNode
// the ref takes part in TextRenderable's character-level wrap math.
//
// **OSC-8 hyperlink** via the `href` prop: the terminal emulator (iTerm, Ghostty,
// Kitty, modern Terminal.app) renders the ref as a real clickable hyperlink that
// opens hivemind-ui at /tasks/<id>. ⌘-click in iTerm; plain click in some others.
// Trade-off (accepted for #250): we lose the previously-shipped React hover-card
// preview because TextNodes (`<a>`/`<span>`) don't accept their own mouse-event
// listeners — they're part of the parent `<text>`'s render. A separate ticket can
// reintroduce a hover preview via a different rendering strategy (e.g. a coordinated
// overlay anchored to the `<text>`'s cursor position).

import { useTheme } from "../context/theme"

const HIVEMIND_UI_BASE = process.env.HIVEMIND_UI_BASE ?? "http://localhost:5173"

export function TicketRef(props: { id: number }) {
  const { theme } = useTheme()

  return (
    <a
      href={`${HIVEMIND_UI_BASE}/tasks/${props.id}`}
      style={{ fg: theme.markdownLink ?? theme.primary, attributes: 1 }}
    >
      #{props.id}
    </a>
  )
}
