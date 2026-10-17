// Variants for the extra sim modes: crest planner, Great Vault and trinket chart.

import { itemLine, IGNORED_SLOTS, PAIR_GROUPS } from './parse.js';
import { upgradeTrack, upgraded, upgradeCost, SEASON } from './upgrades.js';
import { withBorrowed } from './simc-input.js';

// Slots an item may go in without clashing with a unique-equipped twin.
function placements(parsed, item) {
  const pair = PAIR_GROUPS[item.group];
  if (!pair) return [item.slot];
  if (item.equipped) return [item.slot];
  const same = pair.filter((s) => parsed.equipped[s]?.id === item.id);
  return same.length ? same : pair;
}

// Track item levels beat the export's comment, which can lag behind the bonus IDs.
const ilvlAt = (t, level, fallback) => SEASON.tracks[t?.group]?.levels[level]?.ilvl ?? fallback;

// Equipped and bag items one rank up and at max rank, with the crest cost.
// Bag items are tried in each slot they fit; the server keeps the best.
export function crestVariants(parsed) {
  const out = [];
  const items = [...Object.values(parsed.equipped), ...parsed.bags].filter((it) => !IGNORED_SLOTS.has(it.slot));
  for (const item of items) {
    const t = upgradeTrack(item);
    if (!t || t.level >= t.max) continue;
    for (const level of new Set([t.level + 1, t.max])) {
      const up = upgraded(item, level, parsed.watermarks);
      for (const slot of placements(parsed, item)) {
        out.push({
          name: `c${out.length + 1}`, kind: 'crest', slot, itemKey: item.key, equipped: item.equipped,
          itemName: item.name, id: item.id, bonusIds: up.bonusIds,
          fromIlvl: ilvlAt(t, t.level, item.ilvl), ilvl: up.ilvl, level, from: t.level, max: t.max, track: t.track,
          cost: upgradeCost(item, level, parsed.watermarks),
          lines: [itemLine(slot, item.equipped ? up.fields : withBorrowed(slot, up, parsed.equipped, { copyEnchants: true }))],
        });
      }
    }
  }
  return out;
}

// Total crests in a cost, for "DPS per crest".
export const crestCount = (cost) => Object.values(cost ?? {}).reduce((a, b) => a + b, 0);

export const crestName = (id) => SEASON.currencies[id] ?? `Currency ${id}`;

// Every vault reward in every slot it fits.
export function vaultVariants(parsed, options) {
  const out = [];
  for (const item of parsed.vault ?? []) {
    for (const slot of placements(parsed, item)) {
      out.push({
        name: `v${out.length + 1}`, kind: 'vault', vaultKey: item.key, slot,
        itemName: item.name, ilvl: item.ilvl, id: item.id, bonusIds: item.bonusIds,
        lines: [itemLine(slot, withBorrowed(slot, item, parsed.equipped, options))],
      });
    }
  }
  return out;
}

// Trinkets you own (and vault ones) at every rank they can reach.
export function trinketVariants(parsed) {
  const owned = [parsed.equipped.trinket1, parsed.equipped.trinket2, ...parsed.bags, ...(parsed.vault ?? [])]
    .filter((it) => it?.group === 'trinket');
  const candidates = [];
  const seen = new Set();
  for (const item of owned) {
    const sig = `${item.id}:${item.bonusIds}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    candidates.push(item);
  }
  const variants = [];
  const series = candidates.map((item) => {
    const t = upgradeTrack(item);
    const levels = t ? Array.from({ length: t.max - t.level + 1 }, (_, i) => t.level + i) : [null];
    const points = levels.map((level) => {
      const version = level == null || level === t.level ? item : upgraded(item, level, parsed.watermarks);
      const point = { level, ilvl: ilvlAt(t, level, version.ilvl), names: [], current: !!item.equipped && version === item };
      if (!point.current) {
        for (const slot of placements(parsed, item)) {
          const name = `k${variants.length + 1}`;
          point.names.push(name);
          variants.push({ name, kind: 'trinket', slot, lines: [itemLine(slot, version.fields)] });
        }
      }
      return point;
    });
    return {
      key: item.key, name: item.name, id: item.id, bonusIds: item.bonusIds,
      equipped: !!item.equipped, slot: item.equipped ? item.slot : null,
      source: item.equipped ? 'Equipped' : item.key.startsWith('vault:') ? 'Great Vault' : 'Bags',
      track: t ? t.track : null, max: t?.max ?? null, points,
    };
  });
  return { series, variants };
}
