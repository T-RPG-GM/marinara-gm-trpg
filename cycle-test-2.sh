#!/bin/bash
# Installer cycle for the renamed package on a throwaway worktree (scratchpad/test). The real Marinara folder is never
# touched, except that git keeps a worktree's info/exclude in the main repository: the blocks are checked at the end.
S="/c/Users/dbrkq/AppData/Local/Temp/claude/027a67137493fcfa/5c1e4ff2-80b1-42c1-8c26-6d1d9a64dd40/scratchpad"
OLD="$S/pkg/marinara-coc7"; NEW="$S/pkg/marinara-gm-trpg"; T="$S/test"
G=packages/server/src/routes/gallery.routes.ts
M=packages/client/src/components/chat/ChatModeSelectorModal.tsx
EX="$(cd "$T" && git rev-parse --path-format=absolute --git-path info/exclude)"
step() { label=$1; pkg=$2; shift 2; out=$(cd "$pkg" && node install.mjs "$@" "$T" 2>&1); echo "=== $label (exit $?)"; echo "$out" | grep -E '·|\[(완료|실패)' | sed 's/^/  /'; }
blocks() { echo "  exclude blocks: old $(grep -c 'Marinara CoC 7th TRPG' "$EX") · new $(grep -c '마리나라 GM 전용 TRPG' "$EX")"; }
label() { echo "  menu label: new $(grep -c '마리나라 GM 전용 TRPG' "$T/$M") · old $(grep -c 'CoC 7th TRPG' "$T/$M")"; }
clean() { echo "  tracked changes: $(cd "$T" && git status --short -- packages | grep -v node_modules | tr '\n' '|')"; echo "  game files left: $(ls "$T/packages/client/src/components/game/coc7" 2>/dev/null | wc -l)"; }

step 'old 1.0.2 install' "$OLD" install
step 'upgrade to new' "$NEW" install
label; blocks
step 're-apply' "$NEW" install
step 'uninstall' "$NEW" uninstall
clean; blocks

step 'old 1.0.2 install again' "$OLD" install
step 'uninstall with new package (old lines only)' "$NEW" uninstall
clean; blocks

sed -i 's|^const generateGalleryImageSchema = z.object({|// simulated upstream edit\nconst generateGalleryImageSchema = z.object({|' "$T/$G"
step 'install over changed Marinara (3-way)' "$NEW" install
echo "  simulated edit kept: $(grep -c 'simulated upstream edit' "$T/$G") · hunk present: $(grep -c withCoc7Appearances "$T/$G")"
step 'uninstall' "$NEW" uninstall
(cd "$T" && git checkout -q -- "$G")

sed -i 's|^  negativePromptOverride: z.string().max(200_000).optional(),$|  negativePromptOverride: z.string().max(100_000).optional(), // simulated conflicting edit|' "$T/$G"
step 'install over a conflicting change' "$NEW" install
echo "  hunk present: $(grep -c withCoc7Appearances "$T/$G")"
step 'uninstall after the refused install' "$NEW" uninstall
clean; blocks
echo FINISHED
