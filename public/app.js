import { parseProfile, itemLine, GROUPS, GROUP_LABELS, PAIR_GROUPS, IGNORED_SLOTS } from '/lib/parse.js';
import { countCombos } from '/lib/combos.js';
import { GEMS, DIAMONDS, GEM_COLORS, GEM_BY_ID, CONSUMABLES } from '/lib/catalog.js';
import { equippedSockets, buildGemSetups, describeStats } from '/lib/gems.js';
import {
  SEASON, deriveItems, trackLabel, upgradeTrack, maxAffordableLevel, catalystTarget,
} from '/lib/upgrades.js';
import { esc, fmt, signed, pct, duration, wowheadUrl } from './format.js';
import {
  detailHtml, weightsHtml, crestsHtml, vaultHtml, trinketsHtml, stylesHtml, historyHtml,
} from './analysis.js';
import { loadoutHtml } from './loadout.js';

const STORAGE_KEY = 'gear-sim:profile';
const SETTINGS_KEY = 'gear-sim:settings';
const SLOT_LABELS = {
  ...GROUP_LABELS, finger1: 'Ring 1', finger2: 'Ring 2', trinket1: 'Trinket 1', trinket2: 'Trinket 2',
};
const KIND_LABELS = { gear: 'Gear', gems: 'Gems', consumable: 'Consumables', talents: 'Talents' };

const LARGE_RUN = 5000;

const $ = (id) => document.getElementById(id);
const els = {
  profile: $('profile'), character: $('character'), engine: $('engine'),
  gearCard: $('gear-card'), slots: $('slots'),
  gemCard: $('gem-card'), gemGrid: $('gem-grid'), diamonds: $('diamonds'), gemInfo: $('gem-info'),
  gemCount: $('gem-count'), maxColors: $('maxColors'),
  consumableCard: $('consumable-card'), consumables: $('consumables'),
  talentCard: $('talent-card'), loadouts: $('loadouts'),
  optionsCard: $('options-card'), count: $('count'), run: $('run'), formError: $('form-error'),
  progressCard: $('progress-card'), barFill: $('bar-fill'), progressText: $('progress-text'),
  progressLine: $('progress-line'), cancel: $('cancel'),
  resultsCard: $('results-card'), results: $('results'), resultsMeta: $('results-meta'), best: $('best'),
  tabs: $('tabs'), estimateNote: $('estimate-note'),
  moreCard: $('more-card'), toolError: $('tool-error'),
  analysisCard: $('analysis-card'), analysisTitle: $('analysis-title'), analysisMeta: $('analysis-meta'),
  analysis: $('analysis'),
  historyCard: $('history-card'), history: $('history'),
  setupView: $('setup-view'), resultsView: $('results-view'), navTabs: $('nav-tabs'), rerun: $('nav-rerun'),
  runError: $('run-error'), emptyCard: $('empty-card'),
};

// Shown on the results page before a sim has been run.
const VIEW_INFO = {
  topgear: ['Top DPS', 'Pick what to try on the setup page, then run Top DPS.'],
  weights: ['Stat weights', 'How much DPS each stat is worth to you, plus a Pawn string for in-game upgrade arrows.'],
  crests: ['Crest planner', 'Every upgrade you could buy, ranked by DPS gained per Mistcrest.'],
  vault: ['Great Vault', 'Sims each reward in your vault and tells you which one to take. Open the vault in game before you type /simc.'],
  trinkets: ['Trinket chart', 'Your trinkets (equipped, bags and vault) at every upgrade rank.'],
  styles: ['Fight styles', 'Your best Top DPS sets simmed in single target, cleave, AoE and Dungeon Slice. Run Top DPS first.'],
  history: ['DPS history', 'Every main sim for this character is saved on this PC. Run one to start the chart.'],
};

const ANALYSIS_TITLES = {
  weights: 'Stat weights', crests: 'Crest planner', vault: 'Great Vault', trinkets: 'Trinket chart', styles: 'Fight styles',
};

let parsed = null;
let selected = new Set();
let gemPick = new Set();
let diamondPick = new Set();
let consumableUse = {};
let consumableCompare = {};
let crests = {};
let charges = 0;
let modified = [];
let derived = [];
let currentJob = null;
let threads = 8;
let lastResult = null;
let setTotal = 0;
let activeTab = 'overview';
let lastJobId = null;
let openRow = null;
const details = new Map();
const detailJobs = new Set();
const analyses = {};
let view = 'topgear';
let historyRuns = [];
let runningMode = null;
// Sims ticked in "What to sim", run in this order; fight styles builds on Top DPS.
const SIM_ORDER = ['topgear', 'weights', 'crests', 'vault', 'trinkets', 'styles'];
let simPick = new Set(['topgear']);
let batch = [];
let batchSize = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


function storage(fn) {
  try { return fn(window.localStorage); } catch { return null; }
}



function equippedInGroup(group) {
  const slots = PAIR_GROUPS[group] ?? [group];
  return slots.map((s) => parsed.equipped[s]).filter(Boolean);
}

// At least the item level of the weakest piece it could replace.
function isLikelyUpgrade(item) {
  const current = equippedInGroup(item.group);
  if (!current.length) return true;
  return item.ilvl >= Math.min(...current.map((c) => c.ilvl ?? 0));
}

// --- gear --------------------------------------------------------------------------

function renderCharacter() {
  const pills = [
    parsed.name, parsed.spec && `${parsed.spec} ${parsed.className}`,
    `${Object.keys(parsed.equipped).length} equipped`, `${parsed.bags.length} in bags`,
  ].filter(Boolean);
  els.character.innerHTML = pills.map((p) => `<span class="pill">${esc(p)}</span>`).join('');
  els.character.hidden = false;
}

function itemRow(item) {
  const current = equippedInGroup(item.group);
  const best = Math.max(...current.map((c) => c.ilvl ?? 0));
  const up = !item.equipped && item.ilvl > best;
  const control = item.equipped
    ? '<input type="checkbox" checked disabled>'
    : `<input type="checkbox" data-key="${item.key}" ${selected.has(item.key) ? 'checked' : ''}>`;
  const track = trackLabel(item);
  const tags = item.mods
    ? item.mods.map((m) => `<span class="tag mod">${esc(m)}</span>`).join('')
    : item.equipped ? '<span class="tag">Equipped</span>' : '';
  return `
    <label class="item ${item.equipped ? 'equipped' : ''} ${item.mods ? 'derived' : ''} ${!item.equipped && !item.mods && !isLikelyUpgrade(item) ? 'dim' : ''}" ${track ? `title="${esc(track)}"` : ''}>
      ${control}
      <span class="name"><a href="${wowheadUrl(item)}" target="_blank" rel="noopener">${esc(item.name)}</a></span>
      ${tags}
      <span class="ilvl ${up ? 'up' : ''}">${item.ilvl ?? ''}</span>
      ${item.mods ? `<button type="button" class="remove" data-remove="${esc(item.key)}" aria-label="Remove">×</button>` : ''}
    </label>`;
}

