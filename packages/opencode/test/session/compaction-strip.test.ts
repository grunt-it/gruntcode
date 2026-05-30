import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import * as SessionCompaction from "../../src/session/compaction"

describe("compaction strip metadata", () => {
  test("KB read output stripped, metadata preserved", () => {
    const output = "# Feedback architecture\n\nSmall models fail to self-regulate..."
    const part: MessageV2.ToolPart = {
      id: PartID.ascending(),
      sessionID: "ses_test" as SessionID,
      messageID: "msg_test" as MessageID,
      type: "tool",
      callID: "tool_1",
      tool: "knowledge-base_get_knowledge",
      state: {
        status: "completed",
        input: { kb: "grunt-it-stack", file: "feedback-architecture" },
        output,
        title: "KB read",
        metadata: { kb_version: "1780069972625-7174" },
        time: { start: Date.now(), end: Date.now() },
      },
    }

    const metadata = SessionCompaction.buildStripMetadata(part)
    expect(metadata).toMatchObject({
      kb: "grunt-it-stack",
      file: "feedback-architecture",
      kb_version: "1780069972625-7174",
      summary: output.slice(0, 200),
    })
    expect((metadata as any).output_tokens).toBeGreaterThan(0)
  })

  test("Bash output stripped, head+tail preserved", () => {
    const lines = Array(20).fill("output line").map((l, i) => `${l} ${i}`)
    const output = lines.join("\n")
    const part: MessageV2.ToolPart = {
      id: PartID.ascending(),
      sessionID: "ses_test" as SessionID,
      messageID: "msg_test" as MessageID,
      type: "tool",
      callID: "tool_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls -la" },
        output,
        title: "bash",
        metadata: { exit_code: 0 },
        time: { start: Date.now(), end: Date.now() },
      },
    }

    const metadata = SessionCompaction.buildStripMetadata(part)
    expect(metadata).toMatchObject({
      command: "ls -la",
      exit_code: 0,
      head_lines: lines.slice(0, 5),
      tail_lines: lines.slice(-5),
    })
  })

  test("Read output stripped, first line preserved", () => {
    const output = "import { Effect } from 'effect'\n\nexport const foo = ..."
    const part: MessageV2.ToolPart = {
      id: PartID.ascending(),
      sessionID: "ses_test" as SessionID,
      messageID: "msg_test" as MessageID,
      type: "tool",
      callID: "tool_1",
      tool: "read",
      state: {
        status: "completed",
        input: { path: "/src/foo.ts" },
        output,
        title: "read",
        metadata: {},
        time: { start: Date.now(), end: Date.now() },
      },
    }

    const metadata = SessionCompaction.buildStripMetadata(part)
    expect(metadata).toMatchObject({
      path: "/src/foo.ts",
      first_line: "import { Effect } from 'effect'",
      lines_read: output.split("\n").length,
    })
  })

  test("Webfetch output stripped, title preserved", () => {
    const output = "<html><head><title>Cloudflare Docs</title></head>..."
    const part: MessageV2.ToolPart = {
      id: PartID.ascending(),
      sessionID: "ses_test" as SessionID,
      messageID: "msg_test" as MessageID,
      type: "tool",
      callID: "tool_1",
      tool: "webfetch",
      state: {
        status: "completed",
        input: { url: "https://developers.cloudflare.com" },
        output,
        title: "webfetch",
        metadata: { status: 200 },
        time: { start: Date.now(), end: Date.now() },
      },
    }

    const metadata = SessionCompaction.buildStripMetadata(part)
    expect(metadata).toMatchObject({
      url: "https://developers.cloudflare.com",
      status: 200,
      title: "<html><head><title>Cloudflare Docs</title></head>...".slice(0, 100),
    })
  })

  test("Grep output stripped, match count preserved", () => {
    const output = "/src/foo.ts:10:import { Effect }\n/src/bar.ts:5:import { Effect }"
    const part: MessageV2.ToolPart = {
      id: PartID.ascending(),
      sessionID: "ses_test" as SessionID,
      messageID: "msg_test" as MessageID,
      type: "tool",
      callID: "tool_1",
      tool: "grep",
      state: {
        status: "completed",
        input: { pattern: "import { Effect }", include: "*.ts" },
        output,
        title: "grep",
        metadata: {},
        time: { start: Date.now(), end: Date.now() },
      },
    }

    const metadata = SessionCompaction.buildStripMetadata(part)
    expect(metadata).toMatchObject({
      pattern: "import { Effect }",
      include: "*.ts",
      match_count: 2,
      files_matched: ["/src/foo.ts:10:import { Effect }", "/src/bar.ts:5:import { Effect }"],
    })
  })

  test("Unknown tool gets minimal metadata", () => {
    const output = "Some tool output"
    const part: MessageV2.ToolPart = {
      id: PartID.ascending(),
      sessionID: "ses_test" as SessionID,
      messageID: "msg_test" as MessageID,
      type: "tool",
      callID: "tool_1",
      tool: "unknown_tool",
      state: {
        status: "completed",
        input: {},
        output,
        title: "unknown",
        metadata: {},
        time: { start: Date.now(), end: Date.now() },
      },
    }

    const metadata = SessionCompaction.buildStripMetadata(part)
    expect(metadata).toMatchObject({
      tool: "unknown_tool",
      first_100_chars: output.slice(0, 100),
    })
  })
})
