import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from qcworker.records import RecordStore
from PIL import Image

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
image = root / '合成测试报告.png'
Image.new('RGB', (400, 600), 'white').save(image)
doc = {'width': 400, 'height': 600, 'warnings': [], 'blocks': [
    {'sourceId': 'b0', 'kind': 'paragraph', 'text': '检查部位：双肾', 'bbox': [0, 0, 100, 20]},
    {'sourceId': 'b1', 'kind': 'paragraph', 'text': '超声所见：双肾轮廓清晰。', 'bbox': [0, 20, 100, 40]},
    {'sourceId': 'b2', 'kind': 'paragraph', 'text': '超声提示：未见明显异常。', 'bbox': [0, 40, 100, 60]},
]}
payload = {'examination': [{'sourceId': 'b0', 'text': '双肾'}], 'findings': [{'sourceId': 'b1', 'text': '双肾轮廓清晰。'}], 'measurements': [], 'conclusion': [{'sourceId': 'b2', 'text': '未见明显异常。'}]}
store = RecordStore(root)
capture = store.create_capture(str(image), str(image), None)
store.save_ocr(capture['recordId'], doc)
attempt = store.add_attempt(capture['recordId'], payload, doc)
store.finish_attempt(capture['recordId'], attempt, {'status': 'passed', 'summary': '合成测试：未发现问题', 'issues': []}, {'model': 'synthetic-test', 'sentToModel': False})
store.close()
