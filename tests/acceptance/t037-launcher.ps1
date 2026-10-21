param(
  [switch]$SimulationOnly,
  [switch]$RunTests,
  [switch]$RunPlaywright,
  [switch]$RunMockPlaywright,
  [switch]$UseBuild,
  [switch]$SkipNode,
  [switch]$SkipPostman,
  [string]$Grep,
  [string]$AppRoot,
  [int]$SimulationPort = 4900,
  [int]$BackendPort = 4630
)

$ErrorActionPreference = 'Stop'
$validation = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if ([string]::IsNullOrWhiteSpace($AppRoot)) {
  $AppRoot = $validation
}
$repo = (Resolve-Path $AppRoot).Path
$simulation = Join-Path $validation 'postman\simulations\supabase-local.sim.yaml'
$postmanEnv = Join-Path $validation 'postman\environments\acceptance-local.environment.yaml'
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$logDir = Join-Path $env:TEMP "t037-$stamp"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$simulationProcess = $null
$nextProcess = $null

function New-FakeJwt([string]$role, [string]$ref) {
  $header = [Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}')
  $payload = [Text.Encoding]::UTF8.GetBytes((@{ role = $role; ref = $ref; iss = 'supabase' } | ConvertTo-Json -Compress))
  $enc = { param($bytes) [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_') }
  return "$(& $enc $header).$(& $enc $payload).synthetic"
}

function Stop-OwnProcess([System.Diagnostics.Process]$process, [string]$name) {
  if ($null -eq $process) { return }
  try {
    if (-not $process.HasExited) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
      Write-Host "Stopped $name (PID $($process.Id))"
    }
  } catch {
    Write-Warning "Could not stop $name (PID $($process.Id)): $($_.Exception.Message)"
  }
}

function Wait-Http([string]$url, [int[]]$statuses, [int]$seconds, [string]$name) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3 -SkipHttpErrorCheck
      if ($statuses -contains [int]$response.StatusCode) {
        Write-Host "$name ready: HTTP $($response.StatusCode)"
        return
      }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw "$name did not become ready at $url"
}

function Reset-Standin {
  if (-not $SimulationOnly) {
    $resetUrl = "http://127.0.0.1:$SimulationPort/supabase/__reset"
    $response = Invoke-WebRequest $resetUrl -Method Post -UseBasicParsing -TimeoutSec 5 -SkipHttpErrorCheck
    if ($response.StatusCode -ne 204) { throw "Stand-in reset failed: HTTP $($response.StatusCode)" }
  }
}

