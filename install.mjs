#!/usr/bin/env node
// 마리나라 GM 전용 TRPG (unofficial; compatible with Call of Cthulhu 7th Edition rules) — installer, re-applier and remover.
//
//   node install.mjs install   [Marinara 폴더]   설치 (이미 설치돼 있으면 빠진 부분만 다시 넣어요)
//   node install.mjs uninstall [Marinara 폴더]   제거 (게임 기록은 지우지 않아요)
//   node install.mjs check     [Marinara 폴더]   바꾸지 않고 설치 가능 여부만 확인
//
// What it does, and nothing else:
//  1. copies the CoC files (files/…) into the Marinara folder;
//  2. lists them in .git/info/exclude, so Marinara's launcher (start.bat runs `git clean` on the source folders)
//     never deletes them;
//  3. applies patches/coc7-host.patch — the few lines in Marinara's own files that connect CoC (new-game menu,
//     chat screen, server routes, illustration route). If they do not fit this Marinara version, every file is
//     put back as it was and nothing is built;
//  4. applies patches/build-compat.patch when it fits (type annotations some setups need to build);
//  5. rebuilds the client and the server.
// Game data (packages/server/data/coc7-games) is never touched.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const [command = 'install', target] = process.argv.slice(2);

const say = (text = '') => console.log(text);
const fail = (text) => { console.error(`\n[실패] ${text}`); process.exit(1); };

function isMarinara(dir) {
  return Boolean(dir) && existsSync(join(dir, 'packages', 'server')) && existsSync(join(dir, 'packages', 'client')) && existsSync(join(dir, 'package.json'));
}

// The Marinara folder: the one given, the folder this package sits in, or the current folder.
function findRoot() {
  for (const dir of [target, resolve(here, '..'), process.cwd()]) {
    if (dir && isMarinara(resolve(dir))) return resolve(dir);
  }
  fail('Marinara 폴더를 찾지 못했어요. 이 폴더(marinara-gm-trpg)를 Marinara-Engine 폴더 안에 넣고 다시 실행하거나,\n       node install.mjs install "Marinara 폴더 경로" 로 실행해 주세요.');
}

const root = findRoot();
const hasGit = existsSync(join(root, '.git'));
const git = (args, options = {}) => spawnSync('git', args, { cwd: root, encoding: 'utf8', ...options });

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}
const ownedFiles = listFiles(join(here, 'files')).map((file) => relative(join(here, 'files'), file).split(sep).join('/'));
const patchFiles = (patch) => [...readFileSync(patch, 'utf8').matchAll(/^diff --git a\/(\S+) b\//gm)].map((match) => match[1]);

// ── .git/info/exclude: keep the CoC files out of the launcher's `git clean` ──
// Asked from git, so it is right for any checkout (a worktree keeps it in the main repository's folder).
const excludeFile = (() => {
  const found = hasGit ? spawnSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: root, encoding: 'utf8' }).stdout.trim() : '';
  return found ? resolve(root, found) : join(root, '.git', 'info', 'exclude');
})();
const excludeStart = '# >>> 마리나라 GM 전용 TRPG (자동 관리 · 지우지 마세요)';
const excludeEnd = '# <<< 마리나라 GM 전용 TRPG';
// Blocks written by earlier versions under the old name are cleaned up too.
const legacyExclude = [['# >>> Marinara CoC 7th TRPG (자동 관리 · 지우지 마세요)', '# <<< Marinara CoC 7th TRPG']];
function writeExclude(add) {
  if (!hasGit) return;
  mkdirSync(dirname(excludeFile), { recursive: true });
  const current = existsSync(excludeFile) ? readFileSync(excludeFile, 'utf8') : '';
  const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const kept = [[excludeStart, excludeEnd], ...legacyExclude]
    .reduce((text, [start, end]) => text.replace(new RegExp(`\\n?${literal(start)}[\\s\\S]*?${literal(end)}\\n?`, 'g'), '\n'), current)
    .replace(/\n{3,}/g, '\n\n');
  const block = add ? `\n${excludeStart}\n${manifest.exclude.join('\n')}\n${excludeEnd}\n` : '';
  writeFileSync(excludeFile, `${kept.trimEnd()}\n${block}`);
}

