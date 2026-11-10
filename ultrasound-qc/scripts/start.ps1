[CmdletBinding()]
param(
    [ValidateSet('Auto', 'Electron', 'Packaged')]
    [string]$Mode = 'Auto',
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-env.ps1')
$qcRoot = $qcProjectRoot
$qcConfigPath = Join-Path $qcRoot '.runtime\config.json'
if (-not (Test-Path -LiteralPath $qcConfigPath -PathType Leaf)) {
    throw 'Runtime configuration is missing. Run scripts/setup-ocr.ps1 first.'
}
$qcConfig = Get-Content -LiteralPath $qcConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $qcConfig.pythonPath) {
    throw 'pythonPath is missing from .runtime/config.json. Run scripts/setup-ocr.ps1.'
}
$qcPython = if ([System.IO.Path]::IsPathRooted($qcConfig.pythonPath)) {
    [System.IO.Path]::GetFullPath($qcConfig.pythonPath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $qcRoot $qcConfig.pythonPath))
}
# A copied venv can still point to another computer. Never launch that interpreter.
$qcRootPrefix = $qcRoot.TrimEnd('\') + '\'
if (-not $qcPython.StartsWith($qcRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Python is outside this project: $qcPython. Run scripts/setup-ocr.ps1 to repair the migrated environment."
}
if (-not (Test-Path -LiteralPath $qcPython -PathType Leaf)) {
    throw "Local Python is missing: $qcPython. Run scripts/setup-ocr.ps1 first."
}
$qcPythonOutput = & $qcPython -c 'import sys; print(sys.version.split()[0]); sys.exit(0 if sys.version_info[:2] == (3, 11) else 11)' 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Local Python cannot run. Run scripts/setup-ocr.ps1 to repair it.`n$($qcPythonOutput -join [Environment]::NewLine)"
}

$qcElectron = Join-Path $qcRoot 'node_modules\electron\dist\electron.exe'
$qcPackaged = Join-Path $qcRoot 'dist\win-unpacked\UltrasoundQC.exe'
$qcBuildFiles = @('build\main.cjs', 'build\preload.cjs', 'web\index.html')
$qcBuildMissing = @($qcBuildFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $qcRoot $_) -PathType Leaf) })
$qcElectronReady = (Test-Path -LiteralPath $qcElectron -PathType Leaf) -and $qcBuildMissing.Count -eq 0

# Use the prepared application. Starting the app
# does not download dependencies, rebuild, or change Windows security policy.
if ($Mode -eq 'Auto') {
    if (Test-Path -LiteralPath $qcPackaged -PathType Leaf) { $Mode = 'Packaged' }
    elseif ($qcElectronReady) { $Mode = 'Electron' }
    else { throw 'Application files are missing. Restore dependencies and run npm.cmd run build once.' }
}
if ($Mode -eq 'Electron') {
    if (-not $qcElectronReady) {
        throw "Electron or built application files are missing ($($qcBuildMissing -join ', ')). Restore dependencies and run npm.cmd run build once."
    }
    $qcExecutable = $qcElectron
    $qcArguments = @('"' + $qcRoot + '"')
} else {
    if (-not (Test-Path -LiteralPath $qcPackaged -PathType Leaf)) {
        throw 'The packaged application is missing from dist/win-unpacked.'
    }
    $qcExecutable = $qcPackaged
    $qcArguments = @()
}
if ($CheckOnly) {
    [pscustomobject]@{
        ProjectRoot = $qcRoot
        PythonPath = $qcPython
        PythonVersion = ($qcPythonOutput -join '').Trim()
        Mode = $Mode
        Executable = $qcExecutable
        TempDirectory = $env:TEMP
        ModelCache = $env:PADDLE_PDX_CACHE_HOME
    }
    return
}

# Electron must start as a GUI even if the invoking shell used it as Node.
$env:ELECTRON_RUN_AS_NODE = $null
$qcLogStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$qcLogBase = Join-Path $qcRuntimeRoot "logs\startup-$qcLogStamp"
$qcStartOptions = @{
    FilePath = $qcExecutable
    WorkingDirectory = $qcRoot
    WindowStyle = 'Normal'
    PassThru = $true
    RedirectStandardOutput = "$qcLogBase.out.log"
    RedirectStandardError = "$qcLogBase.err.log"
}
if ($qcArguments.Count -gt 0) { $qcStartOptions.ArgumentList = $qcArguments }
try {
    $qcProcess = Start-Process @qcStartOptions
} catch {
    # A policy refusal is an error for the user/administrator to resolve. Do not
    # silently switch binaries, remove file marks or change application control.
    throw "Windows could not start $qcExecutable. $($_.Exception.Message) If application control blocked it, request approval from the administrator; this script does not change security rules."
}
if ($qcProcess.WaitForExit(2500) -and $qcProcess.ExitCode -ne 0) {
    throw "The application exited during startup (code $($qcProcess.ExitCode)). See $qcLogBase.err.log"
}
Write-Host 'Ultrasound QC started. The existing window is activated if it was already running.'
