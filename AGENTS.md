- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- **`main`** — production builds (`gruntcode`). Stable release.
- **`staging`** — pre-release builds (`gruntcode-staging`).
- **`dev`** — cutting-edge builds (`gruntcode-dev`). Default branch.

## Building binaries locally

Each branch auto-detects its channel from `git branch --show-current` via `@opencode-ai/script`.
The version format is `0.0.0-<channel>-<YYYYMMDDHHmm>`.

```sh
# From packages/opencode — build for current platform only, no embedded web UI:
bun run script/build.ts --single --skip-embed-web-ui
```

Output lands in `dist/opencode-darwin-arm64/bin/opencode` (or the platform equivalent).

### Install to ~/.opencode/bin

After building, copy and **re-sign** — macOS invalidates the ad-hoc Bun signature on `cp`:

```sh
cp dist/opencode-darwin-arm64/bin/opencode ~/.opencode/bin/gruntcode       # main
cp dist/opencode-darwin-arm64/bin/opencode ~/.opencode/bin/gruntcode-staging  # staging
cp dist/opencode-darwin-arm64/bin/opencode ~/.opencode/bin/gruntcode-dev     # dev

codesign --force --sign - ~/.opencode/bin/gruntcode
codesign --force --sign - ~/.opencode/bin/gruntcode-staging
codesign --force --sign - ~/.opencode/bin/gruntcode-dev
```

Without the `codesign` step the binary will hang / exit 137 (SIGKILL) on macOS.

### Full rebuild all 3 tiers

```sh
cd packages/opencode
for branch in main staging dev; do
  git checkout "$branch"
  bun run script/build.ts --single --skip-embed-web-ui
  case "$branch" in
    main)    name=gruntcode ;;
    staging) name=gruntcode-staging ;;
    dev)     name=gruntcode-dev ;;
  esac
  cp dist/opencode-darwin-arm64/bin/opencode ~/.opencode/bin/"$name"
  codesign --force --sign - ~/.opencode/bin/"$name"
  echo "$name: $(~/.opencode/bin/"$name" --version)"
done
```

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.
