[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$AppRoot,
  [string]$BaseUrl = 'http://127.0.0.1:4611',
  [string]$OutputDir = '',
  [switch]$StartApp,
  [string]$PlaywrightCli = ''
)

$ErrorActionPreference = 'Stop'

$parameters = @{
  Mode = 'candidate'
  AppRoot = $AppRoot
  BaseUrl = $BaseUrl
  Workers = 2
  MaxFailures = 1
}
if ($OutputDir) { $parameters.OutputDir = $OutputDir }
if ($PlaywrightCli) { $parameters.PlaywrightCli = $PlaywrightCli }
if ($StartApp) {
  $parameters.StartApp = $true
  $parameters.AppRoot = $AppRoot
} else {
  # Refuse to test an incomplete worktree. Orchestrator must start the integrated app.
  $parameters.NoStart = $true
}

& (Join-Path $PSScriptRoot 'run-visual.ps1') @parameters
exit $LASTEXITCODE
