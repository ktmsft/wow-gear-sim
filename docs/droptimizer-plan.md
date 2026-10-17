# Droptimizer plan

Goal: answer "which dungeon or raid boss has the best loot for me?" the way Raidbots' Droptimizer does, but locally and without limits. Planned for a later release.

## What it needs

SimulationCraft knows how to sim any item from its ID and bonus IDs. It doesn't know which items drop where, so SIMulacrum needs loot tables.

- **Loot tables:** Raidbots publishes `instances.json` (dungeons, raids, bosses and their item IDs) and `equippable-items.json` in the same public data we already use for upgrade tracks. `scripts/update-season-data.mjs` would pull the current season's slice into a new generated file, `lib/loot.js`, next to `lib/season.js`.
- **Item levels per difficulty:** each source maps to a track and rank (for example Mythic+ 10 end of dungeon is Hero 1/6, Mythic raid is Myth 1/6). We'd generate this map from the same data, with a small hand-kept table for anything Raidbots doesn't encode.
- **Class filtering:** drop items the character can't use (armor type, main stat, weapon types), using the item's class and subclass from `equippable-items.json`.

## How a run works

1. The user picks sources: Mythic+ (with a keystone level), raid (with difficulty), or both. Optionally: "use my upgrade crests" to also sim each drop at the rank they could afford.
2. For each eligible item, build the item line with the bonus IDs for that difficulty, borrowing the enchant from the item it replaces (as Top Gear already does).
3. Rings and trinkets are tried in both slots, like the Great Vault mode. Each drop is simmed as a single swap, so this is one variant per item and slot.
4. Run through the existing smart sim, so a few hundred items cost about the same as a normal Top Gear run.

## Results

- One row per source (dungeon or boss), ranked by its best upgrade, then by how many drops are upgrades.
- Expanding a source shows each upgrade with its slot, item level and DPS gain, plus a link to Wowhead.
- A summary at the top: "Best dungeon to run: X (3 upgrades, best +1,240)".

## Code changes

- `scripts/update-season-data.mjs`: also write `lib/loot.js`.
- `lib/modes.js`: `dropVariants(parsed, sources, options)`.
- `server.js`: a `drops` mode that groups rows by source.
- `public/analysis.js`: `dropsHtml()`, plus a source picker in the More sims card.
- Tests: loot filtering by class and armor type, the bonus IDs for each difficulty, and grouping by source.

## Open questions

- Catalyst: should a drop also be tried as its catalyst tier piece when the player has charges?
- Bonus sockets and tertiary stats are random; we'd sim the base item and say so.
- World bosses, delves and crafted gear could come later as extra sources.
