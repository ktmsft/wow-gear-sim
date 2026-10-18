// Serves the UI and runs SimulationCraft jobs one at a time.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isSea } from 'node:sea';

import { parseProfile } from './lib/parse.js';
import { buildCombos } from './lib/combos.js';
import { deriveItems } from './lib/upgrades.js';
import { buildSimcInput, buildVariants, normalizeOptions } from './lib/simc-input.js';
import { breakdown, buffUptimes, mainStat, scaleOnly, statWeights } from './lib/report.js';
import { crestVariants, vaultVariants, trinketVariants } from './lib/modes.js';
import * as updater from './updater.js';
import * as history from './history.js';
import pkg from './package.json' with { type: 'json' };

// Packaged as SIMulacrum.exe, files sit next to the exe.
const PACKAGED = isSea();
const ROOT = PACKAGED ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const THREADS = Number(process.env.SIM_THREADS ?? Math.max(1, os.cpus().length));
const WORK_DIR = path.join(os.tmpdir(), 'wow-gear-sim');
const REPORT_DIR = path.join(WORK_DIR, 'reports');
const APP_VERSION = pkg.version;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function findSimc() {
  const candidates = [
    process.env.SIMC_PATH,
    path.join(ROOT, 'simc', 'simc.exe'),
    path.join(ROOT, 'simc', 'simc'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? (process.platform === 'win32' ? 'simc.exe' : 'simc');
}

let SIMC = findSimc();
let simcVersion = null;
let simcBuild = null;
let lastRun = null;

// Physical cores need WMI on Windows; os only reports logical CPUs.
function detectHardware() {
  const hw = { cores: null };
  if (process.platform !== 'win32') return Promise.resolve(hw);
  return new Promise((resolve) => {
    const ps = spawn('powershell', ['-NoProfile', '-Command',
      '(Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum'], { windowsHide: true });
    let out = '';
    ps.stdout.on('data', (d) => { out += d; });
    ps.on('error', () => resolve(hw));
    ps.on('close', () => resolve({ cores: Number(out.trim()) || null }));
  });
}
const hardware = detectHardware();

async function systemInfo() {
  const cpus = os.cpus();
  return {
    cpu: cpus[0]?.model.trim(),
    threads: cpus.length,
    ...(await hardware),
    simThreads: THREADS,
    memTotal: os.totalmem(),
    memFree: os.freemem(),
  };
}

// A trivial spell query is the cheapest call that prints the git build.
function detectSimcVersion() {
  SIMC = findSimc();
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(SIMC, ['spell_query=spell.id=1'], { windowsHide: true });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => child.kill(), 5000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => {
      clearTimeout(timer);
      simcBuild = out.match(/git build \S+ ([0-9a-f]+)/)?.[1] ?? null;
      resolve(out.match(/SimulationCraft [^\r\n(]+/)?.[0].trim() ?? null);
    });
  });
}

// --- jobs -------------------------------------------------------------------

const jobs = new Map();
const queue = [];
let running = null;

function publicJob(job) {
  const { id, mode, state, progress, lastLine, result, error, comboCount, queuedAt, startedAt, finishedAt } = job;
  return {
    id, mode, state, progress, lastLine, result, error, comboCount, queuedAt, startedAt, finishedAt,
    position: state === 'queued' ? queue.indexOf(job) + 1 : 0,
  };
}