try {
  Write-Host "Starting Postman Supabase stand-in on $SimulationPort..."
  $simulationProcess = Start-Process -FilePath 'postman.exe' `
    -ArgumentList @('simulation','run',$simulation,'--port',"$SimulationPort",'--output','ndjson') `
    -WorkingDirectory $repo -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'supabase.ndjson') `
    -RedirectStandardError (Join-Path $logDir 'supabase.err.log') `
    -PassThru

  Wait-Http "http://127.0.0.1:$SimulationPort/supabase/rest/v1/users?select=UserID&limit=0" @(200,206) 60 'Supabase stand-in'
  Reset-Standin

  if ($SimulationOnly) {
    $env:STANDIN_SUPABASE_URL = "http://127.0.0.1:$SimulationPort/supabase"
    node (Join-Path $validation 'tests\acceptance\t037-supabase-sdk-smoke.mjs')
    Write-Host "Simulation-only smoke PASS. Logs: $logDir"
    return
  }

  # The backend must already be integrated. These values are synthetic; there
  # is no .env read and no real Supabase credential.
  $serviceJwt = New-FakeJwt 'service_role' 'synthetic'
  $anonJwt = New-FakeJwt 'anon' 'synthetic'
  $childEnvironment = @{
    NODE_ENV = 'development'
    SUPABASE_URL = "http://127.0.0.1:$SimulationPort/supabase"
    SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_synthetic'
    SUPABASE_SERVICE_ROLE_KEY = $serviceJwt
    SUPABASE_SECRET_KEY = $anonJwt
    AUTH_SESSION_SECRET = ('ab' * 32)
    ENCRYPTION_SECRET_KEY = ('cd' * 32)
    ENCRYPTION_SECRET_KEY0 = ('ef' * 32)
    APP_ORIGIN = "http://localhost:$BackendPort"
    APP_ORIGINS = "http://localhost:$BackendPort"
    ACCEPTANCE_BASE_URL = "http://localhost:$BackendPort"
    ACCEPTANCE_RESET_URL = "http://127.0.0.1:$SimulationPort/supabase/__reset"
    ACCEPTANCE_STRICT_SEEDS = '1'
  }
  foreach ($entry in $childEnvironment.GetEnumerator()) {
    Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value
  }

  $nextCommand = if ($UseBuild) {
    "npm run start -- --port $BackendPort"
  } else {
    "npm run dev -- --port $BackendPort"
  }
  $nextMode = if ($UseBuild) { 'production build' } else { 'dev' }
  Write-Host "Starting Next backend on $BackendPort ($nextMode) with synthetic environment..."
  $nextProcess = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList @('/c',$nextCommand) `
    -WorkingDirectory $repo -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'next.out.log') `
    -RedirectStandardError (Join-Path $logDir 'next.err.log') `
    -PassThru

  Wait-Http "http://localhost:$BackendPort/login" @(200) 120 'Next frontend'
  Wait-Http "http://localhost:$BackendPort/api/auth/session" @(401) 120 'Backend session route'

  if ($RunTests) {
    if (-not $SkipNode) {
      Reset-Standin
      Write-Host "Running Node acceptance (15 tests, strict seeds, no skips)..."
      node (Join-Path $validation 'tests\acceptance\api.test.mjs')
      if ($LASTEXITCODE -ne 0) { throw "Node acceptance failed with exit code $LASTEXITCODE" }
    }

    if (-not $SkipPostman) {
      Reset-Standin
      Write-Host "Running Postman acceptance (22 requests)..."
      & postman collection run (Join-Path $validation 'postman\collections\acceptance-api') `
        -e $postmanEnv --env-var "baseUrl=http://localhost:$BackendPort"
      if ($LASTEXITCODE -ne 0) { throw "Postman acceptance failed with exit code $LASTEXITCODE" }
    }
  }

  # Playwright can run independently of Node/Postman so the final browser rerun
  # does not repeat unchanged API evidence.
  if ($RunPlaywright) {
    $realConfig = Join-Path $validation 'tests\acceptance\playwright.real.config.mjs'
    $realArgs = @('test', '--config', $realConfig)
    if ($Grep) { $realArgs += @('--grep', $Grep) }
    Write-Host "Running Playwright backend-real (2 tests)..."
    & (Join-Path $repo 'node_modules\.bin\playwright.cmd') @realArgs
    if ($LASTEXITCODE -ne 0) { throw "Playwright real acceptance failed with exit code $LASTEXITCODE" }
  }

  if ($RunMockPlaywright) {
    $mockConfig = Join-Path $validation 'tests\acceptance\playwright.mock.config.mjs'
    $mockArgs = @('test', '--config', $mockConfig)
    if ($Grep) { $mockArgs += @('--grep', $Grep) }
    Write-Host "Running Playwright frontend-mock (10 tests) against the same Root server..."
    & (Join-Path $repo 'node_modules\.bin\playwright.cmd') @mockArgs
    if ($LASTEXITCODE -ne 0) { throw "Playwright mock acceptance failed with exit code $LASTEXITCODE" }
  }

  if (-not $RunTests -and -not $RunPlaywright -and -not $RunMockPlaywright) {
    Write-Host "Services ready. Re-run with -RunTests, -RunPlaywright or -RunMockPlaywright after integration notice."
  }
}
finally {
  Stop-OwnProcess $nextProcess 'Next backend'
  Stop-OwnProcess $simulationProcess 'Supabase stand-in'
  Write-Host "T037 logs: $logDir"
}
