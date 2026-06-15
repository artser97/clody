// clody: the CLODY wordmark — same ANSI-Shadow art as the startup banner
// (packages/clody-cli/src/banner.ts), so the home screen matches the launch
// banner. The component renders `right` in the bright `theme.text`; `left` is
// intentionally blank (the wordmark is a single tone, not opencode's two-tone
// OPEN|CODE split). Both arrays must have equal row counts.
export const logo = {
  left: ["", "", "", "", "", ""],
  right: [
    " ██████╗██╗      ██████╗ ██████╗ ██╗   ██╗",
    "██╔════╝██║     ██╔═══██╗██╔══██╗╚██╗ ██╔╝",
    "██║     ██║     ██║   ██║██║  ██║ ╚████╔╝ ",
    "██║     ██║     ██║   ██║██║  ██║  ╚██╔╝  ",
    "╚██████╗███████╗╚██████╔╝██████╔╝   ██║   ",
    " ╚═════╝╚══════╝ ╚═════╝ ╚═════╝    ╚═╝   ",
  ],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
