import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProfile } from '../lib/parse.js';
import { crestVariants, vaultVariants, trinketVariants, crestCount } from '../lib/modes.js';
import { breakdown, buffUptimes, mainStat, scaleOnly, statWeights } from '../lib/report.js';

const PROFILE = `
druid="Example"
spec=feral
server=area_52
# Signet A (311)
finger1=,id=1,bonus_id=12843
# Signet B (321)
finger2=,id=2,bonus_id=12846
# Core (315)
trinket1=,id=10,bonus_id=12844
# Charm (334)
trinket2=,id=11,bonus_id=12854

### Gear from Bags
#
# Idol (305)
# trinket1=,id=12,bonus_id=12841

### Weekly Reward Choices
#
# Vault Band (318)
# finger1=,id=20,bonus_id=12845
#
# Signet B (321)
# finger1=,id=2,bonus_id=12846
#
### End of Weekly Reward Choices

### Additional Character Info
#
# upgrade_currencies=c:3445:40
# slot_high_watermarks=9:315:315/10:308:308
`;

test('parses Great Vault rewards apart from bag items', () => {
  const p = parseProfile(PROFILE);
  assert.equal(p.bags.length, 1);
  assert.deepEqual(p.vault.map((v) => [v.key, v.name, v.slot]), [
    ['vault:0', 'Vault Band', 'finger1'],
    ['vault:1', 'Signet B', 'finger1'],
  ]);
});

test('vault rewards try both ring slots unless a unique twin is equipped', () => {
  const v = vaultVariants(parseProfile(PROFILE), { copyEnchants: true });
  const slots = (key) => v.filter((x) => x.vaultKey === key).map((x) => x.slot);
  assert.deepEqual(slots('vault:0'), ['finger1', 'finger2']);
  assert.deepEqual(slots('vault:1'), ['finger2']);
});

test('crest planner prices each rank past the watermark', () => {
  const v = crestVariants(parseProfile(PROFILE));
  const ring = v.filter((x) => x.itemKey === 'eq:finger1');
  // 311 (3/6) -> 315 is under the 315 ring watermark, so free; the rest cost Hero crests.
  assert.deepEqual(ring.map((x) => [x.level, x.fromIlvl, x.ilvl, crestCount(x.cost)]), [[4, 311, 315, 0], [6, 311, 321, 40]]);
  // Maxed items are skipped.
  assert.ok(!v.some((x) => x.itemKey === 'eq:finger2' || x.itemKey === 'eq:trinket2'));
  // Bag items are tried in both trinket slots.
  assert.deepEqual(v.filter((x) => x.itemKey === 'bag:0' && x.level === 6).map((x) => x.slot), ['trinket1', 'trinket2']);
});

test('trinket chart covers every reachable rank', () => {
  const { series, variants } = trinketVariants(parseProfile(PROFILE));
  const core = series.find((s) => s.key === 'eq:trinket1');
  assert.deepEqual(core.points.map((p) => [p.ilvl, p.current]), [[315, true], [318, false], [321, false]]);
  assert.equal(core.points[0].names.length, 0);
  assert.equal(core.points[1].names.length, 1);
  const idol = series.find((s) => s.key === 'bag:0');
  assert.equal(idol.points.length, 6);
  assert.equal(idol.points[0].names.length, 2);
  assert.equal(variants.length, 2 + 6 * 2);
});

const PLAYER = {
  collected_data: { fight_length: { mean: 100 } },
  stats: [
    { name: 'rip', spell_name: 'Rip', type: 'damage', compound_amount: 6000, num_executes: { mean: 10 } },
    { name: 'cat_melee', spell_name: '', type: 'damage', compound_amount: 4000 },
    { name: 'tigers_fury', spell_name: "Tiger's Fury", type: 'damage', compound_amount: 0 },
    { name: 'regrowth', spell_name: 'Regrowth', type: 'heal', compound_amount: 900 },
  ],
  stats_pets: { treant: [{ name: 'wrath', type: 'damage', compound_amount: 1000 }] },
  buffs: [{ name: 'berserk', spell_name: 'Berserk', uptime: 22.5 }, { name: 'prowl', uptime: 0 }],
  scale_factors: { Agi: 50, Crit: 30, Haste: 40, Mastery: 25, Vers: 35 },
};

test('damage breakdown folds pets in and skips heals and zero rows', () => {
  const rows = breakdown(PLAYER);
  assert.deepEqual(rows.map((r) => [r.name, Math.round(r.dps), Math.round(r.share * 100)]), [
    ['Rip', 60, 55], ['Auto attack', 40, 36], ['Treant', 10, 9],
  ]);
  assert.deepEqual(buffUptimes(PLAYER), [{ name: 'Berserk', id: null, uptime: 22.5 }]);
});

test('stat weights normalize to the main stat and build a Pawn string', () => {
  assert.equal(mainStat('druid', 'feral'), 'Agi');
  assert.equal(mainStat('druid', 'balance'), 'Int');
  assert.equal(mainStat('paladin', 'retribution'), 'Str');
  assert.deepEqual(scaleOnly('Agi'), ['agi', 'crit', 'haste', 'mastery', 'vers']);
  const w = statWeights(PLAYER, 'druid', 'feral');
  assert.equal(w.stats.find((s) => s.key === 'Haste').weight, 0.8);
  assert.equal(w.pawn, '( Pawn: v1: "SIMulacrum Feral": Class=Druid, Spec=Feral, Agility=1.00, CritRating=0.60, HasteRating=0.80, MasteryRating=0.50, Versatility=0.70 )');
});
