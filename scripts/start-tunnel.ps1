param(
    # Optional explicit path to cloudflared; otherwise PATH and the Downloads folder are searched.
    [string]$CloudflaredPath = "",
    [ValidateSet("instagram", "messenger")][string]$Channel = "instagram",
    [int]$TimeoutSeconds = 45
)
$ErrorActionPreference = "Stop"

# Opens a Cloudflare quick tunnel to the configured local API and prints the webhook URL to paste into Meta.
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "fayfort-local.ps1")
$python = Get-FayFortPython -RepoRoot $repoRoot
$config = Get-FayFortApiConfig -RepoRoot $repoRoot -Python $python

Show-StaleFayFortApiWarnings -Config $config
if ((Get-FayFortApiState -BaseUrl $config.base_url -Contract $config.api_contract) -ne "current") {
    throw "The current FayFort API is not running on $($config.base_url). Start it first with .\scripts\start-local-api.ps1 in another terminal, then rerun this script."
}

$command = Get-Command cloudflared -ErrorAction SilentlyContinue
$downloads = if ($env:USERPROFILE) { Join-Path $env:USERPROFILE "Downloads" } else { "" }
$candidates = @(
    $CloudflaredPath,
    $(if ($command) { $command.Source } else { "" }),
    $(if ($downloads) { Join-Path $downloads "cloudflared-windows-amd64.exe" } else { "" }),
    $(if ($downloads) { Join-Path $downloads "cloudflared.exe" } else { "" })
)
$cloudflared = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $cloudflared) {
    throw "cloudflared was not found. Pass -CloudflaredPath <path to cloudflared.exe> or put cloudflared on PATH."
}

$logDir = Join-Path $repoRoot ".logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$log = Join-Path $logDir "cloudflared-$stamp.log"

Write-Host "Opening a Cloudflare quick tunnel to $($config.base_url) ..."
# Paths are quoted because the repository path contains spaces.
$arguments = @("tunnel", "--no-autoupdate", "--url", $config.base_url, "--logfile", "`"$log`"")
$tunnel = Start-Process -FilePath $cloudflared -ArgumentList $arguments -PassThru -WindowStyle Hidden

try {
    $publicUrl = $null
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not $publicUrl -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if ($tunnel.HasExited) {
            $tail = if (Test-Path -LiteralPath $log) { (Get-Content -LiteralPath $log -Tail 15) -join "`n" } else { "(no log written)" }
            throw "cloudflared exited before the tunnel was ready.`n$tail"
        }
        if (Test-Path -LiteralPath $log) {
            $match = Select-String -LiteralPath $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
            if ($match) { $publicUrl = $match.Matches[0].Value }
        }
    }
    if (-not $publicUrl) {
        throw "No tunnel URL appeared within $TimeoutSeconds seconds. See $log."
    }

    Set-Content -LiteralPath (Join-Path $logDir "tunnel-url.txt") -Value $publicUrl
    Write-Host ""
    Write-Host "Tunnel ready -> $($config.base_url)"
    Write-Host "Webhook URL for Meta ($Channel):" -NoNewline
    Write-Host " $publicUrl/webhooks/$Channel" -ForegroundColor Green
    Write-Host ""

    # New quick-tunnel hostnames can take a few seconds to resolve; retry the read-only preflight briefly.
    Push-Location $repoRoot
    try {
        for ($attempt = 1; $attempt -le 6; $attempt++) {
            & $python -m scripts.layer7_cli messenger-preflight --public-url $publicUrl --channel $Channel
            if ($LASTEXITCODE -eq 0) { break }
            if ($attempt -lt 6) { Write-Host "Preflight not passing yet; retrying in 5 seconds ($attempt/6)..."; Start-Sleep -Seconds 5 }
        }
    } finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "Tunnel is running. Leave this window open; Ctrl+C closes the tunnel. A new run gives a new URL."
    Wait-Process -Id $tunnel.Id
} finally {
    if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue }
}
