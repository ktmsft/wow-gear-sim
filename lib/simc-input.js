// Builds the .simc input: options, the character, and one profileset per variant.

import { itemLine } from './parse.js';
import { CONSUMABLES, consumableLine } from './catalog.js';
import { buildGemSetups } from './gems.js';
import { SEASON } from './upgrades.js';

export const FIGHT_STYLES = [
  'Patchwerk', 'DungeonSlice', 'DungeonRoute', 'CastingPatchwerk', 'LightMovement',
  'HeavyMovement', 'HecticAddCleave', 'HelterSkelter', 'CleaveAdd', 'Beastlord',
];

// Options set by the server or touching files/network; stripped from pasted profiles.
const BLOCKED_KEY = /^(output|html|xml|json|json2|log|save|save_.*|reports|input|path|csv|armory|local_json|bcp_api|apikey|threads|iterations|target_error|max_time|fight_style|desired_targets|profileset.*|spell_query.*|copy|food|flask|potion|augmentation|temporary_enchant)$/;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

const strings = (v) => (Array.isArray(v) ? v.map(String) : []);

export function normalizeOptions(raw = {}) {
  const consumables = {};
  const compare = {};
  for (const kind of Object.keys(CONSUMABLES)) {
    const values = CONSUMABLES[kind].items.map((i) => i.value);
    const use = raw.consumables?.[kind];
    consumables[kind] = values.includes(use) || use === 'none' ? use : 'default';
    compare[kind] = strings(raw.compare?.[kind]).filter((v) => values.includes(v));
  }
  return {
    fightStyle: FIGHT_STYLES.includes(raw.fightStyle) ? raw.fightStyle : 'Patchwerk',
    targets: Math.round(clampNumber(raw.targets, 1, 20, 1)),
    duration: Math.round(clampNumber(raw.duration, 30, 900, 300)),
    targetError: clampNumber(raw.targetError, 0.05, 2, 0.2),
    copyEnchants: raw.copyEnchants !== false,
    copyGems: raw.copyGems === true,
    smart: raw.smart !== false,
    consumables,
    compare,
    budget: {
      crests: Object.fromEntries(Object.keys(SEASON.currencies)
        .map((id) => [id, Math.round(clampNumber(raw.budget?.crests?.[id], 0, 1e7, 0))])),
      catalyst: Math.round(clampNumber(raw.budget?.catalyst, 0, 99, 0)),
    },
    modified: (Array.isArray(raw.modified) ? raw.modified : [])
      .map((m) => ({ from: String(m?.from ?? ''), ops: strings(m?.ops).filter((o) => o === 'upgrade' || o === 'catalyst') }))
      .filter((m) => m.from && m.ops.length),
    gems: {
      gems: strings(raw.gems?.gems),
      diamonds: strings(raw.gems?.diamonds),
      maxColors: raw.gems?.maxColors !== false,
    },
  };
}

// Bag items borrow the enchant (and optionally gems) of the item they replace.
export function withBorrowed(slot, item, baseline, options) {
  const fields = item.fields.map((f) => [...f]);
  const current = baseline[slot]?.fields ?? [];
  const borrow = (key) => {
    if (fields.some(([k]) => k === key)) return;
    const value = current.find(([k]) => k === key)?.[1];
    if (value) fields.push([key, value]);
  };
  if (!item.equipped) {
    if (options.copyEnchants) borrow('enchant_id');
    if (options.copyGems) borrow('gem_id');
  }
  return fields;
}

export function safeCharLines(lines) {
  return lines.filter((line) => {
    const key = line.slice(0, line.indexOf('='));
    return /^[a-z0-9_.]+$/i.test(key) && !BLOCKED_KEY.test(key);
  });
}

// Every comparison as { name, kind, lines, ...meta }.
export function buildVariants(parsed, combos, loadouts, options) {
  const variants = [];
  const hasOffHand = !!parsed.equipped.off_hand;

  combos.forEach((combo, i) => {
    const changes = combo.changes.map(([slot, item]) => ({
      slot, name: item.name, ilvl: item.ilvl, id: item.id, bonusIds: item.bonusIds, mods: item.mods,
      bag: !item.equipped && !item.baseEquipped, baseName: item.baseName, crests: item.cost?.crests,
      line: itemLine(slot, withBorrowed(slot, item, parsed.equipped, options)),
    }));
    variants.push({ name: `g${i + 1}`, kind: 'gear', changes, lines: changes.map((c) => c.line) });
  });

  buildGemSetups(parsed, options.gems).forEach((setup, i) => {
    variants.push({
      name: `j${i + 1}`, kind: 'gems', label: setup.label, gems: setup.gems, diamond: setup.diamond,
      changes: Object.entries(setup.lines).map(([slot, line]) => ({ slot, line })),
      lines: Object.values(setup.lines),
    });
  });

  for (const [kind, values] of Object.entries(options.compare)) {
    values.filter((v) => v !== options.consumables[kind]).forEach((value, i) => {
      const item = CONSUMABLES[kind].items.find((it) => it.value === value);
      variants.push({
        name: `${kind}${i + 1}`, kind: 'consumable', category: kind, value,
        label: `${CONSUMABLES[kind].label}: ${item.label}`, detail: item.name,
        lines: [consumableLine(kind, value, hasOffHand)],
      });
    });
  }

  loadouts.forEach((loadout, i) => {
    variants.push({
      name: `t${i + 1}`, kind: 'talents', loadout: loadout.name, talents: loadout.talents,
      lines: [`talents=${loadout.talents.replace(/[^A-Za-z0-9+/=]/g, '')}`],
    });
  });

  return variants;
}

export function baseLines(parsed, options) {
  const hasOffHand = !!parsed.equipped.off_hand;
  return [
    ...safeCharLines(parsed.charLines),
    ...Object.entries(options.consumables)
      .map(([kind, value]) => consumableLine(kind, value, hasOffHand))
      .filter(Boolean),
  ];
}

// actorLines override the character (e.g. one set simmed on its own); scale turns on stat weights.
export function buildSimcInput(parsed, variants, options, {
  jsonPath, threads, targetError, htmlPath = null, actorLines = [], scale = null,
}) {
  const out = [
    `fight_style=${options.fightStyle}`,
    `desired_targets=${options.targets}`,
    `max_time=${options.duration}`,
    'vary_combat_length=0.2',
    `target_error=${targetError ?? options.targetError}`,
    'optimal_raid=1',
    `calculate_scale_factors=${scale ? 1 : 0}`,
    ...(scale ? [`scale_only=${scale.join(',')}`] : []),
    `threads=${threads}`,
    '',
    ...baseLines(parsed, options),
    '',
  ];

  for (const item of Object.values(parsed.equipped)) {
    out.push(itemLine(item.slot, item.fields));
  }
  out.push(...actorLines, '');

  for (const variant of variants) {
    for (const line of variant.lines) out.push(`profileset."${variant.name}"+=${line}`);
  }

  out.push('', `json2=${jsonPath}`, ...(htmlPath ? [`html=${htmlPath}`] : []), '');
  return out.join('\n');
}
