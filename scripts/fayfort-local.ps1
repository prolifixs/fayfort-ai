# Shared helpers for the local FayFort launchers. Dot-source this file; it does not start anything.
# The API host and port come only from API_HOST/API_PORT in .env, read through `python -m app --print-config`.

function Get-FayFortPython {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    $python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $python)) {
        throw "Project virtualenv Python was not found at $python. Create/restore .venv first."
    }
    return $python
}

function Get-FayFortApiConfig {
    param([Parameter(Mandatory = $true)][string]$RepoRoot, [Parameter(Mandatory = $true)][string]$Python)
    Push-Location $RepoRoot
    try {
        $raw = & $Python -m app --print-config
        if ($LASTEXITCODE -ne 0 -or -not $raw) {
            throw "Could not read API_HOST/API_PORT from .env (python -m app --print-config failed)."
        }
        return ($raw | Out-String | ConvertFrom-Json)
    } finally {
        Pop-Location
    }
}

# Returns "current" when the configured API answers with the expected contract and Operations routes,
# "other" when something else answers there, and "none" when nothing responds.
function Get-FayFortApiState {
    param([Parameter(Mandatory = $true)][string]$BaseUrl, [Parameter(Mandatory = $true)][string]$Contract)
    try {
        $health = Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 3
    } catch {
        return "none"
    }
    try {
        $openApi = Invoke-RestMethod -Uri "$BaseUrl/openapi.json" -TimeoutSec 3
        $paths = @($openApi.paths.PSObject.Properties.Name)
        $operationsRoutes = @($paths | Where-Object { $_ -like "/operations/*" })
        if ($health.api_contract -eq $Contract -and ($paths -contains "/workers/requests") -and $operationsRoutes.Count -gt 0) {
            return "current"
        }
    } catch {
        # Fall through: something answered /health but is not the current API.
    }
    return "other"
}

function Get-PortOwnerDescription {
    param([Parameter(Mandatory = $true)][int]$Port)
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return $null }
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { return $null }
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $name = if ($process) { $process.ProcessName } else { "unknown" }
    return "PID $($listener.OwningProcess) ($name)"
}

# Earlier setups ran the API on 8000 and 8001. Warn about any FayFort API still answering on a port
# other than the configured one, because tunnels or browsers pointed there would reach stale code.
function Show-StaleFayFortApiWarnings {
    param([Parameter(Mandatory = $true)]$Config)
    foreach ($port in @(8000, 8001)) {
        if ($port -eq [int]$Config.port) { continue }
        $url = "http://$($Config.host):$port"
        if ((Get-FayFortApiState -BaseUrl $url -Contract $Config.api_contract) -eq "none") { continue }
        $owner = Get-PortOwnerDescription -Port $port
        $ownerText = if ($owner) { $owner } else { "an unknown process" }
        Write-Warning "A FayFort-style API is still answering on port $port ($ownerText). The configured port is $($Config.port). Stop the old process so nothing reaches stale code."
        if ($owner -match "^PID (\d+)") {
            Write-Warning "To stop it:  Stop-Process -Id $($Matches[1])"
        }
    }
}

# Reports the permanent Cloudflare tunnel (installed as the "cloudflared" Windows service from the
# Infrastructure page) and the public address from PUBLIC_API_URL in .env.
function Show-TunnelServiceState {
    param([Parameter(Mandatory = $true)]$Config)
    $service = Get-Service -Name cloudflared -ErrorAction SilentlyContinue
    if ($service) {
        Write-Host "Cloudflare tunnel service: $($service.Status)"
        if ($service.Status -ne "Running") { Write-Warning "Start it with:  Start-Service cloudflared  (as administrator)" }
    } else {
        Write-Host "Cloudflare tunnel service: not installed (use the Infrastructure page's install command, or .\scripts\start-tunnel.ps1 for a temporary tunnel)."
    }
    if ($Config.public_api_url) {
        Write-Host "Public API address: $($Config.public_api_url)  (Instagram webhook: $($Config.public_api_url)/webhooks/instagram)"
    }
}
