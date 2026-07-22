$ErrorActionPreference = "SilentlyContinue"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root ".local-server.pid"

if (-not (Test-Path $PidFile)) {
  Write-Host "No local server pid file found."
  exit 0
}

$serverPid = Get-Content $PidFile
$process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $serverPid
  Write-Host "Local server stopped."
} else {
  Write-Host "Local server was not running."
}

Remove-Item $PidFile -Force
