# gruntcode Eval System

Real-model integration tests that drive gruntcode with DeepSeek V4 Flash against template-based scenarios. Measures structural match, convention adherence, build success, brand generation, and performance across N runs.

## Run

```sh
# With pass-cli (no secret leaks to chat):
OPENCODE_API_KEY='pass://grunt-ai/opencode-api-key/password' \
  pass-cli run -- bun test/eval/runner.ts --scenario website --runs 3

# With plain env var:
EVAL_API_KEY="sk-..." bun run test/eval/runner.ts --scenario all --runs 5

# Record baseline:
bun test/eval/runner.ts --scenario website --runs 5 --record
```

## Scenarios

| Name | Project | Template | Branch | DB | Deploy |
|---|---|---|---|---|---|
| `website` | Vrtnar.si | website-template | main | None | CF Worker |
| `vetapp` | VetApp | app-template | main | Postgres | Workers+Coolster |
| `malikuhar` | MaliKuhar | app-template | coolify-coolster | Postgres | Docker on Coolify |
| `kolesar` | Kolesar | app-template | workers | D1 | CF Worker |

## Metrics

| Metric | Source | Description |
|---|---|---|
| buildOkRate | `bun run build` | Pass rate |
| avgCoverage | file tree check | Required files present |
| avgConventionScore | grep patterns | Stack conventions followed |
| avgAnnotationsPerFile | grep `: Type` counts | Type inference quality |
| avgFilesChanged | git diff | How much the model changed |
| brandOkRate | brand file check | Logo/favicon generated |
| avgWallClockMs | timer | Speed per run |
| stddevWallClockMs | timer | Consistency |
| pagespeed.score | Lighthouse | Perf score (website only) |
| avgTokensInput/Output | gruntcode output | Cost tracking |

## Output Format

All output is JSON-lines on stdout. Stderr has human-readable progress.

```json
{"type":"result","scenario":"website","run":1,"success":true,"buildOk":true,"coverage":0.94,"conventionScore":0.92,"annotationsPerFile":1.3,"brandOk":true}
{"type":"aggregate","scenario":"website","buildOkRate":1,"avgCoverage":0.94,...}
{"type":"diff","scenario":"website","avgCoverage":{"current":0.94,"baseline":0.94,"delta":"0.0%"}}
```

## Record vs Run Mode

- **Run mode** (default): runs scenario, diffs against existing baseline if present. Reports regression if any metric drops >10%.
- **Record mode** (`--record`): stores first run's aggregated metrics as the baseline reference. Subsequent runs diff against it.

First time running a scenario: always use `--record` to establish the baseline.

## Adding a New Scenario

1. Add a new entry to the `scenarios` object in `scenario.ts`
2. Define: prompt, requiredFiles, conventions (grep patterns), antiConventions, brandFiles
3. Re-run with `--record` to capture initial baseline

## Environment

| Env | Required | Default |
|---|---|---|
| EVAL_API_KEY or OPENCODE_API_KEY | Yes | - |
| EVAL_MODEL | No | deepseek-v4-flash |
| EVAL_BASE_URL | No | https://api.opencode.ai/v1 |
| EVAL_BIN | No | gruntcode |
| EVAL_RUNS | No | 3 |
| EVAL_RECORD | No | false |

## Requirements

- `gruntcode` binary on PATH (or set `EVAL_BIN`)
- Local clones of `website-template` and `app-template` at `~/Developer/Projects/`
- `lighthouse` CLI for PageSpeed (optional, website only)
- API key for the opencode-go provider

## Architecture

CLI-subprocess approach: spawns `gruntcode run` with the task prompt, pipe stdin, capture stdout. No Effect-layer injection — tests the real binary end-to-end. See KB `gruntcode/eval-system.md` for full architecture documentation.
