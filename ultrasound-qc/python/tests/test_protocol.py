import json
import os
import subprocess
import sys
from pathlib import Path


def test_real_worker_protocol_records_and_version_rejection(tmp_path):
    root = Path(__file__).resolve().parents[1]
    config = tmp_path / 'config.json'
    config.write_text(json.dumps({'dataRoot': str(tmp_path / 'records'), 'device': 'cpu'}), encoding='utf-8')
    process = subprocess.Popen([sys.executable, '-u', '-m', 'qcworker', str(config)], cwd=root, env={**os.environ, 'PYTHONPATH': str(root), 'PYTHONIOENCODING': 'utf-8'}, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
    def request(method, params=None, version=1):
        process.stdin.write(json.dumps({'version': version, 'request_id': 'test', 'method': method, 'params': params or {}})+'\n')
        process.stdin.flush()
        return json.loads(process.stdout.readline())
    try:
        assert request('ping')['result']['device'] == 'cpu'
        assert 'error' in request('ping', version=9)
        image = tmp_path / '中文报告.png'
        image.write_bytes(b'original')
        capture = request('create_capture', {'originalPath': str(image), 'croppedPath': str(image)})['result']
        record_id = capture['recordId']
        assert request('list_records')['result'][0]['recordId'] == record_id
        assert request('get_record', {'recordId': record_id})['result']['capture']['originalPath'].endswith('original.png')
        assert 'error' in request('unsupported')
        assert request('shutdown')['result'] is True
        assert process.wait(timeout=5) == 0
    finally:
        if process.poll() is None:
            process.kill()
