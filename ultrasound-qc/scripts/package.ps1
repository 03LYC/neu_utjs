$ErrorActionPreference = 'Stop'
$qcRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'local-env.ps1')
Push-Location $qcRoot
try {
    $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
    npm.cmd run package -- --config.electronDist=node_modules/electron/dist
    if ($LASTEXITCODE -ne 0) { throw '打包失败' }
    $qcShell = New-Object -ComObject WScript.Shell
    $qcLink = $qcShell.CreateShortcut((Join-Path (Split-Path $qcRoot -Parent) '超声报告质控.lnk'))
    $qcLink.TargetPath = Join-Path (Split-Path $qcRoot -Parent) '启动超声报告质控.cmd'
    $qcLink.WorkingDirectory = $qcRoot
    $qcLink.Description = '超声报告桌面文字质控'
    $qcLink.Save()
} finally { Pop-Location }
