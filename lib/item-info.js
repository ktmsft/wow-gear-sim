// Fills in names and item levels the export left out. The addon only writes the
// "Name (ilvl)" comment when the game has the item cached, which vault rewards often aren't.

import ICONS from './icons.js';
import { upgradeTrack, SEASON } from './upgrades.js';

export const fromVault = (item) => (item.from ?? item.key ?? '').startsWith('vault:');

export function fillItemInfo(parsed) {
  for (const item of [...Object.values(parsed.equipped), ...parsed.bags, ...parsed.vault]) {
    if (item.ilvl != null) continue;
    const name = ICONS.items[item.id]?.[2];
    if (name) item.name = name;
    const t = upgradeTrack(item);
    if (t) item.ilvl = SEASON.tracks[t.group].levels[t.level].ilvl;
  }
  return parsed;
}
