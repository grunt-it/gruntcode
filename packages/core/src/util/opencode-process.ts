export const OPENCODE_RUN_ID = "OPENCODE_RUN_ID"
export const OPENCODE_PROCESS_ROLE = "OPENCODE_PROCESS_ROLE"

// Stable identifier for the human-facing terminal/tab this session lives in.
// Set via the --peer-id CLI flag or the OPENCODE_PEER_ID env var; propagated to
// MCP children via sanitizedProcessEnv so coordination MCPs (e.g. hivemind-mcp)
// can use it as the peer-id without a TAKEOFF dance.
export const OPENCODE_PEER_ID = "OPENCODE_PEER_ID"

export function setPeerID(peerID: string | undefined) {
  if (peerID && peerID.length > 0) process.env[OPENCODE_PEER_ID] = peerID
}

export function ensureRunID() {
  return (process.env[OPENCODE_RUN_ID] ??= crypto.randomUUID())
}

export function ensureProcessRole(fallback: "main" | "worker") {
  return (process.env[OPENCODE_PROCESS_ROLE] ??= fallback)
}

export function ensureProcessMetadata(fallback: "main" | "worker") {
  return {
    runID: ensureRunID(),
    processRole: ensureProcessRole(fallback),
  }
}

export function sanitizedProcessEnv(overrides?: Record<string, string>) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  return overrides ? Object.assign(env, overrides) : env
}
