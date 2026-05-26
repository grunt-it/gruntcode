import { randomBytes } from "crypto"

export namespace Slug {
  const ADJECTIVES = [
    "brave",
    "calm",
    "clever",
    "cosmic",
    "crisp",
    "curious",
    "eager",
    "gentle",
    "glowing",
    "happy",
    "hidden",
    "jolly",
    "kind",
    "lucky",
    "mighty",
    "misty",
    "neon",
    "nimble",
    "playful",
    "proud",
    "quick",
    "quiet",
    "shiny",
    "silent",
    "stellar",
    "sunny",
    "swift",
    "tidy",
    "witty",
  ] as const

  const NOUNS = [
    "cabin",
    "cactus",
    "canyon",
    "circuit",
    "comet",
    "eagle",
    "engine",
    "falcon",
    "forest",
    "garden",
    "harbor",
    "island",
    "knight",
    "lagoon",
    "meadow",
    "moon",
    "mountain",
    "nebula",
    "orchid",
    "otter",
    "panda",
    "pixel",
    "planet",
    "river",
    "rocket",
    "sailor",
    "squid",
    "star",
    "tiger",
    "wizard",
    "wolf",
  ] as const

  export function create() {
    return [
      ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)],
      NOUNS[Math.floor(Math.random() * NOUNS.length)],
    ].join("-")
  }

  // grunt-it: named slug for sessions launched with a peer-id or in a known cwd.
  // Output: `<sanitized-base>-<5-char-base62-hash>` (e.g. `nik-test-a3f9k`, `gruntcode-x7p2n`).
  // Use as session.slug so the human-readable identifier reflects the launch context
  // instead of a random adjective-noun pair.
  export function createNamed(base: string): string {
    const sanitized = sanitize(base) || "session"
    return `${sanitized}-${randomBase62(5)}`
  }

  function sanitize(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 32)
  }

  function randomBase62(length: number): string {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    const bytes = randomBytes(length)
    let out = ""
    for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length]
    return out
  }
}