function parseProgress(job, chunk) {
  const lines = chunk.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  job.lastLine = lines[lines.length - 1].slice(0, 200);
  for (const line of lines) {
    // e.g. "Generating Profileset: g77 106/470 [====>] ..."
    const sets = line.match(/Profileset:?\s+\S+\s+(\d+)\s*\/\s*(\d+)/i) ?? line.match(/Profilesets?\s*\(\s*(\d+)\s*\/\s*(\d+)/i);
    if (sets) job.progress = { ...job.progress, phase: 'profilesets', done: Number(sets[1]), total: Number(sets[2]) };
    else if (/baseline/i.test(line)) job.progress = { ...job.progress, phase: 'baseline' };
    // Effects SimulationCraft only approximates; reported once with the results.
    const guess = line.match(/Implementation Not Yet Verified:\s*([^:]+):/);
    if (guess) (job.unverified ??= new Set()).add(guess[1].trim());
  }
}

// Smart sim: a quick pass over everything, then re-sim the best at full precision.
const SMART_MIN_SETS = 40;
const SMART_QUICK_ERROR = 1.0;
// Minimum finalists per kind; anything statistically tied with the leader is also kept.
const SMART_KEEP = { gear: 25, gems: 12, consumable: 40, talents: 20 };

function readResults(json) {
  const player = json.sim.players[0];
  const baseline = {
    dps: player.collected_data.dps.mean,
    error: player.collected_data.dps.mean_std_dev * 1.96,
  };
  const results = new Map((json.sim.profilesets?.results ?? []).map((r) => [r.name, {
    dps: r.mean,
    error: r.mean_error ?? (r.mean_stddev != null ? r.mean_stddev * 1.96 : null),
  }]));
  return { baseline, results, version: json.version, player };
}

// One SimulationCraft run. Returns null if the job was cancelled meanwhile.
async function runSimc(job, {
  variants = [], targetError = job.options.targetError, stage = 1, options = job.options,
  actorLines = [], htmlPath = null, scale = null,
} = {}) {
  const dir = path.join(WORK_DIR, job.id);
  const inputPath = path.join(dir, `stage${stage}.simc`);
  const jsonPath = path.join(dir, `stage${stage}.json`);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(inputPath, buildSimcInput(job.parsed, variants, options, {
    jsonPath, threads: THREADS, targetError, htmlPath, actorLines, scale,
  }));
  job.progress = { ...job.progress, stage, phase: 'starting', done: 0, total: variants.length, error: targetError };

  const code = await new Promise((resolve, reject) => {
    const child = spawn(SIMC, [inputPath], { cwd: dir, windowsHide: true });
    job.child = child;
    let stderr = '';
    child.stdout.on('data', (d) => parseProgress(job, d.toString()));
    child.stderr.on('data', (d) => { stderr += d; parseProgress(job, d.toString()); });
    child.on('error', (err) => {
      reject(err.code === 'ENOENT'
        ? new Error(`SimulationCraft not found at "${SIMC}". Run scripts/build-simc.ps1 or set SIMC_PATH.`)
        : err);
    });
    child.on('close', (c) => {
      job.stderr = stderr.slice(-4000);
      resolve(c);
    });
  });

  if (job.state === 'cancelled') return null;
  if (!fs.existsSync(jsonPath)) {
    const detail = job.stderr.match(/Error:.*$/m)?.[0] ?? job.stderr ?? job.lastLine ?? '';
    throw new Error(`SimulationCraft exited with code ${code}.\n${detail}`.trim());
  }
  return readResults(JSON.parse(await fsp.readFile(jsonPath, 'utf8')));
}

function pickFinalists(variants, quick) {
  const byKind = {};
  for (const v of variants) (byKind[v.kind] ??= []).push(v);
  const keep = new Set();
  for (const [kind, list] of Object.entries(byKind)) {
    const r = (v) => quick.results.get(v.name);
    list.sort((a, b) => r(b).dps - r(a).dps);
    const best = r(list[0]);
    list.forEach((v, i) => {
      const close = best.dps - r(v).dps <= (best.error ?? 0) + (r(v).error ?? 0);
      if (i < (SMART_KEEP[kind] ?? 20) || close) keep.add(v.name);
    });
  }
  return variants.filter((v) => keep.has(v.name));
}

function toRows(variants, run, estimate) {
  return variants.filter((v) => run.results.has(v.name)).map((v) => {
    const r = run.results.get(v.name);
    const { lines, ...meta } = v;
    return {
      ...meta,
      dps: r.dps,
      error: r.error,
      delta: r.dps - run.baseline.dps,
      deltaPct: ((r.dps - run.baseline.dps) / run.baseline.dps) * 100,
      estimate,
    };
  });
}

// Sims every variant against the current setup, smart (two-pass) when it's worth it.
async function simVariants(job, variants) {
  const { options } = job;
  const smart = options.smart && variants.length >= SMART_MIN_SETS && options.targetError < SMART_QUICK_ERROR;
  if (!smart) {
    job.progress = { stages: 1 };
    const final = await runSimc(job, { variants });
    return final && { final, smart, rows: toRows(variants, final, false).sort((a, b) => b.dps - a.dps) };
  }
  job.progress = { stages: 2 };
  const quick = await runSimc(job, { variants, targetError: SMART_QUICK_ERROR, stage: 1 });
  if (!quick) return null;
  const finalists = pickFinalists(variants, quick);
  const final = await runSimc(job, { variants: finalists, stage: 2 });
  if (!final) return null;
  const kept = new Set(finalists.map((v) => v.name));
  // Put quick-pass numbers on the final pass's baseline.
  const shift = final.baseline.dps - quick.baseline.dps;
  const quickRows = toRows(variants.filter((v) => !kept.has(v.name)), quick, true)
    .map((r) => ({ ...r, dps: r.dps + shift }));
  const rows = [...toRows(finalists, final, false), ...quickRows].sort((a, b) => b.dps - a.dps);
  return { final, smart, rows };
}

const details = (player) => ({ breakdown: breakdown(player), buffs: buffUptimes(player) });

// --- modes ------------------------------------------------------------------

const MODES = {
  async topgear(job) {
    const sim = await simVariants(job, job.variants);
    if (!sim) return null;
    // Kept so single sets can be simmed in detail or across fight styles later.
    job.keep = {
      parsed: job.parsed, options: job.options,
      lines: new Map(job.variants.map((v) => [v.name, v.lines])),
    };
    const result = {
      baseline: sim.final.baseline,
      baselineDetail: details(sim.final.player),
      rows: sim.rows,
      smart: sim.smart,
      simc: sim.final.version ?? simcVersion,
    };
    lastRun = { sets: job.variants.length, seconds: Math.round((Date.now() - job.startedAt) / 1000), smart: sim.smart, at: Date.now() };
    await history.record(job.parsed, job.options, result, job.variants.length).catch(() => {});
    return result;
  },

  async weights(job) {
    const { parsed } = job;
    const main = mainStat(parsed.className, parsed.spec);
    job.progress = { stages: 1, phase: 'scaling' };
    const run = await runSimc(job, { scale: scaleOnly(main) });
    if (!run) return null;
    return { baseline: run.baseline, ...statWeights(run.player, parsed.className, parsed.spec), simc: run.version };
  },

  async crests(job) {
    const sim = await simVariants(job, job.variants);
    if (!sim) return null;
    // Best slot per item and rank.
    const best = new Map();
    for (const row of sim.rows) {
      const key = `${row.itemKey}:${row.level}`;
      if (!best.has(key)) best.set(key, row);
    }
    return { baseline: sim.final.baseline, rows: [...best.values()], smart: sim.smart, simc: sim.final.version };
  },

  async vault(job) {
    const variants = vaultVariants(job.parsed, job.options);
    const sim = await simVariants(job, variants);
    if (!sim) return null;
    // Best slot per reward.
    const best = new Map();
    for (const row of sim.rows) if (!best.has(row.vaultKey)) best.set(row.vaultKey, row);
    return { baseline: sim.final.baseline, rows: [...best.values()], simc: sim.final.version };
  },

  async trinkets(job) {
    const { series, variants } = job.trinkets;
    const sim = await simVariants(job, variants);
    if (!sim) return null;
    const byName = new Map(sim.rows.map((r) => [r.name, r]));
    const base = sim.final.baseline;
    for (const s of series) {
      for (const p of s.points) {
        const best = p.names.map((n) => byName.get(n)).filter(Boolean).sort((a, b) => b.dps - a.dps)[0];
        Object.assign(p, best
          ? { dps: best.dps, error: best.error, delta: best.delta, slot: best.slot, estimate: best.estimate }
          : { dps: base.dps, error: base.error, delta: 0 });
        delete p.names;
      }
    }
    return { baseline: base, series, simc: sim.final.version };
  },

  async styles(job) {
    const out = [];
    const { variants } = job;
    for (const [i, scenario] of FIGHT_SCENARIOS.entries()) {
      job.progress = { stages: FIGHT_SCENARIOS.length, label: scenario.label, note: `${scenario.label} (${scenario.note})` };
      const options = { ...job.options, fightStyle: scenario.fightStyle, targets: scenario.targets };
      const run = await runSimc(job, { variants, options, stage: i + 1 });
      if (!run) return null;
      out.push({
        ...scenario,
        baseline: run.baseline,
        results: Object.fromEntries([...run.results].map(([name, r]) => [name, r])),
      });
    }
    return { scenarios: out, names: variants.map((v) => v.name) };
  },

  async detail(job) {
    job.progress = { stages: 1 };
    const htmlPath = path.join(REPORT_DIR, `${job.id}.html`);
    await fsp.mkdir(REPORT_DIR, { recursive: true });
    const run = await runSimc(job, { actorLines: job.actorLines, htmlPath });
    if (!run) return null;
    return {
      name: job.setName, dps: run.baseline.dps, margin: run.baseline.error,
      ...details(run.player),
      report: fs.existsSync(htmlPath) ? `/api/reports/${job.id}` : null,
    };
  },
};

// Raid vs M+ vs AoE, all at the user's precision.
const FIGHT_SCENARIOS = [
  { key: 'st', label: 'Single target', note: 'Patchwerk, 1 target', fightStyle: 'Patchwerk', targets: 1 },
  { key: 'cleave', label: 'Cleave', note: 'Patchwerk, 3 targets', fightStyle: 'Patchwerk', targets: 3 },
  { key: 'aoe', label: 'AoE', note: 'Patchwerk, 8 targets', fightStyle: 'Patchwerk', targets: 8 },
  { key: 'dungeon', label: 'Dungeon', note: 'Dungeon Slice (M+)', fightStyle: 'DungeonSlice', targets: 1 },
];

async function runJob(job) {
  running = job;
  job.state = 'running';
  job.startedAt = Date.now();
  try {
    const result = await MODES[job.mode](job);
    if (!result) return;
    job.result = {
      ...result,
      unverified: [...(job.unverified ?? [])],
      seconds: Math.round((Date.now() - job.startedAt) / 1000),
    };
    job.state = 'done';
  } catch (err) {
    if (job.state !== 'cancelled') {
      job.state = 'error';
      job.error = err.message;
    }
  } finally {
    job.finishedAt = Date.now();
    job.child = null;
    job.parsed = null;
    job.variants = null;
    job.trinkets = null;
    running = null;
    fsp.rm(path.join(WORK_DIR, job.id), { recursive: true, force: true }).catch(() => {});
    pump();
  }
}

function pump() {
  if (running || !queue.length) return;
  runJob(queue.shift());
}

// Forget finished jobs after six hours, and their reports after a day.
setInterval(() => {
  const cutoff = Date.now() - 6 * 3_600_000;
  for (const [id, job] of jobs) if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  fsp.readdir(REPORT_DIR).then((files) => Promise.all(files.map(async (f) => {
    const file = path.join(REPORT_DIR, f);
    const { mtimeMs } = await fsp.stat(file);
    if (mtimeMs < Date.now() - 86_400_000) await fsp.rm(file, { force: true });
  }))).catch(() => {});
}, 600_000).unref();

// --- http -------------------------------------------------------------------

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'public/index.html'
    : urlPath.startsWith('/lib/') ? urlPath.slice(1)
    : `public${urlPath}`;
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(path.join(ROOT, 'public')) && !file.startsWith(path.join(ROOT, 'lib'))) {
    return send(res, 404, { error: 'Not found' });
  }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

