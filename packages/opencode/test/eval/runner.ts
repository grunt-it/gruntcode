#!/usr/bin/env bun
/**
 * gruntcode eval runner.
 *
 * Drives gruntcode with a real model against template-based scenarios.
 * Measures metrics across N runs. Outputs JSON-lines for machine parsing.
 *
 * SAFETY: always uses a COPY of the gruntcode binary (default: /tmp/gruntcode-eval)
 * so killing the eval subprocess never touches user's real sessions.
 *
 * Usage:
 *   OPENCODE_API_KEY='pass://grunt-ai/opencode-api-key/password' \
 *     pass-cli run -- bun test/eval/runner.ts --scenario website --runs 3
 *
 * Env:
 *   EVAL_API_KEY / OPENCODE_API_KEY  API key (required)
 *   EVAL_MODEL                       Model ID (default: deepseek-v4-flash)
 *   EVAL_BASE_URL                    API base URL
 *   EVAL_RECORD                      Record baseline (set to "true")
 *   EVAL_RUNS                        Default run count (default: 3)
 *   EVAL_BIN                         gruntcode binary path (default: /tmp/gruntcode-eval)
 */

import * as fs from "fs/promises"
import * as path from "path"
import { $ } from "bun"
import { scenarios, type ScenarioDef } from "./scenario"
import { runDiff } from "./diff"
import { runPagespeed } from "./pagespeed"

const scenarios_all = Object.keys(scenarios) as Array<keyof typeof scenarios>
type Scenario = (typeof scenarios_all)[number]

const THIS_DIR = path.dirname(new URL(import.meta.url).pathname)
const REFERENCES_DIR = path.join(THIS_DIR, "references")

interface ScenarioResult {
  scenario: Scenario
  run: number
  success: boolean
  buildOk: boolean | null
  filesChanged: number
  wallClockMs: number
  tokensInput: number
  tokensOutput: number
  coverage: number
  conventionScore: number
  annotationsPerFile: number
  brandOk: boolean
  brandCustomColors: boolean
  pagespeed?: {
    score: number | null
    lcp: number | null
    cls: number | null
  }
}

interface Baseline {
  scenario: Scenario
  model: string
  recordedAt: string
  runs: number
  metrics: Record<string, number>
}

async function main() {
  if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
    printHelp()
    process.exit(0)
  }

  const scenarioArg = getFlag("--scenario") ?? process.env.EVAL_SCENARIO ?? "all"
  const runCount = parseInt(getFlag("--runs") ?? process.env.EVAL_RUNS ?? "3", 10)
  const record = hasFlag("--record") || process.env.EVAL_RECORD === "true"
  const modelID = getFlag("--model") ?? process.env.EVAL_MODEL ?? "deepseek-v4-flash"
  const baseURL = getFlag("--baseURL") ?? process.env.EVAL_BASE_URL ?? "https://api.opencode.ai/v1"
  const gruntcodeBin = getFlag("--bin") ?? process.env.EVAL_BIN ?? "/tmp/gruntcode-eval"
const runTimeoutMs = parseInt(getFlag("--timeout") ?? process.env.EVAL_TIMEOUT ?? "300000", 10)

  const apiKey = process.env.EVAL_API_KEY ?? process.env.OPENCODE_API_KEY
  if (!apiKey) {
    console.error(
      "EVAL_API_KEY or OPENCODE_API_KEY must be set.\n" +
        "  OPENCODE_API_KEY='pass://grunt-ai/opencode-api-key/password' pass-cli run -- bun ...",
    )
    process.exit(1)
  }

  const allScenarios = scenarioArg === "all"
    ? scenarios_all
    : ([scenarioArg] as Scenario[])

  console.log(
    JSON.stringify({ type: "eval-start", scenarios: allScenarios, runs: runCount, record, model: modelID }),
  )

  for (const scenario of allScenarios) {
    const def = scenarios[scenario]
    if (!def) {
      console.error(`Unknown scenario: ${scenario}`)
      continue
    }

    console.error(`\n=== ${def.projectName} (${scenario}, ${runCount} runs) ===`)
    console.log(JSON.stringify({ type: "scenario-start", scenario, runs: runCount }))

    const results: ScenarioResult[] = []
    for (let i = 0; i < runCount; i++) {
      console.error(`  Run ${i + 1}/${runCount}...`)
      const result = await runScenario(def, i + 1, runCount, {
        apiKey,
        modelID,
        baseURL,
        gruntcodeBin,
        timeout: runTimeoutMs,
      })
      results.push(result)
      console.log(JSON.stringify({ type: "result", ...result }))
    }

    // Aggregate
    const aggregated = aggregate(results)
    console.log(JSON.stringify({ type: "aggregate", scenario, ...aggregated }))

    // Record or diff baseline
    const baselinePath = path.join(REFERENCES_DIR, `${scenario}.json`)

    if (record) {
      const baseline: Baseline = {
        scenario,
        model: modelID,
        recordedAt: new Date().toISOString(),
        runs: runCount,
        metrics: aggregated,
      }
      await fs.mkdir(REFERENCES_DIR, { recursive: true })
      await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2))
      console.log(JSON.stringify({ type: "baseline-recorded", scenario, file: `${scenario}.json` }))
      console.error(`  Baseline written: references/${scenario}.json`)
    }

    try {
      const existing = JSON.parse(await fs.readFile(baselinePath, "utf-8")) as Baseline
      const diff = diffMetrics(aggregated, existing.metrics)
      const hasRegression = Object.values(diff).some(
        (d) => typeof d.delta === "string" && d.delta !== "N/A" && parseFloat(d.delta) < -10,
      )
      console.log(JSON.stringify({ type: "diff", scenario, ...diff, regression: hasRegression }))
      if (hasRegression) {
        console.error(`  ⚠ REGRESSION detected in ${scenario}`)
      }
    } catch {
      if (!record) {
        console.log(JSON.stringify({ type: "no-baseline", scenario }))
      }
    }

    console.log(JSON.stringify({ type: "scenario-end", scenario }))
  }
}

