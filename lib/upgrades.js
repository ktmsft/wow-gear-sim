// Item upgrades (crests) and the catalyst, using this season's data.

import SEASON from './season.js';

export { SEASON };

const CLASS_IDS = {
  warrior: 1, paladin: 2, hunter: 3, rogue: 4, priest: 5, deathknight: 6, shaman: 7,
  mage: 8, warlock: 9, monk: 10, druid: 11, demonhunter: 12, evoker: 13,
};

// Blizzard's "item redundancy slot" index used by slot_high_watermarks.
const WATERMARK_SLOT = {
  head: [0], neck: [1], shoulder: [2], chest: [3], waist: [4], legs: [5], feet: [6], wrist: [7],
  hands: [8], finger: [9], trinket: [10], back: [11], main_hand: [12, 13, 14], off_hand: [16],
};

const field = (item, key) => item.fields.find(([k]) => k === key)?.[1];
const bonusList = (item) => (field(item, 'bonus_id') ?? '').split('/').filter(Boolean);

function withFields(item, changes) {
  const fields = item.fields.map(([k, v]) => [k, k in changes ? changes[k] : v]);
  for (const [k, v] of Object.entries(changes)) if (!fields.some(([f]) => f === k)) fields.push([k, v]);
  return fields;
}

// { group, level, max, track } for an item on an upgrade track, else null.
export function upgradeTrack(item) {
  for (const id of bonusList(item)) {
    const hit = SEASON.upgrades[id];
    if (hit) {
      const [group, level] = hit;
      const track = SEASON.tracks[group];
      return { group, level, max: track.max, track: track.name, bonus: id };
    }
  }
  return null;
}

export function trackLabel(item) {
  const t = upgradeTrack(item);
  return t ? `${t.track} ${t.level}/${t.max}` : null;
}

function watermark(group, watermarks) {
  const levels = (WATERMARK_SLOT[group] ?? []).map((i) => watermarks?.[i] ?? 0);
  return levels.length ? Math.max(...levels) : 0;
}

// Crests needed to go from the current rank to `level`. Ranks at or below the
// slot's high watermark are free.
export function upgradeCost(item, level, watermarks) {
  const t = upgradeTrack(item);
  const cost = {};
  if (!t) return cost;
  const free = watermark(item.group, watermarks);
  for (let l = t.level + 1; l <= level; l++) {
    const step = SEASON.tracks[t.group].levels[l];
    if (!step?.cost || step.ilvl <= free) continue;
    const [currency, amount] = step.cost;
    cost[currency] = (cost[currency] ?? 0) + amount;
  }
  return cost;
}

const affordable = (cost, crests) => Object.entries(cost).every(([c, n]) => (crests?.[c] ?? 0) >= n);

// Highest rank reachable with the crests on hand, or null if none.
export function maxAffordableLevel(item, crests, watermarks) {
  const t = upgradeTrack(item);
  if (!t) return null;
  let best = null;
  for (let l = t.level + 1; l <= t.max; l++) {
    if (affordable(upgradeCost(item, l, watermarks), crests)) best = l;
    else break;
  }
  return best;
}

export function upgraded(item, level, watermarks) {
  const t = upgradeTrack(item);
  const step = SEASON.tracks[t.group].levels[level];
  const bonus = bonusList(item).map((b) => (b === t.bonus ? String(step.bonus) : b)).join('/');
  const crests = upgradeCost(item, level, watermarks);
  return {
    ...item,
    ilvl: step.ilvl,
    bonusIds: bonus,
    fields: withFields(item, { bonus_id: bonus }),
    cost: { crests: addCosts(item.cost?.crests, crests), catalyst: item.cost?.catalyst ?? 0 },
    mods: [...(item.mods ?? []), `${t.track} ${level}/${t.max}`],
  };
}

export function catalystTarget(item, className) {
  const cls = SEASON.catalyst.items[CLASS_IDS[className]];
  const target = cls?.[item.group];
  if (!target || String(target.id) === item.id) return null;
  const bonuses = bonusList(item);
  return SEASON.catalyst.bonus.some((b) => bonuses.includes(String(b))) ? target : null;
}

// The class tier item for this slot, keeping the original item's stats.
export function catalyzed(item, className) {
  const target = catalystTarget(item, className);
  const drop = new Set(SEASON.catalyst.bonus.map(String));
  const bonus = [...bonusList(item).filter((b) => !drop.has(b)), ...target.bonus.map(String)].join('/');
  const changes = { id: String(target.id), bonus_id: bonus };
  if (SEASON.catalyst.redirect && !field(item, 'redirected_base_stats')) changes.redirected_base_stats = item.id;
  return {
    ...item,
    id: String(target.id),
    name: target.name,
    bonusIds: bonus,
    fields: withFields(item, changes),
    cost: { crests: { ...(item.cost?.crests ?? {}) }, catalyst: (item.cost?.catalyst ?? 0) + 1 },
    mods: [...(item.mods ?? []), 'Catalyst'],
  };
}

function addCosts(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

// Rebuilds modified items from [{ from, ops: ['catalyst', 'upgrade'] }] in order.
export function deriveItems(parsed, requests, budget) {
  const all = [...Object.values(parsed.equipped), ...parsed.bags, ...(parsed.vault ?? [])];
  const byKey = Object.fromEntries(all.map((it) => [it.key, it]));
  const out = [];
  for (const req of requests ?? []) {
    let item = byKey[req.from];
    if (!item) continue;
    for (const op of req.ops ?? []) {
      if (op === 'catalyst' && catalystTarget(item, parsed.className)) item = catalyzed(item, parsed.className);
      if (op === 'upgrade') {
        const level = maxAffordableLevel(item, budget?.crests, parsed.watermarks);
        if (level) item = upgraded(item, level, parsed.watermarks);
      }
    }
    if (!item.mods?.length) continue;
    const key = `mod:${req.from}:${req.ops.join('+')}`;
    const base = byKey[req.from];
    item = { ...item, key, equipped: false, from: req.from, ops: req.ops, baseName: base.name, baseEquipped: !!base.equipped };
    byKey[key] = item;
    out.push(item);
  }
  return out;
}

// Whether a full gear set fits the crest and catalyst budget.
export function withinBudget(items, budget) {
  const crests = {};
  let catalyst = 0;
  for (const it of items) {
    if (!it.cost) continue;
    catalyst += it.cost.catalyst ?? 0;
    for (const [c, n] of Object.entries(it.cost.crests ?? {})) crests[c] = (crests[c] ?? 0) + n;
  }
  if (catalyst > (budget?.catalyst ?? 0)) return false;
  return affordable(crests, budget?.crests);
}
