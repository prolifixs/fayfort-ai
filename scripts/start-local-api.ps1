$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
$apiUrl = "http://127.0.0.1:8001"

if (-not (Test-Path -LiteralPath $python)) {
    throw "Project virtualenv Python was not found at $python. Create/restore .venv first."
}

$apiReachable = $false
try {
    $health = Invoke-RestMethod -Uri "$apiUrl/health" -TimeoutSec 3
    $openApi = Invoke-RestMethod -Uri "$apiUrl/openapi.json" -TimeoutSec 3
    $apiReachable = $true
    $operationsRoutes = @($openApi.paths.PSObject.Properties.Name | Where-Object { $_ -like "/operations/*" })
    if ($health.api_contract -eq "departmental-flow-worker-request-bridge-v1" -and
        $openApi.paths.PSObject.Properties.Name -contains "/workers/requests" -and
        $operationsRoutes.Count -gt 0) {
        Write-Host "Current FayFort API contract is healthy on $apiUrl ($($operationsRoutes.Count) Operations routes and worker request bridge)."
        return
    }
} catch {
    # Check the local listener below before deciding whether the port is free.
}

$listener = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener -or $apiReachable) {
    $owner = if ($listener) { "PID $($listener.OwningProcess)" } else { "a responding API endpoint" }
    throw "Port 8001 is occupied by $owner, but it did not return the current FayFort API contract and worker request bridge. No process was stopped. Inspect that listener before retrying."
}

Write-Host "Starting the FayFort API on $apiUrl. Leave this terminal open; Ctrl+C stops the API."
Push-Location $repoRoot
try {
    # Watch backend code only so frontend, test, and documentation edits do
    # not restart the API. Bound graceful shutdown so long-lived browser
    # connections cannot leave the reloader waiting forever.
    & $python -m uvicorn app.main:app --reload --reload-dir (Join-Path $repoRoot "app") --timeout-graceful-shutdown 5 --host 127.0.0.1 --port 8001
    if ($LASTEXITCODE -ne 0) {
        throw "Uvicorn exited with code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