function aggregate(results: ScenarioResult[]): Record<string, number> {
  const n = results.length
  return {
    buildOkRate: results.filter((r) => r.buildOk === true).length / n,
    avgFilesChanged: avg(results.map((r) => r.filesChanged)),
    avgCoverage: avg(results.map((r) => r.coverage)),
    avgConventionScore: avg(results.map((r) => r.conventionScore)),
    avgAnnotationsPerFile: avg(results.map((r) => r.annotationsPerFile)),
    avgTokensInput: avg(results.map((r) => r.tokensInput)),
    avgTokensOutput: avg(results.map((r) => r.tokensOutput)),
    avgWallClockMs: avg(results.map((r) => r.wallClockMs)),
    stddevWallClockMs: stddev(results.map((r) => r.wallClockMs)),
    brandOkRate: results.filter((r) => r.brandOk).length / n,
    brandCustomColorsRate: results.filter((r) => r.brandCustomColors).length / n,
  }
}

function diffMetrics(current: Record<string, number>, baseline: Record<string, number>) {
  const result: Record<string, { current: number; baseline: number; delta: string }> = {}
  for (const [key, c] of Object.entries(current)) {
    const b = baseline[key] ?? 0
    result[key] = {
      current: c,
      baseline: b,
      delta: b === 0 ? "N/A" : `${((c - b) / b * 100).toFixed(1)}%`,
    }
  }
  return result
}

