$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$distRoot = Join-Path $projectRoot "dist"
$serverRoot = Join-Path $distRoot "server"

New-Item -ItemType Directory -Force -Path $distRoot, $serverRoot | Out-Null

foreach ($asset in @("index.html", "app.js", "domain.js", "replenishment-workflow.js", "procurement-workflow.js", "master-data-workflow.js", "supplier-operations-workflow.js", "receiving-workflow.js", "workflow-status-dictionary.js", "workflow-validation.js", "styles.css")) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $asset) -Destination (Join-Path $distRoot $asset) -Force
}

Copy-Item -LiteralPath (Join-Path $projectRoot "worker\index.js") -Destination (Join-Path $serverRoot "index.js") -Force

Write-Output "Static Sites build ready: $distRoot"
