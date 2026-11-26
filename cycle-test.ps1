# Full installer cycle on the throwaway upstream copy (scratchpad\test). Never touches the real Marinara folder,
# except that git keeps a worktree's info/exclude in the main repository: the block is checked and removed at the end.
$S = "C:\Users\dbrkq\AppData\Local\Temp\claude\027a67137493fcfa\5c1e4ff2-80b1-42c1-8c26-6d1d9a64dd40\scratchpad"
$K = "$S\pkg\marinara-coc7"
$T = "$S\test"
function Step($label, $args2) {
  Set-Location $K
  $out = & node install.mjs @args2 $T 2>&1
  $code = $LASTEXITCODE
  "=== $label (exit $code)"
  $out | Where-Object { "$_" -match '·|\[(완료|실패)' } | ForEach-Object { "  $_" }
}
Step 'install' @('install')
Set-Location $T; "  launcher-clean would delete: [" + ((git clean -nd -- packages/shared/src packages/server/src packages/client/src) -join ', ') + "]"
Step 're-apply' @('install')
# Simulate a Marinara update that changed a line right next to a CoC hunk: take CoC out, edit upstream, put CoC back.
Step 'uninstall before simulated update' @('uninstall')
Set-Location $T
$g = 'packages/server/src/routes/gallery.routes.ts'
$text = [IO.File]::ReadAllText("$T\$g")
$text = $text.Replace('const generateGalleryImageSchema = z.object({', "// simulated upstream edit`nconst generateGalleryImageSchema = z.object({")
[IO.File]::WriteAllText("$T\$g", $text)
Step 'install over changed Marinara (3-way)' @('install')
Set-Location $T; "  simulated edit kept: " + [bool](Select-String -Path "$T\$g" -Pattern 'simulated upstream edit' -SimpleMatch -Quiet) + " · CoC hunk present: " + [bool](Select-String -Path "$T\$g" -Pattern 'withCoc7Appearances' -SimpleMatch -Quiet)
Step 'uninstall' @('uninstall')
Set-Location $T
"  tracked changes left: " + ((git status --short) -join ' | ')
$ex = git rev-parse --git-path info/exclude
"  exclude block left: " + [bool](Select-String -Path $ex -Pattern 'Marinara CoC 7th TRPG' -SimpleMatch -Quiet)
