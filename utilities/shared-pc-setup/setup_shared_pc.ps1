# MYRIAD Shared PC setup (Phase 24) - run ONCE on the shared laptop (Win11 Pro).
# Re-run safe: every step is idempotent. Re-run step 7 after a launcher update.
#
#   1. Enable Remote Desktop (+ firewall, NLA)
#   2. Create local accounts per team member + allow RDP
#   3. Power: never sleep on AC, lid close = do nothing
#   4. Windows Update active hours 08-20 (no auto restart during work)
#   5. Shut down / restart = Administrators only (one click would kill everyone's work)
#   6. Disconnected sessions auto sign-out after 24h
#   7. Install the session agent (SYSTEM scheduled task at boot)
#
# Messages are English on purpose (PowerShell 5.1 + Korean = encoding breakage).

$ErrorActionPreference = 'Stop'

# --- self-elevate ------------------------------------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

function Step($n, $title) { Write-Host ""; Write-Host "[$n/7] $title" -ForegroundColor Cyan }
function Ask-YesNo($q) { (Read-Host "$q (y/n)") -match '^[yY]' }

# Well-known SIDs (language independent - group NAMES differ on Korean Windows)
$SID_RDP_USERS = 'S-1-5-32-555'
$SID_USERS     = 'S-1-5-32-545'

Write-Host "MYRIAD Shared PC setup - computer name: $env:COMPUTERNAME" -ForegroundColor Yellow

# --- 1. Remote Desktop -------------------------------------------------------
Step 1 'Enable Remote Desktop'
Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name UserAuthentication -Value 1
# Registry fDenyTSConnections alone does NOT start the 3389 listener on a running service.
# The WMI method is what the Settings toggle uses - applies live. Restart as a safety net.
$ts = Get-CimInstance -Namespace root/cimv2/TerminalServices -ClassName Win32_TerminalServiceSetting
Invoke-CimMethod -InputObject $ts -MethodName SetAllowTSConnections -Arguments @{AllowTSConnections=1; ModifyFirewallException=1} | Out-Null
# Restart ONLY if not listening yet - restarting drops every connected RDP session (incl. the one running this).
# TermService often refuses to stop -> then a reboot is required (checked below)
if (-not (Get-NetTCPConnection -LocalPort 3389 -State Listen -ErrorAction SilentlyContinue)) {
    try { Restart-Service TermService -Force -ErrorAction Stop } catch { Write-Host '  (TermService restart refused - reboot may be needed)' -ForegroundColor Yellow }
}
# '@FirewallAPI.dll,-28752' = Remote Desktop rule group (language independent). All profiles.
Set-NetFirewallRule -Group '@FirewallAPI.dll,-28752' -Profile Any -Enabled True
# Windows marks a newly joined Wi-Fi as Public -> inbound blocked. Office LAN = Private.
Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Public' | Set-NetConnectionProfile -NetworkCategory Private
Start-Sleep -Seconds 5
if (Get-NetTCPConnection -LocalPort 3389 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host '  OK - RDP listening on 3389, NLA on, firewall opened, network = Private'
} else {
    Write-Host '  WARNING - port 3389 not listening yet. REBOOT this PC (settings are saved; no re-run needed).' -ForegroundColor Red
}
$fw = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct -ErrorAction SilentlyContinue
if ($fw) {
    Write-Host "  NOTE - 3rd-party firewall found: $($fw.displayName -join ', '). Allow Remote Desktop (TCP 3389) there too." -ForegroundColor Yellow
}

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

# --- 5. Shut down restricted to Administrators ------------------------------
Step 5 'Shut down / restart = Administrators only'
# Default holders: Administrators, Backup Operators, Users. Drop Users so team accounts
# can only sign out / disconnect. secedit applies ONLY the right listed in the template.
$inf = Join-Path $env:TEMP 'myriad_shutdown.inf'
$sdb = Join-Path $env:TEMP 'myriad_shutdown.sdb'
$tpl = "[Unicode]`r`nUnicode=yes`r`n[Version]`r`nsignature=`"`$CHICAGO`$`"`r`nRevision=1`r`n[Privilege Rights]`r`nSeShutdownPrivilege = *S-1-5-32-544,*S-1-5-32-551`r`n"
[IO.File]::WriteAllText($inf, $tpl, [Text.Encoding]::Unicode)
secedit /configure /db $sdb /cfg $inf /areas USER_RIGHTS /quiet | Out-Null
# verify: export current rights and make sure Users (S-1-5-32-545) is gone
secedit /export /cfg $inf /areas USER_RIGHTS /quiet | Out-Null
$line = Get-Content $inf -ErrorAction SilentlyContinue | Where-Object { $_ -like 'SeShutdownPrivilege*' }
Remove-Item $inf, $sdb -Force -ErrorAction SilentlyContinue
if ($line -like '*S-1-5-32-545*') { Write-Host "  WARNING - shutdown right not changed: $line" -ForegroundColor Red }
# no shutdown button on the sign-in screen either
Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name shutdownwithoutlogon -Value 0
# 'PC\user' -> 'user' (split on backslash = [char]92)
$admins = Get-LocalGroupMember -SID 'S-1-5-32-544' | ForEach-Object { $_.Name.Split([char]92)[-1] }
$rdpOnly = Get-LocalGroupMember -SID $SID_RDP_USERS -ErrorAction SilentlyContinue | ForEach-Object { $_.Name.Split([char]92)[-1] }
$adminTeam = $rdpOnly | Where-Object { $admins -contains $_ }
if ($adminTeam) { Write-Host "  NOTE - these team accounts are Administrators and can still shut down: $($adminTeam -join ', ')" -ForegroundColor Yellow }
Write-Host '  OK - team accounts: sign out / disconnect only (takes effect at their next sign-in)'

# --- 6. Disconnected session limit ------------------------------------------
Step 6 'Disconnected sessions: auto sign-out after 24h'
$tsPol = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services'
if (-not (Test-Path $tsPol)) { New-Item $tsPol -Force | Out-Null }
Set-ItemProperty $tsPol -Name MaxDisconnectionTime -Value 86400000 -Type DWord   # ms = 24h
gpupdate /target:computer /force | Out-Null
Write-Host '  OK - a session left disconnected (X) for 24h is signed out (its apps close)'

# --- 7. Session agent --------------------------------------------------------
Step 7 'Session agent (reports who is connected to the hub)'
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
    # boot + every 5 min: if the agent died (no log, RestartCount does not cover it) it comes back.
    # MultipleInstances defaults to IgnoreNew, so a running agent is left alone.
    $trigger   = @(
        (New-ScheduledTaskTrigger -AtStartup),
        (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5))
    )
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