const MODE_NAMES = new Set(Object.keys(MODES));

// Builds a job for any mode. Detail and fight-style runs reuse a finished Top Gear job.
function prepareJob(body) {
  const mode = MODE_NAMES.has(body.mode) ? body.mode : 'topgear';
  if (mode === 'detail' || mode === 'styles') {
    const src = jobs.get(String(body.source ?? ''))?.keep;
    if (!src) throw new Error('Those results have expired. Run the sim again.');
    const job = { mode, parsed: src.parsed, options: src.options };
    if (mode === 'detail') {
      const name = String(body.name ?? 'baseline');
      const lines = name === 'baseline' ? [] : src.lines.get(name);
      if (!lines) throw new Error('That set is no longer available.');
      return { ...job, setName: name, actorLines: lines, count: 1 };
    }
    const names = (Array.isArray(body.names) ? body.names : []).map(String).filter((n) => src.lines.has(n)).slice(0, 20);
    const variants = names.map((name) => ({ name, kind: 'set', lines: src.lines.get(name) }));
    return { ...job, variants, count: variants.length };
  }

  if (typeof body.profile !== 'string' || !body.profile.trim()) throw new Error('Paste your SimC addon export first.');
  const parsed = parseProfile(body.profile);
  if (!parsed.className) throw new Error('Could not find a character in that text.');
  const options = normalizeOptions(body.options);

  if (mode === 'weights') return { mode, parsed, options, count: 5 };
  if (mode === 'crests') {
    const variants = crestVariants(parsed);
    if (!variants.length) throw new Error('Nothing to upgrade: your gear and bag items are already at max rank.');
    return { mode, parsed, options, variants, count: variants.length };
  }
  if (mode === 'vault') {
    const variants = vaultVariants(parsed, options);
    if (!variants.length) {
      throw new Error('This export has no Great Vault rewards. Open the Great Vault in game, then type /simc again.');
    }
    return { mode, parsed, options, variants, count: variants.length };
  }
  if (mode === 'trinkets') {
    const trinkets = trinketVariants(parsed);
    if (!trinkets.variants.length) throw new Error('No trinkets to chart. Your trinkets are already at max rank and none are in your bags.');
    return { mode, parsed, options, variants: trinkets.variants, trinkets, count: trinkets.variants.length };
  }

  const selected = Array.isArray(body.selected) ? body.selected.map(String) : [];
  const wanted = new Set(Array.isArray(body.loadouts) ? body.loadouts.map(String) : []);
  const loadouts = parsed.loadouts.filter((l) => wanted.has(l.name));
  const extra = deriveItems(parsed, options.modified, options.budget);
  const combos = buildCombos(parsed, selected, Infinity, { extra, budget: options.budget });
  const variants = buildVariants(parsed, combos, loadouts, options);
  if (!variants.length) throw new Error('Nothing to compare. Tick some gear, gems, consumables or talent loadouts.');
  return { mode, parsed, options, variants, count: variants.length };
}