function renderSlots() {
  els.slots.innerHTML = GROUPS.map((group) => {
    const equipped = equippedInGroup(group);
    const bags = parsed.bags.filter((b) => b.group === group).sort((a, b) => (b.ilvl ?? 0) - (a.ilvl ?? 0));
    const mods = derived.filter((d) => d.group === group);
    if (!equipped.length && !bags.length) return '';
    const ticked = bags.filter((b) => selected.has(b.key)).length;
    return `
      <div class="slot">
        <h3><span>${GROUP_LABELS[group]}</span><span>${bags.length ? `${ticked}/${bags.length} from bags` : ''}</span></h3>
        ${equipped.map(itemRow).join('')}
        ${mods.map(itemRow).join('')}
        ${bags.map(itemRow).join('')}
      </div>`;
  }).join('');
}

// --- upgrades & catalyst -------------------------------------------------------------

const budget = () => ({ crests, catalyst: charges });
const modKey = (m) => `mod:${m.from}:${m.ops.join('+')}`;

function refreshDerived() {
  derived = deriveItems(parsed, modified, budget());
  renderSlots();
  updateCount();
}

function renderUpgrades() {
  $('upgrade-card').hidden = false;
  $('crests').innerHTML = Object.entries(SEASON.currencies).map(([id, name]) => `
    <div class="crest">
      <label for="crest-${id}">${esc(name)}</label>
      <input id="crest-${id}" type="number" min="0" step="1" value="${crests[id] ?? 0}" data-crest="${id}">
      <button type="button" data-add="${id}" data-n="10">+10</button>
      <button type="button" data-add="${id}" data-n="100">+100</button>
      <button type="button" data-add="${id}" data-n="max">Max</button>
    </div>`).join('');
  $('charges').innerHTML = [0, 1, 2, 3, 4, 5, 6].map((n) => `
    <button type="button" role="radio" aria-checked="${n === charges}" data-charges="${n}">${n}</button>`).join('');
}

// Equipped items plus everything ticked, including already-modified copies.
function selectedSources() {
  const equipped = Object.values(parsed.equipped).filter((it) => !IGNORED_SLOTS.has(it.slot));
  return [...equipped, ...parsed.bags, ...derived].filter((it) => it.equipped || selected.has(it.key));
}

function addMods(op, eligible) {
  let added = 0;
  let skipped = 0;
  for (const item of selectedSources()) {
    if (item.ops?.includes(op)) continue;
    if (!eligible(item)) { skipped += 1; continue; }
    const mod = { from: item.from ?? item.key, ops: [...(item.ops ?? []), op] };
    if (modified.some((m) => modKey(m) === modKey(mod))) continue;
    modified.push(mod);
    selected.add(modKey(mod));
    added += 1;
  }
  refreshDerived();
  return { added, skipped };
}

$('upgrade-selected').addEventListener('click', () => {
  const canUpgrade = (it) => {
    const t = upgradeTrack(it);
    return t && t.level < t.max && maxAffordableLevel(it, crests, parsed.watermarks);
  };
  const { added } = addMods('upgrade', canUpgrade);
  $('mods-info').textContent = added
    ? `Added ${added} upgraded item${added === 1 ? '' : 's'}. Combinations that need more crests than you have are skipped.`
    : 'Nothing to upgrade: selected items are maxed, not upgradeable, or out of reach of your crests.';
});

$('catalyze-selected').addEventListener('click', () => {
  const { added } = addMods('catalyst', (it) => catalystTarget(it, parsed.className));
  $('mods-info').textContent = added
    ? `Added ${added} catalyst item${added === 1 ? '' : 's'}. At most ${charges} per combination.`
    : 'None of the selected items can be catalyzed.';
});

$('upgrade-card').addEventListener('input', (e) => {
  const id = e.target.dataset.crest;
  if (!id) return;
  crests[id] = Math.max(0, Math.floor(Number(e.target.value) || 0));
  refreshDerived();
});

$('upgrade-card').addEventListener('click', (e) => {
  const { add, n, charges: c } = e.target.dataset;
  if (add) {
    crests[add] = n === 'max' ? 9999 : (crests[add] ?? 0) + Number(n);
    renderUpgrades();
    refreshDerived();
  }
  if (c != null) {
    charges = Number(c);
    renderUpgrades();
    updateCount();
  }
});

$('crests-max').addEventListener('click', () => {
  for (const id of Object.keys(SEASON.currencies)) crests[id] = 9999;
  renderUpgrades();
  refreshDerived();
});

// --- gems --------------------------------------------------------------------------

function renderGems() {
  const sockets = equippedSockets(parsed);
  const regular = sockets.filter((s) => !s.diamond);
  const diamond = sockets.find((s) => s.diamond);
  const current = new Set(sockets.map((s) => s.gemId));
  els.gemCard.hidden = !sockets.length;
  if (!sockets.length) return;

  const where = regular.map((s) => SLOT_LABELS[s.slot]).join(', ');
  els.gemInfo.innerHTML = `Your gear has <strong>${regular.length}</strong> gem socket${regular.length === 1 ? '' : 's'}`
    + (where ? ` (${esc(where)})` : '')
    + (diamond ? ` and a diamond in ${esc(SLOT_LABELS[diamond.slot])}` : '')
    + `. Now socketed: ${esc(describeStats(regular.map((s) => s.gemId)))}${diamond ? ` + ${esc(GEM_BY_ID[diamond.gemId]?.label ?? '')} Diamond` : ''}.`
    + ' Each setup is tried on your current gear.';

  els.gemGrid.innerHTML = Object.entries(GEM_COLORS).map(([color, info]) => `
    <div class="gem-col">
      <h4 class="c-${color}">${info.label}</h4>
      ${GEMS.filter((g) => g.color === color).map((g) => `
        <label class="tile" title="${esc(g.name)}">
          <input type="checkbox" data-gem="${g.id}" ${gemPick.has(g.id) ? 'checked' : ''}>
          <span class="dot bg-${color}"></span>
          <span>${esc(g.label)}</span>
          ${current.has(g.id) ? '<span class="tag equipped-mark">Equipped</span>' : ''}
        </label>`).join('')}
    </div>`).join('');

  els.diamonds.innerHTML = diamond ? DIAMONDS.map((d) => `
    <label class="tile">
      <input type="checkbox" data-diamond="${d.id}" ${diamondPick.has(d.id) ? 'checked' : ''}>
      <span class="dot bg-diamond"></span>
      <span>${esc(d.label)}<small>${esc(d.note)}</small></span>
      ${current.has(d.id) ? '<span class="tag equipped-mark">Equipped</span>' : ''}
    </label>`).join('') : '<p class="hint">No diamond socketed.</p>';
}

