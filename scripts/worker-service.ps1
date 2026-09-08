# Keep the MintBound worker alive across reboots, sleeps and closed terminals.
#
# The worker is what keeps the deployment answerable. Without it no fresh proof
# lands, the last one ages past its staleness bound, and `mintbound claims` reports
# minting FROZEN to anyone who looks. That is the safety property behaving
# correctly, but it is not what you want a judge to find.
#
# The worker already restarts itself on internal errors. What it cannot survive is
# the terminal closing or the machine rebooting, which is what this handles.
#
# Installs into the per-user Startup folder, which needs no administrator rights.
# A scheduled task would be tidier but requires elevation on a default Windows
# install, and needing admin is a good way for this step never to happen.
#
#   Install:   .\scripts\worker-service.ps1 -Install
#   Status:    .\scripts\worker-service.ps1 -Status
#   Remove:    .\scripts\worker-service.ps1 -Uninstall
#   Run now:   .\scripts\worker-service.ps1

param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Status
)

$ErrorActionPreference = "Stop"
$RepoRoot  = Split-Path -Parent $PSScriptRoot
$StartupPs = [Environment]::GetFolderPath("Startup")
$Launcher  = Join-Path $StartupPs "MintBoundWorker.vbs"
$LogFile   = Join-Path $RepoRoot "worker.log"

function Assert-Env {
    $envFile = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envFile)) {
        throw "No .env at $envFile. The worker needs WORKER_PRIVATE_KEY to submit snapshots."
    }
}

if ($Install) {
    Assert-Env

    # A .vbs launcher rather than a .cmd, purely so nothing flashes a console
    # window at logon. It starts this same script in its supervise loop.
    $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$PSCommandPath"""
    @"
' MintBound reserve snapshot worker. Delete this file to stop it starting at logon.
CreateObject("WScript.Shell").Run "$cmd", 0, False
"@ | Set-Content -Path $Launcher -Encoding ASCII

    if (-not (Test-Path $Launcher)) { throw "Failed to write launcher to $Launcher" }

    Start-Process powershell.exe `
        -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$PSCommandPath`"" `
        -WindowStyle Hidden

    Write-Output "Installed: $Launcher"
    Write-Output "Started now, and will start again at every logon."
    Write-Output "Verify in a minute or two with:  npx mintbound-cli status"
    return
}

if ($Uninstall) {
    if (Test-Path $Launcher) { Remove-Item $Launcher -Force; Write-Output "Removed $Launcher" }
    else { Write-Output "Not installed." }
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*worker.ts*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Output "Any running worker stopped."
    return
}

if ($Status) {
    Write-Output "Launcher installed : $(Test-Path $Launcher)"
    $running = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*worker.ts*" })
    Write-Output "Worker processes   : $($running.Count)"
    if (Test-Path $LogFile) {
        Write-Output "--- last 5 log lines ---"
        Get-Content $LogFile -Tail 5
    }
    return
}

# ── Foreground: run the worker, and bring it back if it ever exits ───────────
Assert-Env
Set-Location $RepoRoot

while ($true) {
    "[$(Get-Date -Format s)] starting worker" | Add-Content $LogFile
    try {
        & npm run worker *>> $LogFile
    } catch {
        "[$(Get-Date -Format s)] worker threw: $_" | Add-Content $LogFile
    }
    "[$(Get-Date -Format s)] worker exited; restarting in 15s" | Add-Content $LogFile
    Start-Sleep -Seconds 15
}
