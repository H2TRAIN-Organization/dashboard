[CmdletBinding()]
param(
  [ValidateSet('baseline', 'candidate')]
  [string]$Mode = 'baseline',
  [string]$BaseUrl = '',
  [int]$Port = 0,
  [string]$AppRoot = '',
  [string]$OutputDir = '',
  [string]$SourceRoot = '',
  [switch]$NoStart,
  [switch]$StartApp,
  [switch]$KeepServer,
  [switch]$NoWarmup,
  [string]$BrowserChannel = 'chrome',
  [string]$PlaywrightCli = '',
  [string]$Grep = '',
  [int]$Workers = 2,
  [int]$MaxFailures = 1
)

$ErrorActionPreference = 'Stop'

$VisualRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ValidationRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$TempRoot = Join-Path $env:TEMP 'opencode\t013-visual'

if (-not $Port) { $Port = if ($Mode -eq 'baseline') { 4610 } else { 4611 } }
if (-not $BaseUrl) { $BaseUrl = "http://127.0.0.1:$Port" }
if (-not $AppRoot) {
  throw "AppRoot is required. Portable example: git worktree add --detach <BASELINE_DIR> 8ed4a3d; cd <BASELINE_DIR>; npm ci; then pass -AppRoot <BASELINE_DIR> (baseline) or -AppRoot <INTEGRATED_DIR> (candidate)."
}
if (-not $SourceRoot) { $SourceRoot = $AppRoot }
if (-not $OutputDir) {
  # Ignored local output under tests/visual/.output, never a machine-specific path.
  $OutputDir = Join-Path $VisualRoot (Join-Path '.output' $Mode)
}

$AppRoot = (Resolve-Path $AppRoot).Path
$SourceRoot = (Resolve-Path $SourceRoot).Path
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $TempRoot, $OutputDir | Out-Null

