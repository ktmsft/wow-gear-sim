# Gear Sim

A local "Top Gear" for World of Warcraft. Paste your SimulationCraft addon export and it sims your gear, gems, consumables and talent loadouts with [SimulationCraft](https://github.com/simulationcraft/simc), then ranks them by DPS.

It works for any class and spec. Everything comes from your export, and runs entirely on your PC with no limits.

## Features

- **Gear:** every valid combination of equipped and bag items. Rings and trinkets are tried in both slots, and unique items are never doubled.
- **Gems:** every way to fill your sockets with the gems you tick, plus diamond swaps.
- **Consumables:** food, flask, potion, weapon oil and augment rune.
- **Talents:** your saved loadouts from the export.
- **Smart sim:** a quick pass over everything, then the best are re-simmed at full precision.
- **Results:** a recommended combination, a profile you can copy to double-check on Raidbots, and a time estimate before you start.

## Setup (Windows)

1. Install the tools (one time):

   ```powershell
   winget install OpenJS.NodeJS.LTS Git.Git Kitware.CMake
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```

2. Get the project and build the sim engine. The first build takes 10–20 minutes.

   ```powershell
   git clone https://github.com/ktmsft/wow-gear-sim
   cd wow-gear-sim
   powershell -ExecutionPolicy Bypass -File scripts\build-simc.ps1
   ```

3. Add a desktop shortcut:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\install-shortcut.ps1
   ```

   Double-click **Gear Sim** to start it and open the page. Or run `npm start` and go to http://127.0.0.1:8787.

On macOS or Linux, build simc with CMake (`cmake -S simc-src -B build -DBUILD_GUI=OFF && cmake --build build --target simc`). Then either copy the binary to `simc/simc` or set `SIMC_PATH`, and run `npm start`.

## Simming your character

1. Install the **SimulationCraft** addon from [CurseForge](https://www.curseforge.com/wow/addons/simulationcraft) or Wago.
2. In game, type `/simc` and copy all the text in the window that opens. Include the bag items: those are what the tool compares.
3. Paste it into the page. It reads your class, spec, talents, gear and saved loadouts.
4. Tick the bag items, gems, consumables and loadouts you want to try, then pick a fight style and click **Run sim**.

"SimC default for your spec" uses SimulationCraft's recommended consumables for your class and spec.

## Keeping it current

After a WoW patch or hotfix, rerun `scripts\build-simc.ps1`. The page shows this command, with a copy button, under **Updating SimulationCraft**. No restart is needed.

The gem and consumable lists are in `lib/catalog.js`, for Midnight (patch 12.1). Update them when a new season adds items.

## Settings

| Variable | Default | |
|---|---|---|
| `PORT` | `8787` | |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` to allow other devices on your network |
| `SIMC_PATH` | `simc/simc.exe` | |
| `SIM_THREADS` | all cores | |

## Tests

```powershell
npm test
```
