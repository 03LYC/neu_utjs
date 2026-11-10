import json
import os
import re
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat()


class RecordStore:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / 'records.sqlite3')
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS records (
                id TEXT PRIMARY KEY, created TEXT NOT NULL, status TEXT NOT NULL,
                capture TEXT NOT NULL, ocr TEXT, error TEXT);
            CREATE TABLE IF NOT EXISTS attempts (
                id TEXT PRIMARY KEY, record_id TEXT NOT NULL, created TEXT NOT NULL,
                payload TEXT NOT NULL, document TEXT, result TEXT, metadata TEXT);
        ''')
        interrupted_result = json.dumps({'status': 'failed', 'summary': '上次任务未完成，请重新质控', 'issues': []}, ensure_ascii=False)
        self.db.execute("UPDATE attempts SET result=?, metadata=? WHERE result IS NULL AND record_id IN (SELECT id FROM records WHERE status IN ('processing', 'awaiting_confirmation'))", (interrupted_result, json.dumps({'interrupted': True, 'sentToModel': None})))
        self.db.execute("UPDATE records SET status='failed', error='上次任务未完成，请重新质控' WHERE status IN ('processing', 'awaiting_confirmation')")
        self.db.commit()

    def _directory(self, record_id):
        if not re.fullmatch(r'[a-f0-9]{32}', record_id):
            raise ValueError('无效记录编号')
        path = self.root / record_id
        if path.is_symlink() or path.resolve().parent != self.root:
            raise ValueError('记录路径不安全')
        return path

    def _atomic_json(self, path, data):
        temporary = path.with_suffix('.tmp')
        def encode(value):
            if hasattr(value, 'tolist'):
                return value.tolist()
            raise TypeError(f'Unsupported JSON value: {type(value).__name__}')
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=encode), encoding='utf-8')
        os.replace(temporary, path)

    def create_capture(self, original_path, cropped_path, roi=None):
        record_id = uuid.uuid4().hex
        folder = self._directory(record_id)
        folder.mkdir()
        original = folder / ('original' + Path(original_path).suffix.lower())
        cropped = folder / ('crop' + Path(cropped_path).suffix.lower())
        try:
            shutil.copyfile(original_path, original)
            shutil.copyfile(cropped_path, cropped)
            capture = dict(recordId=record_id, createdAt=now(), originalPath=str(original), croppedPath=str(cropped), roi=roi)
            self._atomic_json(folder / 'capture.json', capture)
            with self.db:
                self.db.execute('INSERT INTO records(id,created,status,capture) VALUES(?,?,?,?)', (record_id, capture['createdAt'], 'processing', json.dumps(capture)))
            return capture
        except Exception:
            shutil.rmtree(folder)
            raise

    def save_ocr(self, record_id, document, raw=None):
        folder = self._directory(record_id)
        if not (folder / 'ocr.json').exists():
            self._atomic_json(folder / 'ocr.json', document)
            (folder / 'ocr.txt').write_text('\n'.join(b.get('text', '') for b in document.get('blocks', [])), encoding='utf-8')
        if raw is not None and not (folder / 'paddle-ocr.json').exists():
            self._atomic_json(folder / 'paddle-ocr.json', raw)
            full_text = '\n'.join(raw.get('overall_ocr_res', raw).get('rec_texts', []))
            (folder / 'ocr-full.txt').write_text(full_text, encoding='utf-8')
        with self.db:
            self.db.execute('UPDATE records SET ocr=COALESCE(ocr,?) WHERE id=?', (json.dumps(document, ensure_ascii=False), record_id))

    def set_status(self, record_id, status, error=None):
        self._directory(record_id)
        if status not in ('processing', 'awaiting_confirmation', 'passed', 'issues_found', 'needs_review', 'failed'):
            raise ValueError('无效状态')
        with self.db:
            self.db.execute('UPDATE records SET status=?,error=? WHERE id=?', (status, error, record_id))

    def add_attempt(self, record_id, payload, document=None):
        self._directory(record_id)
        if not self.db.execute('SELECT id FROM records WHERE id=?', (record_id,)).fetchone():
            raise ValueError('记录不存在')
        attempt_id = uuid.uuid4().hex
        with self.db:
            self.db.execute('INSERT INTO attempts(id,record_id,created,payload,document) VALUES(?,?,?,?,?)', (attempt_id, record_id, now(), json.dumps(payload, ensure_ascii=False), json.dumps(document, ensure_ascii=False) if document is not None else None))
        return attempt_id

    def finish_attempt(self, record_id, attempt_id, result, metadata):
        status = result.get('status')
        if status not in ('passed', 'issues_found', 'needs_review', 'failed'):
            raise ValueError('无效结果状态')
        row = self.db.execute('SELECT id FROM attempts WHERE id=? AND record_id=?', (attempt_id, record_id)).fetchone()
        if not row:
            raise ValueError('尝试不存在')
        self._atomic_json(self._directory(record_id) / f'result-{attempt_id}.json', {'result': result, 'metadata': metadata})
        with self.db:
            self.db.execute('UPDATE attempts SET result=?,metadata=? WHERE id=?', (json.dumps(result, ensure_ascii=False), json.dumps(metadata, ensure_ascii=False), attempt_id))
            self.db.execute('UPDATE records SET status=?,error=NULL WHERE id=?', (status, record_id))

    def update_attempt(self, record_id, attempt_id, payload, document):
        self._directory(record_id)
        with self.db:
            cursor = self.db.execute('UPDATE attempts SET payload=?,document=? WHERE id=? AND record_id=? AND result IS NULL', (json.dumps(payload, ensure_ascii=False), json.dumps(document, ensure_ascii=False) if document is not None else None, attempt_id, record_id))
            if cursor.rowcount != 1:
                raise ValueError('尝试不存在或已经结束')

    def list_records(self, status=None, limit=200, offset=0):
        limit = min(max(int(limit), 1), 1000)
        offset = max(int(offset), 0)
        rows = self.db.execute('SELECT id,created,status,error FROM records WHERE (? IS NULL OR status=?) ORDER BY created DESC LIMIT ? OFFSET ?', (status, status, limit, offset)).fetchall()
        return [dict(recordId=r['id'], createdAt=r['created'], status=r['status'], error=r['error']) for r in rows]

    def get_record(self, record_id):
        self._directory(record_id)
        row = self.db.execute('SELECT * FROM records WHERE id=?', (record_id,)).fetchone()
        if not row:
            raise ValueError('记录不存在')
        attempts = []
        for a in self.db.execute('SELECT * FROM attempts WHERE record_id=? ORDER BY created', (record_id,)).fetchall():
            attempts.append(dict(attemptId=a['id'], createdAt=a['created'], payload=json.loads(a['payload']), document=json.loads(a['document']) if a['document'] else None, result=json.loads(a['result']) if a['result'] else None, metadata=json.loads(a['metadata']) if a['metadata'] else {}))
        return dict(recordId=record_id, createdAt=row['created'], status=row['status'], error=row['error'], capture=json.loads(row['capture']), ocr=json.loads(row['ocr']) if row['ocr'] else None, attempts=attempts)

    def delete_record(self, record_id):
        folder = self._directory(record_id)
        # Rename first; if database transaction fails, restore the directory.
        trash = self.root / ('deleted-' + record_id)
        if folder.exists():
            os.replace(folder, trash)
        try:
            with self.db:
                self.db.execute('DELETE FROM attempts WHERE record_id=?', (record_id,))
                self.db.execute('DELETE FROM records WHERE id=?', (record_id,))
        except Exception:
            if trash.exists():
                os.replace(trash, folder)
            raise
        if trash.exists():
            shutil.rmtree(trash)
        return True

    def close(self):
        self.db.close()
