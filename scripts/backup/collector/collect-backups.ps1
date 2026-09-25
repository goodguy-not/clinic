#Requires -Version 5.1
<#
.SYNOPSIS
  Milestone 10, checkpoint A2 - collects the clinic server's nightly backups
  onto this computer. Run by Task Scheduler (install-collector.ps1), never by
  clinic staff.

.DESCRIPTION
  Every run, over SSH with a key the server only lets do three things
  (scripts/backup/collector-serve.sh):

    1. asks the server which backups it holds, with their SHA-256;
    2. downloads each one this computer does not have yet to "<name>.partial",
       checks its SHA-256 and only then renames it into place;
    3. tells the server the newest backup it now holds ("ack"), which is what
       lets the manager see when the off-site copy was last refreshed;
    4. removes its own copies older than RetentionDays, never the newest.

  SAFE IF INTERRUPTED: a half-downloaded file is only ever a ".partial", thrown
  away and fetched again next run; a file is final only once its hash matched.
  SAFE IF REPEATED: what is already here is skipped, and a second copy of this
  script running at the same moment exits at once.

  The backups are encrypted; this computer cannot read them and needs no key
  to do so. Settings come from collector.json beside this script.
#>
param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'collector.json')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

$config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
$destination = [string]$config.Destination
$retentionDays = [int]$config.RetentionDays
if ($retentionDays -lt 1) { throw 'RetentionDays must be 1 or more.' }

$archiveName = '^clinic-backup-(\d{8}T\d{6}Z)\.tar\.gpg$'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$logFile = Join-Path $destination 'collector.log'

function Write-Log([string]$message) {
  $line = '{0} {1}' -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  Write-Output $line
}

function ConvertTo-Argument([string]$value) {
  if ($value -notmatch '[\s"]') { return $value }
  return '"' + $value.Replace('"', '\"') + '"'
}

# One request to the server. Bytes are copied straight from ssh's stdout to the
# file - Windows PowerShell's own redirection would re-encode them as text.
function Invoke-Server([string]$request, [string]$outFile) {
  if ($config.PSObject.Properties.Name -contains 'SshCommand' -and $config.SshCommand) {
    # Tests only: a stand-in for ssh that runs collector-serve.sh locally.
    $exe = [string]$config.SshCommand[0]
    $arguments = @($config.SshCommand | Select-Object -Skip 1)
  } else {
    $exe = 'ssh'
    $arguments = @(
      '-i', [string]$config.IdentityFile,
      '-o', 'BatchMode=yes',
      '-o', 'IdentitiesOnly=yes',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', ('UserKnownHostsFile=' + [string]$config.KnownHostsFile),
      '-o', 'ConnectTimeout=20',
      '-o', 'ServerAliveInterval=30',
      '-p', [string]$config.Port,
      ('{0}@{1}' -f $config.User, $config.Server)
    )
  }
  $arguments += $request

  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $exe
  $info.Arguments = ($arguments | ForEach-Object { ConvertTo-Argument ([string]$_) }) -join ' '
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.CreateNoWindow = $true

  $process = [System.Diagnostics.Process]::Start($info)
  $stderr = $process.StandardError.ReadToEndAsync()
  $text = $null
  if ($outFile) {
    $stream = [System.IO.File]::Create($outFile)
    try { $process.StandardOutput.BaseStream.CopyTo($stream) } finally { $stream.Dispose() }
  } else {
    $text = $process.StandardOutput.ReadToEnd()
  }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw ('server request "{0}" failed ({1}): {2}' -f $request, $process.ExitCode, $stderr.Result.Trim())
  }
  return $text
}

function Get-ArchiveTime([string]$name) {
  $stamp = ([regex]::Match($name, $archiveName)).Groups[1].Value
  return [datetime]::ParseExact($stamp, "yyyyMMdd'T'HHmmss'Z'",
    [System.Globalization.CultureInfo]::InvariantCulture,
    [System.Globalization.DateTimeStyles]'AssumeUniversal, AdjustToUniversal')
}

$mutex = New-Object System.Threading.Mutex($false, 'Global\ClinicBackupCollector')
if (-not $mutex.WaitOne(0)) { Write-Output 'another collection is running'; exit 0 }

try {
  # --- what the server holds ---------------------------------------------
  $offered = @()
  foreach ($line in ((Invoke-Server 'list' $null) -split "`n")) {
    $parts = $line.Trim() -split ' '
    if ($parts.Count -ne 3) { continue }
    if ($parts[0] -notmatch $archiveName -or $parts[2] -notmatch '^[0-9a-f]{64}$') {
      throw "the server listed an unexpected entry: $line"
    }
    $offered += [pscustomobject]@{ Name = $parts[0]; Size = [long]$parts[1]; Hash = $parts[2] }
  }

  # --- fetch what is missing, oldest first ---------------------------------
  $collected = 0
  foreach ($item in ($offered | Sort-Object Name)) {
    $final = Join-Path $destination $item.Name
    if (Test-Path -LiteralPath $final) { continue }
    $partial = "$final.partial"
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    Invoke-Server ('get ' + $item.Name) $partial | Out-Null
    $hash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $item.Hash) {
      Remove-Item -LiteralPath $partial -Force
      throw ('{0} arrived with the wrong SHA-256; discarded, will retry next run' -f $item.Name)
    }
    Move-Item -LiteralPath $partial -Destination $final
    $collected += 1
    Write-Log ('collected {0} ({1} bytes, SHA-256 checked)' -f $item.Name, $item.Size)
  }

  # --- tell the server what this computer now holds -------------------------
  $held = @(Get-ChildItem -LiteralPath $destination -File |
      Where-Object { $_.Name -match $archiveName } | Sort-Object Name)
  if ($held.Count -gt 0) {
    $newest = $held[-1].Name
    if (@($offered | Where-Object { $_.Name -eq $newest }).Count -gt 0) {
      Invoke-Server ('ack ' + $newest) $null | Out-Null
    }
  }

  # --- this computer's own retention ---------------------------------------
  $cutoff = (Get-Date).ToUniversalTime().AddDays(-$retentionDays)
  foreach ($file in $held) {
    if ($file.Name -eq $held[-1].Name) { continue }
    if ((Get-ArchiveTime $file.Name) -lt $cutoff) {
      Remove-Item -LiteralPath $file.FullName -Force
      Write-Log ('expired {0} (older than {1} days)' -f $file.Name, $retentionDays)
    }
  }
  # A .partial whose archive the server no longer offers is never resumed.
  Get-ChildItem -LiteralPath $destination -Filter '*.partial' -File |
    Where-Object { $_.LastWriteTimeUtc -lt (Get-Date).ToUniversalTime().AddDays(-1) } |
    Remove-Item -Force

  $held = @(Get-ChildItem -LiteralPath $destination -File |
      Where-Object { $_.Name -match $archiveName } | Sort-Object Name)
  $newestHeld = if ($held.Count -gt 0) { $held[-1].Name } else { 'none' }
  Write-Log ('run complete: {0} new, {1} held, newest {2}' -f $collected, $held.Count, $newestHeld)
  exit 0
} catch {
  Write-Log ('FAILED: ' + $_.Exception.Message)
  exit 1
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
