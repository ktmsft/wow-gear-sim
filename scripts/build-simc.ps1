# Builds simc.exe from the latest SimulationCraft source into simc\. Rerun after patches.
# Needs CMake and the VS C++ Build Tools (see README).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
# Build outside the project folder to keep it small.
$work = Join-Path $env:LOCALAPPDATA 'wow-gear-sim'
$src = Join-Path $work 'simc-src'
$build = Join-Path $work 'simc-build'
$dest = Join-Path $root 'simc'

$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (-not $cmake) { $cmake = Join-Path $env:ProgramFiles 'CMake\bin\cmake.exe' }
if (-not (Test-Path $cmake)) { throw 'CMake not found. Run: winget install Kitware.CMake' }

New-Item -ItemType Directory -Force $work | Out-Null
if (Test-Path (Join-Path $src '.git')) {
  Write-Host 'Updating SimulationCraft source...'
  git -C $src fetch --depth 1 origin
  git -C $src reset --hard FETCH_HEAD
} else {
  Write-Host 'Downloading SimulationCraft source...'
  git clone --depth 1 https://github.com/simulationcraft/simc $src
}

Write-Host 'Configuring...'
& $cmake -S $src -B $build -G 'Visual Studio 17 2022' -A x64 -DBUILD_GUI=OFF -DBUILD_TESTING=OFF
if ($LASTEXITCODE) { throw 'CMake configure failed. Are the Visual Studio C++ Build Tools installed?' }

Write-Host 'Compiling (this takes a while the first time)...'
& $cmake --build $build --config Release --target simc --parallel
if ($LASTEXITCODE) { throw 'Build failed.' }

$exe = Get-ChildItem -Path $build -Recurse -Filter 'simc.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw 'Build finished but simc.exe was not found.' }
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item $exe.FullName (Join-Path $dest 'simc.exe') -Force

& (Join-Path $dest 'simc.exe') | Select-Object -First 1
Write-Host "Installed to $dest"
