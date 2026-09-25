#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Milestone 10, checkpoint A2 - sets up the clinic computer as the off-site
  backup collector. Run ONCE, by whoever installs it, as Administrator. Clinic
  staff never run anything afterwards.

.DESCRIPTION
  - copies collect-backups.ps1 to %ProgramData%\ClinicBackupCollector, readable
    only by SYSTEM and Administrators;
  - creates the collector's SSH key there (kept if it already exists);
  - pins the server's host key, refusing to continue unless it matches the
    fingerprint read off the server by the person installing;
  - writes collector.json;
  - registers a scheduled task that runs as SYSTEM two minutes after every
    start-up and every hour while the computer is on, whether or not anybody is
    signed in, and catches up on any run it missed.

  Prints the public key line to add to the server (README, Backup and restore,
  The clinic collector). Safe to run again: it replaces the task and the
  settings, and keeps the key.

.EXAMPLE
  .\install-collector.ps1 -Server backup.example.invalid -HostKeyFingerprint 'SHA256:...'
#>
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$HostKeyFingerprint,
  [string]$User = 'clinic-collector',
  [int]$Port = 22,
  [string]$Destination = (Join-Path $env:SystemDrive 'ClinicBackups'),
  [int]$RetentionDays = 30,
  # Optional: a Windows account (the manager's) given READ access to the
  # collected files, for the monthly copy to the external drive.
  [string]$ManagerAccount = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

foreach ($tool in 'ssh', 'ssh-keygen', 'ssh-keyscan') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool not found. Enable the Windows 'OpenSSH Client' optional feature first."
  }
}

$system = '*S-1-5-18'          # SYSTEM, by SID so it works in any Windows language
$administrators = '*S-1-5-32-544'
$installDir = Join-Path $env:ProgramData 'ClinicBackupCollector'

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
& icacls $installDir /inheritance:r /grant:r "${system}:(OI)(CI)F" "${administrators}:(OI)(CI)F" | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'collect-backups.ps1') -Destination $installDir -Force

# --- the collector's key ------------------------------------------------------
$key = Join-Path $installDir 'id_ed25519'
if (-not (Test-Path -LiteralPath $key)) {
  & ssh-keygen -q -t ed25519 -N '""' -C "clinic-collector@$env:COMPUTERNAME" -f $key
  if ($LASTEXITCODE -ne 0) { throw 'ssh-keygen failed' }
}

# --- the server's host key, pinned, never trusted on first sight -----------------
$scanned = Join-Path $installDir 'known_hosts.scan'
# ssh-keyscan reports progress on stderr, which Windows PowerShell turns into a
# terminating error under 'Stop'; only its stdout, the key, is wanted.
$ErrorActionPreference = 'Continue'
& ssh-keyscan -p $Port -t ed25519 $Server 2> $null | Set-Content -LiteralPath $scanned -Encoding ASCII
$ErrorActionPreference = 'Stop'
$seen = (& ssh-keygen -l -f $scanned) -split ' ' | Select-Object -Index 1
if ($seen -ne $HostKeyFingerprint) {
  Remove-Item -LiteralPath $scanned -Force
  throw "The server presented host key $seen, not $HostKeyFingerprint. Nothing was set up; check the server address and the fingerprint."
}
Move-Item -LiteralPath $scanned -Destination (Join-Path $installDir 'known_hosts') -Force

# --- settings -----------------------------------------------------------------
[ordered]@{
  Server         = $Server
  Port           = $Port
  User           = $User
  IdentityFile   = $key
  KnownHostsFile = (Join-Path $installDir 'known_hosts')
  Destination    = $Destination
  RetentionDays  = $RetentionDays
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installDir 'collector.json') -Encoding UTF8

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$grants = @("${system}:(OI)(CI)F", "${administrators}:(OI)(CI)F")
if ($ManagerAccount) { $grants += "${ManagerAccount}:(OI)(CI)RX" }
& icacls $Destination /inheritance:r /grant:r @grants | Out-Null

# --- the schedule ---------------------------------------------------------------
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
  '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $installDir 'collect-backups.ps1'))
$atStartup = New-ScheduledTaskTrigger -AtStartup
$atStartup.Delay = 'PT2M'
$hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Clinic backup collector' -Action $action `
  -Trigger @($atStartup, $hourly) -Principal $principal -Settings $settings -Force | Out-Null

$public = (Get-Content -LiteralPath "$key.pub" -Raw).Trim()
Write-Output ''
Write-Output 'Installed. Add this ONE line to the collector login''s ~/.ssh/authorized_keys on the server,'
Write-Output 'with the two directories filled in (README, Backup and restore, The clinic collector):'
Write-Output ''
Write-Output ('restrict,command="env BACKUP_DESTINATION_DIR=<dir> BACKUP_STATUS_DIR=<dir> <repo>/scripts/backup/collector-serve.sh" ' + $public)
Write-Output ''
Write-Output 'Then start the task once and read the log:'
Write-Output "  Start-ScheduledTask -TaskName 'Clinic backup collector'"
Write-Output ('  Get-Content "{0}"' -f (Join-Path $Destination 'collector.log'))
