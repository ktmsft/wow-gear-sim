# Starts the server in the background if needed, then opens the page.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$port = if ($env:PORT) { $env:PORT } else { 8787 }
$url = "http://127.0.0.1:$port/"

function Test-Server {
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "${url}api/status" | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-Server)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
  if (-not (Test-Path $node)) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Node.js is not installed. Get it from https://nodejs.org', 'SIMplicity') | Out-Null
    exit 1
  }

  $log = Join-Path $env:LOCALAPPDATA 'wow-gear-sim\server.log'
  New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
  Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root `
    -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"

  for ($i = 0; $i -lt 40 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 250 }
}

Start-Process $url
