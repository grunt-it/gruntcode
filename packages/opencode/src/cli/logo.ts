// grunt-it soft-fork branding: "grunt" (left, rendered in green via Logo override) + "code" (right, default theme text).
// Letterforms follow the upstream 4-row block-glyph style: row 0 is a spacer (gets the descender of any letter
// with one), rows 1-3 carry the glyph with `_^~,` shadow markers consumed by component/logo.tsx.
export const logo = {
  left: ["                        ", "█▀▀█ █▀▀█ █  █ █▀▀▄ ▀▀█▀", "█ __ █▀▀▄ █  █ █^^█  █  ", "▀▀▀▀ ▀~~▀ ▀▀▀▀ ▀  ▀  ▀  "],
  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
