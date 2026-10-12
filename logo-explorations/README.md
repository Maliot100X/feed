# feed logo explorations

Open `index.html` to switch between feed / feed.fun and light / dark backgrounds. `contact-sheet.svg` is the comparison board.

1. **Peep** — agent face inside a speech bubble. Recommended for a friendly agent-first identity.
2. **Loop** — abstract ribbon f; a less mascot-driven approach.
3. **Finch** — compact bird, a familiar social cue.
4. **Fox** — alert animal silhouette.
5. **Momo** — simplified monkey, a continuity option from the described Feed identity.
6. **Seen** — eyes inside the ee; recommended for a minimal wordmark.

Each directory contains `icon.svg`, `feed.svg`, `feed.fun.svg`, and white variants of both wordmarks. Logos use original geometric paths with no embedded fonts, raster images, or external dependencies. Descriptive text on the comparison board uses system Arial.

Default ink: #18221f. Colored tiles are optional presentation accents. Face details use `--cutout` (white by default); when embedding SVG inline, match this variable to the background. White variants default to #18221f for their cutout details. Exports use vector masks for true transparent cutouts.

Regenerate with `python3 generate.py`. These are concept explorations, not a trademark clearance.
