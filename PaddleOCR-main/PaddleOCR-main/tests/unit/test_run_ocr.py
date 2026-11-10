"""Test the VS Code entry point without loading models or opening windows."""

import importlib.util
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def runner():
    spec = importlib.util.spec_from_file_location(
        "run_ocr", Path(__file__).resolve().parents[2] / "run_ocr.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # 原有契约测试继续覆盖纯文字模式；文档模式另测。
    module.RECOGNITION_MODE = "text"
    return module


@pytest.fixture
def fake_ocr(monkeypatch):
    class Result(dict):
        def save_all(self, path):
            self.saved_path = Path(path)

    result = Result(rec_texts=["中文识别", "Hello OCR"])
    state = SimpleNamespace(result=result, closed=False, error=None)

    class OCR:
        def __init__(self, **kwargs):
            state.kwargs = kwargs

        def predict_iter(self, path):
            state.input_path = Path(path)
            if state.error:
                raise state.error
            yield result

        def close(self):
            state.closed = True

    monkeypatch.setitem(sys.modules, "paddleocr", SimpleNamespace(PaddleOCR=OCR))
    return state


def test_save_unicode_text_and_results(runner, fake_ocr, tmp_path, monkeypatch):
    image = tmp_path / "中文照片.png"
    image.touch()
    monkeypatch.setattr(runner, "OUTPUT_DIR", tmp_path / "output")
    monkeypatch.delenv("PADDLE_PDX_CACHE_HOME", raising=False)

    text_path, lines = runner.recognize_image(image)

    assert text_path.read_text(encoding="utf-8") == "中文识别\nHello OCR"
    assert lines == ["中文识别", "Hello OCR"]
    assert fake_ocr.result.saved_path == text_path.parent
    assert fake_ocr.input_path == image
    assert fake_ocr.closed
    assert fake_ocr.kwargs == {
        "lang": "ch",
        "ocr_version": "PP-OCRv6",
        "device": "gpu:0",
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
    }
    assert os.environ["PADDLE_PDX_CACHE_HOME"] == str(runner.CACHE_DIR)


def test_relative_image_and_existing_cache(runner, fake_ocr, tmp_path, monkeypatch):
    (tmp_path / "sample.png").touch()
    monkeypatch.setattr(runner, "PROJECT_DIR", tmp_path)
    monkeypatch.setattr(runner, "OUTPUT_DIR", tmp_path / "output")
    monkeypatch.setenv("PADDLE_PDX_CACHE_HOME", str(tmp_path / "custom_cache"))

    runner.recognize_image("sample.png")

    assert fake_ocr.input_path == tmp_path / "sample.png"
    assert os.environ["PADDLE_PDX_CACHE_HOME"] == str(tmp_path / "custom_cache")


def test_missing_image_does_not_create_output(runner, tmp_path, monkeypatch):
    output_dir = tmp_path / "output"
    monkeypatch.setattr(runner, "OUTPUT_DIR", output_dir)
    with pytest.raises(FileNotFoundError):
        runner.recognize_image(tmp_path / "missing.png")
    assert not output_dir.exists()


def test_close_on_prediction_failure(runner, fake_ocr, tmp_path, monkeypatch):
    image = tmp_path / "sample.png"
    image.touch()
    monkeypatch.setattr(runner, "OUTPUT_DIR", tmp_path / "output")
    fake_ocr.error = RuntimeError("prediction failed")
    with pytest.raises(RuntimeError, match="prediction failed"):
        runner.recognize_image(image)
    assert fake_ocr.closed


def test_repeated_runs_preserve_previous_results(runner, fake_ocr, tmp_path, monkeypatch):
    image = tmp_path / "sample.png"
    image.touch()
    monkeypatch.setattr(runner, "OUTPUT_DIR", tmp_path / "output")
    fixed_time = runner.datetime.now()
    monkeypatch.setattr(runner, "datetime", SimpleNamespace(now=lambda: fixed_time))
    first, _ = runner.recognize_image(image)
    second, _ = runner.recognize_image(image)
    assert first != second
    assert first.exists() and second.exists()


def test_cancel_does_not_load_models(runner, monkeypatch):
    monkeypatch.setattr(runner, "choose_image", lambda: None)

    def unexpected(*args, **kwargs):
        pytest.fail("Cancelling must not load models or show another dialog")

    monkeypatch.setattr(runner, "recognize_image", unexpected)
    monkeypatch.setattr(runner, "show_message", unexpected)
    assert runner.main() == 0


def test_fixed_image_skips_picker(runner, monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "IMAGE_PATH", "sample.png")

    def unexpected():
        pytest.fail("A fixed image must not open the file picker")

    monkeypatch.setattr(runner, "choose_image", unexpected)
    monkeypatch.setattr(
        runner, "recognize_image", lambda image: (tmp_path / "sample.txt", ["中文"])
    )
    messages = []
    monkeypatch.setattr(runner, "show_message", lambda *args: messages.append(args))
    assert runner.main() == 0
    assert "中文" in messages[0][1]


def test_error_is_reported(runner, monkeypatch):
    monkeypatch.setattr(runner, "IMAGE_PATH", "missing.png")
    messages = []
    monkeypatch.setattr(
        runner, "show_message", lambda *args, **kwargs: messages.append((args, kwargs))
    )
    assert runner.main() == 1
    assert messages[0][1]["error"] is True


@pytest.fixture
def fake_document(monkeypatch):
    table = (
        '<table><tr><th colspan="2">心功能检查</th></tr>'
        '<tr><td rowspan="2">左心室</td><td>42</td></tr>'
        '<tr><td></td></tr></table>'
    )
    data = {
        "overall_ocr_res": {"rec_texts": ["心功能检查", "左心室", "42", "正文"]},
        "parsing_res_list": [
            {"block_label": "text", "block_content": "标题 <测试>"},
            {"block_label": "table", "block_content": table},
            {"block_label": "text", "block_content": "表格下方正文"},
        ],
        "table_res_list": [{"pred_html": table}],
    }
    state = SimpleNamespace(data=data, saved=[], closed=False, xlsx_error=None)

    class Result(dict):
        def __init__(self):
            super().__init__(data)

        @property
        def json(self):
            return {"res": data}

        def save_to_json(self, path):
            state.saved.append(("json", Path(path)))

        def save_to_img(self, path):
            state.saved.append(("img", Path(path)))

        def save_to_html(self, path):
            state.saved.append(("html", Path(path)))

        def save_to_xlsx(self, path):
            if state.xlsx_error:
                raise state.xlsx_error
            state.saved.append(("xlsx", Path(path)))

    class Pipeline:
        def __init__(self, **kwargs):
            state.kwargs = kwargs

        def predict_iter(self, path):
            yield Result()

        def close(self):
            state.closed = True

    monkeypatch.setitem(sys.modules, "paddleocr", SimpleNamespace(PPStructureV3=Pipeline))
    return state


def test_document_preserves_table_and_text(runner, fake_document, tmp_path, monkeypatch):
    image = tmp_path / "中文照片.png"
    image.touch()
    monkeypatch.setattr(runner, "OUTPUT_DIR", tmp_path / "output")
    text_path, lines = runner.recognize_image(image, mode="document")

    report = text_path.with_suffix(".html").read_text(encoding="utf-8")
    assert '<th colspan="2">心功能检查</th>' in report
    assert '<td rowspan="2">左心室</td>' in report
    assert "<td></td>" in report
    assert "标题 &lt;测试&gt;" in report
    assert report.index("标题") < report.index("<table>") < report.index("表格下方正文")
    assert text_path.read_text(encoding="utf-8") == "\n".join(lines)
    assert fake_document.saved == [
        (kind, text_path.parent) for kind in ("json", "img", "html", "xlsx")
    ]
    assert fake_document.kwargs["use_table_recognition"] is True
    assert fake_document.kwargs["ocr_version"] == "PP-OCRv5"
    assert fake_document.closed


def test_document_without_table(runner, fake_document, tmp_path, monkeypatch):
    image = tmp_path / "plain.png"
    image.touch()
    monkeypatch.setattr(runner, "OUTPUT_DIR", tmp_path / "output")
    fake_document.data["table_res_list"] = []
    fake_document.data["parsing_res_list"] = [
        {"block_label": "text", "block_content": "普通正文\n第二行文字\n\n  缩进文字"},
        {"block_label": "text", "block_content": "第二段正文"},
    ]
    path, _ = runner.recognize_image(image, mode="document")
    report = path.with_suffix(".html").read_text(encoding="utf-8")
    assert '<p class="text">普通正文\n第二行文字\n\n  缩进文字</p>' in report
    assert '<p class="text">第二段正文</p>' in report
    assert "white-space: pre-wrap" in report
    assert "未检测到表格" not in report
    assert "同目录的 XLSX" not in report
    assert "请对照原图核对" not in report
    assert "plain.png" not in report
    assert path.read_text(encoding="utf-8") == (
        "普通正文\n第二行文字\n\n  缩进文字\n\n第二段正文"
    )
    assert "<table>" not in report
    assert [kind for kind, _ in fake_document.saved] == ["json", "img"]


def test_excel_failure_keeps_readable_report(runner, fake_document, tmp_path, monkeypatch):
    image = tmp_path / "table.png"
    image.touch()
    monkeypatch.setattr(runner, "OUTPUT_DIR", tmp_path / "output")
    fake_document.xlsx_error = RuntimeError("export failed")
    path, _ = runner.recognize_image(image, mode="document")
    report = path.with_suffix(".html").read_text(encoding="utf-8")
    assert "Excel 导出失败" in report
    assert "export failed" in report
    assert "<table>" in report
    assert fake_document.closed


def test_report_escapes_active_content(runner):
    report = runner.render_document(
        {
            "parsing_res_list": [
                {"block_label": "text", "block_content": '<img src="x" onerror="f()">'},
                {
                    "block_label": "table",
                    "block_content": '<table onclick="f()"><tr><td colspan="2">'
                    '&lt;script&gt;<img src="https://example.com">A/E &gt;1'
                    "</td></tr></table>",
                },
            ]
        }
    )
    assert "<img" not in report
    assert '<table onclick=' not in report
    assert '<td colspan="2">&lt;script&gt;A/E &gt;1</td>' in report


def test_document_main_opens_html(runner, monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "IMAGE_PATH", "sample.png")
    path = tmp_path / "中文照片.txt"
    path.with_suffix(".html").write_text("<table></table>", encoding="utf-8")
    monkeypatch.setattr(runner, "recognize_image", lambda image: (path, ["42"]))
    opened = []
    monkeypatch.setattr(runner.webbrowser, "open", lambda url: opened.append(url))

    def unexpected(*args, **kwargs):
        pytest.fail("Opening a document report must not show a completion dialog")

    monkeypatch.setattr(runner, "show_message", unexpected)
    assert runner.main() == 0
    assert opened == [path.with_suffix(".html").as_uri()]


def test_invalid_mode(runner):
    with pytest.raises(ValueError, match="RECOGNITION_MODE"):
        runner.recognize_image("sample.png", mode="invalid")


def test_skewed_cells_are_matched_by_position(runner):
    pytest.importorskip("bs4")
    # 同一行两端相差 12px，旧的 10px 容差会把右侧排到左侧前面。
    table = {
        "pred_html": '<table><tr><td colspan="2">标题</td></tr>'
        '<tr><td>23</td><td>主动脉根部</td></tr>'
        '<tr><td></td><td>A/E &gt;1</td></tr></table>',
        "cell_box_list": [
            [0, 0, 200, 40],
            [100, 40, 200, 80],
            [0, 52, 100, 92],
            [100, 80, 200, 120],
            [0, 92, 100, 132],
        ],
        "table_ocr_pred": {
            "rec_boxes": [
                [20, 5, 180, 30],
                [10, 57, 90, 82],
                [110, 45, 190, 70],
                [110, 85, 190, 110],
                [0, 150, 100, 180],
            ],
            "rec_texts": ["标题", "主动脉根部", "23", "A/E >1", "表格外正文"],
        },
    }
    html = runner.align_table_text(table)
    assert '<td colspan="2">标题</td>' in html
    assert "<tr><td>主动脉根部</td><td>23</td></tr>" in html
    assert "<tr><td></td><td>A/E &gt;1</td></tr>" in html
    assert "表格外正文" not in html


def test_uncertain_table_alignment_keeps_original(runner):
    pytest.importorskip("bs4")
    table = {
        "pred_html": "<table><tr><td>原始结果</td><td></td></tr></table>",
        "cell_box_list": [[0, 0, 100, 40]],
        "table_ocr_pred": {"rec_boxes": [[0, 0, 50, 30]], "rec_texts": ["文字"]},
    }
    assert runner.align_table_text(table) is None
    assert "原始结果" in table["pred_html"]


def test_incomplete_ocr_matching_keeps_original(runner):
    pytest.importorskip("bs4")
    table = {
        "pred_html": "<table><tr><td>已有文字</td><td>23</td></tr></table>",
        "cell_box_list": [[0, 0, 100, 40], [100, 0, 200, 40]],
        "table_ocr_pred": {"rec_boxes": [[110, 5, 190, 35]], "rec_texts": ["23"]},
    }
    assert runner.align_table_text(table) is None
    assert "已有文字" in table["pred_html"]


def test_large_int16_ocr_boxes_do_not_overflow(runner):
    pytest.importorskip("bs4")
    np = pytest.importorskip("numpy")
    table = {
        "pred_html": "<table><tr><td>B</td><td>A</td></tr></table>",
        "cell_box_list": np.array([[0, 0, 400, 100], [400, 0, 800, 100]], dtype=np.int16),
        "table_ocr_pred": {
            "rec_boxes": np.array([[0, 0, 400, 100], [400, 0, 800, 100]], dtype=np.int16),
            "rec_texts": ["A", "B"],
        },
    }
    assert runner.align_table_text(table) == "<table><tr><td>A</td><td>B</td></tr></table>"


def test_ambiguous_geometric_rows_keep_original(runner):
    pytest.importorskip("bs4")
    boxes = [[0, 0, 100, 45], [100, 25, 200, 70], [0, 20, 100, 65], [100, 45, 200, 90]]
    table = {
        "pred_html": "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>",
        "cell_box_list": boxes,
        "table_ocr_pred": {"rec_boxes": boxes, "rec_texts": ["A", "B", "C", "D"]},
    }
    assert runner.align_table_text(table) is None


def test_identical_tables_are_not_assigned_to_the_same_block(runner, monkeypatch):
    tables = [{"pred_html": "same", "id": 1}, {"pred_html": "same", "id": 2}]
    blocks = [SimpleNamespace(label="table", content="same") for _ in range(2)]
    monkeypatch.setattr(runner, "align_table_text", lambda table: str(table["id"]))
    runner.align_document_tables({"table_res_list": tables, "parsing_res_list": blocks})
    assert [table["pred_html"] for table in tables] == ["same", "same"]
    assert [block.content for block in blocks] == ["same", "same"]


def test_table_alignment_updates_exports_and_document(runner, monkeypatch):
    table = {"pred_html": "old"}
    block = SimpleNamespace(label="table", content="old")
    text = SimpleNamespace(label="text", content="正文")
    result = {"table_res_list": [table], "parsing_res_list": [block, text]}
    monkeypatch.setattr(runner, "align_table_text", lambda table: "aligned")
    runner.align_document_tables(result)
    assert table["pred_html"] == block.content == "aligned"
    assert text.content == "正文"
