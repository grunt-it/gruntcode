import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import type { SessionID, PartID } from "./schema"

const log = Log.create({ service: "session.compaction-archive" })

/**
 * Compaction archive: persists the full, verbatim tool output that is stripped from the live
 * conversation during compaction. The live `output` is replaced with a compact marker to free
 * context, while the complete original is written here so a future "post-compaction knowledge
 * retrieval" MCP can read it back byte-for-byte on demand.
 *
 * Layout: <data>/compaction-archive/<sessionID>/<partID>
 *
 * No TTL — these are durable records keyed by session + part id, intended to outlive the
 * in-context output. They are removed only when the owning session is deleted (a future
 * concern; today nothing prunes them, by design).
 */
export const ARCHIVE_DIR = path.join(Global.Path.data, "compaction-archive")

export function sessionDir(sessionID: SessionID) {
  return path.join(ARCHIVE_DIR, sessionID)
}

export function filePath(sessionID: SessionID, partID: PartID) {
  return path.join(ARCHIVE_DIR, sessionID, partID)
}

type FS = AppFileSystem.Interface

/**
 * Write the full output for a stripped tool part. Returns the absolute path it was written to,
 * which is stored in the part's `strippedOutput.outputPath` so retrieval can find it later.
 *
 * Takes a pre-yielded AppFileSystem instance so callers that already hold the service (e.g. the
 * compaction layer) don't re-introduce an AppFileSystem requirement into their per-call effects.
 */
export const write = Effect.fn("CompactionArchive.write")(function* (
  fs: FS,
  sessionID: SessionID,
  partID: PartID,
  content: string,
) {
  const dir = sessionDir(sessionID)
  yield* fs.ensureDir(dir)
  const file = filePath(sessionID, partID)
  yield* fs.writeFileString(file, content)
  log.info("archived stripped output", { sessionID, partID, bytes: content.length })
  return file
})

/**
 * Read a previously archived stripped output. Used by the retrieval path (and tests) to
 * recover the full original after compaction. Pulls AppFileSystem from context so test/MCP
 * callers can use it directly without threading the service.
 */
export const read = Effect.fn("CompactionArchive.read")(function* (sessionID: SessionID, partID: PartID) {
  const fs = yield* AppFileSystem.Service
  return yield* fs.readFileString(filePath(sessionID, partID))
})

export * as CompactionArchive from "./compaction-archive"