function gemChoice() {
  return { gems: [...gemPick], diamonds: [...diamondPick], maxColors: els.maxColors.checked };
}

function gemSetupCount() {
  try {
    return { n: buildGemSetups(parsed, gemChoice()).length };
  } catch (err) {
    return { n: 0, error: err.message };
  }
}

// --- consumables --------------------------------------------------------------------

function renderConsumables() {
  els.consumables.innerHTML = Object.entries(CONSUMABLES).map(([kind, cat]) => {
    const use = consumableUse[kind] ?? 'default';
    const compare = consumableCompare[kind] ?? new Set();
    return `
      <div class="cons">
        <h4>${esc(cat.label)}</h4>
        <span class="use-label">Used in every sim</span>
        <select data-use="${kind}">
          <option value="default" ${use === 'default' ? 'selected' : ''}>SimC default for your spec</option>
          ${cat.items.map((i) => `<option value="${i.value}" ${use === i.value ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}
          <option value="none" ${use === 'none' ? 'selected' : ''}>None</option>
        </select>
        <span class="use-label">Compare</span>
        ${cat.items.map((i) => `
          <label class="tile ${use === i.value ? 'is-base' : ''}">
            <input type="checkbox" data-compare="${kind}" value="${i.value}" ${compare.has(i.value) && use !== i.value ? 'checked' : ''} ${use === i.value ? 'disabled' : ''}>
            <span>${esc(i.label)}<small>${esc(i.name)}</small></span>
          </label>`).join('')}
      </div>`;
  }).join('');
}

function consumableCompareCount() {
  return Object.entries(consumableCompare)
    .reduce((n, [kind, set]) => n + [...set].filter((v) => v !== (consumableUse[kind] ?? 'default')).length, 0);
}

// --- talents & counts -----------------------------------------------------------------

function renderLoadouts() {
  els.talentCard.hidden = !parsed.loadouts.length;
  const active = parsed.talents;
  els.loadouts.innerHTML = parsed.loadouts.map((l, i) => `
    <label class="item">
      <input type="checkbox" data-loadout="${i}">
      <span class="name">${esc(l.name)}</span>
      ${l.talents === active ? '<span class="tag">Active</span>' : ''}
    </label>`).join('');
}


function updateCount() {
  if (!parsed) return;
  const gear = countCombos(parsed, [...selected], { extra: derived, budget: budget() });
  const gems = gemSetupCount();
  const counts = {
    gear,
    gems: gems.n,
    consumable: consumableCompareCount(),
    talents: els.loadouts.querySelectorAll('input:checked').length,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  setTotal = total;
  els.gemCount.textContent = gems.error ?? (gems.n ? `${gems.n} gem setup${gems.n === 1 ? '' : 's'} to try` : '');
  const over = !!gems.error;
  const parts = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n.toLocaleString()} ${KIND_LABELS[k].toLowerCase()}`);
  els.count.className = `count ${over ? 'over' : ''}`;
  if (over) {
    els.count.innerHTML = esc(gems.error);
  } else if (!total) {
    els.count.innerHTML = 'Tick something to compare against your current setup.';
  } else {
    els.count.innerHTML = `<strong>${total.toLocaleString()}</strong> ${total === 1 ? 'set' : 'sets'}`
      + (parts.length > 1 ? ` (${parts.join(', ')})` : '')
      + (total >= LARGE_RUN ? ' · <span class="warn">large run, this can take a long time</span>' : '');
  }
  const picks = pickedSims();
  els.run.textContent = picks.length > 1 ? `Run ${picks.length} sims` : 'Run sim';
  els.run.disabled = !!currentJob || !picks.length || (simPick.has('topgear') && (over || total === 0));
  if (!simPick.has('topgear')) {
    els.count.className = 'count';
    els.count.innerHTML = picks.length ? `${picks.map((m) => VIEW_INFO[m][0]).join(', ')}` : 'Tick at least one sim under What to sim.';
  }
  updateTools();
  updateFloat();
}

// Always-visible copy of the Run button on the setup page.
function updateFloat() {
  const f = $('run-float');
  f.hidden = !parsed?.className || !els.resultsView.hidden;
  if (f.hidden) return;
  f.querySelector('.rf-label').textContent = currentJob ? 'View progress' : els.run.textContent;
  f.disabled = !currentJob && els.run.disabled;
  const sets = simPick.has('topgear') && setTotal ? `${setTotal.toLocaleString()} set${setTotal === 1 ? '' : 's'}` : '';
  $('run-float-sub').textContent = currentJob ? 'A sim is running' : sets;
}

// Ticked sims that can run right now, in run order.
function pickedSims() {
  return SIM_ORDER.filter((m) => simPick.has(m) && simAvailable(m));
}

function simAvailable(mode) {
  if (mode === 'vault') return !!parsed?.vault?.length;
  if (mode === 'styles') return simPick.has('topgear') || !!lastJobId;
  return true;
}

function updateTools() {
  const vault = parsed?.vault?.length ?? 0;
  $('vault-note').textContent = vault
    ? `${vault} reward${vault === 1 ? '' : 's'} in your export.`
    : 'No rewards in this export. Open the Great Vault in game, then type /simc again.';
  $('styles-note').textContent = simPick.has('topgear') ? 'Runs after Top DPS, using its best sets.'
    : lastJobId ? 'Uses your best sets from the last Top DPS run.' : 'Needs Top DPS: tick it too.';
  for (const box of els.moreCard.querySelectorAll('[data-sim]')) {
    const ok = simAvailable(box.dataset.sim);
    box.checked = simPick.has(box.dataset.sim) && ok;
    box.disabled = !ok;
    box.closest('.tool').classList.toggle('unavailable', !ok);
  }
  const n = pickedSims().length;
  $('sim-count').textContent = n ? `${n} selected` : '';
  $('styles-btn').disabled = !!currentJob || !lastJobId;
  if (!els.resultsView.hidden) renderView();
}

function saveSettings() {
  storage((s) => s.setItem(SETTINGS_KEY, JSON.stringify({
    gems: [...gemPick], diamonds: [...diamondPick], maxColors: els.maxColors.checked,
    use: consumableUse,
    compare: Object.fromEntries(Object.entries(consumableCompare).map(([k, v]) => [k, [...v]])),
    fightStyle: $('fightStyle').value, targets: $('targets').value, duration: $('duration').value,
    targetError: $('targetError').value, smart: $('smart').checked,
    sims: [...simPick],
  })));
}

function loadSettings() {
  const raw = storage((s) => s.getItem(SETTINGS_KEY));
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    gemPick = new Set(s.gems ?? []);
    diamondPick = new Set(s.diamonds ?? []);
    els.maxColors.checked = s.maxColors !== false;
    consumableUse = s.use ?? {};
    consumableCompare = Object.fromEntries(Object.entries(s.compare ?? {}).map(([k, v]) => [k, new Set(v)]));
    for (const id of ['fightStyle', 'targets', 'duration', 'targetError']) if (s[id] != null) $(id).value = s[id];
    $('smart').checked = s.smart !== false;
    if (Array.isArray(s.sims)) simPick = new Set(s.sims.filter((m) => SIM_ORDER.includes(m)));
  } catch { /* ignore bad saved settings */ }
}

