/**
 * Diff engine for eval runner.
 * Checks structural file presence, convention adherence, type-inference ratio, and brand files.
 */

import * as fs from "fs/promises"
import * as path from "path"
import { $ } from "bun"
import type { ScenarioDef } from "./scenario"

export interface StructuralResult {
  requiredFound: number
  requiredMissing: string[]
  requiredMatched: string[]
  coverage: number
}

export interface ConventionResult {
  conventionHits: Record<string, boolean>
  antiConventionHits: Record<string, boolean>
  score: number
}

export interface TypeInferenceResult {
  totalExplicitAnnotations: number
  filesChecked: number
  annotationsPerFile: number
}

export interface BrandResult {
  filesPresent: string[]
  filesMissing: string[]
  allPresent: boolean
  hasCustomColors: boolean
}

export interface DiffOutput {
  structural: StructuralResult
  conventions: ConventionResult
  typeInference: TypeInferenceResult
  brand: BrandResult
}

export async function runDiff(projectDir: string, def: ScenarioDef): Promise<DiffOutput> {
  const [structural, conventions, typeInference, brand] = await Promise.all([
    checkStructural(projectDir, def),
    checkConventions(projectDir, def),
    checkTypeInference(projectDir, def),
    checkBrand(projectDir, def),
  ])
  return { structural, conventions, typeInference, brand }
}

async function checkStructural(projectDir: string, def: ScenarioDef): Promise<StructuralResult> {
  const requiredMatched: string[] = []
  const requiredMissing: string[] = []

  for (const file of def.requiredFiles) {
    const exists = await fs
      .stat(path.join(projectDir, file))
      .then(() => true)
      .catch(() => false)
    if (exists) {
      requiredMatched.push(file)
    } else {
      requiredMissing.push(file)
    }
  }

  const requiredFound = requiredMatched.length
  const total = def.requiredFiles.length
  const coverage = total > 0 ? requiredFound / total : 0

  return { requiredFound, requiredMissing, requiredMatched, coverage }
}

async function checkConventions(projectDir: string, def: ScenarioDef): Promise<ConventionResult> {
  const conventionHits: Record<string, boolean> = {}
  const antiConventionHits: Record<string, boolean> = {}

  // Grep for each convention pattern across convention files
  for (const [pattern, _desc] of Object.entries(def.conventions)) {
    const found = await grepExists(projectDir, pattern, def.conventionFiles)
    conventionHits[pattern] = found
  }

  // Check anti-conventions
  for (const [pattern, _desc] of Object.entries(def.antiConventions)) {
    const found = await grepExists(projectDir, pattern, def.conventionFiles)
    antiConventionHits[pattern] = found
  }

  const total = Object.keys(def.conventions).length
  const hits = Object.values(conventionHits).filter(Boolean).length
  const score = total > 0 ? hits / total : 0

  return { conventionHits, antiConventionHits, score }
}

async function checkTypeInference(projectDir: string, def: ScenarioDef): Promise<TypeInferenceResult> {
  // Count explicit type annotations (": TypeName" patterns) in .ts/.svelte files
  // Excludes .d.ts files, import statements, type declarations, function params
  const result = await $`grep -rnP ':\\s*[A-Z]\\w*[<\\[]?[A-Za-z]' --include='*.ts' --include='*.svelte' --exclude='*.d.ts' ${def.conventionFiles.length > 0 ? def.conventionFiles.map((g) => `--glob='${g}'`).join(" ") : ""} ${projectDir}/src 2>/dev/null | head -200`
    .quiet()
    .text()

  const lines = result.split("\n").filter(Boolean)
  // Filter out import statements and type declarations
  const annotations = lines.filter(
    (line) =>
      !line.includes("import") &&
      !line.includes("export type") &&
      !line.includes("interface ") &&
      !line.includes("type ") &&
      !line.match(/\/\/.*:\s*[A-Z]/), // comment type hints
  )

  // Count unique files
  const filesWithAnnotations = new Set(annotations.map((l) => l.split(":")[0])).size

  // Count total files checked
  const fileCount = annotations.length > 0 ? filesWithAnnotations : 0

  return {
    totalExplicitAnnotations: annotations.length,
    filesChecked: fileCount,
    annotationsPerFile: fileCount > 0 ? annotations.length / fileCount : 0,
  }
}

async function checkBrand(projectDir: string, def: ScenarioDef): Promise<BrandResult> {
  const filesPresent: string[] = []
  const filesMissing: string[] = []

  for (const file of def.brandFiles) {
    const exists = await fs
      .stat(path.join(projectDir, file))
      .then(() => true)
      .catch(() => false)
    if (exists) {
      filesPresent.push(file)
    } else {
      filesMissing.push(file)
    }
  }

  // Check if app.css has non-default shadcn CSS variables (not the template defaults)
  let hasCustomColors = false
  try {
    const appCss = await fs.readFile(path.join(projectDir, "src", "app.css"), "utf-8")
    // Check for custom color values — look for hsl/css variables that aren't the template defaults
    const colorLines = appCss.match(/--(primary|secondary|accent|background|foreground|muted|border|ring):\s*[^;]+/gi)
    if (colorLines) {
      const defaultColors = [
        "185 30% 30%",
        "187 27% 70%",
        "187 40% 50%",
        "0 0% 3.9%",
        "0 0% 98%",
        "0 0% 45.1%",
        "0 0% 89.8%",
      ]
      hasCustomColors = colorLines.some(
        (line) => !defaultColors.some((dc) => line.includes(dc)),
      )
    }
  } catch {
    // app.css not found or unreadable
  }

  return {
    filesPresent,
    filesMissing,
    allPresent: filesMissing.length === 0,
    hasCustomColors,
  }
}

async function grepExists(
  baseDir: string,
  pattern: string,
  globPatterns: string[],
): Promise<boolean> {
  const globArgs = globPatterns.flatMap((g) => ["--glob", g])
  const result = await $`grep -rnP ${pattern} ${globArgs} ${baseDir}/src 2>/dev/null | head -1`.quiet().nothrow()
  return result.exitCode === 0 && result.text().trim().length > 0
}
