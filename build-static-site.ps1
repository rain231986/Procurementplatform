$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$distRoot = Join-Path $projectRoot "dist"
$serverRoot = Join-Path $distRoot "server"
$hostingRoot = Join-Path $distRoot ".openai"
$migrationRoot = Join-Path $hostingRoot "drizzle"

New-Item -ItemType Directory -Force -Path $distRoot, $serverRoot, $hostingRoot, $migrationRoot | Out-Null

foreach ($asset in @("index.html", "app.js", "cloudflare-client.js", "domain.js", "replenishment-workflow.js", "procurement-workflow.js", "master-data-workflow.js", "supplier-operations-workflow.js", "store-operations-workflow.js", "receiving-workflow.js", "workflow-status-dictionary.js", "workflow-validation.js", "styles.css", ".assetsignore")) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $asset) -Destination (Join-Path $distRoot $asset) -Force
}

Copy-Item -LiteralPath (Join-Path $projectRoot "worker\index.js") -Destination (Join-Path $serverRoot "index.js") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "worker\state-api.js") -Destination (Join-Path $serverRoot "state-api.js") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot ".openai\hosting.json") -Destination (Join-Path $hostingRoot "hosting.json") -Force
Copy-Item -Path (Join-Path $projectRoot "worker\migrations\*.sql") -Destination $migrationRoot -Force

Write-Output "Static Sites build ready: $distRoot"
