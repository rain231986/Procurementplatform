$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 8787
$PidFile = Join-Path $Root ".local-server.pid"
$LogFile = Join-Path $Root ".local-server.log"

if (Test-Path $PidFile) {
  $existingPid = Get-Content $PidFile -ErrorAction SilentlyContinue
  if ($existingPid) {
    $existing = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($existing -and $listening) {
      Write-Host "Local server is already running: http://localhost:$Port/"
      exit 0
    }
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

$serverScript = Join-Path $Root ".local-server-runtime.ps1"

@'
$ErrorActionPreference = "Stop"
$Root = $args[0]
$Port = [int]$args[1]
$LogFile = $args[2]

Add-Type -AssemblyName System.Net
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

function Get-ContentType($path) {
  switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8"; break }
    ".css" { "text/css; charset=utf-8"; break }
    ".js" { "application/javascript; charset=utf-8"; break }
    ".json" { "application/json; charset=utf-8"; break }
    ".svg" { "image/svg+xml"; break }
    ".png" { "image/png"; break }
    ".jpg" { "image/jpeg"; break }
    ".jpeg" { "image/jpeg"; break }
    ".ico" { "image/x-icon"; break }
    default { "application/octet-stream" }
  }
}

function Send-Response($stream, $status, $contentType, [byte[]]$body) {
  $reason = if ($status -eq 200) { "OK" } elseif ($status -eq 404) { "Not Found" } else { "Server Error" }
  $header = "HTTP/1.1 $status $reason`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  $stream.Write($body, 0, $body.Length)
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $buffer = New-Object byte[] 8192
    $read = $stream.Read($buffer, 0, $buffer.Length)
    $request = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
    $line = ($request -split "`r?`n")[0]
    $parts = $line -split " "
    $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { "/" }
    $pathOnly = ($rawPath -split "\?")[0]
    $decoded = [System.Uri]::UnescapeDataString($pathOnly).TrimStart("/")
    if ([string]::IsNullOrWhiteSpace($decoded)) { $decoded = "index.html" }
    $decoded = $decoded -replace "/", [System.IO.Path]::DirectorySeparatorChar
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $decoded))
    $rootFull = [System.IO.Path]::GetFullPath($Root)

    if (-not $fullPath.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $fullPath -PathType Leaf)) {
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
      Send-Response $stream 404 "text/plain; charset=utf-8" $body
    } else {
      $body = [System.IO.File]::ReadAllBytes($fullPath)
      Send-Response $stream 200 (Get-ContentType $fullPath) $body
    }
  } catch {
    Add-Content -Path $LogFile -Value "$(Get-Date -Format s) $($_.Exception.Message)"
  } finally {
    $client.Close()
  }
}
'@ | Set-Content -Path $serverScript -Encoding UTF8

$process = Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$serverScript`"",
  "`"$Root`"",
  "$Port",
  "`"$LogFile`""
) -WindowStyle Hidden -PassThru

$process.Id | Set-Content -Path $PidFile -Encoding ASCII
Start-Sleep -Milliseconds 700
Write-Host "Local server started: http://localhost:$Port/"
