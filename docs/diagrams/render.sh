#!/usr/bin/env bash
# Regenerate every diagram SVG from its .d2 source.
#
# Each body is rendered twice, against theme-light.d2 and theme-dark.d2, because d2 inlines custom
# fills as literal colours: one SVG cannot carry both palettes. The docs pair them with <picture>.
#
# Needs d2 v0.7.x on PATH (https://d2lang.com/tour/install), or D2 pointing at it:
#   D2=/path/to/d2 ./render.sh
set -euo pipefail

cd "$(dirname "$0")"
D2="${D2:-d2}"

if ! command -v "$D2" >/dev/null 2>&1; then
  echo "render.sh: d2 not found. Install it, or set D2=/path/to/d2." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

n=0
for body in *.d2; do
  [[ "$body" == theme-*.d2 ]] && continue
  name="${body%.d2}"
  for mode in light dark; do
    cat "theme-$mode.d2" "$body" > "$tmp/$name-$mode.d2"
    "$D2" --pad 28 "$tmp/$name-$mode.d2" "$name-$mode.svg" >/dev/null 2>&1 || { echo "render.sh: $body failed ($mode)" >&2; "$D2" --pad 28 "$tmp/$name-$mode.d2" "$name-$mode.svg"; }
    echo "  $name-$mode.svg"
  done
  n=$((n + 1))
done

echo "rendered $n diagrams (light + dark)"
