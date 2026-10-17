// Parses a /simc addon export. Shared by the server and the browser.

export const ITEM_SLOTS = [
  'head', 'neck', 'shoulder', 'back', 'chest', 'shirt', 'tabard', 'wrist', 'hands',
  'waist', 'legs', 'feet', 'finger1', 'finger2', 'trinket1', 'trinket2', 'main_hand', 'off_hand',
];

// Cosmetic slots.
export const IGNORED_SLOTS = new Set(['shirt', 'tabard']);

// Items here can go in either slot.
export const PAIR_GROUPS = { finger: ['finger1', 'finger2'], trinket: ['trinket1', 'trinket2'] };

export const GROUPS = [
  'head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist',
  'legs', 'feet', 'finger', 'trinket', 'main_hand', 'off_hand',
];

export const GROUP_LABELS = {
  head: 'Head', neck: 'Neck', shoulder: 'Shoulders', back: 'Back', chest: 'Chest',
  wrist: 'Wrists', hands: 'Hands', waist: 'Waist', legs: 'Legs', feet: 'Feet',
  finger: 'Rings', trinket: 'Trinkets', main_hand: 'Main Hand', off_hand: 'Off Hand',
};

const ITEM_LINE = new RegExp(`^(${ITEM_SLOTS.join('|')})=(.*)$`);
const NAME_LINE = /^(.+?)\s*\((\d+)\)\s*$/;

export function groupOf(slot) {
  if (slot.startsWith('finger')) return 'finger';
  if (slot.startsWith('trinket')) return 'trinket';
  return slot;
}

// ",id=1,enchant_id=2" -> [['id','1'],['enchant_id','2']]
function parseFields(value) {
  return value.split(',').slice(1).filter(Boolean).map((part) => {
    const eq = part.indexOf('=');
    return eq === -1 ? [part, ''] : [part.slice(0, eq), part.slice(eq + 1)];
  });
}

function makeItem(key, slot, value, meta, equipped) {
  const fields = parseFields(value);
  const get = (k) => fields.find(([f]) => f === k)?.[1];
  return {
    key,
    slot,
    group: groupOf(slot),
    name: meta?.name ?? `Item ${get('id') ?? '?'}`,
    ilvl: meta ? Number(meta.ilvl) : null,
    id: get('id') ?? null,
    bonusIds: get('bonus_id') ?? '',
    fields,
    equipped,
  };
}

export function itemLine(slot, fields) {
  return `${slot}=,${fields.map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(',')}`;
}

export function parseProfile(text) {
  const result = {
    charLines: [],
    className: null,
    name: null,
    spec: null,
    talents: null,
    loadouts: [],
    equipped: {},
    bags: [],
  };

  let section = 'main';
  let pendingName = null;
  let pendingLoadout = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('###')) {
      section = /gear from bags/i.test(line) ? 'bags' : 'other';
      pendingName = null;
      continue;
    }

    if (line.startsWith('#')) {
      const body = line.replace(/^#+\s?/, '').trim();
      if (!body) continue;

      const loadout = body.match(/^Saved Loadout:\s*(.+)$/i);
      if (loadout) { pendingLoadout = loadout[1].trim(); continue; }

      if (pendingLoadout && body.startsWith('talents=')) {
        result.loadouts.push({ name: pendingLoadout, talents: body.slice('talents='.length) });
        pendingLoadout = null;
        continue;
      }

      const item = body.match(ITEM_LINE);
      if (item && section === 'bags') {
        if (!IGNORED_SLOTS.has(item[1])) {
          result.bags.push(makeItem(`bag:${result.bags.length}`, item[1], item[2], pendingName, false));
        }
        pendingName = null;
        continue;
      }

      const named = body.match(NAME_LINE);
      if (named && !body.includes('=')) pendingName = { name: named[1], ilvl: named[2] };
      continue;
    }

    const item = line.match(ITEM_LINE);
    if (item) {
      result.equipped[item[1]] = makeItem(`eq:${item[1]}`, item[1], item[2], pendingName, true);
      pendingName = null;
      continue;
    }

    pendingName = null;
    result.charLines.push(line);
    const eq = line.indexOf('=');
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1).replace(/^"|"$/g, '');
    if (CLASS_KEYS.has(key)) { result.className = key; result.name = value; }
    if (key === 'spec') result.spec = value;
    if (key === 'talents') result.talents = value;
  }

  return result;
}

export const CLASS_KEYS = new Set([
  'deathknight', 'demonhunter', 'druid', 'evoker', 'hunter', 'mage', 'monk',
  'paladin', 'priest', 'rogue', 'shaman', 'warlock', 'warrior',
]);
