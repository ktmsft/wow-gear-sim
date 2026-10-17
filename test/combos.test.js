import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProfile } from '../lib/parse.js';
import { buildCombos, countCombos } from '../lib/combos.js';
import { buildSimcInput, buildVariants, normalizeOptions, safeCharLines } from '../lib/simc-input.js';
import { buildGemSetups, equippedSockets } from '../lib/gems.js';

const PROFILE = `
druid="Example"
level=90
spec=feral
talents=AAAA
# Saved Loadout: Raid
# talents=BBBB
# Ring A (321)
finger1=,id=1,enchant_id=7967,bonus_id=10
# Ring B (321)
finger2=,id=2,enchant_id=7967,bonus_id=10
# Trinket A (321)
trinket1=,id=11,bonus_id=10
# Trinket B (334)
trinket2=,id=12,bonus_id=20
# Boots (321)
feet=,id=21,enchant_id=7963,bonus_id=10
# Shirt (1)
shirt=,id=99

### Gear from Bags
#
# Ring C (311)
# finger1=,id=3,bonus_id=10
#
# Trinket B (321)
# trinket1=,id=12,bonus_id=10
#
# New Boots (334)
# feet=,id=22,bonus_id=20
`;

test('parses equipped gear, bag gear and loadouts', () => {
  const p = parseProfile(PROFILE);
  assert.equal(p.className, 'druid');
  assert.equal(p.name, 'Example');
  assert.equal(p.equipped.finger1.name, 'Ring A');
  assert.equal(p.equipped.trinket2.ilvl, 334);
  assert.deepEqual(p.bags.map((b) => b.name), ['Ring C', 'Trinket B', 'New Boots']);
  assert.deepEqual(p.loadouts, [{ name: 'Raid', talents: 'BBBB' }]);
});

test('rings pair up, unique trinkets never double up', () => {
  const p = parseProfile(PROFILE);
  const all = p.bags.map((b) => b.key);
  // rings: {A,B},{A,C},{B,C} = 3; trinkets: {A,B334},{A,B321} = 2 ({B,B} is unique-equipped); feet: 2
  assert.equal(countCombos(p, all), 3 * 2 * 2 - 1);
  for (const { changes } of buildCombos(p, all)) {
    const slots = changes.map(([s]) => s);
    assert.equal(new Set(slots).size, slots.length);
  }
});

test('a replacement ring takes the slot of the ring it replaces', () => {
  const p = parseProfile(PROFILE);
  const combos = buildCombos(p, ['bag:0']);
  const changes = combos.map((c) => c.changes.map(([slot, item]) => `${slot}:${item.name}`));
  assert.deepEqual(changes.sort(), [['finger1:Ring C'], ['finger2:Ring C']].sort());
});

test('enforces the combination limit', () => {
  const p = parseProfile(PROFILE);
  assert.throws(() => buildCombos(p, p.bags.map((b) => b.key), 5), /limit is 5/);
});

test('copies enchants onto bag items and writes profilesets', () => {
  const p = parseProfile(PROFILE);
  const options = normalizeOptions({});
  const variants = buildVariants(p, buildCombos(p, ['bag:2']), p.loadouts, options);
  const text = buildSimcInput(p, variants, options, { jsonPath: 'out.json', threads: 2 });
  assert.match(text, /^profileset\."g1"\+=feet=,id=22,bonus_id=20,enchant_id=7963$/m);
  assert.match(text, /^profileset\."t1"\+=talents=BBBB$/m);
  assert.match(text, /^json2=out\.json$/m);
  assert.equal(variants[0].changes[0].name, 'New Boots');
});

test('consumables: base choice goes on the character, compares become profilesets', () => {
  const p = parseProfile(PROFILE);
  const options = normalizeOptions({
    consumables: { flask: 'flask_of_the_magisters_2', food: 'bogus' },
    compare: { flask: ['flask_of_the_magisters_2', 'flask_of_the_blood_knights_2'], oil: ['thalassian_phoenix_oil_2'] },
  });
  assert.equal(options.consumables.food, 'default');
  const variants = buildVariants(p, [], [], options);
  assert.deepEqual(variants.map((v) => v.lines[0]), [
    'flask=flask_of_the_blood_knights_2',
    'temporary_enchant=main_hand:thalassian_phoenix_oil',
  ].map((l, i) => (i === 1 ? `${l}_2` : l)));
  const text = buildSimcInput(p, variants, options, { jsonPath: 'x', threads: 1 });
  assert.match(text, /^flask=flask_of_the_magisters_2$/m);
});

const GEMMED = `
druid="Example"
spec=feral
head=,id=1,gem_id=240892
neck=,id=2,gem_id=240906
finger1=,id=3,gem_id=240898
finger2=,id=4,gem_id=240967
`;

test('finds sockets and the diamond', () => {
  const sockets = equippedSockets(parseProfile(GEMMED));
  assert.equal(sockets.length, 4);
  assert.deepEqual(sockets.filter((s) => s.diamond).map((s) => s.slot), ['finger2']);
});

test('gem setups fill every regular socket and skip the current setup', () => {
  const p = parseProfile(GEMMED);
  // Pure crit + pure haste across 3 sockets: CCC, CCH, CHH, HHH = 4 multisets.
  const all = buildGemSetups(p, { gems: ['240904', '240888'], maxColors: false });
  assert.equal(all.length, 4);
  const twoColors = buildGemSetups(p, { gems: ['240904', '240888'] });
  assert.equal(twoColors.length, 2);
  const crit = all.find((s) => s.gems.every((g) => g === '240904'));
  assert.equal(crit.lines.head, 'head=,id=1,gem_id=240904');
  assert.equal(crit.lines.finger2, undefined);
  // The current gems plus another diamond only swaps the diamond.
  const diamond = buildGemSetups(p, { gems: [], diamonds: ['240983'] });
  assert.deepEqual(Object.keys(diamond[0].lines), ['finger2']);
  assert.match(diamond[0].lines.finger2, /gem_id=240983/);
});

test('drops file and network options from pasted profiles', () => {
  assert.deepEqual(
    safeCharLines(['druid="Example"', 'output=C:/x.txt', 'html=a.html', 'json2=b', 'save=c', 'armory=us,a,b', 'level=90']),
    ['druid="Example"', 'level=90'],
  );
});