function showGuide(show) {
  $('guide').hidden = !show;
  $('guide-toggle').hidden = show;
}

function loadProfile(text) {
  els.formError.hidden = true;
  showGuide(!text.trim());
  const cards = [els.gearCard, els.gemCard, els.consumableCard, els.talentCard, els.optionsCard, els.moreCard];
  if (!text.trim()) {
    parsed = null;
    els.character.hidden = true;
    for (const el of cards) el.hidden = true;
    return;
  }
  parsed = parseProfile(text);
  if (!parsed.className) {
    els.character.hidden = false;
    els.character.innerHTML = '<span class="pill">No character found. Paste the full /simc export.</span>';
    for (const el of cards) el.hidden = true;
    return;
  }
  selected = new Set(parsed.bags.filter(isLikelyUpgrade).map((b) => b.key));
  crests = { ...parsed.currencies };
  charges = parsed.catalystCharges ?? 0;
  modified = [];
  derived = [];
  renderUpgrades();
  renderCharacter();
  renderSlots();
  renderGems();
  renderConsumables();
  renderLoadouts();
  els.gearCard.hidden = false;
  els.consumableCard.hidden = false;
  els.optionsCard.hidden = false;
  els.moreCard.hidden = false;
  updateCount();
  loadHistory();
}

// --- running --------------------------------------------------------------------

function readOptions() {
  return {
    fightStyle: $('fightStyle').value,
    targets: Number($('targets').value),
    duration: Number($('duration').value),
    targetError: Number($('targetError').value),
    copyEnchants: $('copyEnchants').checked,
    copyGems: $('copyGems').checked,
    smart: $('smart').checked,
    gems: gemChoice(),
    budget: budget(),
    modified,
    consumables: consumableUse,
    compare: Object.fromEntries(Object.entries(consumableCompare).map(([k, v]) => [k, [...v]])),
  };
}

