param([switch]$Cpu)
$ErrorActionPreference = 'Stop'
$qcRoot = Split-Path -Parent $PSScriptRoot
Push-Location $qcRoot
try {
    . (Join-Path $PSScriptRoot 'local-env.ps1')
    $uv = Join-Path $qcRoot '.runtime\tools\uv.exe'
    if (-not (Test-Path -LiteralPath $uv)) {
        $archive = Join-Path $qcRoot '.runtime\downloads\uv-x86_64-pc-windows-msvc.zip'
        Invoke-WebRequest -Uri 'https://github.com/astral-sh/uv/releases/download/0.13.5/uv-x86_64-pc-windows-msvc.zip' -OutFile $archive
        Expand-Archive -LiteralPath $archive -DestinationPath (Split-Path $uv -Parent) -Force
    }
    & $uv python install 3.11.15 --no-bin --no-registry
    if ($LASTEXITCODE -ne 0) { throw '下载项目内 Python 失败' }
    $basePython = Join-Path $qcRoot '.runtime\python\cpython-3.11.15-windows-x86_64-none\python.exe'
    # Keep copied packages while replacing interpreter and activation scripts.
    & $uv venv --allow-existing --python $basePython .venv
    if ($LASTEXITCODE -ne 0) { throw '修复 Python 环境失败' }
    $python = Join-Path $qcRoot '.venv\Scripts\python.exe'
    $env:PYTHONPATH = Join-Path (Split-Path $qcRoot -Parent) 'PaddleOCR-main\PaddleOCR-main'
    $env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = 'True'
    $flavor = if ($Cpu) { 'paddlepaddle' } else { 'paddlepaddle-gpu' }
    & $python -B -X utf8 -c "import importlib.metadata as m,sys; versions={d.metadata['Name'].lower():d.version for d in m.distributions()}; sys.exit(0 if versions.get('$flavor') == '3.3.1' and versions.get('paddlex') == '3.7.2' else 1)"
    if ($LASTEXITCODE -ne 0) {
        $opposite = if ($Cpu) { 'paddlepaddle-gpu' } else { 'paddlepaddle' }
        & $uv pip uninstall --python $python $opposite
        if ($LASTEXITCODE -ne 0) { throw '清理冲突 Paddle 发行包失败' }
        if ($Cpu) {
            $cpuLock = Join-Path $qcRoot '.runtime\requirements-cpu.txt'
            Get-Content -LiteralPath 'python\requirements.lock.txt' | Where-Object { $_ -notmatch '^paddlepaddle-gpu\s' } | Set-Content -LiteralPath $cpuLock -Encoding utf8
            & $uv pip install --python $python paddlepaddle==3.3.1 -r $cpuLock
        } else {
            & $uv pip install --python $python -r python\requirements.lock.txt
        }
        if ($LASTEXITCODE -ne 0) { throw '安装 OCR 依赖失败' }
    }
    # Keep the official pure-Python build: the compiled wheel can be rejected
    # by Windows application control even when its package version matches.
    # Check after dependency synchronization so it cannot overwrite this repair.
    $chardetHealthCheck = @'
import sys
from email import message_from_string
from importlib.metadata import PackageNotFoundError, distribution
try:
    installed = distribution('chardet')
except PackageNotFoundError:
    sys.exit(1)
wheel = message_from_string(installed.read_text('WHEEL') or '')
sys.exit(0 if installed.version == '7.7.0' and wheel.get('Root-Is-Purelib', '').strip().lower() == 'true' else 1)
'@
    $chardetHealthCheck | & $python -B -X utf8 -
    if ($LASTEXITCODE -ne 0) {
        $chardetWheel = Join-Path $qcRoot '.runtime\downloads\chardet-7.7.0-py3-none-any.whl'
        $chardetUrl = 'https://files.pythonhosted.org/packages/cc/75/88a3eb36264375ff951bd2f9397c409727ab6aa6a18e1bd933851571d421/chardet-7.7.0-py3-none-any.whl'
        $chardetSha256 = '11cf9b719ea3675a2a7d8a3071bbe4d7ea24b26bfe39a51588d515ddd05cacad'
        if (-not (Test-Path -LiteralPath $chardetWheel -PathType Leaf)) {
            Invoke-WebRequest -Uri $chardetUrl -OutFile $chardetWheel -UseBasicParsing
        }
        if ((Get-FileHash -LiteralPath $chardetWheel -Algorithm SHA256).Hash -ne $chardetSha256) {
            throw 'chardet 本地安装包 SHA256 校验失败，未安装此文件'
        }
        & $uv pip install --python $python --no-index --no-deps --reinstall-package chardet $chardetWheel
        if ($LASTEXITCODE -ne 0) { throw '安装 chardet 官方纯 Python 版本失败' }
    }
    $qcConfig = @{
        pythonPath = '.venv/Scripts/python.exe'
        ocrSource = '../PaddleOCR-main/PaddleOCR-main'
        modelCache = '.runtime/models'
        device = $(if ($Cpu) { 'cpu' } else { 'gpu:0' })
    }
    $qcConfig | ConvertTo-Json | Set-Content -LiteralPath '.runtime\config.json' -Encoding utf8
    $python | Set-Content -LiteralPath '.runtime\python-path.txt' -Encoding utf8
    & $python -B -X utf8 -m pytest python\tests\test_runtime.py -q
    if ($LASTEXITCODE -ne 0) { throw 'OCR 导入验证失败' }
    Write-Host 'OCR 环境已就绪；下载、Python 和缓存均保存在项目 .runtime 下。'
    if ($Cpu) { Write-Host '请在软件设置中选择 CPU 并保存。' }
} finally { Pop-Location }
