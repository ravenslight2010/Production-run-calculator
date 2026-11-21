#Requires -Version 5.1
# Legacy entrypoint — forwards to short scripts/ca/setup.ps1
param(
  [string]$RepoRoot = "",
  [string]$ReportPath = "",
  [string]$AgentRoot = "C:\runcalc\agent",
  [switch]$SkipOllamaInstall,
  [switch]$SkipOpenCodeInstall,
  [switch]$SkipModelPull,
  [switch]$SkipNodeInstall,
  [switch]$UseFixture,
  [switch]$LaunchChat,
  [switch]$NoLaunch
)
$setup = Join-Path $PSScriptRoot "..\..\ca\setup.ps1"
$setup = [IO.Path]::GetFullPath($setup)
if (-not (Test-Path -LiteralPath $setup)) { throw "Missing $setup" }
$forward = @{
  RepoRoot = $RepoRoot
  ReportPath = $ReportPath
  AgentRoot = $AgentRoot
  SkipOllamaInstall = $SkipOllamaInstall
  SkipOpenCodeInstall = $SkipOpenCodeInstall
  SkipModelPull = $SkipModelPull
  SkipNodeInstall = $SkipNodeInstall
  UseFixture = $UseFixture
  LaunchChat = $LaunchChat
  NoLaunch = $NoLaunch
}
& $setup @forward
exit $LASTEXITCODE