async function api(path, init) {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

function showProgress(job) {
  const { done = 0, total = 0, phase, stage = 1, stages = 1 } = job.progress ?? {};
  const bar = els.barFill.parentElement;
  const known = phase === 'profilesets' && total > 0;
  bar.classList.toggle('indeterminate', !known);
  els.barFill.style.width = known ? `${(done / total) * 100}%` : '';
  const prefix = job.progress?.label ? `${job.progress.label} (${stage} of ${stages}): `
    : stages > 1 ? (stage === 1 ? 'Quick pass: ' : 'Final pass: ') : '';
  els.progressText.textContent = job.state === 'queued'
    ? `Waiting in queue (position ${job.position})…`
    : job.mode === 'weights' ? 'Working out stat weights (one sim per stat)…'
    : known ? `${prefix}set ${done} of ${total}…`
    : phase === 'baseline' ? `${prefix}simulating your current setup…` : `${prefix}starting SimulationCraft…`;
  els.progressLine.textContent = progressDetail(job);
  const title = VIEW_INFO[job.mode ?? 'topgear']?.[0] ?? 'Simulating';
  const step = batchSize > 1 ? ` (${batchSize - batch.length} of ${batchSize})` : '';
  $('progress-title').textContent = `Simulating: ${title}${step}`;
}

// Plain-English note on what the engine is doing right now.
function progressDetail(job) {
  const { phase, stage = 1, stages = 1, total = 0, error } = job.progress ?? {};
  const secs = job.startedAt ? Math.round((Date.now() - job.startedAt) / 1000) : 0;
  const elapsed = secs ? ` Running for ${secs < 60 ? `${secs} sec` : `${Math.floor(secs / 60)} min ${secs % 60} sec`}.` : '';
  const sets = `${total.toLocaleString()} set${total === 1 ? '' : 's'}`;
  if (job.state === 'queued') return 'Another sim is running. This one starts as soon as it finishes.';
  let note;
  if (job.mode === 'weights') {
    note = 'Sims your character once as is, then once per stat with a little extra of that stat, to see how much each one adds.';
  } else if (job.mode === 'styles') {
    note = `${job.progress?.note ?? ''}: simming your current gear and ${sets} in this kind of fight.`;
  } else if (phase === 'baseline' || phase === 'starting') {
    note = 'First it sims your current gear, so every set has something to compare against.';
  } else if (stages > 1 && stage === 1) {
    note = `A rough ±${error ?? 1}% sim of every set to find the contenders. The best ones get a precise re-sim next.`;
  } else if (stages > 1) {
    note = `Re-simming the ${sets} closest to the top at ±${error}%, so the ranking can be trusted.`;
  } else {
    note = `Simming ${sets} at ±${error}% against your current gear.`;
  }
  return note + elapsed;
}

function showError(mode, message, onResults = false) {
  const el = onResults ? els.runError : mode === 'topgear' ? els.formError : els.toolError;
  el.textContent = message;
  el.hidden = false;
}

// --- pages ------------------------------------------------------------------------

function go(page, mode = view) {
  const hash = page === 'results' ? `#results/${mode}` : '#setup';
  if (location.hash !== hash) location.hash = hash;
  else route();
}

function route() {
  const [page, mode] = location.hash.slice(1).split('/');
  const results = page === 'results' && parsed?.className;
  if (results && VIEW_INFO[mode]) view = mode;
  els.setupView.hidden = !!results;
  els.resultsView.hidden = !results;
  if (results) renderView();
  updateFloat();
  window.scrollTo({ top: 0 });
}

function renderView() {
  for (const b of els.navTabs.querySelectorAll('[data-view]')) {
    const v = b.dataset.view;
    b.setAttribute('aria-selected', String(v === view));
    const done = v === 'topgear' ? !!lastResult : v === 'history' ? historyRuns.length > 0 : !!analyses[v];
    b.classList.toggle('has-result', done);
  }
  const running = !!currentJob;
  els.progressCard.hidden = !running;
  const has = view === 'topgear' ? !!lastResult : view === 'history' ? historyRuns.length > 0 : !!analyses[view];
  const busyHere = running && runningMode === view;
  els.resultsCard.hidden = view !== 'topgear' || !has || busyHere;
  els.analysisCard.hidden = !VIEW_INFO[view] || view === 'topgear' || view === 'history' || !has || busyHere;
  els.historyCard.hidden = view !== 'history' || !has;
  if (!els.analysisCard.hidden) renderAnalysis(view);

  els.emptyCard.hidden = has || busyHere;
  if (!has) {
    const [title, text] = VIEW_INFO[view];
    $('empty-title').textContent = title;
    $('empty-text').textContent = text;
    const run = $('empty-run');
    run.hidden = view === 'history';
    run.textContent = view === 'topgear' ? 'Go to setup' : `Run ${title.toLowerCase()}`;
    run.disabled = running || (view === 'styles' && !lastJobId) || (view === 'vault' && !parsed?.vault?.length);
  }
  els.rerun.hidden = view === 'history' || !has;
  els.rerun.disabled = running || (view === 'styles' && !lastJobId);
  els.rerun.textContent = view === 'topgear' ? 'Re-run Top DPS' : `Re-run ${VIEW_INFO[view][0].toLowerCase()}`;
}

// Up to 10 sets for the fight-style comparison: each kind's best, then the top overall.
function styleCandidates() {
  const rows = lastResult.rows.filter((r) => !r.estimate);
  const picks = [];
  const add = (r) => { if (r && !picks.includes(r) && picks.length < 10) picks.push(r); };
  for (const kind of Object.keys(KIND_LABELS)) add(rows.find((r) => r.kind === kind));
  for (const r of rows) add(r);
  return picks;
}

async function runMode(mode, { navigate = true } = {}) {
  els.formError.hidden = true;
  els.toolError.hidden = true;
  let body;
  if (mode === 'topgear') {
    if (navigate && setTotal >= LARGE_RUN && !confirm(`${setTotal.toLocaleString()} sets can take a long time, possibly hours. You can cancel at any point. Run it?`)) return false;
    const loadoutIdx = [...els.loadouts.querySelectorAll('input:checked')].map((i) => Number(i.dataset.loadout));
    body = {
      mode,
      profile: els.profile.value,
      selected: [...selected],
      loadouts: loadoutIdx.map((i) => parsed.loadouts[i].name),
      options: readOptions(),
    };
  } else if (mode === 'styles') {
    body = { mode, source: lastJobId, names: styleCandidates().map((r) => r.name) };
  } else {
    body = { mode, profile: els.profile.value, options: readOptions() };
  }
  try {
    const job = await api('/api/sim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    currentJob = job.id;
    runningMode = mode;
    els.runError.hidden = true;
    showProgress(job);
    updateCount();
    if (navigate) go('results', mode);
    else if (!els.resultsView.hidden) renderView();
    poll();
    return true;
  } catch (err) {
    showError(mode, err.message, !els.resultsView.hidden);
    return false;
  }
}

// Runs every ticked sim in turn. The first one's tab opens; the rest fill in their tabs.
async function runBatch(modes) {
  batch = [...modes];
  batchSize = modes.length;
  await nextInBatch(true);
}

async function nextInBatch(first = false) {
  const mode = batch.shift();
  if (!mode) return;
  if (!(await runMode(mode, { navigate: first }))) batch = [];
}

async function poll() {
  if (!currentJob) return;
  try {
    const job = await api(`/api/jobs/${currentJob}`);
    showProgress(job);
    if (job.state === 'queued' || job.state === 'running') {
      setTimeout(poll, 1000);
      return;
    }
    finish(job);
  } catch (err) {
    finish({ state: 'error', error: err.message });
  }
}

function finish(job) {
  currentJob = null;
  runningMode = null;
  els.progressCard.hidden = true;
  const mode = job.mode ?? 'topgear';
  if (job.state === 'done' && mode === 'topgear') {
    lastResult = job.result;
    lastJobId = job.id;
    details.clear();
    openRow = null;
    activeTab = 'overview';
    renderResults();
    loadHistory();
  } else if (job.state === 'done') {
    analyses[mode] = { result: job.result, rows: lastResult ? new Map(lastResult.rows.map((r) => [r.name, r])) : new Map() };
  } else if (job.state === 'error') {
    showError(mode, job.error, true);
  }
  if (job.state === 'done' && batch.length === batchSize - 1) view = mode;
  if (job.state !== 'done') batch = [];
  updateCount();
  refreshStatus();
  if (!els.resultsView.hidden) go('results', view);
  if (batch.length) nextInBatch();
}

// --- results ----------------------------------------------------------------------

const chip = (label, body) => `<span class="chg">${label ? `<span class="chg-slot">${esc(label)}</span>` : ''}<span class="chg-body">${body}</span></span>`;

// One chip per change: slot label over the item (or gem, consumable, loadout).
// bare: drop the label for non-gear rows where the heading already says it.
function changeChips(row, bare = false) {
  const lbl = (text) => (bare ? '' : text);
  if (row.kind === 'baseline') return chip('Equipped', '<span class="chg-name">Your current gear</span>');
  if (row.kind === 'talents') return chip(lbl('Talents'), `<span class="chg-name">${esc(row.loadout)}</span>`);
  if (row.kind === 'consumable') {
    const [cat, name] = row.label.split(': ');
    return chip(lbl(cat), `<span class="chg-name" title="${esc(row.detail)}">${esc(name ?? row.label)}</span>`);
  }
  if (row.kind === 'gems') {
    return chip(lbl('Gems'), `<span class="chg-name">${esc(row.label)}</span><span class="chg-sub">${esc(describeStats(row.gems))}</span>`);
  }
  return row.changes.map((c) => chip(SLOT_LABELS[c.slot] ?? c.slot, `
    <a class="chg-name item" href="${wowheadUrl(c)}" target="_blank" rel="noopener">${esc(c.name)}</a>
    <span class="chg-meta"><span class="ilvl-pill">${c.ilvl ?? ''}</span>${(c.mods ?? []).map((m) => `<span class="tag mod">${esc(m)}</span>`).join('')}</span>`)).join('');
}


function bestByKind(result) {
  const margin = (row) => (row.error ?? 0) + (result.baseline.error ?? 0);
  const out = {};
  for (const row of result.rows) {
    if (row.estimate) continue;
    const key = row.kind === 'consumable' ? `consumable:${row.category}` : row.kind;
    if (!out[key] || row.dps > out[key].dps) out[key] = row;
  }
  return Object.fromEntries(Object.entries(out).filter(([, row]) => row.delta > margin(row)));
}

// SimC profile with every winning change applied.
function profileWith(winners) {
  const lines = [...parsed.charLines];
  const slotLines = {};
  for (const row of winners) {
    if (row.kind === 'talents') {
      const i = lines.findIndex((l) => l.startsWith('talents='));
      lines[i] = `talents=${row.talents}`;
    }
    if (row.kind === 'consumable') {
      const option = CONSUMABLES[row.category].option;
      lines.push(row.category === 'oil'
        ? `temporary_enchant=main_hand:${row.value}${parsed.equipped.off_hand ? `/off_hand:${row.value}` : ''}`
        : `${option}=${row.value}`);
    }
  }
  // Gear beats gems for the same slot.
  for (const row of winners.filter((r) => r.kind === 'gems')) {
    for (const c of row.changes) slotLines[c.slot] = c.line;
  }
  for (const row of winners.filter((r) => r.kind === 'gear')) {
    for (const c of row.changes) slotLines[c.slot] = c.line;
  }
  for (const [slot, item] of Object.entries(parsed.equipped)) {
    if (IGNORED_SLOTS.has(slot)) continue;
    lines.push(slotLines[slot] ?? itemLine(slot, item.fields));
  }
  return lines.join('\n');
}

// SimulationCraft's "Implementation Not Yet Verified" warnings, in plain words.
function unverifiedNote(result) {
  const names = result.unverified ?? [];
  if (!names.length) return '';
  const list = names.map((n) => `<b>${esc(n)}</b>`).join(', ');
  return `<p class="hero-note">${list} ${names.length === 1 ? 'is' : 'are'} only approximated by SimulationCraft so far, so ${names.length === 1 ? 'its' : 'their'} DPS is a best guess. Engine updates usually fix this within a few weeks.</p>`;
}

function renderBest(result) {
  const best = bestByKind(result);
  const winners = Object.values(best);
  const base = result.baseline.dps;
  const stats = `
    <div class="hero-stats">
      <span><b>${result.rows.length.toLocaleString()}</b> sets</span>
      <span><b>${duration(result.seconds ?? 0)}</b></span>
      ${result.smart ? '<span><b>Smart</b> sim</span>' : ''}
      <span>±<b>${fmt(result.baseline.error ?? 0)}</b> margin</span>
    </div>
    ${unverifiedNote(result)}`;
  const total = winners.reduce((n, r) => n + r.delta, 0);
  const approx = winners.length > 1 ? '≈ ' : '';
  els.best.className = `best ${winners.length ? 'win' : 'keep'}`;
  els.best.innerHTML = `
    <div class="hero ${winners.length ? 'win' : 'keep'}">
      <div class="hero-main">
        <p class="hero-eyebrow">${winners.length ? 'Your best setup' : 'Verdict'}</p>
        <h3 class="hero-title">${winners.length
          ? `${fmt(base)} <span class="arrow">→</span> ${approx}${fmt(base + total)} DPS`
          : "You're already wearing your best setup"}</h3>
        <p class="hero-sub">${winners.length
          ? `Follow the steps below.${winners.length > 1 ? ' Each change was simmed on its own, so the combined gain is approximate.' : ''}`
          : "Nothing you ticked beats it by more than the sim's margin of error. Keep everything as it is."}</p>
      </div>
      <div class="hero-num">
        <span class="hero-dps">${winners.length ? signed(total) : fmt(base)}</span>
        ${winners.length ? `<span class="gain-pill">${pct(total, base)}</span>` : '<span class="hero-unit">DPS</span>'}
      </div>
      ${stats}
    </div>
    ${loadoutHtml(parsed, winners, SLOT_LABELS)}
    ${winners.length ? '<button type="button" id="copy-best" class="action">Copy SimC profile with these changes</button>' : ''}`;
  const copy = $('copy-best');
  if (copy) {
    copy.onclick = async (e) => {
      await navigator.clipboard.writeText(profileWith(winners));
      e.target.textContent = 'Copied';
    };
  }
}

function renderTabs(result) {
  const counts = {};
  for (const row of result.rows) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
  const tabs = [['overview', 'Top results', result.rows.length], ...Object.keys(KIND_LABELS)
    .filter((k) => counts[k]).map((k) => [k, KIND_LABELS[k], counts[k]])];
  if (!tabs.some(([k]) => k === activeTab)) activeTab = 'overview';
  els.tabs.innerHTML = tabs.map(([key, label, n]) => `
    <button type="button" role="tab" data-tab="${key}" aria-selected="${key === activeTab}">${label}<span class="n">${n}</span></button>`).join('');
}

function renderTable(result) {
  const pool = activeTab === 'overview' ? result.rows.slice(0, 50) : result.rows.filter((r) => r.kind === activeTab);
  const rows = [...pool, { kind: 'baseline', dps: result.baseline.dps, error: result.baseline.error, delta: 0, deltaPct: 0 }]
    .sort((a, b) => b.dps - a.dps);
  // Shared scale so the range bars line up with the equipped marker.
  const lo = Math.min(...rows.map((r) => r.dps - (r.error ?? 0)));
  const hi = Math.max(...rows.map((r) => r.dps + (r.error ?? 0)));
  const span = hi - lo || 1;
  const at = (v) => (5 + ((v - lo) / span) * 90).toFixed(2);
  const baseErr = result.baseline.error ?? 0;
  els.results.innerHTML = rows.map((row, i) => {
    const isBase = row.kind === 'baseline';
    const err = row.error ?? 0;
    const side = !isBase && Math.abs(row.delta) <= err + baseErr;
    const cls = isBase ? 'base' : side ? 'side' : row.delta > 0 ? 'pos' : 'neg';
    const approx = row.estimate ? '≈' : '';
    const delta = isBase ? 'Baseline'
      : `${approx}${row.delta > 0 ? '+' : ''}${fmt(row.delta)}<small>${pct(row.delta, result.baseline.dps)}</small>`;
    return `
      <div class="rank-row ${cls}${row.estimate ? ' estimate' : ''}${i === 0 && row.delta > 0 ? ' lead' : ''}" role="listitem"
        data-name="${esc(row.name ?? 'baseline')}" tabindex="0" aria-expanded="false" title="Show the damage breakdown">
        <span class="rank-n">${i + 1}</span>
        <div class="rank-chgs">${changeChips(row)}</div>
        <div class="plot" aria-hidden="true" title="${fmt(row.dps - err)} to ${fmt(row.dps + err)} DPS">
          <span class="plot-base" style="left:${at(result.baseline.dps)}%"></span>
          <span class="plot-range" style="left:${at(row.dps - err)}%;right:${(100 - at(row.dps + err)).toFixed(2)}%"></span>
          <span class="plot-dot" style="left:${at(row.dps)}%"></span>
        </div>
        <span class="rank-dps">${approx}${fmt(row.dps)}<small>±${fmt(err)}</small></span>
        <span class="rank-delta">${delta}</span>
      </div>`;
  }).join('');
  els.estimateNote.hidden = !pool.some((r) => r.estimate);
  if (openRow) showDrawer(openRow);
}

// --- set details ----------------------------------------------------------------

function rowEl(name) {
  return [...els.results.querySelectorAll('.rank-row')].find((r) => r.dataset.name === name);
}

function drawerContent(name) {
  const isBase = name === 'baseline';
  const detail = details.get(name) ?? (isBase ? lastResult.baselineDetail : null);
  return detailHtml(detail, lastResult.baselineDetail, { isBase, loading: detailJobs.has(name) });
}

function showDrawer(name) {
  els.results.querySelector('.drawer')?.remove();
  for (const r of els.results.querySelectorAll('.rank-row[aria-expanded="true"]')) r.setAttribute('aria-expanded', 'false');
  const row = rowEl(name);
  if (!row) return;
  row.setAttribute('aria-expanded', 'true');
  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  drawer.dataset.for = name;
  drawer.innerHTML = drawerContent(name);
  row.after(drawer);
}

function refreshDrawer(name) {
  const drawer = els.results.querySelector('.drawer');
  if (drawer?.dataset.for === name) drawer.innerHTML = drawerContent(name);
}

function toggleRow(name) {
  if (openRow === name) {
    openRow = null;
    els.results.querySelector('.drawer')?.remove();
    rowEl(name)?.setAttribute('aria-expanded', 'false');
    return;
  }
  openRow = name;
  showDrawer(name);
  if (name !== 'baseline' && !details.has(name)) requestDetail(name);
}

// Sims one set on its own for its breakdown and the full SimulationCraft report.
async function requestDetail(name) {
  if (detailJobs.has(name) || !lastJobId) return;
  detailJobs.add(name);
  refreshDrawer(name);
  try {
    let job = await api('/api/sim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'detail', source: lastJobId, name }),
    });
    while (job.state === 'queued' || job.state === 'running') {
      await sleep(700);
      job = await api(`/api/jobs/${job.id}`);
    }
    details.set(name, job.state === 'done' ? job.result : { error: job.error ?? 'The detail sim was cancelled.' });
  } catch (err) {
    details.set(name, { error: err.message });
  } finally {
    detailJobs.delete(name);
    refreshDrawer(name);
  }
}

// --- extra sims -----------------------------------------------------------------

function renderAnalysis(mode) {
  const { result, rows } = analyses[mode];
  els.analysisTitle.textContent = ANALYSIS_TITLES[mode];
  els.analysisMeta.textContent = `${duration(result.seconds ?? 0)}${result.simc ? ` · SimulationCraft ${result.simc}` : ''}`;
  const describe = (name) => {
    const row = rows.get(name);
    return row ? `<div class="rank-chgs">${changeChips(row)}</div>` : esc(name);
  };
  els.analysis.innerHTML = {
    weights: () => weightsHtml(result),
    crests: () => crestsHtml(result, crests, SLOT_LABELS),
    vault: () => vaultHtml(result, parsed?.equipped ?? {}, SLOT_LABELS),
    trinkets: () => trinketsHtml(result),
    styles: () => stylesHtml(result, describe),
  }[mode]();
}

// --- history --------------------------------------------------------------------

function characterKey() {
  const server = parsed.charLines.find((l) => l.startsWith('server='))?.slice(7).replace(/^"|"$/g, '') ?? '';
  return new URLSearchParams({ name: parsed.name ?? '', server }).toString();
}

async function loadHistory(clear = false) {
  if (!parsed?.className) return;
  try {
    const { runs } = await api(`/api/history?${characterKey()}`, clear ? { method: 'DELETE' } : undefined);
    historyRuns = runs;
    if (runs.length) els.history.innerHTML = historyHtml(runs);
  } catch {
    historyRuns = [];
  }
  if (!els.resultsView.hidden) renderView();
}

function renderResults() {
  const result = lastResult;
  els.resultsMeta.textContent = result.simc ? `SimulationCraft ${result.simc}` : '';
  renderBest(result);
  renderTabs(result);
  renderTable(result);
}

// --- wiring -----------------------------------------------------------------------

els.profile.addEventListener('input', () => {
  loadProfile(els.profile.value);
  storage((s) => s.setItem(STORAGE_KEY, els.profile.value));
});

els.slots.addEventListener('click', (e) => {
  const key = e.target.dataset.remove;
  if (!key) return;
  e.preventDefault();
  modified = modified.filter((m) => modKey(m) !== key);
  selected.delete(key);
  refreshDerived();
});

els.slots.addEventListener('change', (e) => {
  const key = e.target.dataset.key;
  if (!key) return;
  if (e.target.checked) selected.add(key); else selected.delete(key);
  renderSlots();
  updateCount();
});

document.querySelector('#gear-card .bulk').addEventListener('click', (e) => {
  const mode = e.target.dataset.bulk;
  if (!mode) return;
  const pick = { all: () => true, none: () => false, upgrades: isLikelyUpgrade }[mode];
  selected = new Set([...parsed.bags.filter(pick), ...(mode === 'none' ? [] : derived)].map((b) => b.key));
  renderSlots();
  updateCount();
});

els.gemCard.addEventListener('change', (e) => {
  const { gem, diamond } = e.target.dataset;
  if (gem) e.target.checked ? gemPick.add(gem) : gemPick.delete(gem);
  if (diamond) e.target.checked ? diamondPick.add(diamond) : diamondPick.delete(diamond);
  saveSettings();
  updateCount();
});

document.querySelector('#gem-card .bulk').addEventListener('click', (e) => {
  const mode = e.target.dataset.gems;
  if (!mode) return;
  gemPick = new Set(GEMS.filter((g) => mode === 'all' || (mode === 'pure' && g.main === g.sub)).map((g) => g.id));
  if (mode === 'none') diamondPick.clear();
  renderGems();
  saveSettings();
  updateCount();
});

els.consumables.addEventListener('change', (e) => {
  const { use, compare } = e.target.dataset;
  if (use) {
    consumableUse[use] = e.target.value;
    renderConsumables();
  }
  if (compare) {
    const set = (consumableCompare[compare] ??= new Set());
    e.target.checked ? set.add(e.target.value) : set.delete(e.target.value);
  }
  saveSettings();
  updateCount();
});

els.tabs.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]')?.dataset.tab;
  if (!tab || !lastResult) return;
  activeTab = tab;
  renderTabs(lastResult);
  renderTable(lastResult);
});

