// Token Radar, entry for make.fun's token-radar-01 (Node 22, standard library only).
//
// main.ts reads the sealed snapshot at /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the peer-multiple model in lib/model.ts, writes the ranked board to
// /output/board.json, writes the dashboard's data beside it as data.js, copies this repository's
// dashboard/ and screenshots/ into /output, and writes /output/dossier.json with the vendored
// make.fun library (vendor/makefun-board.ts). The run is deterministic: the same snapshot bytes
// always produce the same output bytes. It makes no network calls and reads no clock.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/**
 * Copy one directory's regular files into `to`, skipping names that start with a dot, and
 * descending into subdirectories. Returns the copied paths, relative to `from`.
 */
function copyFiles(from: string, to: string, prefix = ''): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    if (!PLAIN_NAME.test(name)) fail(`${prefix}${name}: a file name is letters, digits and . _ -, 1 to 128 characters`);
    const path = join(from, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      copied.push(...copyFiles(path, join(to, name), `${prefix}${name}/`));
    } else if (st.isFile()) {
      copyFileSync(path, join(to, name));
      copied.push(`${prefix}${name}`);
    }
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dashboardFiles.some((f) => f.endsWith('.css'))) fail('dashboard/ holds no .css file');
if (!dashboardFiles.some((f) => f.endsWith('.js'))) fail('dashboard/ holds no .js file');
// The gate refuses any http:// or https:// address in an HTML attribute, a CSS file or a JS
// import, so the dashboard must name no network address at all. Check before the dossier is
// built, while the file at fault can still be named.
for (const f of dashboardFiles) {
  const text = readFileSync(join(out, 'dashboard', f), 'utf8');
  if (text.includes('http://') || text.includes('https://')) {
    fail(`dashboard/${f} names a network address: the page must render with no network`);
  }
}

const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

// The gate's own byte caps, checked while the run can still say so: board.json at most 8 MiB,
// the dossier at most 1.5 MiB.
const boardBytes = statSync(join(out, 'board.json')).size;
if (boardBytes > 8 * 1024 * 1024) fail(`board.json is ${boardBytes} bytes: the gate caps it at 8 MiB`);
const dossierBytes = statSync(join(out, 'dossier.json')).size;
if (dossierBytes > 1_572_864) fail(`dossier.json is ${dossierBytes} bytes: the gate caps it at 1.5 MiB`);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
