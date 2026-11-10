from pathlib import Path
import pytest
from qcworker.records import RecordStore


def test_unique_capture_paths_with_unicode_names(tmp_path):
    store = RecordStore(tmp_path / '数据')
    image = tmp_path / '报告.png'
    image.write_bytes(b'original')
    a = store.create_capture(str(image), str(image), {'x': 0, 'y': 0, 'width': 1, 'height': 1})
    b = store.create_capture(str(image), str(image), None)
    assert a['recordId'] != b['recordId']
    assert Path(a['originalPath']).read_bytes() == b'original'
    assert len(store.list_records()) == 2


def test_retry_preserves_first_ocr(tmp_path):
    store = RecordStore(tmp_path / 'data')
    image = tmp_path / '报告.png'
    image.write_bytes(b'x')
    rec = store.create_capture(str(image), str(image), None)
    store.save_ocr(rec['recordId'], {'blocks': [{'text': '原文'}]})
    a = store.add_attempt(rec['recordId'], {'findings': '修订'}, {'blocks': []})
    store.finish_attempt(rec['recordId'], a, {'status': 'needs_review', 'issues': [], 'summary': '核对'}, {'model': 'test'})
    doc = store.get_record(rec['recordId'])
    assert doc['ocr']['blocks'][0]['text'] == '原文'
    assert doc['attempts'][0]['payload']['findings'] == '修订'


def test_delete_cannot_escape_root(tmp_path):
    store = RecordStore(tmp_path / 'data')
    with pytest.raises(ValueError):
        store.delete_record('../outside')


def test_failed_write_cannot_finish_as_passed(tmp_path, monkeypatch):
    store = RecordStore(tmp_path / 'data')
    image = tmp_path / 'x.png'
    image.write_bytes(b'x')
    rec = store.create_capture(str(image), str(image), None)
    attempt = store.add_attempt(rec['recordId'], {}, None)
    def fail(*args):
        raise OSError('disk full')
    monkeypatch.setattr(store, '_atomic_json', fail)
    with pytest.raises(OSError):
        store.finish_attempt(rec['recordId'], attempt, {'status': 'passed'}, {})
    assert store.get_record(rec['recordId'])['status'] != 'passed'


def test_restart_marks_incomplete_record(tmp_path):
    root = tmp_path / 'data'
    image = tmp_path / 'x.png'
    image.write_bytes(b'x')
    store = RecordStore(root)
    rec = store.create_capture(str(image), str(image), None)
    store.close()
    reopened = RecordStore(root)
    assert reopened.get_record(rec['recordId'])['status'] == 'failed'


def test_update_attempt_keeps_exact_sent_payload(tmp_path):
    store = RecordStore(tmp_path / 'data')
    image = tmp_path / 'x.png'
    image.write_bytes(b'x')
    rec = store.create_capture(str(image), str(image), None)
    attempt = store.add_attempt(rec['recordId'], {}, None)
    store.update_attempt(rec['recordId'], attempt, {'findings': '已核对文本'}, {'blocks': []})
    saved = store.get_record(rec['recordId'])['attempts'][0]
    assert saved['payload']['findings'] == '已核对文本'
    assert saved['document'] == {'blocks': []}


def test_restart_finishes_incomplete_attempt_as_failed(tmp_path):
    root = tmp_path / 'data'
    store = RecordStore(root)
    image = tmp_path / 'x.png'
    image.write_bytes(b'x')
    rec = store.create_capture(str(image), str(image), None)
    store.add_attempt(rec['recordId'], {}, None)
    store.close()
    reopened = RecordStore(root)
    assert reopened.get_record(rec['recordId'])['attempts'][0]['result']['status'] == 'failed'


def test_raw_ocr_is_saved_locally_without_overwriting_original(tmp_path):
    store = RecordStore(tmp_path / 'data')
    image = tmp_path / 'x.png'
    image.write_bytes(b'x')
    rec = store.create_capture(str(image), str(image), None)
    raw = {'overall_ocr_res': {'rec_texts': ['姓名：测试患者', '超声所见：轮廓清晰']}}
    store.save_ocr(rec['recordId'], {'blocks': []}, raw=raw)
    folder = Path(rec['originalPath']).parent
    assert '姓名：测试患者' in (folder / 'ocr-full.txt').read_text(encoding='utf-8')
    store.save_ocr(rec['recordId'], {'blocks': []}, raw={'overall_ocr_res': {'rec_texts': ['后来内容']}})
    assert '姓名：测试患者' in (folder / 'ocr-full.txt').read_text(encoding='utf-8')

