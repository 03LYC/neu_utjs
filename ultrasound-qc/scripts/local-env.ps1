# Keep migration tools, downloads, temporary files and caches inside this project.
# Dot-source this file before setup, build or startup. Do not change USERPROFILE:
# Windows credentials and the existing application data still belong to this user.
$qcProjectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$qcRuntimeRoot = Join-Path $qcProjectRoot '.runtime'
$qcLocalDirectories = @{
    TEMP = 'tmp'
    TMP = 'tmp'
    UV_CACHE_DIR = 'cache\uv'
    UV_PYTHON_INSTALL_DIR = 'python'
    UV_TOOL_DIR = 'tools\uv-tools'
    UV_TOOL_BIN_DIR = 'tools\bin'
    PIP_CACHE_DIR = 'cache\pip'
    npm_config_cache = 'cache\npm'
    ELECTRON_CACHE = 'cache\electron'
    ELECTRON_BUILDER_CACHE = 'cache\electron-builder'
    XDG_CACHE_HOME = 'cache'
    HF_HOME = 'cache\huggingface'
    HUGGINGFACE_HUB_CACHE = 'cache\huggingface\hub'
    MODELSCOPE_CACHE = 'cache\modelscope'
    PADDLE_HOME = 'cache\paddle'
    PADDLE_PDX_CACHE_HOME = 'models'
}
foreach ($qcVariable in $qcLocalDirectories.Keys) {
    $qcDirectory = Join-Path $qcRuntimeRoot $qcLocalDirectories[$qcVariable]
    [System.IO.Directory]::CreateDirectory($qcDirectory) | Out-Null
    [Environment]::SetEnvironmentVariable($qcVariable, $qcDirectory, 'Process')
}
foreach ($qcDirectoryName in @('downloads', 'tools', 'logs')) {
    [System.IO.Directory]::CreateDirectory((Join-Path $qcRuntimeRoot $qcDirectoryName)) | Out-Null
}
$env:UV_PYTHON_INSTALL_BIN = '0'
$env:UV_PYTHON_INSTALL_REGISTRY = '0'
$env:UV_NO_MODIFY_PATH = '1'
$env:PIP_DISABLE_PIP_VERSION_CHECK = '1'
$env:PYTHONNOUSERSITE = '1'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = 'True'
$env:PADDLE_PDX_MODEL_SOURCE = 'bos'
$env:PATH = ((Join-Path $qcRuntimeRoot 'tools'), (Join-Path $qcRuntimeRoot 'tools\bin'), $env:PATH) -join [System.IO.Path]::PathSeparator