async function runScenario(
  def: ScenarioDef,
  runNum: number,
  totalRuns: number,
  opts: { apiKey: string; modelID: string; baseURL: string; gruntcodeBin: string; timeout: number },
): Promise<ScenarioResult> {
  const startTime = Date.now()
  const tmpDir = await createTempDir()

  try {
    const home = process.env.HOME ?? "/Users/nikdivjak"
    const templateDir = path.join(home, "Developer", "Projects", def.templateDir)
    await fs.cp(templateDir, tmpDir, { recursive: true })

    await fs.writeFile(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify(buildConfig(opts), null, 2),
    )

    await $`git init`.cwd(tmpDir).quiet()
    await $`git config user.email "eval@grunt.test"`.cwd(tmpDir).quiet()
    await $`git config user.name "Eval"`.cwd(tmpDir).quiet()
    await $`git add -A`.cwd(tmpDir).quiet()
    await $`git commit --allow-empty -m "initial"`.cwd(tmpDir).quiet()

    // Checkout the scenario's template branch
    try {
      const branch = def.templateBranch
      if (branch !== "main") {
        const branches = await $`git branch -a`.cwd(tmpDir).quiet().text()
        if (branches.includes(branch) || branches.includes(`origin/${branch}`) || branches.includes(`remotes/origin/${branch}`)) {
          await $`git checkout ${branch}`.cwd(tmpDir).quiet()
          console.error(`    checked out branch: ${branch}`)
        }
      }
    } catch {
      console.error(`    (branch checkout skipped)`)
    }

    const runStart = Date.now()

    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), opts.timeout)

    const proc = Bun.spawn(
      [
        opts.gruntcodeBin,
        "run",
        "--agent",
        "build",
        "--format",
        "json",
        "--dangerously-skip-permissions",
      ],
      {
        cwd: tmpDir,
        env: {
          ...process.env,
          OPENCODE_API_KEY: opts.apiKey,
          FORCE_COLOR: "0",
        },
        stdio: ["pipe", "pipe", "pipe"],
        signal: abortController.signal,
      },
    )

    proc.stdin.write(Buffer.from(def.prompt))
    proc.stdin.end()

    const exitCode = await proc.exited.catch((e) => {
      return null
    })
    clearTimeout(timeoutId)

    const stdoutText = await new Response(proc.stdout).text()
    const events = stdoutText.split("\n").filter(Boolean)
    let tokensInput = 0
    let tokensOutput = 0
    for (const line of events) {
      try {
        const event = JSON.parse(line)
        if (event.type === "step_finish" && event.part?.tokens) {
          tokensInput += event.part.tokens.input ?? 0
          tokensOutput += event.part.tokens.output ?? 0
        }
      } catch {
        // skip non-JSON lines
      }
    }

    console.error(`    gruntcode done (exit=${exitCode}, tokens=${tokensInput}+${tokensOutput}, ${Date.now() - runStart}ms)`)

    // Run diff engine
    const diff = await runDiff(tmpDir, def)

    // Build check
    let buildOk: boolean | null = null
    if (def.checkBuild) {
      console.error(`    running build...`)
      try {
        const buildResult = await $`bun run build`.cwd(tmpDir).quiet().nothrow()
        buildOk = buildResult.exitCode === 0
      } catch {
        buildOk = false
      }
    }

    // File diff
    const diffOutput = await $`git diff --stat --diff-filter=AMDR`.cwd(tmpDir).quiet().text()
    const filesChanged = diffOutput.split("\n").filter((l) => l.trim()).length

    // PageSpeed (website only)
    let pagespeedResult: ScenarioResult["pagespeed"]
    if (def.checkPagespeed) {
      console.error(`    running pagespeed...`)
      const ps = await runPagespeed(tmpDir)
      if (ps.score !== null) {
        pagespeedResult = { score: ps.score, lcp: ps.lcp, cls: ps.cls }
      }
    }

    return {
      scenario: def.id as Scenario,
      run: runNum,
      success: exitCode === 0,
      buildOk,
      filesChanged,
      wallClockMs: Date.now() - runStart,
      tokensInput,
      tokensOutput,
      coverage: diff.structural.coverage,
      conventionScore: diff.conventions.score,
      annotationsPerFile: diff.typeInference.annotationsPerFile,
      brandOk: diff.brand.allPresent,
      brandCustomColors: diff.brand.hasCustomColors,
      pagespeed: pagespeedResult,
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

async function createTempDir(): Promise<string> {
  const dir = path.join(
    await fs.realpath(process.env.TMPDIR ?? "/tmp"),
    `gruntcode-eval-${Math.random().toString(36).slice(2)}`,
  )
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function buildConfig(opts: { apiKey: string; modelID: string; baseURL: string }) {
  return {
    $schema: "https://opencode.ai/config.json",
    provider: {
      "opencode-go": {
        name: "Opencode Go",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          [opts.modelID]: {
            id: opts.modelID,
            name: opts.modelID,
            attachment: true,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 128000, output: 8192 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: opts.apiKey,
          baseURL: opts.baseURL,
        },
      },
    },
    model: `opencode-go/${opts.modelID}`,
  }
}

function getFlag(name: string): string | undefined {
  const idx = Bun.argv.indexOf(name)
  if (idx === -1 || idx >= Bun.argv.length - 1) return undefined
  return Bun.argv[idx + 1]
}

function hasFlag(name: string): boolean {
  return Bun.argv.includes(name)
}

function avg(vals: number[]): number {
  if (vals.length === 0) return 0
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function stddev(vals: number[]): number {
  if (vals.length < 2) return 0
  const m = avg(vals)
  return Math.sqrt(vals.reduce((sum, v) => sum + (v - m) ** 2, 0) / (vals.length - 1))
}

function printHelp() {
  console.log(`
gruntcode eval runner — real-model integration tests

Usage:
  bun test/eval/runner.ts [options]
  OPENCODE_API_KEY='pass://...' pass-cli run -- bun test/eval/runner.ts ...

Options:
  --scenario <name>  Scenario (${scenarios_all.join("|")}|all)         [default: all]
  --runs <n>         Runs per scenario                                 [default: 3]
  --record           Record baseline snapshots
  --model <id>       Model ID                                          [default: deepseek-v4-flash]
  --baseURL <url>    API base URL
  --bin <path>       gruntcode binary path                             [default: /tmp/gruntcode-eval]
  --timeout <ms>     Per-run timeout                                   [default: 300000]
  --help, -h         Show help

Output: JSON-lines on stdout. Stderr for progress.
  `)
}

await main()
