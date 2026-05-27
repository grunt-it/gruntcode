// grunt-it: hivemind sidebar sections (#229). Rendered inside the existing right-side
// Sidebar between the session title block and the gruntcode footer, so we add hivemind
// awareness to the operator's already-visible side panel rather than introducing a
// second sidebar (saves screen real estate, no layout-width math required).
//
// Sidebar interior width is ~38 cols (Sidebar is 42 wide, with paddingLeft=2 + paddingRight=2).
// Text needs to either word-wrap explicitly OR get truncated to fit, because <text> in opentui
// clips horizontally by default (no auto-wrap on inline rows). We split each peer / inbox row
// into TWO explicit lines: compact identifier on line 1, wrapped/truncated detail on line 2.

import { For, Show, createMemo } from "solid-js"
import { useHivemind } from "../../context/hivemind"
import { useTheme } from "../../context/theme"

const SIDEBAR_INNER_COLS = 38

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return iso
  const diff = Date.now() - t
  if (diff < 0) return "now"
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}

export function HivemindSections() {
  const hive = useHivemind()
  const { theme } = useTheme()

  const wakeable = createMemo(() => {
    const s = hive.state.self
    return !!(s?.http_port && s?.session_id)
  })

  return (
    <box gap={1} paddingTop={1}>
      {/* Connection state header */}
      <box>
        <text fg={theme.textMuted}>
          <span style={{ fg: hive.state.apiOnline ? theme.success : theme.error }}>●</span>{" "}
          <b>hivemind</b>{" "}
          <span>
            {hive.state.apiOnline ? "" : "(api offline — start hivemind-api)"}
          </span>
        </text>
      </box>

      {/* Section 1 — this peer */}
      <Show
        when={hive.state.self}
        fallback={
          <text fg={theme.textMuted} wrapMode="word">
            not announced yet — set --peer-id to register
          </text>
        }
      >
        {(self) => (
          <box flexDirection="column">
            <text fg={theme.text}>
              <b>you · </b>
              <span>{truncate(self().id, SIDEBAR_INNER_COLS - 6)}</span>
            </text>
            <Show when={self().summary}>
              <text fg={theme.textMuted} wrapMode="word">
                {self().summary}
              </text>
            </Show>
            <text fg={theme.textMuted}>
              {wakeable() ? `✓ wakeable :${self().http_port}` : "✗ not wakeable"}
              {" · "}
              {relativeTime(self().last_seen_at)} ago
            </text>
          </box>
        )}
      </Show>

      {/* Section 2 — live peers. Each peer = 2 lines: id+time on line 1, summary on line 2.
          Summary uses wrapMode="word" so long summaries wrap inside the card width instead of
          clipping (caught 2026-05-27: "nik-t" truncation visible at right edge). */}
      <Show when={hive.state.peers.length > 0}>
        <box flexDirection="column">
          <text fg={theme.text}>
            <b>peers ({hive.state.peers.length})</b>
          </text>
          <For each={hive.state.peers.slice(0, 6)}>
            {(peer) => (
              <box flexDirection="column" paddingTop={0}>
                <text fg={theme.textMuted}>
                  <span style={{ fg: theme.success }}>·</span> <b>{truncate(peer.id, 26)}</b>
                  <span> {relativeTime(peer.last_seen_at)}</span>
                </text>
                <Show when={peer.summary}>
                  <text fg={theme.textMuted} wrapMode="word">
                    {"  "}
                    {truncate(peer.summary ?? "", 90)}
                  </text>
                </Show>
              </box>
            )}
          </For>
        </box>
      </Show>

      {/* Section 3 — inbox. Each DM = 2 lines: sender on line 1, wrapped subject/body on line 2. */}
      <Show when={hive.state.inbox.length > 0}>
        <box flexDirection="column">
          <text fg={theme.text}>
            <b>inbox · </b>
            <span style={{ fg: theme.warning }}>{hive.state.inbox.length} unread</span>
          </text>
          <For each={hive.state.inbox.slice(0, 4)}>
            {(msg) => (
              <box flexDirection="column">
                <text fg={theme.textMuted}>
                  <b>{truncate(msg.from_peer, 28)}</b>
                </text>
                <text fg={theme.textMuted} wrapMode="word">
                  {"  "}
                  {truncate(msg.subject ?? msg.body, 110)}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      {/* Section 4 — board pulse */}
      <Show when={hive.state.apiOnline}>
        <box>
          <text fg={theme.text}>
            <b>board</b>
          </text>
          <text fg={theme.textMuted}>
            <span>open: {hive.state.board.open}</span>
            <Show when={hive.state.board.highPrioMine > 0}>
              <span style={{ fg: theme.error }}> ({hive.state.board.highPrioMine} high-prio)</span>
            </Show>
          </text>
          <text fg={theme.textMuted}>
            <span>claimed: {hive.state.board.claimed}</span>
            <Show when={hive.state.board.mineClaimedCount > 0}>
              <span style={{ fg: theme.success }}> ({hive.state.board.mineClaimedCount} by you)</span>
            </Show>
            <Show when={hive.state.board.stale > 0}>
              <span style={{ fg: theme.warning }}> · {hive.state.board.stale} stale</span>
            </Show>
          </text>
        </box>
      </Show>
    </box>
  )
}
