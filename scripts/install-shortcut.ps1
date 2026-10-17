# Adds a "SIMplicity" desktop shortcut.

$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'launch.ps1'
$desktop = [Environment]::GetFolderPath('Desktop')
$path = Join-Path $desktop 'SIMplicity.lnk'

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($path)
$link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$link.WorkingDirectory = $root
$link.IconLocation = "$env:SystemRoot\System32\imageres.dll,144"
$link.Description = 'Open SIMplicity (WoW gear simulator)'
$link.Save()

Write-Host "Created $path"
