// Serves the UI and runs SimulationCraft jobs one at a time.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseProfile } from './lib/parse.js';
import { buildCombos } from './lib/combos.js';
import { buildSimcInput, buildVariants, normalizeOptions } from './lib/simc-input.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const THREADS = Number(process.env.SIM_THREADS ?? Math.max(1, os.cpus().length));
const WORK_DIR = path.join(os.tmpdir(), 'wow-gear-sim');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function findSimc() {
  const candidates = [
    process.env.SIMC_PATH,
    path.join(ROOT, 'simc', 'simc.exe'),
    path.join(ROOT, 'simc', 'simc'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? (process.platform === 'win32' ? 'simc.exe' : 'simc');
}

const SIMC = findSimc();
let simcVersion = null;

function detectSimcVersion() {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(SIMC, [], { windowsHide: true });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => child.kill(), 5000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out.match(/SimulationCraft [^\r\n(]+/)?.[0].trim() ?? null);
    });
  });
}

// --- jobs -------------------------------------------------------------------

const jobs = new Map();
const queue = [];
let running = null;

function publicJob(job) {
  const { id, state, progress, lastLine, result, error, comboCount, queuedAt, startedAt, finishedAt } = job;
  return {
    id, state, progress, lastLine, result, error, comboCount, queuedAt, startedAt, finishedAt,
    position: state === 'queued' ? queue.indexOf(job) + 1 : 0,
  };
}

function parseProgress(job, chunk) {
  const lines = chunk.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  job.lastLine = lines[lines.length - 1].slice(0, 200);
  for (const line of lines) {
    const sets = line.match(/Profilesets?\s*\(?\s*(\d+)\s*\/\s*(\d+)/i);
    if (sets) job.progress = { ...job.progress, phase: 'profilesets', done: Number(sets[1]), total: Number(sets[2]) };
    else if (/baseline/i.test(line)) job.progress = { ...job.progress, phase: 'baseline' };
  }
}

// Smart sim: a quick pass over everything, then re-sim the best at full precision.
const SMART_MIN_SETS = 40;
const SMART_QUICK_ERROR = 1.0;
const SMART_KEEP = { gear: 25, gems: 12, consumable: 40, talents: 20 };

function readResults(json) {
  const baseActor = json.sim.players[0];
  const baseline = {
    dps: baseActor.collected_data.dps.mean,
    error: baseActor.collected_data.dps.mean_std_dev * 1.96,
  };
  const results = new Map((json.sim.profilesets?.results ?? []).map((r) => [r.name, {
    dps: r.mean,
    error: r.mean_error ?? (r.mean_stddev != null ? r.mean_stddev * 1.96 : null),
  }]));
  return { baseline, results, version: json.version };
}

async function runSimc(job, variants, targetError, stage) {
  const dir = path.join(WORK_DIR, job.id);
  const inputPath = path.join(dir, `stage${stage}.simc`);
  const jsonPath = path.join(dir, `stage${stage}.json`);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(inputPath, buildSimcInput(job.parsed, variants, job.options, {
    jsonPath, threads: THREADS, targetError,
  }));
  job.progress = { ...job.progress, stage, phase: 'starting', done: 0, total: variants.length };

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
    list.sort((a, b) => quick.results.get(b.name).dps - quick.results.get(a.name).dps)
      .slice(0, SMART_KEEP[kind] ?? 20)
      .forEach((v) => keep.add(v.name));
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

async function runJob(job) {
  running = job;
  job.state = 'running';
  job.startedAt = Date.now();
  const { variants, options } = job;

  try {
    const smart = options.smart && variants.length >= SMART_MIN_SETS && options.targetError < SMART_QUICK_ERROR;
    let rows;
    let final;
    if (smart) {
      job.progress = { stages: 2 };
      const quick = await runSimc(job, variants, SMART_QUICK_ERROR, 1);
      if (!quick) return;
      const finalists = pickFinalists(variants, quick);
      final = await runSimc(job, finalists, options.targetError, 2);
      if (!final) return;
      const kept = new Set(finalists.map((v) => v.name));
      // Put quick-pass numbers on the final pass's baseline.
      const shift = final.baseline.dps - quick.baseline.dps;
      const quickRows = toRows(variants.filter((v) => !kept.has(v.name)), quick, true)
        .map((r) => ({ ...r, dps: r.dps + shift }));
      rows = [...toRows(finalists, final, false), ...quickRows];
    } else {
      job.progress = { stages: 1 };
      final = await runSimc(job, variants, options.targetError, 1);
      if (!final) return;
      rows = toRows(variants, final, false);
    }
    rows.sort((a, b) => b.dps - a.dps);
    job.result = {
      baseline: final.baseline,
      rows,
      smart,
      simc: final.version ?? simcVersion,
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
    running = null;
    fsp.rm(path.join(WORK_DIR, job.id), { recursive: true, force: true }).catch(() => {});
    pump();
  }
}

function pump() {
  if (running || !queue.length) return;
  runJob(queue.shift());
}

// Forget finished jobs after an hour.
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, job] of jobs) if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
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

async function handleSim(req, res) {
  const body = await readBody(req);
  if (typeof body.profile !== 'string' || !body.profile.trim()) {
    return send(res, 400, { error: 'Paste your SimC addon export first.' });
  }
  const parsed = parseProfile(body.profile);
  if (!parsed.className) return send(res, 400, { error: 'Could not find a character in that text.' });

  const options = normalizeOptions(body.options);
  const selected = Array.isArray(body.selected) ? body.selected.map(String) : [];
  const wanted = new Set(Array.isArray(body.loadouts) ? body.loadouts.map(String) : []);
  const loadouts = parsed.loadouts.filter((l) => wanted.has(l.name));

  let variants;
  try {
    variants = buildVariants(parsed, buildCombos(parsed, selected), loadouts, options);
  } catch (err) {
    return send(res, 400, { error: err.message });
  }
  if (!variants.length) {
    return send(res, 400, { error: 'Nothing to compare. Tick some gear, gems, consumables or talent loadouts.' });
  }

  const job = {
    id: crypto.randomUUID(),
    state: 'queued',
    parsed, variants, options,
    comboCount: variants.length,
    progress: { phase: 'queued', done: 0, total: variants.length },
    lastLine: '',
    queuedAt: Date.now(),
  };
  jobs.set(job.id, job);
  queue.push(job);
  pump();
  send(res, 202, publicJob(job));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      simcVersion = await detectSimcVersion();
      return send(res, 200, {
        simc: simcVersion, simcPath: SIMC, threads: THREADS, queued: queue.length,
        buildScript: process.platform === 'win32' ? path.join(ROOT, 'scripts', 'build-simc.ps1') : null,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/sim') return await handleSim(req, res);

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

server.listen(PORT, HOST, async () => {
  simcVersion = await detectSimcVersion();
  console.log(`WoW Gear Sim running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(simcVersion ? `Using ${simcVersion}` : `SimulationCraft not found (looked for "${SIMC}"). Run scripts/get-simc.ps1.`);
});
