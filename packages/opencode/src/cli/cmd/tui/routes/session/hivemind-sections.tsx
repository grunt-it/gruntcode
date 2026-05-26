// grunt-it: hivemind sidebar sections (#229). Rendered inside the existing right-side
// Sidebar between the session title block and the gruntcode footer, so we add hivemind
// awareness to the operator's already-visible side panel rather than introducing a
// second sidebar (saves screen real estate, no layout-width math required).

import { For, Show, createMemo } from "solid-js"
import { useHivemind } from "../../context/hivemind"
import { useTheme } from "../../context/theme"

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
          <text fg={theme.textMuted}>
            <span>not announced yet — set --peer-id to register</span>
          </text>
        }
      >
        {(self) => (
          <box>
            <text fg={theme.text}>
              <b>you · </b>
              <span>{self().id}</span>
            </text>
            <Show when={self().summary}>
              <text fg={theme.textMuted}>{self().summary}</text>
            </Show>
            <text fg={theme.textMuted}>
              <span>{wakeable() ? `✓ wakeable :${self().http_port}` : "✗ not wakeable"}</span>
              {" · "}
              <span>{relativeTime(self().last_seen_at)} ago</span>
            </text>
          </box>
        )}
      </Show>

      {/* Section 2 — live peers */}
      <Show when={hive.state.peers.length > 0}>
        <box>
          <text fg={theme.text}>
            <b>peers ({hive.state.peers.length})</b>
          </text>
          <For each={hive.state.peers.slice(0, 6)}>
            {(peer) => (
              <text fg={theme.textMuted}>
                <span style={{ fg: theme.success }}>·</span> <b>{peer.id}</b>
                <Show when={peer.summary}>
                  <span> — {(peer.summary ?? "").slice(0, 40)}</span>
                </Show>
              </text>
            )}
          </For>
        </box>
      </Show>

      {/* Section 3 — inbox */}
      <Show when={hive.state.inbox.length > 0}>
        <box>
          <text fg={theme.text}>
            <b>inbox · </b>
            <span style={{ fg: theme.warning }}>{hive.state.inbox.length} unread</span>
          </text>
          <For each={hive.state.inbox.slice(0, 4)}>
            {(msg) => (
              <text fg={theme.textMuted}>
                <b>{msg.from_peer}</b>: {(msg.subject ?? msg.body).slice(0, 50)}
              </text>
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
