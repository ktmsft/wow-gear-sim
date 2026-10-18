// Local run history: one JSON file in the user's app data folder.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'SIMulacrum')
  : path.join(os.homedir(), '.simulacrum');
const FILE = path.join(DIR, 'history.json');
const MAX = 2000;

const charField = (parsed, key) => parsed.charLines
  .find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1).replace(/^"|"$/g, '') ?? '';

export const characterOf = (parsed) => ({ name: parsed.name, server: charField(parsed, 'server') });

async function load() {
  try {
    return JSON.parse(await fsp.readFile(FILE, 'utf8'));
  } catch {
    return [];
  }
}

// Writes go one at a time so two runs can't clobber each other.
let chain = Promise.resolve();
function update(fn) {
  chain = chain.then(async () => {
    const list = fn(await load());
    await fsp.mkdir(DIR, { recursive: true });
    await fsp.writeFile(FILE, JSON.stringify(list));
  });
  return chain;
}

function summary(row) {
  if (row.kind === 'gear') return row.changes.map((c) => `${c.name} (${c.ilvl})`).join(', ');
  if (row.kind === 'talents') return `Talents: ${row.loadout}`;
  return row.label ?? '';
}

export function record(parsed, options, result, sets) {
  const top = result.rows.find((r) => !r.estimate);
  const margin = (top?.error ?? 0) + (result.baseline.error ?? 0);
  const upgrade = top && top.delta > margin ? top : null;
  const entry = {
    at: Date.now(),
    ...characterOf(parsed),
    className: parsed.className,
    spec: parsed.spec,
    fightStyle: options.fightStyle,
    targets: options.targets,
    dps: result.baseline.dps,
    error: result.baseline.error,
    best: upgrade ? upgrade.dps : result.baseline.dps,
    bestText: upgrade ? summary(upgrade) : null,
    sets,
  };
  return update((list) => [...list, entry].slice(-MAX));
}

const mine = (name, server) => (e) => e.name === name && e.server === server;

export async function list(name, server) {
  return (await load()).filter(mine(name, server));
}

export function clear(name, server) {
  const match = mine(name, server);
  return update((list) => list.filter((e) => !match(e)));
}
