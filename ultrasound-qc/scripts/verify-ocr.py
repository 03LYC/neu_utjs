import argparse
import json
import sys
import time
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'python'))
from qcworker.ocr import OcrEngine

parser = argparse.ArgumentParser()
parser.add_argument('--device', default='gpu:0')
parser.add_argument('--limit', type=int, default=4)
parser.add_argument('--unwarping', action='store_true')
args = parser.parse_args()
config = json.loads((root / '.runtime/config.json').read_text(encoding='utf-8-sig'))
config['device'] = args.device
config['unwarping'] = args.unwarping
engine = OcrEngine(config)
start = time.monotonic()
engine.initialize()
out = root / '.runtime' / 'verification'
out.mkdir(exist_ok=True, parents=True)
summary = {'device': args.device, 'initializeSeconds': round(time.monotonic()-start, 2), 'reports': []}
samples = root.parent / '0614报告截图' / '0614报告截图'
try:
    for folder in list(sorted(p for p in samples.iterdir() if p.is_dir()))[:args.limit]:
        image = next(folder.glob('*.png'))
        document = engine.recognize(image)
        (out / f'raw-{folder.name}.json').write_text(json.dumps(engine.last_raw, ensure_ascii=False, default=lambda value: value.tolist() if hasattr(value, 'tolist') else str(value)), encoding='utf-8')
        (out / f'{folder.name}.json').write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding='utf-8')
        summary['reports'].append({'category': folder.name, 'filename': image.name, 'blocks': len(document['blocks']), 'cells': sum(b['kind']=='cell' for b in document['blocks']), 'warnings': document['warnings'], 'elapsedMs': document['elapsedMs']})
        print(json.dumps(summary['reports'][-1], ensure_ascii=False), flush=True)
finally:
    engine.close()
    (out / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    (out / ('summary-cpu.json' if args.device == 'cpu' else 'summary-gpu.json')).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
