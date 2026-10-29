# Qualification candidate. Run with PowerShell 7 on the Windows host.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$StateDirectory,
  [switch]$InitializeFresh,
  [string]$Site,
  [string]$TimeZone,
  [string]$Manager
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit $LASTEXITCODE" }
}
if ($PSVersionTable.PSVersion.Major -lt 7 -or -not $IsWindows) { throw 'Requires Windows and PowerShell 7' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$state = [System.IO.Path]::GetFullPath($StateDirectory)
if ($state.StartsWith('\\')) { throw 'Use a local Windows disk, not a network share' }
# Never put secrets inside the checkout (including untracked subdirectories).
if ($state.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
    $state.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Use a private state directory outside the checkout'
}
Invoke-Checked 'docker' @('info', '--format', '{{.OSType}}')
$os = & docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0 -or $os -ne 'linux') { throw 'Docker Linux containers / WSL2 are required' }
$version = & node --version
if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne ('v' + (Get-Content (Join-Path $root '.nvmrc')).Trim())) {
  throw 'Install the exact Node version in .nvmrc'
}
$envFile = Join-Path $state 'self-host.env'
if ($InitializeFresh) {
  if ((Test-Path $state) -and ((Get-Item -LiteralPath $state).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw 'State directory cannot be a junction or symbolic link'
  }
  if ((Test-Path $state) -and @(Get-ChildItem -LiteralPath $state -Force).Count -gt 0) {
    throw 'Initialization requires a new or empty dedicated state directory'
  }
  # Refuse an existing DB volume BEFORE generating credentials or starting DB.
  $volumes = & docker volume ls --format '{{.Name}}'
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Docker volumes' }
  if ($volumes -contains 'runcalc-selfhost_db-data') { throw 'Existing data detected; initialization refused' }
  if (Test-Path $envFile) { throw 'Existing credentials detected; initialization refused' }
  New-Item -ItemType Directory -Force -Path $state | Out-Null
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  # Replace, rather than merely add to, the ACL: inherited or explicit broad
  # grants on a pre-existing folder must not expose generated credentials.
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner([System.Security.Principal.NTAccount]::new($identity))
  foreach ($principal in @($identity, 'NT AUTHORITY\SYSTEM')) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $state -AclObject $acl
  Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'config.mjs'), $state, $Site, $TimeZone, $Manager)
}
if (-not (Test-Path $envFile)) { throw 'Initialize a fresh installation first' }
if (-not $InitializeFresh) {
  $volumes = & docker volume ls --format '{{.Name}}'
  if ($LASTEXITCODE -ne 0 -or $volumes -notcontains 'runcalc-selfhost_db-data') {
    throw 'Existing database volume is missing; refusing to silently create a blank database'
  }
}
# Set interpolation from this installation only. No inherited DATABASE_URL or
# other ambient Compose values are trusted. No secret is printed by config.
$previous = @{}
$values = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
}
$values['SELF_HOST_ENV_FILE'] = $envFile
foreach ($key in $values.Keys) {
  $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
  [Environment]::SetEnvironmentVariable($key, $values[$key], 'Process')
}
try {
  if ($values['DATABASE_URL'] -notmatch '^postgresql://runcalc_user:[a-f0-9]{64}@db:5432/runcalc$' -or
      $values['LOCAL_AI_BASE_URL'] -ne 'http://ollama:11434/v1' -or
      $values['LOCAL_AI_FALLBACK_TO_GEMINI'] -ne 'false') { throw 'Unexpected database or local AI configuration' }
  $compose = @('compose', '--project-name', 'runcalc-selfhost', '--project-directory', $root,
    '--env-file', $envFile, '-f', (Join-Path $root 'docker-compose.self-host.yml'))
  Invoke-Checked 'docker' ($compose + @('config', '--quiet'))
  if ($InitializeFresh) {
    # Requires WAN for first image/dependency download. Never runs on restart.
    Invoke-Checked 'docker' ($compose + @('pull', 'db', 'ollama', 'caddy-storage-init'))
    Invoke-Checked 'docker' ($compose + @('--profile', 'initialize', 'build', 'api', 'web', 'migrate'))
    Invoke-Checked 'docker' ($compose + @('--profile', 'initialize', 'run', '--rm', 'migrate'))
  }
  # --pull never and --no-build: a normal offline restart performs no downloads.
  Invoke-Checked 'docker' ($compose + @('up', '-d', '--no-build', '--pull', 'never', 'db', 'ollama', 'api', 'web', 'caddy-storage-init'))
  Write-Output 'Stack started, not yet qualified. Verify HTTPS /api/ready, trust the LAN CA, and prepare local models separately.'
} finally {
  foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
