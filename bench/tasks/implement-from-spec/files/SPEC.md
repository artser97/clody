# parseDuration

`parseDuration(text)` parses a duration string into total seconds.

- Supported units: `h` (hours), `m` (minutes), `s` (seconds)
- Units may be combined in order, e.g. `"1h30m"` → 5400, `"45s"` → 45, `"2m5s"` → 125
- An empty string returns 0
- Invalid input (anything not matching the pattern) throws a `TypeError`
