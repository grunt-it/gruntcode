// grunt-it: clickable hivemind ticket-ref (#229) component for assistant chat (#233, #331).
//
// **Inline-flowing rendering** (#250): TicketRef renders as an `<a>` (LinkRenderable) —
// an OpenTUI TextNode that flows inline within a parent `<text>` block. A top-level
// `<text>` widget per ref broke text-wrap (#250): each became its own flex item and the
// flex-wrap engine reordered them per-item instead of flowing per-character. As an inline
// TextNode the ref takes part in TextRenderable's character-level wrap math.
//
// **Clean label + OSC-8 hyperlink** via the `href` prop (build-verified #331): the ref
// renders as just `#<id>` (the URL is NOT shown — it's carried as OSC-8 hyperlink
// metadata, unlike a markdown `[#N](url)` which leaks the literal URL into the visible
// text). Terminals that support OSC-8 (iTerm2, Ghostty, Kitty, modern Terminal.app)
// render the ref as a real hyperlink with native hover-highlight + click-to-open
// (⌘-click in iTerm; plain click in some others) pointing at hivemind-ui /tasks/<id>.
//
// Why native OSC-8 instead of a custom hover-card overlay: the terminal owns the exact
// rendered geometry of the link, so hover-highlight + click are always pixel-accurate —
// no JS-side cursor→character position estimation (which drifted badly when attempted).

import { useTheme } from "../context/theme"

const HIVEMIND_UI_BASE = process.env.HIVEMIND_UI_BASE ?? "https://hivemind.grunt.si"

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
