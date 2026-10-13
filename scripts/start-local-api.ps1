$ErrorActionPreference = "Stop"

# Starts the FayFort API on API_HOST:API_PORT from .env (the single source of truth for the port).
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "fayfort-local.ps1")
$python = Get-FayFortPython -RepoRoot $repoRoot
$config = Get-FayFortApiConfig -RepoRoot $repoRoot -Python $python
$apiUrl = $config.base_url

Show-StaleFayFortApiWarnings -Config $config
Show-TunnelServiceState -Config $config

$state = Get-FayFortApiState -BaseUrl $apiUrl -Contract $config.api_contract
if ($state -eq "current") {
    Write-Host "Current FayFort API contract is already healthy on $apiUrl."
    return
}
$owner = Get-PortOwnerDescription -Port ([int]$config.port)
if ($state -eq "other" -or $owner) {
    $ownerText = if ($owner) { $owner } else { "a responding API endpoint" }
    throw "Port $($config.port) is occupied by $ownerText, but it did not return the current FayFort API contract. No process was stopped. Inspect that listener before retrying."
}

Write-Host "Starting the FayFort API on $apiUrl (from API_HOST/API_PORT in .env). Leave this terminal open; Ctrl+C stops the API."
Push-Location $repoRoot
try {
    & $python -m app --reload
    if ($LASTEXITCODE -ne 0) {
        throw "The API exited with code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
