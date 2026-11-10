import importlib.util
import os
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.cells = []
        self.row = -1
        self.column = 0
        self.current = None
        self.occupied = set()

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row += 1
            self.column = 0
        elif tag in ('td', 'th'):
            attrs = dict(attrs)
            while (self.row, self.column) in self.occupied:
                self.column += 1
            def span(name):
                try:
                    return min(100, max(1, int(attrs.get(name, '1'))))
                except ValueError:
                    return 1
            self.current = dict(text='', row=max(0, self.row), column=self.column, rowspan=span('rowspan'), colspan=span('colspan'))
        elif tag == 'br' and self.current is not None:
            self.current['text'] += '\n'

    def handle_data(self, text):
        if self.current is not None:
            self.current['text'] += text

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.current is not None:
            cell = self.current
            cell['text'] = cell['text'].strip()
            self.cells.append(cell)
            for row in range(cell['row'], cell['row'] + cell['rowspan']):
                for col in range(cell['column'], cell['column'] + cell['colspan']):
                    self.occupied.add((row, col))
            self.column += cell['colspan']
            self.current = None


def bbox(value, width, height):
    try:
        box = [float(v) for v in value]
        if len(box) == 4:
            return box
    except (TypeError, ValueError):
        pass
    return [0.0, 0.0, float(width), float(height)]


def parse_document(data, width, height):
    blocks = []
    warnings = []
    tables = 0
    parsing = data.get('parsing_res_list', [])
    for index, block in enumerate(parsing):
        text = block.get('block_content', '')
        label = block.get('block_label', 'text')
        if label in ('image', 'figure', 'chart', 'seal', 'formula'):
            continue
        box = bbox(block.get('block_bbox'), width, height)
        if label == 'table':
            tables += 1
            parser = TableParser()
            parser.feed(text)
            parser.close()
            matching = [table for table in data.get('table_res_list', []) if table.get('pred_html') == text]
            cell_boxes = matching[0].get('cell_box_list', []) if len(matching) == 1 else []
            verified_boxes = len(cell_boxes) == len(parser.cells) and bool(cell_boxes)
            if data.get('table_res_list') and not verified_boxes:
                warnings.append('表格单元格坐标对应关系不确定，请核对表格结构')
            if not parser.cells:
                warnings.append('检测到表格但无法恢复单元格，请核对或重拍')
            for n, cell in enumerate(parser.cells):
                cell_box = bbox(cell_boxes[n], width, height) if verified_boxes else box
                blocks.append(dict(sourceId=f't{tables}c{n}', kind='cell', tableId=f't{tables}', bbox=cell_box, confidence=None, **cell))
        elif text.strip():
            # Keep line boundaries: a model block may combine several section headings.
            for line_index, line in enumerate(text.splitlines()):
                if line.strip():
                    blocks.append(dict(sourceId=f'b{index}l{line_index}', kind='paragraph', text=line.strip(), bbox=box, confidence=None))
    overall = data.get('overall_ocr_res', data)
    has_layout_blocks = bool(blocks)
    # Layout models sometimes absorb the report header into the ultrasound image region.
    # Recover only explicit report section headers, never image annotations or patient labels.
    header_blocks = []
    normalize = lambda text: re.sub(r'\s+', '', text)
    combined_text = ''.join(normalize(block['text']) for block in blocks)
    for i, text in enumerate(overall.get('rec_texts', [])):
        match = re.match(r'^\s*(检查部位|检查项目|超声所见|超声描述|检查所见|超声提示|超声诊断|诊断意见|检查结论|超声结论)\s*(?:[:：]|$)', text)
        if match and normalize(text) not in combined_text:
            boxes = overall.get('rec_boxes', [])
            scores = overall.get('rec_scores', [])
            header_text = text.strip()
            header_box = bbox(boxes[i] if i < len(boxes) else None, width, height)
            if match.group(1) not in ('检查部位', '检查项目'):
                tail = text[match.end():].strip()
                nearby_text = ''.join(normalize(block['text']) for block in blocks if abs(block['bbox'][1] - header_box[1]) <= max(10, header_box[3] - header_box[1]))
                if tail and normalize(tail) in nearby_text:
                    header_text = text[:match.end()].strip()
                warnings.append('分区标题仅在全文OCR中找到，已按坐标补回，请对照原图核对分区顺序')
            header_blocks.append(dict(sourceId=f'h{i}', kind='paragraph', text=header_text, bbox=header_box, confidence=float(scores[i]) if i < len(scores) else None))
    for header in sorted(header_blocks, key=lambda item: item['bbox'][1]):
        tolerance = max(3, (header['bbox'][3] - header['bbox'][1]) * 0.5)
        position = next((index for index, block in enumerate(blocks) if block['bbox'][1] >= header['bbox'][1] - tolerance), len(blocks))
        blocks.insert(position, header)
    if not has_layout_blocks:
        blocks = []
        for i, text in enumerate(overall.get('rec_texts', [])):
            scores = overall.get('rec_scores', [])
            boxes = overall.get('rec_boxes', [])
            confidence = float(scores[i]) if i < len(scores) else None
            blocks.append(dict(sourceId=f'b{i}', kind='paragraph', text=text, bbox=bbox(boxes[i] if i < len(boxes) else None, width, height), confidence=confidence))
        if blocks:
            warnings.append('版面分析未恢复报告结构，请核对阅读顺序和表格对应关系')
    scores = overall.get('rec_scores', [])
    if any(float(score) < 0.65 for score in scores):
        warnings.append('部分文字识别置信度较低，请对照原图核对数字和单位')
    if not blocks:
        warnings.append('未识别到文字，请检查拍照范围和清晰度')
    return dict(blocks=blocks, warnings=warnings, width=width, height=height)


