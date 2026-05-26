// grunt-it soft-fork branding: "grunt" (left, rendered in green via Logo override) + "code" (right, default theme text).
//
// Clean block glyphs: NO shadow markers (_^~,). Just █▀▄ and space. Each letter is 4 columns wide and
// 3 rows tall plus a 1-row spacer at top. Letters separated by 1 space.
//
// Letter design:
//   G:        R:        U:        N:        T:
//   █▀▀▀      █▀▀▄      █  █      █▄ █      ▀█▀
//   █ ▀█      █▀▀▄      █  █      █ ▀█       █
//   ▀▀▀▀      ▀  ▀      ▀▀▀▀      ▀  ▀       ▀
//
//   C:        O:        D:        E:
//   █▀▀▀      █▀▀█      █▀▀▄      █▀▀▀
//   █         █  █      █  █      █▀▀
//   ▀▀▀▀      ▀▀▀▀      ▀▀▀▀      ▀▀▀▀
export const logo = {
  left: [
    "                        ",
    "█▀▀▀ █▀▀▄ █  █ █▄ █ ▀█▀ ",
    "█ ▀█ █▀▀▄ █  █ █ ▀█  █  ",
    "▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀  ▀  ▀  ",
  ],
  right: [
    "                   ",
    "█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀",
    "█    █  █ █  █ █▀▀ ",
    "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀",
  ],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
