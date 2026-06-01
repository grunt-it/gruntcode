import { Schema } from "effect"

/**
 * Metadata preserved when stripping KB read outputs during compaction.
 * Keeps audit trail without the full output bloat.
 */
export const KbReadMetadata = Schema.Struct({
  kb: Schema.String,
  file: Schema.String,
  kb_version: Schema.NullOr(Schema.String),
  output_tokens: Schema.Number,
  summary: Schema.String.check(Schema.isMaxLength(200)),
})

/**
 * Metadata preserved when stripping bash command outputs during compaction.
 * Keeps command, exit code, and head/tail lines for debugging context.
 */
export const BashMetadata = Schema.Struct({
  command: Schema.String,
  exit_code: Schema.Number,
  output_tokens: Schema.Number,
  head_lines: Schema.Array(Schema.String).check(Schema.isMaxLength(5)),
  tail_lines: Schema.Array(Schema.String).check(Schema.isMaxLength(5)),
})

/**
 * Metadata preserved when stripping file read outputs during compaction.
 * Keeps path and first line for context.
 */
export const ReadMetadata = Schema.Struct({
  path: Schema.String,
  lines_read: Schema.Number,
  output_tokens: Schema.Number,
  first_line: Schema.NullOr(Schema.String),
})

/**
 * Metadata preserved when stripping webfetch outputs during compaction.
 * Keeps URL and title for reference.
 */
export const WebfetchMetadata = Schema.Struct({
  url: Schema.String,
  status: Schema.Number,
  output_tokens: Schema.Number,
  title: Schema.NullOr(Schema.String),
})

/**
 * Metadata preserved when stripping grep outputs during compaction.
 * Keeps pattern and match statistics.
 */
export const GrepMetadata = Schema.Struct({
  pattern: Schema.String,
  include: Schema.NullOr(Schema.String),
  match_count: Schema.Number,
  files_matched: Schema.Array(Schema.String),
})

/**
 * Union of all strip metadata types.
 * Used to type the strippedOutput field on tool parts.
 */
export const StripMetadata = Schema.Union([
  KbReadMetadata,
  BashMetadata,
  ReadMetadata,
  WebfetchMetadata,
  GrepMetadata,
])

export type StripMetadata = Schema.Schema.Type<typeof StripMetadata>