class OcrEngine:
    def __init__(self, config, factory=None):
        self.config = config
        self.pipeline = None
        self.factory = factory
        self.dll_handles = []
        self.align_tables = None
        self.last_raw = None

    def initialize(self):
        if self.pipeline is not None:
            return
        if self.factory:
            self.pipeline = self.factory(self.config)
            return
        source = Path(self.config['ocrSource'])
        sys.path.insert(0, str(source))
        os.environ.setdefault('PADDLE_PDX_CACHE_HOME', self.config['modelCache'])
        os.environ.setdefault('PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK', 'True')
        os.environ.setdefault('PADDLE_PDX_MODEL_SOURCE', 'bos')
        if os.name == 'nt':
            packages = Path(sys.prefix) / 'Lib' / 'site-packages'
            for folder in list((packages / 'nvidia').glob('*/bin')) + [packages / 'paddle' / 'libs', packages / 'paddle' / 'base']:
                if folder.is_dir():
                    self.dll_handles.append(os.add_dll_directory(str(folder)))
                    os.environ['PATH'] = str(folder) + os.pathsep + os.environ.get('PATH', '')
        from paddleocr import PPStructureV3
        spec = importlib.util.spec_from_file_location('existing_report_ocr', source / 'run_ocr.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.align_tables = module.align_document_tables
        self.pipeline = PPStructureV3(
            lang='ch', ocr_version='PP-OCRv5', device=self.config.get('device', 'gpu:0'),
            use_doc_orientation_classify=False, use_doc_unwarping=self.config.get('unwarping', False), use_textline_orientation=False,
            use_table_recognition=True, use_formula_recognition=False, use_seal_recognition=False,
            use_chart_recognition=False, use_region_detection=False, format_block_content=False,
            layout_unclip_ratio={8: [1.0, 1.2]},
            enable_mkldnn=False,
        )

    def recognize(self, image_path):
        from PIL import Image
        self.initialize()
        with Image.open(image_path) as img:
            width, height = img.size
        start = time.monotonic()
        results = list(self.pipeline.predict_iter(str(image_path)))
        if len(results) != 1:
            raise ValueError('本版本每次仅支持一张单页报告')
        result = results[0]
        if self.align_tables:
            self.align_tables(result)
        self.last_raw = result.json['res']
        document = parse_document(self.last_raw, width, height)
        document['fullText'] = '\n'.join(self.last_raw.get('overall_ocr_res', {}).get('rec_texts', []))
        document['elapsedMs'] = round((time.monotonic() - start) * 1000)
        return document

    def close(self):
        if self.pipeline is not None and hasattr(self.pipeline, 'close'):
            self.pipeline.close()
        self.pipeline = None
