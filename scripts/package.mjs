// Builds dist/GearSim: GearSim.exe (Node single executable) plus the web files.
// Usage: node scripts/package.mjs [--simc path\to\simc.exe] [--simc-src path\to\simc-source]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'GearSim');
const EXE = path.join(OUT, process.platform === 'win32' ? 'GearSim.exe' : 'GearSim');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const simcExe = arg('--simc');
const simcSrc = arg('--simc-src');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

console.log('Bundling server...');
await build({
  entryPoints: [path.join(ROOT, 'server.js')],
  outfile: path.join(DIST, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'error',
});

console.log('Building GearSim executable...');
const seaConfig = path.join(DIST, 'sea-config.json');
const blob = path.join(DIST, 'sea-prep.blob');
fs.writeFileSync(seaConfig, JSON.stringify({
  main: path.join(DIST, 'server.cjs'),
  output: blob,
  disableExperimentalSEAWarning: true,
}));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
fs.copyFileSync(process.execPath, EXE);
if (process.platform === 'win32') {
  // node.exe is signed; injecting invalidates the signature, so drop it if signtool is around.
  try {
    execFileSync('signtool', ['remove', '/s', EXE], { stdio: 'ignore' });
  } catch { /* optional */ }
}
await inject(EXE, 'NODE_SEA_BLOB', fs.readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
});

console.log('Copying files...');
for (const dir of ['public', 'lib']) {
  fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
}
fs.copyFileSync(path.join(ROOT, 'packaging', 'README.txt'), path.join(OUT, 'README.txt'));

const licenses = path.join(OUT, 'licenses');
fs.mkdirSync(licenses);
const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE');
if (fs.existsSync(nodeLicense)) {
  fs.copyFileSync(nodeLicense, path.join(licenses, 'Node.js-LICENSE.txt'));
} else {
  const res = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!res.ok) throw new Error(`Couldn't fetch the Node.js license (${res.status}).`);
  fs.writeFileSync(path.join(licenses, 'Node.js-LICENSE.txt'), await res.text());
}

if (simcExe) {
  fs.mkdirSync(path.join(OUT, 'simc'));
  fs.copyFileSync(simcExe, path.join(OUT, 'simc', 'simc.exe'));
}
if (simcSrc) {
  for (const name of fs.readdirSync(simcSrc).filter((n) => /^(LICENSE|COPYING)/.test(n))) {
    fs.copyFileSync(path.join(simcSrc, name), path.join(licenses, `SimulationCraft-${name}.txt`));
  }
  let commit = '';
  try {
    commit = execFileSync('git', ['-C', simcSrc, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch { /* not a git checkout */ }
  fs.writeFileSync(path.join(licenses, 'SimulationCraft-SOURCE.txt'),
    'simc.exe is SimulationCraft, licensed under the GNU GPL v3 (see SimulationCraft-LICENSE.txt).\n'
    + 'Source code: https://github.com/simulationcraft/simc'
    + (commit ? `\nBuilt from commit: ${commit}\n` : '\n'));
}

for (const f of ['server.cjs', 'sea-config.json', 'sea-prep.blob']) fs.rmSync(path.join(DIST, f));
console.log(`Done: ${OUT}`);
