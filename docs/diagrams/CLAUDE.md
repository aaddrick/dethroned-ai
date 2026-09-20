# Working on the diagrams

Read this before editing anything in `docs/diagrams/`. The approach and most of the rules come from
the ticketmill repo's diagram guide, where each was learned by rendering something that compiled
and then looked wrong on GitHub.

## What lives here

| File | Role |
| --- | --- |
| `theme-light.d2`, `theme-dark.d2` | Palette and class definitions. No nodes, no edges. |
| `gameplay-loop.d2`, `turn.d2`, `gauntlet.d2`, `architecture.d2`, `chronicle.d2`, `release.d2` | One diagram each, embedded at the top of the page of the same subject. |
| `render.sh` | Regenerates every SVG. The only supported way to produce them. |
| `*-light.svg`, `*-dark.svg` | Generated and committed, so reading the docs needs no tools. Never hand-edit. |

Bodies contain no colours. They reference class names only; all colour lives in the two themes.

## Making a change

1. Edit the `.d2` body (or both theme files).
2. Run `./render.sh` (needs [D2](https://d2lang.com) v0.7.x on `PATH`, or `D2=/path/to/d2`). It
   writes the light and the dark SVG. Commit the pair.
3. Look at the result at the width it will be seen at. See "Verifying".
4. A new diagram needs a `<picture>` block in its page; a changed class needs the legend in
   `docs/index.md` updated.

`render.sh` concatenates a theme and a body, so a body must not declare its own `vars` or `classes`.

## Classes

Both themes must define exactly these, or one mode silently falls back to d2's defaults.

| Class | Means |
| --- | --- |
| `stage` | An ordinary step |
| `model` | A call to Jev |
| `gate` | A check that can refuse or turn the flow |
| `store` | Something stored |
| `player` | A person |
| `terminal` | Where the flow ends |
| `phase` | A container (unused so far) |
| `flow` | A forward edge |
| `loop` | A backward edge, dashed amber |

## Rules

- **Comments are `#`.** `//` is parsed as a shape.
- **No `|md|` blocks.** They render as HTML inside the SVG, which GitHub's `<img>` embedding drops.
  Use quoted labels with `\n`. After any label change, `grep -c foreignObject *.svg` must be 0.
- **Two themes, because d2 inlines custom fills** as literal colours. The pages pair the renders
  with `<picture>` and `prefers-color-scheme`.
- **The canvas stays transparent.** Both themes set a root `style.fill: transparent`; without it a
  white slab sits behind the dark render.
- **Every diagram here is a grid snake.** Row 1 reads left to right, the flow drops down the last
  column, row 2 reads back right to left. Declare `grid-rows` before `grid-columns`; cells fill
  row-major over declaration order, and that order is the only thing that places them.
- **The diagonal rule.** Grid edges are straight, centre to centre, with no path-finding. An edge is
  orthogonal only between neighbouring cells in one row or one column. Anything else is a diagonal,
  and an edge spanning two cells draws through the one between. Place cells to suit the edges.
- **A cell has four sides.** `architecture.d2` works as a grid because the service has exactly four
  neighbours. Secret Manager would be a fifth, so it is named inside the service cell. A real
  fan-out belongs on the layout engine (remove the grid keys and dagre takes over), not in a grid.
- **Two-cycles are one `<->` edge** with a combined label; two edges stack their labels.
- **Spacer cells (`sp1: "" { style.opacity: 0 }`) are load-bearing.** Deleting one reflows the grid.
- **A column is as wide as its widest cell**, so one long label stretches everything above and
  below it. Break labels into short lines.
- **Size.** The SVG has a `viewBox` and no width, so it scales to the column, about 1012 px on
  GitHub. Aim for a natural width near that and a height under about 550. Currently 1085 to 1191
  wide and 292 to 469 tall:

  ```bash
  for f in *-light.svg; do printf "%-28s " "$f"; grep -o 'viewBox="[^"]*"' "$f" | head -1; done
  ```

- **Numbers in labels are facts.** The limits in `gauntlet.d2` (120, 20,000, 12) mirror
  `terraform/variables.tf`. Change them together.

## Verifying

Compiling is not verifying. Put the SVG in a page 1012 px wide and look at it in a browser, on
`#fff` for light and `#0d1117` for dark. Check both; a theme edit can break one and not the other.
`inkscape` and `rsvg-convert` do not show what GitHub shows.
