# Windows PowerShell 5.1, native Windows x64, local NTFS only.
# Keep the gate and the entire commit in this process: no unprotected child writer.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Get-OwnerIdentity([int] $OwnerPid) {
    try {
        $owner = [System.Diagnostics.Process]::GetProcessById($OwnerPid)
    } catch [System.ArgumentException] {
        return $null # The OS positively reported that the PID does not exist.
    }
    try {
        return $owner.StartTime.ToUniversalTime().ToFileTimeUtc().ToString(
            [System.Globalization.CultureInfo]::InvariantCulture)
    } finally {
        $owner.Dispose()
    }
}

function Assert-RegularFile([string] $FilePath) {
    $item = Get-Item -LiteralPath $FilePath -Force
    if ($item.PSIsContainer -or
        ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        throw "metadata lock or gate is not a regular file; leave it untouched"
    }
}

function Assert-Recoverable([string] $LockPath) {
    if (-not [System.IO.File]::Exists($LockPath) -and
        -not [System.IO.Directory]::Exists($LockPath)) { return }
    Assert-RegularFile $LockPath
    if ((Get-Item -LiteralPath $LockPath -Force).Length -gt 256) {
        throw "metadata lock is malformed; leave it untouched"
    }
    $text = [System.IO.File]::ReadAllText($LockPath)
    $legacy = $text -cmatch '^[1-9][0-9]{0,9}\r?\n?$'
    if ($legacy) {
        $ownerPid = [int]::Parse($text.Trim(), [System.Globalization.CultureInfo]::InvariantCulture)
    } else {
        $record = ConvertFrom-Json -InputObject $text
        if ($null -eq $record -or
            @($record.PSObject.Properties).Count -ne 2 -or
            $null -eq $record.identity -or
            @($record.identity.PSObject.Properties).Count -ne 2 -or
            $record.identity.platform -cne 'win32' -or
            $record.identity.creationTimeFileTime -isnot [string] -or
            $record.identity.creationTimeFileTime -cnotmatch '^[1-9][0-9]{0,18}$' -or
            ($record.pid -isnot [int] -and $record.pid -isnot [long]) -or
            $record.pid -le 0 -or $record.pid -gt [int]::MaxValue) {
            throw "metadata lock has an invalid owner; leave it untouched"
        }
        $ownerPid = [int] $record.pid
    }
    # Errors (access denied, exiting process, unsupported identity) propagate.
    # Only a definite absence or a verified different creation time permits recovery.
    $current = Get-OwnerIdentity $ownerPid
    if ($null -eq $current) { return }
    if ($legacy) { throw "live legacy PID-only lock; PID reuse cannot be distinguished; leave it untouched" }
    if ($current -ceq $record.identity.creationTimeFileTime) {
        throw "metadata update or recovery is active; retry after it finishes"
    }
}

$gate = $null
$temporaryPath = $null
$ownedLock = $false
try {
    $request = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
    if ($request.operation -ceq 'identity') {
        $identity = Get-OwnerIdentity ([int] $request.ownerPid)
        if ($null -eq $identity) { throw "metadata owner is absent" }
        [Console]::Write($identity)
        exit 0
    }
    if ($request.operation -cne 'replace') { throw "unknown metadata operation" }
    $decisionPath = [System.IO.Path]::GetFullPath([string] $request.decisionPath)
    if ($decisionPath.StartsWith('\\')) { throw "metadata maintenance requires local NTFS, not a network share" }
    $drive = New-Object -TypeName System.IO.DriveInfo `
        -ArgumentList ([System.IO.Path]::GetPathRoot($decisionPath))
    if ($drive.DriveFormat -cne 'NTFS' -or $drive.DriveType -ne [System.IO.DriveType]::Fixed) {
        throw "metadata maintenance requires a local fixed NTFS volume"
    }
    Assert-RegularFile $decisionPath
    $lockPath = $decisionPath + '.metadata-maintenance.lock'
    $recoveryPath = $lockPath + '.recovery'
    $gatePath = $recoveryPath + '.gate'
    if (Test-Path -LiteralPath $gatePath) { Assert-RegularFile $gatePath }
    try {
        # Never unlink this stable gate. Windows releases this exclusive handle
        # on normal exit, exception, timeout, or forced process termination.
        $gate = [System.IO.File]::Open($gatePath, [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch {
        throw "metadata lock recovery is already in progress or the gate is unavailable; retry without removing locks"
    }
    Assert-Recoverable $recoveryPath
    Assert-Recoverable $lockPath
    $selfIdentity = Get-OwnerIdentity $PID
    if ($null -eq $selfIdentity) { throw "cannot establish metadata writer identity" }
    $owner = @{ pid = $PID; identity = @{ platform = 'win32'; creationTimeFileTime = $selfIdentity } }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($lockPath, ($owner | ConvertTo-Json -Compress), $utf8)
    $ownedLock = $true
    # Compare exact bytes under the gate, not an earlier unchecked JSON snapshot.
    $current = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($decisionPath))
    if ($current -cne $request.before) {
        throw "metadata decision changed during validation; retry the append against the latest file"
    }
    $temporaryPath = Join-Path ([System.IO.Path]::GetDirectoryName($decisionPath)) (
        '.distill-metadata-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $output = [System.IO.File]::Open($temporaryPath, [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $bytes = [Convert]::FromBase64String($request.after)
        $output.Write($bytes, 0, $bytes.Length)
        $output.Flush($true)
    } finally { $output.Dispose() }
    # Same-volume ReplaceFile semantics; never delete the destination first,
    # and never fall back to a non-atomic copy when replacement is denied.
    [System.IO.File]::Replace($temporaryPath, $decisionPath, $null)
    $temporaryPath = $null
    if ([System.IO.File]::Exists($recoveryPath)) { [System.IO.File]::Delete($recoveryPath) }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($null -ne $temporaryPath -and [System.IO.File]::Exists($temporaryPath)) {
        [System.IO.File]::Delete($temporaryPath)
    }
    if ($ownedLock) { [System.IO.File]::Delete($lockPath) }
    if ($null -ne $gate) { $gate.Dispose() }
}
