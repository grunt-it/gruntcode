import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Option, Scope } from "effect"
import { HivemindLoopHook } from "@/session/hivemind-loop-hook"
import { MCP } from "@/mcp"
import { testEffect } from "../lib/effect"
import { MessageID } from "@/session/schema"

/**
 * Loop hook unit tests (#266 Phase 1). The hook is intentionally narrow: it gates on a
 * feature flag, finds the hivemind MCP client, and fires fire-and-forget Effect.promise
 * wrappers. The hard correctness rule is "MUST NEVER break the TUI" — disabled path is a
 * silent no-op, missing-MCP path is a silent no-op, and the in-flight wake itself is
 * forked via Effect.forkIn(scope) + Effect.ignore so even an MCP exception is swallowed.
 *
 * These tests cover the gating paths (flag off + MCP-not-provided) without needing a
 * full MCP fixture. The wake fire-path is exercised end-to-end via the real coordinator
 * dispatch loop in production once Phase 1 is enabled.
 */

const it = testEffect(Layer.empty)

describe("HivemindLoopHook.recordTurnEnd", () => {
  it.effect("flag off → silent no-op (no MCP needed)", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      // No MCP layer provided + enabled=false. The hook returns immediately on flag check;
      // no error, no environment requirement leaks.
      yield* HivemindLoopHook.recordTurnEnd({
        enabled: false,
        mcp: Option.none(),
        sessionID: "ses_x",
        messageID: MessageID.make("msg_x"),
        finishReason: "stop",
        scope,
      })
      yield* Scope.close(scope, Exit.succeed(undefined))
      // If we reached here without throwing, the no-op path is clean.
      expect(true).toBe(true)
    }),
  )

  it.effect("flag on but MCP=None → silent no-op (no error)", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      yield* HivemindLoopHook.recordTurnEnd({
        enabled: true,
        mcp: Option.none(),
        sessionID: "ses_x",
        messageID: MessageID.make("msg_x"),
        finishReason: "stop",
        scope,
      })
      yield* Scope.close(scope, Exit.succeed(undefined))
      expect(true).toBe(true)
    }),
  )
})

describe("HivemindLoopHook.loopProgress", () => {
  it.effect("flag off → silent no-op", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      yield* HivemindLoopHook.loopProgress({
        enabled: false,
        mcp: Option.none(),
        scope,
      })
      yield* Scope.close(scope, Exit.succeed(undefined))
      expect(true).toBe(true)
    }),
  )

  it.effect("flag on but MCP=None → silent no-op", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      yield* HivemindLoopHook.loopProgress({
        enabled: true,
        mcp: Option.none(),
        scope,
      })
      yield* Scope.close(scope, Exit.succeed(undefined))
      expect(true).toBe(true)
    }),
  )
})

describe("HivemindLoopHook with mocked MCP", () => {
  it.effect("flag on + MCP Some + no hivemind client → silent no-op (no throw)", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      // Build a minimal MCP service stub: clients() returns empty map → hook can't find
      // hivemind, returns silently. Other interface methods aren't called by the hook.
      const stubMcp = {
        status: () => Effect.succeed({}),
        clients: () => Effect.succeed({}),
        tools: () => Effect.succeed({}),
        prompts: () => Effect.succeed({}),
        resources: () => Effect.succeed({}),
        add: () => Effect.succeed({ status: {} }),
        connect: () => Effect.void,
        disconnect: () => Effect.void,
        getPrompt: () => Effect.succeed(undefined),
        readResource: () => Effect.succeed(undefined),
        startAuth: () => Effect.succeed({ authorizationUrl: "", oauthState: "" }),
        authenticate: () => Effect.succeed({ status: "connected" as const }),
        finishAuth: () => Effect.succeed({ status: "connected" as const }),
        removeAuth: () => Effect.void,
        supportsOAuth: () => Effect.succeed(false),
        hasStoredTokens: () => Effect.succeed(false),
        getAuthStatus: () => Effect.succeed({ kind: "none" as const }),
      } as unknown as MCP.Interface

      yield* HivemindLoopHook.recordTurnEnd({
        enabled: true,
        mcp: Option.some(stubMcp),
        sessionID: "ses_x",
        messageID: MessageID.make("msg_x"),
        finishReason: "stop",
        scope,
      })
      yield* Scope.close(scope, Exit.succeed(undefined))
      expect(true).toBe(true)
    }),
  )
})
