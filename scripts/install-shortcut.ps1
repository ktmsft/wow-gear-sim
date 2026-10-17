# Adds a "SIMulacrum" desktop shortcut.

$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'launch.ps1'
$desktop = [Environment]::GetFolderPath('Desktop')
$path = Join-Path $desktop 'SIMulacrum.lnk'

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($path)
$link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$link.WorkingDirectory = $root
$link.IconLocation = Join-Path $root 'packaging\simulacrum.ico'
$link.Description = 'Open SIMulacrum (WoW gear simulator)'
$link.Save()

Write-Host "Created $path"
