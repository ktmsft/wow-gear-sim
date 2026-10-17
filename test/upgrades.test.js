import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProfile, itemLine } from '../lib/parse.js';
import { buildCombos, countCombos } from '../lib/combos.js';
import {
  upgradeTrack, upgradeCost, maxAffordableLevel, catalystTarget, deriveItems,
} from '../lib/upgrades.js';

// Real Midnight season 1 items (Hero track bonus ids 12841-12846).
const PROFILE = `
druid="Example"
spec=feral
# Somber Spaulders (321)
shoulder=,id=251223,enchant_id=8001,bonus_id=13440/6652/13662/12699/12846,content_tuning=1279
# Arctic Explorer's Legwraps (321)
feet=,id=251153,enchant_id=7963,bonus_id=13440/6652/13662/12699/12846,content_tuning=1279
# Signet A (305)
finger1=,id=1,bonus_id=12841
# Signet B (305)
finger2=,id=2,bonus_id=12841

### Gear from Bags
#
# Arctic Explorer's Legwraps (311)
# feet=,id=251153,bonus_id=12843/13440/6652/13662/12699,content_tuning=1279

### Additional Character Info
#
# catalyst_currencies=2813:8/3465:2
# upgrade_currencies=c:3445:100/c:3446:5/i:210233:9
# slot_high_watermarks=0:334:334/2:321:321/6:300:321/9:305:305
`;

test('reads crests, catalyst charges and watermarks', () => {
  const p = parseProfile(PROFILE);
  assert.deepEqual(p.currencies, { 3445: 100, 3446: 5 });
  assert.equal(p.catalystCharges, 2);
  assert.equal(p.watermarks[6], 300);
});

test('upgrade cost skips ranks at or below the slot watermark', () => {
  const p = parseProfile(PROFILE);
  const boots = p.bags[0];
  assert.deepEqual(upgradeTrack(boots), { group: 617, level: 3, max: 6, track: 'Hero', bonus: '12843' });
  // 315, 318, 321 are all above the feet watermark of 300.
  assert.deepEqual(upgradeCost(boots, 6, p.watermarks), { 3445: 60 });
  assert.deepEqual(upgradeCost(boots, 6, { 6: 318 }), { 3445: 20 });
  assert.equal(maxAffordableLevel(boots, { 3445: 45 }, p.watermarks), 5);
});

test('catalyst turns an eligible item into the class tier piece, keeping its stats', () => {
  const p = parseProfile(PROFILE);
  assert.equal(catalystTarget(p.equipped.shoulder, 'druid').id, 271526);
  const [cat] = deriveItems(p, [{ from: 'eq:shoulder', ops: ['catalyst'] }], { crests: p.currencies });
  assert.equal(itemLine('shoulder', cat.fields),
    'shoulder=,id=271526,enchant_id=8001,bonus_id=13440/6652/12699/12846/13694/13697,content_tuning=1279,redirected_base_stats=251223');
  assert.equal(cat.cost.catalyst, 1);
});

test('combinations stay within the crest and catalyst budget', () => {
  const p = parseProfile(PROFILE);
  const budget = { crests: { 3445: 100 }, catalyst: 0 };
  const extra = deriveItems(p, [
    { from: 'eq:finger1', ops: ['upgrade'] },
    { from: 'eq:finger2', ops: ['upgrade'] },
    { from: 'eq:shoulder', ops: ['catalyst'] },
  ], budget);
  // Each ring can afford 5 ranks (100 crests) alone, but not both together.
  assert.deepEqual(extra.slice(0, 2).map((it) => it.cost.crests[3445]), [100, 100]);
  const keys = extra.map((it) => it.key);
  const combos = buildCombos(p, keys, Infinity, { extra, budget });
  assert.ok(combos.length > 0);
  for (const { changes } of combos) {
    const items = changes.map(([, it]) => it);
    assert.ok(items.filter((it) => it.cost?.crests?.[3445]).length <= 1);
    assert.ok(!items.some((it) => it.cost?.catalyst));
  }
  assert.equal(countCombos(p, keys, { extra, budget }), combos.length);
});
