// Gem setups for the equipped gear's sockets.

import { GEMS, GEM_BY_ID, isDiamond, STAT_SHORT } from './catalog.js';
import { IGNORED_SLOTS, itemLine } from './parse.js';

// [{ slot, index, gemId, diamond }] for every filled socket on equipped gear.
export function equippedSockets(parsed) {
  const sockets = [];
  for (const [slot, item] of Object.entries(parsed.equipped)) {
    if (IGNORED_SLOTS.has(slot)) continue;
    const gems = item.fields.find(([k]) => k === 'gem_id')?.[1];
    if (!gems) continue;
    gems.split('/').forEach((gemId, index) => {
      if (gemId && gemId !== '0') sockets.push({ slot, index, gemId, diamond: isDiamond(gemId) });
    });
  }
  return sockets;
}

function multisets(pool, size, start = 0, acc = [], out = []) {
  if (acc.length === size) { out.push(acc); return out; }
  for (let i = start; i < pool.length; i++) multisets(pool, size, i, acc.concat(pool[i]), out);
  return out;
}

const colorCount = (ids) => new Set(ids.map((id) => GEM_BY_ID[id]?.color).filter(Boolean)).size;

export function gemSetupLabel(ids, diamondId) {
  const counts = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  const parts = Object.entries(counts).map(([id, n]) => `${n > 1 ? `${n}× ` : ''}${GEM_BY_ID[id]?.label ?? id}`);
  if (diamondId) parts.push(`${GEM_BY_ID[diamondId]?.label ?? diamondId} Diamond`);
  return parts.join(' · ');
}

// [{ gems, diamond, lines: { slot: itemLine }, label }], excluding the current setup.
export function buildGemSetups(parsed, { gems = [], diamonds = [], maxColors = true } = {}, limit = Infinity) {
  const sockets = equippedSockets(parsed);
  const regular = sockets.filter((s) => !s.diamond);
  const diamondSocket = sockets.find((s) => s.diamond);
  const pool = GEMS.map((g) => g.id).filter((id) => gems.includes(id));
  const diamondPool = diamondSocket ? DIAMOND_ORDER.filter((id) => diamonds.includes(id)) : [];
  if ((!pool.length || !regular.length) && !diamondPool.length) return [];

  const currentRegular = regular.map((s) => s.gemId).sort();
  let sets = pool.length && regular.length ? multisets(pool, regular.length) : [currentRegular];
  if (maxColors && pool.length) {
    const best = Math.max(...sets.map(colorCount));
    sets = sets.filter((s) => colorCount(s) === best);
  }
  const diamondChoices = diamondPool.length ? diamondPool : [diamondSocket?.gemId ?? null];

  const total = sets.length * diamondChoices.length;
  if (total > limit) {
    throw new Error(`${total} gem setups selected; the limit is ${limit}. Untick some gems or keep "Only max colors" on.`);
  }

  const setups = [];
  for (const set of sets) {
    for (const diamond of diamondChoices) {
      const sameGems = [...set].sort().join() === currentRegular.join();
      if (sameGems && diamond === (diamondSocket?.gemId ?? null)) continue;
      setups.push({
        gems: set,
        diamond,
        lines: applyGems(parsed, regular, set, diamondSocket, diamond),
        label: gemSetupLabel(set, diamondSocket ? diamond : null),
      });
    }
  }
  return setups;
}

export function countGemSetups(parsed, choice) {
  try {
    return buildGemSetups(parsed, choice).length;
  } catch {
    return 0;
  }
}

// Item lines for items whose gems changed.
function applyGems(parsed, regular, set, diamondSocket, diamond) {
  const perSlot = {};
  const place = (socket, gemId) => {
    const item = parsed.equipped[socket.slot];
    const current = (perSlot[socket.slot] ??= item.fields.find(([k]) => k === 'gem_id')[1].split('/'));
    current[socket.index] = gemId;
  };
  // Keep gems that stay in their current socket.
  const remaining = [...set];
  const open = [];
  for (const socket of regular) {
    const i = remaining.indexOf(socket.gemId);
    if (i === -1) open.push(socket);
    else remaining.splice(i, 1);
  }
  open.forEach((socket, i) => place(socket, remaining[i]));
  if (diamondSocket && diamond) place(diamondSocket, diamond);

  const lines = {};
  for (const [slot, gems] of Object.entries(perSlot)) {
    const item = parsed.equipped[slot];
    const before = item.fields.find(([k]) => k === 'gem_id')[1];
    const after = gems.join('/');
    if (before === after) continue;
    lines[slot] = itemLine(slot, item.fields.map(([k, v]) => [k, k === 'gem_id' ? after : v]));
  }
  return lines;
}

const DIAMOND_ORDER = ['240967', '240983', '240969', '240971'];

export function describeStats(gemIds) {
  const totals = {};
  for (const id of gemIds) {
    const g = GEM_BY_ID[id];
    if (!g?.main) continue;
    if (g.main === g.sub) totals[g.main] = (totals[g.main] ?? 0) + 17;
    else {
      totals[g.main] = (totals[g.main] ?? 0) + 16;
      totals[g.sub] = (totals[g.sub] ?? 0) + 7;
    }
  }
  return Object.entries(totals).map(([s, n]) => `${n} ${STAT_SHORT[s]}`).join(', ');
}