els.loadouts.addEventListener('change', updateCount);
for (const id of ['fightStyle', 'targets', 'duration', 'targetError', 'smart']) {
  $(id).addEventListener('change', () => { saveSettings(); updateCount(); });
}

els.run.addEventListener('click', () => runBatch(pickedSims()));
$('run-float').addEventListener('click', () => (currentJob ? go('results', runningMode ?? view) : els.run.click()));

$('styles-btn').addEventListener('click', () => runBatch(['styles']));

$('nav-back').addEventListener('click', () => go('setup'));
els.rerun.addEventListener('click', () => runBatch([view]));
$('empty-run').addEventListener('click', () => (view === 'topgear' ? go('setup') : runBatch([view])));
els.navTabs.addEventListener('click', (e) => {
  const v = e.target.closest('[data-view]')?.dataset.view;
  if (v) go('results', v);
});
window.addEventListener('hashchange', route);

// Icons Wowhead doesn't have yet become a labelled placeholder.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.classList.contains('ic')) return;
  const span = document.createElement('span');
  span.className = `${img.className} broken`;
  span.textContent = img.dataset.fb ?? '';
  img.replaceWith(span);
}, true);


els.moreCard.addEventListener('change', (e) => {
  const mode = e.target.dataset.sim;
  if (!mode) return;
  if (e.target.checked) simPick.add(mode); else simPick.delete(mode);
  saveSettings();
  updateCount();
});

