// Every gear set from equipped plus selected bag items, as changes from equipped.

import { GROUPS, PAIR_GROUPS, IGNORED_SLOTS } from './parse.js';

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
      // Unique-equipped.
      if (a.id === b.id) continue;
      const sig = [a, b].map((it) => `${it.id}:${it.bonusIds}`).sort().join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      options.push(assignPair(pair, a, b, baseline));
    }
  }
  return options;
}

export function itemsByGroup(parsed, selectedKeys) {
  const selected = new Set(selectedKeys);
  const byGroup = {};
  for (const [slot, item] of Object.entries(parsed.equipped)) {
    if (IGNORED_SLOTS.has(slot)) continue;
    (byGroup[item.group] ??= []).push(item);
  }
  for (const item of parsed.bags) {
    if (selected.has(item.key)) (byGroup[item.group] ??= []).push(item);
  }
  return byGroup;
}

export function countCombos(parsed, selectedKeys) {
  const byGroup = itemsByGroup(parsed, selectedKeys);
  let total = 1;
  for (const group of GROUPS) {
    if (byGroup[group]) total *= groupOptions(group, byGroup[group], parsed.equipped).length;
  }
  return Math.max(0, total - 1);
}

// [{ changes: [[slot, item], ...] }], excluding the equipped set.
export function buildCombos(parsed, selectedKeys, maxCombos = Infinity) {
  const baseline = parsed.equipped;
  const byGroup = itemsByGroup(parsed, selectedKeys);
  const perGroup = GROUPS.filter((g) => byGroup[g]).map((g) => groupOptions(g, byGroup[g], baseline));

  const total = perGroup.reduce((n, opts) => n * opts.length, 1) - 1;
  if (total > maxCombos) {
    throw new Error(`${total} combinations selected; the limit is ${maxCombos}. Untick some items.`);
  }

  const combos = [];
  const walk = (index, acc) => {
    if (index === perGroup.length) {
      const changes = acc.filter(([slot, item]) => baseline[slot]?.key !== item.key);
      if (changes.length) combos.push({ changes });
      return;
    }
    for (const option of perGroup[index]) walk(index + 1, acc.concat(option));
  };
  walk(0, []);
  return combos;
}
