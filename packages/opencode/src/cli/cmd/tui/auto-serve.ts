// auto-serve.ts — make bare `gruntcode` wakeable by ensuring a serve daemon exists.
//
// The default TUI command (thread.ts) historically spawns an in-process Worker
// that hosts the session itself. That session has no HTTP endpoint, so it can't
// be reached by hivemind_wake_peer (or any external POST to /session/<id>/prompt_async).
//
// This module makes the bare command wakeable: it probes for an existing serve
// daemon on the conventional port, spawns one as a detached child if missing,
// waits for readiness, and returns the URL. The caller (thread.ts) then takes
// the attach codepath instead of the in-process worker so the session is hosted
// on the daemon.
//
// Escape hatch: set OPENCODE_DISABLE_AUTO_SERVE=1 to keep the legacy in-process
// behavior (or use a different entry point — `gruntcode attach`, `gruntcode run`,
// etc. don't go through this).
//
// Refs hivemind #224.

import { spawn, spawnSync } from "child_process"
import { existsSync } from "fs"
import { open } from "fs/promises"
import path from "path"
import { homedir } from "os"

const DEFAULT_PORT = 4096
const DEFAULT_HOST = "127.0.0.1"
const SPAWN_READY_TIMEOUT_MS = 10_000
const PROBE_TIMEOUT_MS = 1500

export type AutoServeResult =
  | { ok: true; url: string; bin: string; spawned: boolean }
  | { ok: false; reason: string }

// Probe a candidate serve URL. Returns true iff /session responds 200 within
// PROBE_TIMEOUT_MS. We hit /session (not /) because the OpenAPI doc / root
// route may not exist on all builds, but /session is core to the serve API.
async function probe(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const response = await fetch(`${url}/session`, { signal: controller.signal })
    clearTimeout(timer)
    return response.ok
  } catch {
    return false
  }
}

function serveLogDir() {
  return path.join(homedir(), ".local", "share", "opencode")
}

async function spawnDaemon(port: number, host: string, binPath: string): Promise<void> {
  const dir = serveLogDir()
  await (await import("fs/promises")).mkdir(dir, { recursive: true }).catch(() => {})
  const logPath = path.join(dir, "serve.log")
  // append-mode so previous boots' logs remain
  const log = await open(logPath, "a")
  // The spawned daemon is the parent of all session MCP children. We set
  // OPENCODE_SERVER_URL on the daemon's env so hivemind-mcp (and any other
  // coordination MCP loaded under a session) can discover the daemon's HTTP
  // endpoint without being told it via CLI args. OPENCODE_PEER_ID is inherited
  // via process.env if the user passed --peer-id; that's already set by setPeerID()
  // earlier in the wrapper's lifecycle.
  const child = spawn(binPath, ["serve", "--port", String(port), "--hostname", host, "--print-logs"], {
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    env: {
      ...process.env,
      OPENCODE_SERVER_URL: `http://${host}:${port}`,
    },
  })
  child.unref()
  await log.close()
}

function findGruntcodeBin(): string | null {
  // process.argv[0] is the binary that started this process. If user ran
  // `gruntcode` (compiled binary), this is the gruntcode binary path —
  // perfect for re-exec.
  const argv0 = process.argv[0] ?? ""
  if (argv0.endsWith("/gruntcode") || argv0.endsWith("/opencode")) return argv0
  // Dev mode (bun run): argv0 is bun. Find an installed gruntcode via PATH.
  const which = spawnSync("which", ["gruntcode"], { encoding: "utf8" })
  const found = which.stdout?.trim()
  if (found && existsSync(found)) return found
  // Last-resort: opencode in PATH (still works since our patches are inside the same code path)
  const whichOpencode = spawnSync("which", ["opencode"], { encoding: "utf8" })
  const foundOpencode = whichOpencode.stdout?.trim()
  if (foundOpencode && existsSync(foundOpencode)) return foundOpencode
  return null
}

export async function ensureServeDaemon(): Promise<AutoServeResult> {
  if (process.env.OPENCODE_DISABLE_AUTO_SERVE) {
    return { ok: false, reason: "OPENCODE_DISABLE_AUTO_SERVE set" }
  }

  const port = Number(process.env.OPENCODE_AUTO_SERVE_PORT ?? DEFAULT_PORT)
  const host = process.env.OPENCODE_AUTO_SERVE_HOST ?? DEFAULT_HOST
  const url = `http://${host}:${port}`

  // We need a bin for re-exec into attach (and for spawning the daemon if missing).
  const bin = findGruntcodeBin()
  if (!bin) {
    return { ok: false, reason: "cannot locate gruntcode binary (argv0 is non-gruntcode and `which gruntcode`/`which opencode` failed)" }
  }

  // Already serving?
  if (await probe(url)) return { ok: true, url, bin, spawned: false }

  try {
    await spawnDaemon(port, host, bin)
  } catch (error) {
    return { ok: false, reason: `failed to spawn serve daemon: ${error instanceof Error ? error.message : String(error)}` }
  }

  // Wait for readiness.
  const deadline = Date.now() + SPAWN_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await probe(url)) return { ok: true, url, bin, spawned: true }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  return { ok: false, reason: `serve daemon did not respond on ${url} within ${SPAWN_READY_TIMEOUT_MS}ms` }
}
