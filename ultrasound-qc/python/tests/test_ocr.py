from qcworker.ocr import OcrEngine, parse_document


def test_table_keeps_headers_empty_cells_and_order():
    data = {'parsing_res_list': [
        {'block_label': 'text', 'block_content': '检查部位：心脏', 'block_bbox': [0, 0, 100, 20]},
        {'block_label': 'table', 'block_content': '<table><tr><td>项目</td><td>值(mm)</td></tr><tr><td>左房</td><td>38</td></tr><tr><td>右房</td><td></td></tr></table>', 'block_bbox': [0, 20, 100, 100]},
    ]}
    doc = parse_document(data, 100, 200)
    cells = [b for b in doc['blocks'] if b['kind'] == 'cell']
    assert [b['text'] for b in cells] == ['项目', '值(mm)', '左房', '38', '右房', '']
    assert cells[-1]['row'] == 2 and cells[-1]['column'] == 1
    assert len({b['sourceId'] for b in doc['blocks']}) == 7


def test_unknown_confidence_stays_unknown():
    doc = parse_document({'parsing_res_list': [{'block_label': 'text', 'block_content': '文字'}]}, 100, 100)
    assert doc['blocks'][0].get('confidence') is None


def test_model_initialized_once():
    calls = []
    engine = OcrEngine({'device': 'cpu'}, factory=lambda config: calls.append(config) or object())
    engine.initialize()
    engine.initialize()
    assert len(calls) == 1


def test_low_confidence_stops_automatic_send():
    data = {'overall_ocr_res': {'rec_texts': ['异常字'], 'rec_scores': [0.3], 'rec_boxes': [[0, 0, 90, 15]]}}
    assert parse_document(data, 100, 100)['warnings']


def test_recovers_examination_header_misclassified_as_image():
    data = {'parsing_res_list': [{'block_label': 'image', 'block_content': '', 'block_bbox': [0, 0, 100, 40]}, {'block_label': 'text', 'block_content': '超声所见：轮廓清晰', 'block_bbox': [0, 45, 100, 70]}], 'overall_ocr_res': {'rec_texts': ['检查部位：双肾', '患者姓名：某某'], 'rec_boxes': [[0, 0, 100, 10], [0, 15, 100, 25]]}}
    doc = parse_document(data, 100, 100)
    assert doc['blocks'][0]['text'] == '检查部位：双肾'
    assert all('患者姓名' not in block['text'] for block in doc['blocks'])


def test_fallback_keeps_body_when_only_header_was_recovered():
    doc = parse_document({'rec_texts': ['检查部位：肝脏', '超声所见：肝脏轮廓清晰', '超声提示：未见异常']}, 100, 100)
    assert any('肝脏轮廓清晰' in block['text'] for block in doc['blocks'])


def test_uses_verified_cell_boxes_instead_of_table_bbox():
    html = '<table><tr><td>左房</td><td>38</td></tr></table>'
    data = {'parsing_res_list': [{'block_label': 'table', 'block_content': html, 'block_bbox': [0, 0, 100, 50]}], 'table_res_list': [{'pred_html': html, 'cell_box_list': [[0, 0, 50, 50], [50, 0, 100, 50]]}]}
    doc = parse_document(data, 100, 100)
    assert doc['blocks'][1]['bbox'] == [50, 0, 100, 50]


def test_recovers_missing_section_headings_in_reading_order_with_warning():
    data = {'parsing_res_list': [
        {'block_label': 'text', 'block_content': '检查部位：双肾', 'block_bbox': [0, 0, 100, 10]},
        {'block_label': 'text', 'block_content': '双肾轮廓清晰', 'block_bbox': [10, 40, 100, 60]},
        {'block_label': 'text', 'block_content': '未见明显异常', 'block_bbox': [10, 90, 100, 110]},
    ], 'overall_ocr_res': {'rec_texts': ['超声所见：', '超声提示：'], 'rec_boxes': [[0, 20, 80, 35], [0, 75, 80, 90]]}}
    doc = parse_document(data, 120, 140)
    assert [block['text'] for block in doc['blocks']] == ['检查部位：双肾', '超声所见：', '双肾轮廓清晰', '超声提示：', '未见明显异常']
    assert any('标题' in warning for warning in doc['warnings'])


def test_recovered_conclusion_keeps_text_even_if_same_words_exist_in_findings():
    data = {'parsing_res_list': [{'block_label': 'text', 'block_content': '双肾未见异常', 'block_bbox': [0, 30, 100, 50]}], 'overall_ocr_res': {'rec_texts': ['超声提示：未见异常'], 'rec_boxes': [[0, 100, 100, 120]]}}
    doc = parse_document(data, 100, 140)
    assert doc['blocks'][-1]['text'] == '超声提示：未见异常'


def test_recovered_heading_does_not_duplicate_already_present_same_line_body():
    data = {'parsing_res_list': [{'block_label': 'text', 'block_content': '未见异常', 'block_bbox': [45, 100, 100, 120]}], 'overall_ocr_res': {'rec_texts': ['超声提示：未见异常'], 'rec_boxes': [[0, 100, 100, 120]]}}
    doc = parse_document(data, 100, 140)
    assert [block['text'] for block in doc['blocks']] == ['超声提示：', '未见异常']