els.results.addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  if (e.target.closest('[data-report]')) {
    requestDetail(e.target.closest('.drawer').dataset.for);
    return;
  }
  const row = e.target.closest('.rank-row');
  if (row) toggleRow(row.dataset.name);
});

els.results.addEventListener('keydown', (e) => {
  const row = e.target.closest('.rank-row');
  if (row && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    toggleRow(row.dataset.name);
  }
});

els.analysisCard.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    await navigator.clipboard.writeText($(copy.dataset.copy).textContent);
    copy.textContent = 'Copied';
  }
});

$('history-clear').addEventListener('click', () => {
  if (confirm('Clear the saved DPS history for this character?')) loadHistory(true);
});
els.cancel.addEventListener('click', async () => {
  if (currentJob) await api(`/api/jobs/${currentJob}`, { method: 'DELETE' }).catch(() => {});
  finish({ state: 'cancelled' });
});

// --- engine updates ----------------------------------------------------------------

function applyStatus(s) {
  renderSystem(s);
  threads = s.threads || threads;
  els.engine.className = `engine ${s.simc ? 'ok' : 'missing'}`;
  els.engine.textContent = s.simc ? `${s.simc} · ${s.threads} threads` : 'SimulationCraft not installed';
  $('engine-version').textContent = s.simc ? `${s.simc}${s.simcBuild ? ` (${s.simcBuild})` : ''}` : 'Not installed';
  if (s.buildScript) {
    const cmd = `powershell -ExecutionPolicy Bypass -File "${s.buildScript}"`;
    $('update-cmd').textContent = cmd;
    $('build-own').hidden = false;
    $('engine-card').hidden = false;
    $('copy-cmd').onclick = async (e) => {
      await navigator.clipboard.writeText(cmd);
      e.target.textContent = 'Copied';
      setTimeout(() => { e.target.textContent = 'Copy'; }, 2000);
    };
  }
}

