/**
 * PageSpeed measurement using Lighthouse CLI.
 * Runs `bun run preview` and measures against the local preview server.
 */

import { $ } from "bun"
import * as path from "path"
import * as fs from "fs/promises"

export interface PageSpeedResult {
  score: number | null
  lcp: number | null
  cls: number | null
  inp: number | null
  error?: string
}

/**
 * Run PageSpeed audit against a project's production build preview.
 *
 * 1. Runs `bun run build` to produce the production build
 * 2. Starts `bun run preview` to serve it locally
 * 3. Runs Lighthouse via CLI against the local preview
 * 4. Parses and returns core web vitals
 */
export async function runPagespeed(projectDir: string): Promise<PageSpeedResult> {
  try {
    // Check if lighthouse CLI is available
    const hasLighthouse = await $`which lighthouse 2>/dev/null`.quiet().nothrow()
    if (hasLighthouse.exitCode !== 0) {
      return { score: null, lcp: null, cls: null, inp: null, error: "lighthouse CLI not found" }
    }

    // Build
    const buildResult = await $`bun run build`.cwd(projectDir).quiet().nothrow()
    if (buildResult.exitCode !== 0) {
      return { score: null, lcp: null, cls: null, inp: null, error: "build failed" }
    }

    // Start preview server
    const preview = Bun.spawn(["bun", "run", "preview", "--port", "5899"], {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    })

    // Wait for preview to be ready (poll port)
    await waitForPort(5899, 30000)

    // Run lighthouse
    const reportPath = path.join(projectDir, ".lighthouse-report.json")
    const lhResult = await $`lighthouse http://localhost:5899 \
      --output=json \
      --output-path=${reportPath} \
      --chrome-flags="--headless --no-sandbox" \
      --quiet \
      --only-categories=performance \
      --max-wait-for-load=30000`
      .cwd(projectDir)
      .quiet()
      .nothrow()

    // Kill preview
    preview.kill()

    if (lhResult.exitCode !== 0) {
      return { score: null, lcp: null, cls: null, inp: null, error: "lighthouse run failed" }
    }

    // Parse report
    const reportText = await fs.readFile(reportPath, "utf-8")
    const report = JSON.parse(reportText)

    const score = report.categories?.performance?.score !== undefined
      ? Math.round(report.categories.performance.score * 100)
      : null

    const lcp = report.audits?.["largest-contentful-paint"]?.numericValue
      ? Math.round(report.audits["largest-contentful-paint"].numericValue)
      : null

    const cls = report.audits?.["cumulative-layout-shift"]?.numericValue ?? null

    const inp = report.audits?.["interaction-to-next-paint"]?.numericValue
      ? Math.round(report.audits["interaction-to-next-paint"].numericValue)
      : null

    // Clean up
    await fs.rm(reportPath, { force: true })

    return { score, lcp, cls, inp }
  } catch (err) {
    return { score: null, lcp: null, cls: null, inp: null, error: String(err) }
  }
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}`)
      if (res.ok || res.status === 404) return // 404 means the server is running
    } catch {
      // Not ready yet
    }
    await Bun.sleep(200)
  }
  throw new Error(`Preview server did not start on port ${port} within ${timeoutMs}ms`)
}
