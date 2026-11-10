from pathlib import Path
import subprocess
import sys


def test_chardet_pure_wheel_imports_in_fresh_process():
    # A warm parent process cannot reveal a blocked native extension on import.
    check = '''
from email import message_from_string
from importlib.metadata import distribution
from pathlib import Path
import chardet

installed = distribution('chardet')
assert installed.version == '7.7.0'
wheel = message_from_string(installed.read_text('WHEEL') or '')
assert wheel.get('Root-Is-Purelib', '').strip().lower() == 'true'
assert Path(chardet.__file__).suffix == '.py'
assert not any(str(file).lower().endswith(('.pyd', '.so')) for file in installed.files or [])
detected = chardet.detect(b'Ultrasound QC synthetic ASCII report 123')
assert detected['encoding'].lower() == 'ascii', detected
print('ok')
'''
    result = subprocess.run(
        [sys.executable, '-B', '-X', 'utf8', '-c', check],
        capture_output=True, text=True, encoding='utf-8', timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.strip() == 'ok'


def test_runtime_imports_and_local_ocr_source():
    import paddle
    import paddlex
    import paddleocr
    assert paddle.__version__
    assert paddlex.__version__
    expected = Path(__file__).resolve().parents[3] / 'PaddleOCR-main' / 'PaddleOCR-main'
    assert Path(paddleocr.__file__).resolve().is_relative_to(expected)