const APP_DISMISS_KEY = 'gear-sim:app-update-dismissed';

// Banner for a newer app release; dismissal is remembered per version.
function renderAppUpdate(app) {
  if (!app?.latest) return;
  const dismissed = storage((s) => s.getItem(APP_DISMISS_KEY)) === app.latest;
  const show = app.available && app.page && !dismissed;
  $('app-update').hidden = !show;
  if (!show) return;
  $('app-update-text').textContent = `SIMulacrum ${app.latest} is available (you have ${app.current}).`;
  $('app-update-link').href = app.page;
  $('app-update-dismiss').onclick = () => {
    storage((s) => s.setItem(APP_DISMISS_KEY, app.latest));
    $('app-update').hidden = true;
  };
}

function renderUpdate(u) {
  renderAppUpdate(u.app);
  if (!u.supported) return;
  $('engine-card').hidden = false;
  $('update-row').hidden = false;
  const status = $('update-status');
  const updateBtn = $('update-btn');
  const checkBtn = $('check-btn');
  const busy = ['downloading', 'installing'].includes(u.install?.state);
  updateBtn.hidden = true;
  checkBtn.disabled = busy;
  if (busy) {
    status.textContent = u.install.state === 'downloading' ? 'Downloading the new engine…' : 'Installing…';
    setTimeout(pollUpdate, 1000);
    return;
  }
  els.engine.classList.toggle('has-update', !!u.available);
  if (u.install?.state === 'error') status.textContent = `Update failed: ${u.install.error}`;
  else if (u.error) status.textContent = u.error;
  else if (u.available) {
    status.innerHTML = `New engine available: <strong>${esc(u.latest.simc ?? u.latest.tag)}</strong>`;
    updateBtn.hidden = false;
    els.engine.textContent += ' · update available';
  } else if (u.install?.state === 'done') status.textContent = 'Updated. You have the latest engine.';
  else if (u.latest) status.textContent = 'You have the latest engine.';
  else if (u.checked) status.textContent = 'No updates have been published yet.';
  else status.textContent = '';
}

async function checkUpdate(force) {
  try {
    renderUpdate(await api(`/api/update?check=${force ? 'force' : '1'}`));
  } catch { /* offline: stay quiet */ }
}

async function pollUpdate() {
  const u = await api('/api/update').catch(() => null);
  if (!u) return;
  if (u.install?.state === 'done' || u.install?.state === 'error') {
    applyStatus(await api('/api/status'));
    return checkUpdate(false);
  }
  renderUpdate(u);
}

$('check-btn').addEventListener('click', () => {
  $('update-status').textContent = 'Checking…';
  checkUpdate(true);
});

$('update-btn').addEventListener('click', async () => {
  try {
    await api('/api/update', { method: 'POST' });
    pollUpdate();
  } catch (err) {
    $('update-status').textContent = err.message;
  }
});

$('guide-toggle').addEventListener('click', () => showGuide(true));
els.engine.addEventListener('click', () => {
  if (!$('engine-card').hidden) $('engine-card').scrollIntoView({ behavior: 'smooth' });
});

const gb = (bytes) => `${Math.round(bytes / 2 ** 30)} GB`;

function renderSystem(s) {
  const sys = s.system;
  if (!sys) return;
  const pills = [
    ['CPU', sys.cpu],
    ['Threads', `${sys.cores ? `${sys.cores} cores · ` : ''}${sys.threads} threads · sims use ${sys.simThreads}`],
    ['Memory', `${gb(sys.memTotal)} (${gb(sys.memFree)} free)`],
    ...(s.lastRun ? [['Last run', `${s.lastRun.sets.toLocaleString()} sets in ${duration(s.lastRun.seconds)}${s.lastRun.smart ? ' (smart sim)' : ''}`]] : []),
  ];
  $('system').innerHTML = pills.map(([k, v]) => `<span class="pill"><span class="k">${k}</span> ${esc(v)}</span>`).join('');
  $('system').hidden = false;
}

function refreshStatus() {
  api('/api/status').then(applyStatus).catch(() => {});
}

api('/api/status').then((s) => {
  applyStatus(s);
  updateCount();
  checkUpdate(false);
}).catch(() => { els.engine.textContent = 'Server offline'; });

const THEME_KEY = 'gear-sim:theme';
$('theme').value = document.documentElement.dataset.theme || 'dark';
$('theme').addEventListener('change', (e) => {
  document.documentElement.dataset.theme = e.target.value;
  storage((s) => s.setItem(THEME_KEY, e.target.value));
});

loadSettings();
const saved = storage((s) => s.getItem(STORAGE_KEY));
if (saved) {
  els.profile.value = saved;
  loadProfile(saved);
}
if (location.hash.startsWith('#results')) history.replaceState(null, '', '#setup');
route();
