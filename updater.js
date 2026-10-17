// Updates simc.exe from the latest GitHub release (Windows only).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO = process.env.GEAR_SIM_REPO ?? 'ktmsft/wow-gear-sim';
const ASSET = 'simc-win64.zip';
const CHECK_TTL_MS = 30 * 60_000;

export const supported = process.platform === 'win32';

let cached = null;
let install = { state: 'idle' };

export function installState() {
  return install;
}

export async function latestRelease(force = false) {
  if (!force && cached && Date.now() - cached.at < CHECK_TTL_MS) return cached.release;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'gear-sim' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const rel = await res.json();
  const asset = rel.assets?.find((a) => a.name === ASSET);
  const release = {
    tag: rel.tag_name,
    page: rel.html_url,
    published: rel.published_at,
    build: rel.body?.match(/simc-build:\s*([0-9a-f]{7,40})/)?.[1] ?? null,
    simc: rel.body?.match(/simc-version:\s*(.+)/)?.[1]?.trim() ?? null,
    url: asset?.browser_download_url ?? null,
  };
  cached = { at: Date.now(), release };
  return release;
}

export function isNewer(release, currentBuild) {
  if (!release?.url || !release.build) return false;
  if (!currentBuild) return true;
  return !release.build.startsWith(currentBuild) && !currentBuild.startsWith(release.build);
}

// Downloads and swaps in the new simc.exe; `onDone` re-detects the version.
export async function installUpdate({ simcDir, workDir, onDone }) {
  if (install.state === 'downloading' || install.state === 'installing') return;
  install = { state: 'downloading' };
  const dir = path.join(workDir, 'update');
  try {
    const release = await latestRelease(true);
    if (!release?.url) throw new Error('No SimulationCraft download in the latest release.');

    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    const zip = path.join(dir, ASSET);
    const res = await fetch(release.url, { headers: { 'user-agent': 'gear-sim' } });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zip));

    install = { state: 'installing' };
    await run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dir]);
    const exe = path.join(dir, 'simc.exe');
    if (!fs.existsSync(exe)) throw new Error('simc.exe was not in the download.');

    await fsp.mkdir(simcDir, { recursive: true });
    const target = path.join(simcDir, 'simc.exe');
    const backup = path.join(simcDir, 'simc.old.exe');
    if (fs.existsSync(target)) await fsp.rename(target, backup);
    try {
      await fsp.copyFile(exe, target);
    } catch (err) {
      if (fs.existsSync(backup)) await fsp.rename(backup, target);
      throw err;
    }
    await fsp.rm(backup, { force: true });

    install = { state: 'done', version: release.simc };
    await onDone?.();
  } catch (err) {
    install = { state: 'error', error: err.message };
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`))));
  });
}