async function handleSim(req, res) {
  let spec;
  try {
    spec = prepareJob(await readBody(req));
  } catch (err) {
    return send(res, 400, { error: err.message });
  }
  const { count, ...rest } = spec;
  const job = {
    id: crypto.randomUUID(),
    state: 'queued',
    ...rest,
    comboCount: count,
    progress: { phase: 'queued', done: 0, total: count },
    lastLine: '',
    queuedAt: Date.now(),
  };
  jobs.set(job.id, job);
  queue.push(job);
  pump();
  send(res, 202, publicJob(job));
}

// Item icons: fetched from Wowhead's image server the first time, then served from disk.
const ICON_DIR = path.join(history.DIR, 'icons');
const iconFetches = new Map();
const iconMisses = new Set();

async function handleIcon(res, name) {
  const file = path.join(ICON_DIR, `${name}.jpg`);
  let data = await fsp.readFile(file).catch(() => null);
  if (!data && !iconMisses.has(name)) {
    if (!iconFetches.has(name)) {
      iconFetches.set(name, (async () => {
        const r = await fetch(`https://wow.zamimg.com/images/wow/icons/large/${name}.jpg`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(String(r.status));
        const buf = Buffer.from(await r.arrayBuffer());
        await fsp.mkdir(ICON_DIR, { recursive: true });
        await fsp.writeFile(file, buf);
        return buf;
      })().finally(() => iconFetches.delete(name)));
    }
    data = await iconFetches.get(name).catch(() => null);
    if (!data) iconMisses.add(name);
  }
  if (!data) return send(res, 404, { error: 'Icon unavailable' });
  res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=604800' });
  res.end(data);
}

async function handleHistory(req, res, url) {
  const name = url.searchParams.get('name') ?? '';
  const server = url.searchParams.get('server') ?? '';
  if (req.method === 'DELETE') await history.clear(name, server);
  send(res, 200, { runs: await history.list(name, server) });
}

function buildScript() {
  const script = path.join(ROOT, 'scripts', 'build-simc.ps1');
  return process.platform === 'win32' && fs.existsSync(script) ? script : null;
}

async function handleUpdate(req, res, url) {
  if (req.method === 'POST') {
    if (!updater.supported) return send(res, 400, { error: 'Engine updates are only supported on Windows.' });
    if (running || queue.length) return send(res, 409, { error: 'Wait for the current sim to finish first.' });
    updater.installUpdate({
      simcDir: path.join(ROOT, 'simc'),
      workDir: WORK_DIR,
      onDone: async () => { simcVersion = await detectSimcVersion(); },
    });
    return send(res, 202, { install: updater.installState() });
  }
  let latest = null;
  let error = null;
  if (url.searchParams.has('check')) {
    try {
      latest = await updater.latestRelease(url.searchParams.get('check') === 'force');
    } catch (err) {
      error = `Couldn't check for updates (${err.message}).`;
    }
  }
  // App updates are a manual zip download, so they apply on every platform.
  const app = {
    current: APP_VERSION,
    latest: latest?.version ?? null,
    available: !!latest?.version && updater.compareVersions(latest.version, APP_VERSION) > 0,
    page: latest?.page ?? null,
  };
  if (!updater.supported) return send(res, 200, { supported: false, app });
  send(res, 200, {
    supported: true,
    current: simcVersion,
    build: simcBuild,
    checked: url.searchParams.has('check'),
    latest,
    available: updater.isNewer(latest, simcBuild),
    install: updater.installState(),
    error,
    app,
  });
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      simcVersion = await detectSimcVersion();
      return send(res, 200, {
        simc: simcVersion, simcPath: SIMC, threads: THREADS, queued: queue.length,
        simcBuild,
        appVersion: APP_VERSION,
        buildScript: buildScript(),
        system: await systemInfo(),
        lastRun,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/sim') return await handleSim(req, res);
    if (url.pathname === '/api/update') return await handleUpdate(req, res, url);
    if (url.pathname === '/api/history') return await handleHistory(req, res, url);
    const icon = url.pathname.match(/^\/api\/icons\/([a-z0-9_-]{1,100})\.jpg$/);
    if (icon && req.method === 'GET') return await handleIcon(res, icon[1]);

    const report = url.pathname.match(/^\/api\/reports\/([0-9a-f-]{36})$/);
    if (report && req.method === 'GET') {
      try {
        const html = await fsp.readFile(path.join(REPORT_DIR, `${report[1]}.html`));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(html);
      } catch {
        return send(res, 404, { error: 'That report has expired. Sim the set again to get a new one.' });
      }
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return send(res, 404, { error: 'Job not found' });
      if (req.method === 'DELETE') {
        if (job.state === 'queued') queue.splice(queue.indexOf(job), 1);
        if (job.state === 'queued' || job.state === 'running') {
          job.state = 'cancelled';
          job.finishedAt = Date.now();
          job.child?.kill();
        }
        return send(res, 200, publicJob(job));
      }
      return send(res, 200, publicJob(job));
    }

    if (req.method === 'GET') return await serveStatic(res, url.pathname);
    send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

const PAGE_URL = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/`;

server.on('error', (err) => {
  // Already running (e.g. double-clicked twice): just show it.
  if (err.code === 'EADDRINUSE' && PACKAGED) {
    openBrowser(PAGE_URL);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, HOST, async () => {
  simcVersion = await detectSimcVersion();
  console.log(`SIMulacrum is running at ${PAGE_URL}`);
  console.log(simcVersion ? `Using ${simcVersion}` : `SimulationCraft not found (looked for "${SIMC}").`);
  if (PACKAGED) {
    console.log('\nKeep this window open while you use SIMulacrum. Close it to quit.');
    if (!process.env.GEAR_SIM_NO_BROWSER) openBrowser(PAGE_URL);
  }
});
