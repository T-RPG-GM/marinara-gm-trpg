#!/bin/bash
# Full installer cycle on the throwaway worktree scratchpad/test. Never touches the real Marinara folder
# (git keeps the worktree's info/exclude in the main repository: the block is checked at the end).
S="/c/Users/dbrkq/AppData/Local/Temp/claude/027a67137493fcfa/5c1e4ff2-80b1-42c1-8c26-6d1d9a64dd40/scratchpad"
K="$S/pkg/marinara-coc7"; T="$S/test"; G=packages/server/src/routes/gallery.routes.ts
step() { label=$1; shift; out=$(cd "$K" && node install.mjs "$@" "$T" 2>&1); echo "=== $label (exit $?)"; echo "$out" | grep -E '·|\[(완료|실패)' | sed 's/^/  /'; }
step install install
echo "  launcher-clean would delete: [$(cd "$T" && git clean -nd -- packages/shared/src packages/server/src packages/client/src | tr '\n' ' ')]"
echo "  new code present: $(grep -c promptConnectionId "$T/$G") gallery / $(grep -c illustrationConnection "$T/packages/client/src/components/game/coc7/ui.mjs") ui"
step re-apply install
step 'uninstall before simulated update' uninstall
sed -i 's|^const generateGalleryImageSchema = z.object({|// simulated upstream edit\nconst generateGalleryImageSchema = z.object({|' "$T/$G"
step 'install over changed Marinara (3-way)' install
echo "  simulated edit kept: $(grep -c 'simulated upstream edit' "$T/$G") · CoC hunk present: $(grep -c withCoc7Appearances "$T/$G")"
step uninstall uninstall
echo "  tracked changes left: $(cd "$T" && git status --short | tr '\n' '|')"
echo "  exclude block left: $(grep -c 'Marinara CoC 7th TRPG' "$(cd "$T" && git rev-parse --path-format=absolute --git-path info/exclude)")"

# An update that rewrites a line the CoC patch changes: install must refuse cleanly, uninstall must still work.
(cd "$T" && git checkout -q -- "$G")
sed -i 's|^  negativePromptOverride: z.string().max(200_000).optional(),$|  negativePromptOverride: z.string().max(100_000).optional(), // simulated conflicting edit|' "$T/$G"
step 'install over a conflicting change' install
echo "  conflicting edit kept: $(grep -c 'simulated conflicting edit' "$T/$G") · CoC hunk present: $(grep -c withCoc7Appearances "$T/$G")"
step 'uninstall after the refused install' uninstall
echo "  CoC files left: $(ls "$T/packages/client/src/components/game/coc7" 2>/dev/null | wc -l) · exclude block left: $(grep -c 'Marinara CoC 7th TRPG' "$(cd "$T" && git rev-parse --path-format=absolute --git-path info/exclude)")"
echo FINISHED
