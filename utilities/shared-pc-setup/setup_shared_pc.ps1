# MYRIAD Shared PC setup (Phase 24) - run ONCE on the shared laptop (Win11 Pro).
# Re-run safe: every step is idempotent. Re-run step 5 after a launcher update.
#
#   1. Enable Remote Desktop (+ firewall, NLA)
#   2. Create local accounts per team member + allow RDP
#   3. Power: never sleep on AC, lid close = do nothing
#   4. Windows Update active hours 08-20 (no auto restart during work)
#   5. Install the session agent (SYSTEM scheduled task at boot)
#
# Messages are English on purpose (PowerShell 5.1 + Korean = encoding breakage).

$ErrorActionPreference = 'Stop'

# --- self-elevate ------------------------------------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

function Step($n, $title) { Write-Host ""; Write-Host "[$n/5] $title" -ForegroundColor Cyan }
function Ask-YesNo($q) { (Read-Host "$q (y/n)") -match '^[yY]' }

# Well-known SIDs (language independent - group NAMES differ on Korean Windows)
$SID_RDP_USERS = 'S-1-5-32-555'
$SID_USERS     = 'S-1-5-32-545'

Write-Host "MYRIAD Shared PC setup - computer name: $env:COMPUTERNAME" -ForegroundColor Yellow

# --- 1. Remote Desktop -------------------------------------------------------
Step 1 'Enable Remote Desktop'
Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 0
Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name UserAuthentication -Value 1
# '@FirewallAPI.dll,-28752' = Remote Desktop rule group (language independent)
Enable-NetFirewallRule -Group '@FirewallAPI.dll,-28752'
Write-Host '  OK - RDP on, NLA on, firewall opened'

# --- 2. Local accounts -------------------------------------------------------
Step 2 'Team member accounts'
Write-Host '  Enter Windows account names separated by comma (e.g. kim,park,lee). Empty = skip.'
$names = (Read-Host '  Accounts') -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
foreach ($n in $names) {
    if (Get-LocalUser -Name $n -ErrorAction SilentlyContinue) {
        Write-Host "  - $n already exists (password unchanged)"
    } else {
        $pw = Read-Host "  - Password for '$n'" -AsSecureString
        New-LocalUser -Name $n -Password $pw -PasswordNeverExpires -FullName $n | Out-Null
        Write-Host "  - $n created"
    }
    foreach ($sid in @($SID_USERS, $SID_RDP_USERS)) {
        try { Add-LocalGroupMember -SID $sid -Member $n -ErrorAction Stop } catch [Microsoft.PowerShell.Commands.MemberExistsException] { }
    }
}
Write-Host '  OK - accounts can sign in via Remote Desktop'

# --- 3. Power ----------------------------------------------------------------
Step 3 'Power settings (AC)'
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
Write-Host '  OK - no sleep on AC, lid close does nothing. Keep the charger plugged in.'

# --- 4. Windows Update active hours -----------------------------------------
Step 4 'Windows Update active hours 08:00-20:00'
$wu = 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
if (-not (Test-Path $wu)) { New-Item $wu -Force | Out-Null }
Set-ItemProperty $wu -Name ActiveHoursStart -Value 8
Set-ItemProperty $wu -Name ActiveHoursEnd -Value 20
Write-Host '  OK'

# --- 5. Session agent --------------------------------------------------------
Step 5 'Session agent (reports who is connected to the hub)'
if (Ask-YesNo '  Install / update the agent now?') {
    Write-Host '  Folder that contains MyriadLauncher.exe + config.json (an already set-up launcher on THIS PC):'
    $src = (Read-Host '  Launcher folder').Trim('"', ' ')
    $exe = Join-Path $src 'MyriadLauncher.exe'
    $cfg = Join-Path $src 'config.json'
    if (-not (Test-Path $exe) -or -not (Test-Path $cfg)) { throw "MyriadLauncher.exe or config.json not found in $src" }

    $root = Join-Path $env:ProgramData 'MyriadLauncher'
    $bin  = Join-Path $root 'agent-bin'
    $task = 'MyriadSharedPcAgent'

    # stop old agent before overwriting its files
    if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
        Get-Process MyriadLauncher -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -like "$bin*" } | Stop-Process -Force
        Start-Sleep -Seconds 2
    }
    New-Item $bin -ItemType Directory -Force | Out-Null
    robocopy $src $bin /MIR /XF config.json config.json.bak launcher.log launcher_error.log /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }

    # agent.json = token copied from the launcher config (no typing secrets)
    $c = Get-Content $cfg -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $c.api_token) { throw 'config.json has no api_token - run MyriadSetup.exe first' }
    $agentCfg = @{ api_base_url = $c.api_base_url; api_token = $c.api_token } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $root 'agent.json'), $agentCfg, (New-Object Text.UTF8Encoding($false)))

    # lock the folder: SYSTEM + Administrators only (other team accounts must not read the token)
    icacls $root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null

    $action    = New-ScheduledTaskAction -Execute (Join-Path $bin 'MyriadLauncher.exe') -Argument '--shared-pc-agent' -WorkingDirectory $bin
    $trigger   = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                   -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
    Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $task
    Write-Host "  OK - agent running. Log: $root\agent.log"
}

Write-Host ''
Write-Host 'Done. Computer name for the hub:' $env:COMPUTERNAME -ForegroundColor Green
Read-Host 'Press Enter to close'