// ── patches ──
const applied = (patch) => git(['apply', '--reverse', '--check', '--whitespace=nowarn', patch]).status === 0;
const fits = (patch) => git(['apply', '--check', '--whitespace=nowarn', patch]).status === 0;
// Whether any CoC line the patch adds is in Marinara's files. After a failed or undone install none is,
// even when Marinara changed the lines around them so that the patch fits in neither direction.
// Only lines naming CoC count: the patch also re-indents ordinary Marinara lines that exist either way.
function present(patch) {
  let file = '';
  const added = new Map();
  for (const line of readFileSync(patch, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('+++ ')) { file = line.slice(4).replace(/^b\//, ''); continue; }
    if (file && line.startsWith('+') && /coc/i.test(line)) added.set(file, [...(added.get(file) ?? []), line.slice(1).trim()]);
  }
  return [...added].some(([name, lines]) => {
    if (!existsSync(join(root, name))) return false;
    const text = readFileSync(join(root, name), 'utf8');
    return lines.some((line) => text.includes(line));
  });
}

function backup(files) {
  return new Map(files.map((file) => [file, existsSync(join(root, file)) ? readFileSync(join(root, file)) : null]));
}
function restore(saved) {
  for (const [file, data] of saved) {
    if (data === null) rmSync(join(root, file), { force: true });
    else writeFileSync(join(root, file), data);
  }
  if (hasGit) git(['reset', '-q', '--', ...saved.keys()]);
}

// Applies a patch as-is, or with a three-way merge when Marinara changed nearby lines. A merge that leaves
// conflicts is undone completely, so a failed attempt never leaves half-patched files behind.
function applyPatch(patch, { required }) {
  const name = patch.split(/[\\/]/).pop();
  if (applied(patch)) { say(`  · ${name}: 이미 들어가 있어요`); return true; }
  if (fits(patch)) {
    const result = git(['apply', '--whitespace=nowarn', patch]);
    if (result.status === 0) { say(`  · ${name}: 넣었어요`); return true; }
  }
  if (hasGit) {
    const saved = backup(patchFiles(patch));
    // A three-way apply needs each file to match git's index, so files that carry other local edits
    // (another patch, an update not yet committed) are staged first; everything is unstaged again after.
    git(['add', '--', ...[...saved.keys()].filter((file) => saved.get(file) !== null)]);
    const merged = git(['apply', '--3way', '--whitespace=nowarn', patch]);
    const conflicted = git(['diff', '--name-only', '--diff-filter=U']).stdout.trim();
    if (merged.status === 0 && !conflicted) {
      git(['reset', '-q', '--', ...saved.keys()]);
      const unchanged = [...saved].every(([file, data]) => data !== null && existsSync(join(root, file)) && readFileSync(join(root, file)).equals(data));
      say(unchanged ? `  · ${name}: 이미 들어가 있어요` : `  · ${name}: 이 버전에 맞춰 합쳐서 넣었어요`);
      return true;
    }
    restore(saved);
  }
  if (required) return false;
  say(`  · ${name}: 이 버전에는 필요 없거나 맞지 않아 건너뛰었어요`);
  return true;
}

// Takes a patch out: as-is, or with a three-way merge when Marinara changed nearby lines since it went in.
// Returns false (with every file put back) when it cannot come out cleanly.
function reversePatch(patch) {
  const name = patch.split(/[\\/]/).pop();
  if (applied(patch)) {
    const result = git(['apply', '--reverse', '--whitespace=nowarn', patch]);
    if (result.status === 0) { say(`  · ${name}: 뺐어요`); return true; }
  }
  if (fits(patch) || !present(patch)) { say(`  · ${name}: 들어가 있지 않아요`); return true; }
  if (hasGit) {
    const saved = backup(patchFiles(patch));
    git(['add', '--', ...[...saved.keys()].filter((file) => saved.get(file) !== null)]);
    const merged = git(['apply', '--reverse', '--3way', '--whitespace=nowarn', patch]);
    const conflicted = git(['diff', '--name-only', '--diff-filter=U']).stdout.trim();
    if (merged.status === 0 && !conflicted) {
      git(['reset', '-q', '--', ...saved.keys()]);
      say(`  · ${name}: 이 버전에 맞춰 뺐어요`);
      return true;
    }
    restore(saved);
  }
  say(`  · ${name}: 자동으로 빼지 못했어요`);
  return false;
}

// ── build ──
function run(label, args, cwd) {
  say(`  · ${label}`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) fail(`${label}에 실패했어요. 위의 오류를 확인해 주세요.`);
}
function build() {
  say('\n[빌드] 화면과 서버를 다시 만들어요 (1~2분 걸릴 수 있어요)');
  const client = join(root, 'packages', 'client');
  const server = join(root, 'packages', 'server');
  if (existsSync(join(client, 'scripts', 'build.mjs')) && existsSync(join(server, 'scripts', 'build.mjs'))) {
    run('서버 빌드', ['./scripts/build.mjs'], server);
    run('화면 빌드', ['./scripts/build.mjs'], client);
  } else if (existsSync(join(root, 'scripts', 'pnpm-runner.mjs'))) {
    run('전체 빌드', ['scripts/pnpm-runner.mjs', 'build'], root);
  } else {
    fail('빌드 방법을 찾지 못했어요. Marinara를 한 번 실행하면 다시 빌드돼요.');
  }
}

const hostPatch = join(here, 'patches', 'coc7-host.patch');
const compatPatch = join(here, 'patches', 'build-compat.patch');
// Connection lines of earlier releases. They change the same lines as the current patch, so an install over an
// older release takes the old lines out first; uninstall also removes them when only an old release is in.
const legacyDir = join(here, 'patches', 'legacy');
const legacyPatches = existsSync(legacyDir)
  ? readdirSync(legacyDir).filter((name) => name.endsWith('.patch')).map((name) => join(legacyDir, name))
  : [];
function removeLegacy() {
  if (applied(hostPatch)) return true;
  for (const patch of legacyPatches) {
    if (fits(patch) || !present(patch)) continue;
    say(`  · 예전 판 연결(${patch.split(/[\\/]/).pop()})을 먼저 빼요`);
    if (!reversePatch(patch)) return false;
  }
  return true;
}

say(`${manifest.name} ${manifest.version}`);
say(`Marinara 폴더: ${root}`);
try {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  say(`Marinara 버전: ${version}  (이 패키지는 ${manifest.builtFor} 기준으로 만들었어요)`);
} catch { /* version shown only when readable */ }
if (!hasGit) say('※ git 폴더(.git)가 없는 설치예요. 연결 부분은 정확히 맞을 때만 들어가요.');
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { fail('git이 필요해요. Marinara를 설치할 때 함께 깔린 git이 PATH에 있는지 확인해 주세요.'); }

if (command === 'check') {
  say(`\n연결 부분: ${applied(hostPatch) ? '이미 들어가 있음' : fits(hostPatch) ? '그대로 넣을 수 있음' : '그대로는 안 맞음 (설치 때 합치기를 시도해요)'}`);
  process.exit(0);
}

if (command === 'install' || command === 'reapply') {
  say('\n[1/4] 게임 파일 복사');
  for (const file of ownedFiles) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(here, 'files', file), join(root, file));
  }
  say(`  · ${ownedFiles.length}개 파일`);
  say('\n[2/4] 실행기가 게임 파일을 지우지 않게 보호');
  writeExclude(true);
  say(hasGit ? '  · .git/info/exclude 에 등록했어요' : '  · git 폴더가 없어 건너뛰었어요');
  say('\n[3/4] Marinara에 게임 연결');
  if (!removeLegacy()) {
    fail('예전 판의 연결 부분을 자동으로 빼지 못했어요. Marinara 파일은 그대로 두었어요.\n       Marinara 폴더에서 git으로 해당 파일을 원래대로 되돌린 뒤 다시 실행해 주세요.');
  }
  if (!applyPatch(hostPatch, { required: true })) {
    fail('이 Marinara 버전에는 게임 연결 부분이 맞지 않아요. 파일은 원래대로 되돌렸어요.\n       새 버전의 패키지를 받아 주세요. (게임 파일 복사와 보호는 그대로 남아 있어요)');
  }
  applyPatch(compatPatch, { required: false });
  say('\n[4/4]');
  build();
  say('\n[완료] Marinara를 다시 시작하면 "새 대화 → GM(게임) → 마리나라 GM 전용 TRPG"로 시작할 수 있어요.');
  say('       Marinara를 업데이트한 뒤 게임 메뉴가 안 보이면 "다시 적용.bat"을 실행해 주세요.');
} else if (command === 'uninstall') {
  say('\n[1/3] Marinara에서 게임 연결 빼기');
  // The build-compat lines stay: they are plain type annotations that keep some setups building.
  // Only an earlier release's lines in (never updated to this one): those are the ones to take out.
  const legacyIn = !applied(hostPatch) && legacyPatches.find((patch) => applied(patch));
  if (!(legacyIn ? reversePatch(legacyIn) : reversePatch(hostPatch))) {
    fail('Marinara 파일에서 게임 연결 부분을 자동으로 빼지 못했어요. 게임 파일도 그대로 두었어요 (지우면 빌드가 깨져요).\n       Marinara 폴더에서 git으로 해당 파일을 원래대로 되돌린 뒤 다시 실행해 주세요.');
  }
  say('\n[2/3] 게임 파일 지우기');
  for (const file of ownedFiles) rmSync(join(root, file), { force: true });
  for (const dir of manifest.ownedDirs) {
    const full = join(root, dir);
    if (existsSync(full) && !readdirSync(full).length) rmSync(full, { recursive: true, force: true });
  }
  writeExclude(false);
  say('  · 지웠어요 (게임 기록 packages/server/data/coc7-games 는 그대로 남겨요)');
  say('\n[3/3]');
  build();
  say('\n[완료] 게임을 뺐어요. Marinara를 다시 시작해 주세요.');
} else {
  fail(`알 수 없는 명령이에요: ${command} (install, uninstall, check 중 하나)`);
}