if (-not $PlaywrightCli) {
  $PlaywrightCli = @(
    (Join-Path $VisualRoot 'node_modules\@playwright\test\cli.js'),
    (Join-Path $ValidationRoot 'node_modules\@playwright\test\cli.js')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $PlaywrightCli -or -not (Test-Path $PlaywrightCli)) {
  throw "Playwright dependencies not found. Run 'npm ci' in $ValidationRoot so tests/visual can resolve @playwright/test. -PlaywrightCli only overrides the CLI binary."
}
$PlaywrightCli = (Resolve-Path $PlaywrightCli).Path
$ConfigPath = Join-Path $VisualRoot 'playwright.visual.config.ts'
$PidFile = Join-Path $TempRoot "$Mode-$Port.pid"
$StartedByUs = $false
$ServerPid = $null
$InitialTsconfigDirty = $false
$InitialAgentsExists = $false
$PlaywrightExit = 1
$StartedAt = (Get-Date).ToUniversalTime().ToString('o')

function Wait-App {
  param([string]$Url, [int]$Seconds = 150)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
      if ($response.StatusCode -gt 0) { return $true }
    } catch {
      # A 500 still proves Next dev is reachable (legacy login page does this).
      if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { return $true }
    }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Stop-OwnedApp {
  param([int]$ProcessId, [string]$Root, [int]$LocalPort)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  $command = [string]$process.CommandLine
  if ($command.Contains($Root) -and $command.Contains("--port $LocalPort")) {
    & taskkill /PID $ProcessId /T /F | Out-Null
    return $true
  }
  Write-Warning "Refusing to stop PID ${ProcessId}: command line does not match this runner."
  return $false
}

try {
  if (-not (Test-Path (Join-Path $AppRoot 'node_modules\next\dist\bin\next'))) {
    $hint = if ($Mode -eq 'baseline') {
      "Run 'npm ci --no-audit --no-fund' in $AppRoot so the baseline uses its lockfile (Next 15.4.6 / React 19.1 / Supabase 2.54), never the newer root node_modules."
    } else {
      'Candidate must use its own installed dependencies.'
    }
    throw "Next.js is not installed under $AppRoot. $hint"
  }

  if (Test-Path (Join-Path $AppRoot '.git')) {
    $InitialTsconfigDirty = [bool](git -C $AppRoot status --porcelain -- tsconfig.json)
    $InitialAgentsExists = Test-Path (Join-Path $AppRoot 'AGENTS.md')
  }

  $alreadyListening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  $shouldStart = if ($Mode -eq 'baseline') { -not $NoStart } else { [bool]$StartApp -and -not $NoStart }

  if ($shouldStart) {
    if ($alreadyListening) {
      throw "Port $Port is already in use (PID $($alreadyListening[0].OwningProcess)). Refusing to touch an unowned process."
    }

    # .next is generated output, never source. A stale cache caused hydration hangs.
    Remove-Item -Recurse -Force (Join-Path $AppRoot '.next') -ErrorAction SilentlyContinue

    $stdout = Join-Path $TempRoot "$Mode-$Port.out.log"
    $stderr = Join-Path $TempRoot "$Mode-$Port.err.log"
    $node = (Get-Command node).Source
    $next = Join-Path $AppRoot 'node_modules\next\dist\bin\next'
    $nodeModules = Get-Item (Join-Path $AppRoot 'node_modules') -Force -ErrorAction Stop
    $isJunction = [bool]($nodeModules.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
    $bundlerFlag = if ($isJunction) { '--webpack' } else { '--turbopack' }
    $arguments = @($next, 'dev', $bundlerFlag, '--port', "$Port", '--hostname', '127.0.0.1')
    $env:NEXT_TELEMETRY_DISABLED = '1'

    $process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $AppRoot `
      -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $ServerPid = $process.Id
    $StartedByUs = $true
    Set-Content -Path $PidFile -Value $ServerPid -Encoding ascii
    Write-Host "Started $Mode server PID=$ServerPid port=$Port bundler=$bundlerFlag root=$AppRoot (hidden; logs in $TempRoot)"
  } elseif (-not (Wait-App -Url "$BaseUrl/" -Seconds 5)) {
    $message = if ($Mode -eq 'candidate') {
      "Candidate app is not reachable at $BaseUrl. The integrated frontend must be started by the orchestrator on port $Port (or pass -StartApp -AppRoot ...). Refusing to test an incomplete worktree."
    } else {
      "Baseline app is not reachable at $BaseUrl and -NoStart was requested."
    }
    throw $message
  }

  if (-not (Wait-App -Url "$BaseUrl/" -Seconds 150)) {
    $errLog = Join-Path $TempRoot "$Mode-$Port.err.log"
    $tail = if (Test-Path $errLog) { Get-Content $errLog -Tail 25 | Out-String } else { '' }
    throw "App did not become reachable at $BaseUrl. Last stderr:`n$tail"
  }

  if (-not $NoWarmup) {
    # Compile each route sequentially before parallel capture. Local dev routes only.
    foreach ($path in @('/', '/users', '/data', '/analytics', '/overview', '/admin', '/admin/database', '/login', '/app-login')) {
      try {
        Invoke-WebRequest -Uri "$BaseUrl$path" -UseBasicParsing -TimeoutSec 45 | Out-Null
      } catch {
        # Legacy login routes intentionally return 500; warmup records reachability only.
      }
    }
  }

  $commit = try { (git -C $AppRoot rev-parse HEAD).Trim() } catch { '' }
  Push-Location $AppRoot
  try {
    $appVersions = [ordered]@{
      next = (& node -p "require('./node_modules/next/package.json').version").Trim()
      react = (& node -p "require('./node_modules/react/package.json').version").Trim()
      supabase = (& node -p "require('./node_modules/@supabase/supabase-js/package.json').version").Trim()
    }
  } finally {
    Pop-Location
  }
  Write-Host ("Dependencies: next={0} react={1} supabase={2}" -f $appVersions.next, $appVersions.react, $appVersions.supabase)

  $env:VISUAL_BASE_URL = $BaseUrl
  $env:VISUAL_OUTPUT_DIR = $OutputDir
  $env:VISUAL_SOURCE_ROOT = $SourceRoot
  $env:VISUAL_PROJECT_LABEL = "$Mode-$commit"
  $env:VISUAL_SOURCE_COMMIT = $commit
  $env:VISUAL_SERVER_PID = if ($ServerPid) { "$ServerPid" } else { '' }
  $env:VISUAL_BROWSER_CHANNEL = $BrowserChannel

  Push-Location $ValidationRoot
  try {
    $playwrightArgs = @($PlaywrightCli, 'test', '--config', $ConfigPath)
    if ($Grep) { $playwrightArgs += @('--grep', $Grep) }
    if ($Workers -gt 0) { $playwrightArgs += @('--workers', "$Workers") }
    if ($MaxFailures -gt 0) { $playwrightArgs += @('--max-failures', "$MaxFailures") }
    & node @playwrightArgs
    $PlaywrightExit = $LASTEXITCODE
  } finally {
    Pop-Location
  }
} catch {
  Write-Error $_.Exception.Message
  $PlaywrightExit = 2
} finally {
  $stopped = $false
  if ($StartedByUs -and -not $KeepServer -and $ServerPid) {
    $stopped = Stop-OwnedApp -ProcessId $ServerPid -Root $AppRoot -LocalPort $Port
    if ($stopped) { Write-Host "Stopped owned server PID=$ServerPid" }
    Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
  }

  if (Test-Path (Join-Path $AppRoot '.git')) {
    # Next dev may auto-rewrite tsconfig or create AGENTS.md. Restore only
    # generated changes when the candidate/baseline tree started clean.
    if (-not $InitialTsconfigDirty) {
      & git -C $AppRoot checkout -- tsconfig.json 2>$null
    }
    if (-not $InitialAgentsExists) {
      Remove-Item -Force (Join-Path $AppRoot 'AGENTS.md') -ErrorAction SilentlyContinue
    }
  }

  $meta = [ordered]@{
    mode = $Mode
    baseUrl = $BaseUrl
    port = $Port
    appRoot = $AppRoot
    sourceRoot = $SourceRoot
    outputDir = $OutputDir
    appVersions = $appVersions
    serverPid = $ServerPid
    startedByRunner = $StartedByUs
    stoppedByRunner = $stopped
    keepServer = [bool]$KeepServer
    playwrightExit = $PlaywrightExit
    startedAt = $StartedAt
    finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  $meta | ConvertTo-Json | Set-Content -Path (Join-Path $OutputDir 'run-meta.json') -Encoding utf8
  Write-Host ("FINAL mode={0} exit={1} serverPid={2} output={3}" -f $Mode, $PlaywrightExit, $ServerPid, $OutputDir)
}

exit $PlaywrightExit
