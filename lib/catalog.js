// Midnight gems and consumables, verified against SimulationCraft 1210-01.

export const STAT_SHORT = { crit: 'Crit', haste: 'Haste', mastery: 'Mast', vers: 'Vers' };

// Color sets the 16-point stat; the prefix adds 7 of another.
export const GEM_COLORS = {
  garnet: { stat: 'crit', label: 'Garnet' },
  peridot: { stat: 'haste', label: 'Peridot' },
  amethyst: { stat: 'mastery', label: 'Amethyst' },
  lapis: { stat: 'vers', label: 'Lapis' },
};

const gem = (id, name, color, sub) => {
  const main = GEM_COLORS[color].stat;
  const label = sub === main ? `17 ${STAT_SHORT[main]}` : `16 ${STAT_SHORT[main]} & 7 ${STAT_SHORT[sub]}`;
  return { id: String(id), name, color, main, sub, label };
};

export const GEMS = [
  gem(240904, 'Flawless Deadly Garnet', 'garnet', 'crit'),
  gem(240906, 'Flawless Quick Garnet', 'garnet', 'haste'),
  gem(240908, 'Flawless Masterful Garnet', 'garnet', 'mastery'),
  gem(240910, 'Flawless Versatile Garnet', 'garnet', 'vers'),
  gem(240888, 'Flawless Quick Peridot', 'peridot', 'haste'),
  gem(240890, 'Flawless Deadly Peridot', 'peridot', 'crit'),
  gem(240892, 'Flawless Masterful Peridot', 'peridot', 'mastery'),
  gem(240894, 'Flawless Versatile Peridot', 'peridot', 'vers'),
  gem(240896, 'Flawless Masterful Amethyst', 'amethyst', 'mastery'),
  gem(240898, 'Flawless Deadly Amethyst', 'amethyst', 'crit'),
  gem(240900, 'Flawless Quick Amethyst', 'amethyst', 'haste'),
  gem(240902, 'Flawless Versatile Amethyst', 'amethyst', 'vers'),
  gem(240912, 'Flawless Versatile Lapis', 'lapis', 'vers'),
  gem(240914, 'Flawless Deadly Lapis', 'lapis', 'crit'),
  gem(240916, 'Flawless Quick Lapis', 'lapis', 'haste'),
  gem(240918, 'Flawless Masterful Lapis', 'lapis', 'mastery'),
];

// Unique-equipped; all give primary stat.
export const DIAMONDS = [
  { id: '240967', name: 'Powerful Eversong Diamond', label: 'Powerful', note: 'Crit damage per gem color' },
  { id: '240983', name: 'Indecipherable Eversong Diamond', label: 'Indecipherable', note: 'Primary stat only' },
  { id: '240969', name: 'Telluric Eversong Diamond', label: 'Telluric', note: 'Mana per gem color' },
  { id: '240971', name: 'Stoic Eversong Diamond', label: 'Stoic', note: 'Armor' },
];

export const GEM_BY_ID = Object.fromEntries([...GEMS, ...DIAMONDS].map((g) => [g.id, g]));
export const isDiamond = (id) => DIAMONDS.some((d) => d.id === String(id));

// Values are simc consumable names; "_2" is top quality.
export const CONSUMABLES = {
  food: {
    label: 'Food',
    option: 'food',
    items: [
      { value: 'harandar_celebration', label: '52 Primary stat', name: 'Harandar Celebration' },
      { value: 'amani_cornucopia', label: '71 Highest secondary', name: 'Amani Cornucopia' },
      { value: 'blooming_feast', label: '65 Highest secondary', name: 'Blooming Feast' },
      { value: 'arcano_cutlets', label: '58 Crit', name: 'Arcano Cutlets' },
      { value: 'crimson_calamari', label: '58 Haste', name: 'Crimson Calamari' },
      { value: 'glitter_skewers', label: '58 Mastery', name: 'Glitter Skewers' },
      { value: 'braised_blood_hunter', label: '58 Versatility', name: 'Braised Blood Hunter' },
      { value: 'hearthflame_supper', label: '22 Crit & 22 Haste', name: 'Hearthflame Supper' },
      { value: 'eversong_pudding', label: '22 Crit & 22 Mastery', name: 'Eversong Pudding' },
      { value: 'wise_tails', label: '22 Crit & 22 Vers', name: 'Wise Tails' },
      { value: 'bloodthistlewrapped_cutlets', label: '22 Haste & 22 Mastery', name: 'Bloodthistle-Wrapped Cutlets' },
      { value: 'sunwell_delight', label: '22 Haste & 22 Vers', name: 'Sunwell Delight' },
      { value: 'fried_bloomtail', label: '22 Mastery & 22 Vers', name: 'Fried Bloomtail' },
    ],
  },
  flask: {
    label: 'Flask',
    option: 'flask',
    items: [
      { value: 'flask_of_the_shattered_sun_2', label: 'Shattered Sun', name: '165 Crit' },
      { value: 'flask_of_the_blood_knights_2', label: 'Blood Knights', name: '165 Haste' },
      { value: 'flask_of_the_magisters_2', label: 'Magisters', name: '165 Mastery' },
      { value: 'flask_of_thalassian_resistance_2', label: 'Thalassian Resistance', name: '165 Versatility' },
    ],
  },
  potion: {
    label: 'Potion',
    option: 'potion',
    items: [
      { value: 'lights_potential_2', label: "Light's Potential", name: 'Primary stat' },
      { value: 'draught_of_rampant_abandon_2', label: 'Draught of Rampant Abandon', name: 'Primary stat, void zone' },
      { value: 'potion_of_recklessness_2', label: 'Potion of Recklessness', name: '+Highest / −lowest secondary' },
      { value: 'liquid_luster_2', label: 'Liquid Luster', name: 'Versatility' },
      { value: 'alluring_nostrum_2', label: 'Alluring Nostrum', name: 'Shadow damage procs' },
      { value: 'potion_of_zealotry_2', label: 'Potion of Zealotry', name: 'Holy damage procs' },
    ],
  },
  oil: {
    label: 'Weapon oil',
    option: 'temporary_enchant',
    items: [
      { value: 'thalassian_phoenix_oil_2', label: 'Thalassian Phoenix Oil', name: 'Crit & Haste' },
      { value: 'smugglers_enchanted_edge_2', label: "Smuggler's Enchanted Edge", name: 'Arcane damage procs' },
      { value: 'oil_of_dawn_2', label: 'Oil of Dawn', name: 'Healer shields' },
    ],
  },
  rune: {
    label: 'Augment rune',
    option: 'augmentation',
    items: [
      { value: 'void_touched', label: 'Void-Touched Augment Rune', name: 'Primary stat' },
    ],
  },
};

// 'default' keeps simc's spec default.
export function consumableLine(kind, value, hasOffHand) {
  const cat = CONSUMABLES[kind];
  if (!cat || value === 'default') return null;
  if (value === 'none') return `${cat.option}=disabled`;
  if (!cat.items.some((i) => i.value === value)) return null;
  if (kind === 'oil') {
    return `temporary_enchant=main_hand:${value}${hasOffHand ? `/off_hand:${value}` : ''}`;
  }
  return `${cat.option}=${value}`;
}
