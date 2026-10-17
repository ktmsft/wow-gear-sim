// Pulls the readable parts out of a SimulationCraft json2 player: damage
// breakdown, buff uptimes and stat weights.

const pretty = (name) => (/melee/.test(name) ? 'Auto attack'
  : name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

const label = (s) => s.spell_name || pretty(s.name);

// stats_pets is keyed by pet name in json2; older builds used an array.
function petStats(player) {
  const pets = player.stats_pets;
  if (!pets) return [];
  return Array.isArray(pets)
    ? pets.map((p) => [p.name ?? 'Pet', p.stats ?? []])
    : Object.entries(pets);
}

// Abilities by share of damage. Child actions are folded into their parent.
export function breakdown(player, limit = 14) {
  const length = player.collected_data?.fight_length?.mean || 1;
  const rows = (player.stats ?? [])
    .filter((s) => s.type === 'damage' && s.compound_amount > 0)
    .map((s) => ({ name: label(s), id: s.id, school: s.school ?? null, amount: s.compound_amount, casts: s.num_executes?.mean ?? 0 }));
  for (const [pet, stats] of petStats(player)) {
    const amount = stats.filter((s) => s.type === 'damage').reduce((n, s) => n + (s.compound_amount ?? 0), 0);
    if (amount > 0) rows.push({ name: pretty(pet), id: null, school: 'pet', amount, casts: 0 });
  }
  const total = rows.reduce((n, r) => n + r.amount, 0) || 1;
  rows.sort((a, b) => b.amount - a.amount);
  const top = rows.slice(0, limit);
  const rest = rows.slice(limit).reduce((n, r) => n + r.amount, 0);
  if (rest > 0) top.push({ name: 'Everything else', id: null, school: null, amount: rest, casts: 0 });
  return top.map(({ amount, ...r }) => ({ ...r, dps: amount / length, share: amount / total }));
}

export function buffUptimes(player, limit = 14) {
  return (player.buffs ?? [])
    .filter((b) => (b.uptime ?? 0) >= 1)
    .map((b) => ({ name: b.spell_name || pretty(b.name), id: b.spell ?? null, uptime: b.uptime }))
    .sort((a, b) => b.uptime - a.uptime)
    .slice(0, limit);
}

// --- stat weights ---------------------------------------------------------------

const STRENGTH = new Set(['warrior', 'deathknight', 'paladin:retribution', 'paladin:protection']);
const AGILITY = new Set([
  'rogue', 'hunter', 'demonhunter', 'monk:windwalker', 'monk:brewmaster',
  'druid:feral', 'druid:guardian', 'shaman:enhancement',
]);

export function mainStat(className, spec) {
  const has = (set) => set.has(className) || set.has(`${className}:${spec}`);
  return has(STRENGTH) ? 'Str' : has(AGILITY) ? 'Agi' : 'Int';
}

export const WEIGHT_STATS = ['Crit', 'Haste', 'Mastery', 'Vers'];
const SIMC_STAT = { Str: 'str', Agi: 'agi', Int: 'int', Crit: 'crit', Haste: 'haste', Mastery: 'mastery', Vers: 'vers' };
const PAWN_STAT = {
  Str: 'Strength', Agi: 'Agility', Int: 'Intellect', Crit: 'CritRating',
  Haste: 'HasteRating', Mastery: 'MasteryRating', Vers: 'Versatility',
};
export const STAT_LABELS = { Str: 'Strength', Agi: 'Agility', Int: 'Intellect', Crit: 'Critical Strike', Haste: 'Haste', Mastery: 'Mastery', Vers: 'Versatility' };

export const scaleOnly = (main) => [main, ...WEIGHT_STATS].map((s) => SIMC_STAT[s]);

const PAWN_CLASS = {
  deathknight: 'DeathKnight', demonhunter: 'DemonHunter',
};
const camel = (s) => s.split(/[_\s]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

// Weights normalized so the main stat is 1, plus a Pawn import string.
export function statWeights(player, className, spec) {
  const main = mainStat(className, spec);
  const raw = player.scale_factors ?? {};
  const base = raw[main] || 1;
  const stats = [main, ...WEIGHT_STATS].map((key) => ({
    key, label: STAT_LABELS[key], perPoint: raw[key] ?? 0, weight: (raw[key] ?? 0) / base,
  }));
  const cls = PAWN_CLASS[className] ?? camel(className);
  const specName = camel(spec ?? '');
  const pawn = `( Pawn: v1: "SIMulacrum ${specName}": Class=${cls}, Spec=${specName}, `
    + stats.map((s) => `${PAWN_STAT[s.key]}=${s.weight.toFixed(2)}`).join(', ')
    + ' )';
  return { main, stats, pawn };
}
