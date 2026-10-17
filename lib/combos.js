// Every gear set from equipped plus selected bag items, as changes from equipped.

import { GROUPS, PAIR_GROUPS, IGNORED_SLOTS } from './parse.js';
import { withinBudget } from './upgrades.js';

function sameItem(a, b) {
  return a.id === b.id && a.bonusIds === b.bonusIds;
}

// Keep paired items in their current slot to minimize changes.
function assignPair([slotA, slotB], a, b, baseline) {
  const keep = (slot, item) => (baseline[slot]?.key === item.key ? 1 : 0);
  const straight = keep(slotA, a) + keep(slotB, b);
  const swapped = keep(slotA, b) + keep(slotB, a);
  return swapped > straight ? [[slotA, b], [slotB, a]] : [[slotA, a], [slotB, b]];
}

function groupOptions(group, items, baseline) {
  const pair = PAIR_GROUPS[group];
  if (!pair) {
    const unique = items.filter((it, i) => items.findIndex((o) => sameItem(o, it)) === i);
    return unique.map((it) => [[group, it]]);
  }

  if (items.length < 2) {
    return [pair.filter((s) => baseline[s]).map((s) => [s, baseline[s]])];
  }

  const options = [];
  const seen = new Set();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      // Unique-equipped, and an item can't be worn alongside its own upgraded copy.
      if (a.id === b.id || (a.from ?? a.key) === (b.from ?? b.key)) continue;
      const sig = [a, b].map((it) => `${it.id}:${it.bonusIds}`).sort().join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      options.push(assignPair(pair, a, b, baseline));
    }
  }
  return options;
}

// `extra` holds upgraded/catalyzed copies; they're used when their key is selected.
export function itemsByGroup(parsed, selectedKeys, extra = []) {
  const selected = new Set(selectedKeys);
  const byGroup = {};
  for (const [slot, item] of Object.entries(parsed.equipped)) {
    if (IGNORED_SLOTS.has(slot)) continue;
    (byGroup[item.group] ??= []).push(item);
  }
  for (const item of [...parsed.bags, ...extra]) {
    if (selected.has(item.key)) (byGroup[item.group] ??= []).push(item);
  }
  return byGroup;
}

function enumerate(parsed, selectedKeys, { extra = [], budget } = {}, onSet) {
  const baseline = parsed.equipped;
  const byGroup = itemsByGroup(parsed, selectedKeys, extra);
  const perGroup = GROUPS.filter((g) => byGroup[g]).map((g) => groupOptions(g, byGroup[g], baseline));
  const costed = Object.values(byGroup).flat().some((it) => it.cost);
  const total = perGroup.reduce((n, opts) => n * opts.length, 1) - 1;

  const walk = (index, acc) => {
    if (index === perGroup.length) {
      if (costed && !withinBudget(acc.map(([, item]) => item), budget)) return;
      const changes = acc.filter(([slot, item]) => baseline[slot]?.key !== item.key);
      if (changes.length) onSet(changes);
      return;
    }
    for (const option of perGroup[index]) walk(index + 1, acc.concat(option));
  };
  return { total, costed, run: () => walk(0, []) };
}

export function countCombos(parsed, selectedKeys, opts) {
  const e = enumerate(parsed, selectedKeys, opts, () => { n += 1; });
  if (!e.costed) return Math.max(0, e.total);
  let n = 0;
  e.run();
  return n;
}

// [{ changes: [[slot, item], ...] }], excluding the equipped set.
export function buildCombos(parsed, selectedKeys, maxCombos = Infinity, opts) {
  const combos = [];
  const e = enumerate(parsed, selectedKeys, opts, (changes) => combos.push({ changes }));
  if (e.total > maxCombos) {
    throw new Error(`${e.total} combinations selected; the limit is ${maxCombos}. Untick some items.`);
  }
  e.run();
  return combos;
}
