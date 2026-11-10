"""在 VS Code 中打开本文件，点击右上角“运行 Python 文件”即可识别图片。

请使用 pytorch_2 解释器。默认弹出图片选择框；也可以修改 IMAGE_PATH 固定图片。
默认识别文档和表格，完成后在浏览器查看 HTML；表格同时导出为 Excel。
识别结果保存到本项目的 inference_results 文件夹，不会修改原始图片。
"""

import os
import sys
import tempfile
import webbrowser
from collections import Counter
from datetime import datetime
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from statistics import median

PROJECT_DIR = Path(__file__).resolve().parent

# 留空：运行时选择图片。也可填写完整路径，例如 r"D:\照片\文字照片.jpg"。
IMAGE_PATH = ""
# 要直接运行项目自带示例，可改为 "test_tipc/web/test.jpg"。
DEVICE = "gpu:0"
# document：保留段落和表格结构；text：原来的快速纯文字识别。
RECOGNITION_MODE = "document"
OPEN_RESULT = True
# 拍照文档先矫正形变；扫描件可关闭以加快识别。
USE_DOC_UNWARPING = True
# 稍微扩大表格区域，避免漏掉紧贴边界的表头；(1.0, 1.0) 表示不扩大。
TABLE_BOX_EXPAND = (1.0, 1.2)
OUTPUT_DIR = PROJECT_DIR / "inference_results"
CACHE_DIR = PROJECT_DIR.parent / "PaddleOCR-cache"


def choose_image():
    """选择一张图片；点击取消时返回 None，不加载模型。"""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        selected = filedialog.askopenfilename(
            parent=root,
            title="选择需要识别文字的图片",
            initialdir=str(PROJECT_DIR),
            filetypes=[
                ("图片", "*.jpg *.jpeg *.png *.bmp *.tif *.tiff *.webp"),
                ("所有文件", "*.*"),
            ],
        )
    finally:
        root.destroy()
    return Path(selected) if selected else None


def show_message(title, message, *, error=False):
    import tkinter as tk
    from tkinter import messagebox

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        show = messagebox.showerror if error else messagebox.showinfo
        show(title, message, parent=root)
    finally:
        root.destroy()


class _TableHTMLParser(HTMLParser):
    """仅保留表格标签和合并单元格属性，OCR 内容不能作为脚本执行。"""

    tags = {"table", "thead", "tbody", "tfoot", "tr", "td", "th", "br"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag not in self.tags:
            return
        spans = ""
        if tag in {"td", "th"}:
            for name, value in attrs:
                if name in {"rowspan", "colspan"} and value and value.isascii():
                    if value.isdigit() and 0 < int(value) <= 1000:
                        spans += f' {name}="{int(value)}"'
        self.parts.append(f"<{tag}{spans}>")

    def handle_endtag(self, tag):
        if tag in self.tags and tag != "br":
            self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        self.parts.append(escape(data))


def render_document(data):
    """按版面分析的阅读顺序显示正文，直接保留模型预测的表格结构。"""
    parts = []
    blocks = data.get("parsing_res_list", [])
    for block in blocks:
        content = block["block_content"]
        if block["block_label"] == "table":
            parser = _TableHTMLParser()
            parser.feed(content)
            parser.close()
            parts.append('<div class="table-wrap">' + "".join(parser.parts) + "</div>")
        elif content:
            parts.append('<p class="text">' + escape(content) + "</p>")
    if not blocks:
        # 空版面结果仍显示 OCR 文本，避免生成空白报告。
        for text in data.get("overall_ocr_res", {}).get("rec_texts", []):
            parts.append('<p class="text">' + escape(text) + "</p>")
        for table in data.get("table_res_list", []):
            parser = _TableHTMLParser()
            parser.feed(table["pred_html"])
            parser.close()
            parts.append('<div class="table-wrap">' + "".join(parser.parts) + "</div>")
    return "\n".join(parts)


def save_document_report(output_dir, image_path, pages, warnings):
    """生成 UTF-8 网页，表格的行列和 rowspan/colspan 由结构模型决定。"""
    warning_html = "".join(f'<p class="note">{escape(w)}</p>' for w in warnings)
    body = "\n".join(f'<section>{page}</section>' for page in pages)
    report = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>文档识别结果</title>
<style>
body { font-family: "Microsoft YaHei", sans-serif; margin: 32px; color: #202124; }
.note { color: #666; font-size: 14px; }
.text { white-space: pre-wrap; line-height: 1.7; }
.table-wrap { overflow-x: auto; margin: 20px 0; }
table { border-collapse: collapse; min-width: 70%; }
td, th { border: 1px solid #555; padding: 8px 12px; text-align: center; }
section { margin: 24px 0; }
</style></head><body>
"""
    report += warning_html + body + "</body></html>\n"
    report_path = output_dir / f"{image_path.stem}.html"
    report_path.write_text(report, encoding="utf-8")
    return report_path


def align_table_text(table):
    """按单元格位置匹配文字，修正倾斜图片中固定 10px 分行造成的错列。

    保留结构模型的行列与合并关系。只有几何分行与 HTML 每行单元格数
    完全一致时才替换文字；存在跨行合并时也必须满足这一条件。
    """
    boxes = table.get("cell_box_list", [])
    ocr = table.get("table_ocr_pred", {})
    text_boxes = ocr.get("rec_boxes", [])
    texts = ocr.get("rec_texts", [])
    if not len(boxes) or not len(text_boxes) or len(text_boxes) != len(texts):
        return None
    if any(len(box) != 4 for box in boxes) or any(len(box) != 4 for box in text_boxes):
        return None
    # PaddleX 的 OCR 框可能是 numpy.int16；直接乘面积会在大框上溢出。
    boxes = [[float(value) for value in box] for box in boxes]
    text_boxes = [[float(value) for value in box] for box in text_boxes]
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(table["pred_html"], "html.parser")
    html_rows = [row.find_all(["td", "th"], recursive=False) for row in soup.find_all("tr")]
    html_rows = [row for row in html_rows if row]
    if sum(map(len, html_rows)) != len(boxes):
        return None
    if any(len(box) != 4 or box[2] <= box[0] or box[3] <= box[1] for box in boxes):
        return None

    # 容差随实际单元格高度缩放，不依赖照片分辨率。
    tolerance = median(float(box[3] - box[1]) for box in boxes) * 0.5
    rows = []
    for box in sorted(boxes, key=lambda box: box[1]):
        if not rows or box[1] - rows[-1][0][1] > tolerance:
            rows.append([])
        rows[-1].append(box)
    if [len(row) for row in rows] != [len(row) for row in html_rows]:
        return None
    for row in rows:
        row.sort(key=lambda box: box[0])
        for left, right in zip(row, row[1:]):
            # 不能将上下两格误当成同一行；允许检测框边缘有少量重叠。
            if left[2] - right[0] > 0.2 * min(left[2] - left[0], right[2] - right[0]):
                return None
    ordered_boxes = [box for row in rows for box in row]
    cell_texts = [[] for _ in ordered_boxes]
    for text_box, text in zip(text_boxes, texts):
        x1, y1, x2, y2 = text_box
        area = max(0, x2 - x1) * max(0, y2 - y1)
        if area == 0:
            continue
        overlaps = [
            max(0, min(x2, box[2]) - max(x1, box[0]))
            * max(0, min(y2, box[3]) - max(y1, box[1]))
            / area
            for box in ordered_boxes
        ]
        best = max(range(len(overlaps)), key=overlaps.__getitem__)
        if overlaps[best] >= 0.5:
            cell_texts[best].append((y1, x1, text))
    html_cells = [cell for row in html_rows for cell in row]
    replacements = [" ".join(text for _, _, text in sorted(matches)) for matches in cell_texts]
    original_text = Counter("".join(cell.get_text().split()) for cell in html_cells)
    replacement_text = Counter("".join(text.split()) for text in replacements)
    original_text.pop("", None)
    replacement_text.pop("", None)
    # OCR 匹配不完整时不能清空原有文字；整表保留模型输出，避免重复和丢字。
    if original_text - replacement_text:
        return None
    for cell, text in zip(html_cells, replacements):
        # BeautifulSoup 会转义文字中的 <、>、&，保留 colspan/rowspan 属性。
        cell.string = text
    return str(soup)


def align_document_tables(result):
    """同时更新表格导出与正文块，保证 HTML、XLSX、JSON 内容一致。"""
    tables = result.get("table_res_list", [])
    occurrences = Counter(table["pred_html"] for table in tables)
    for table in tables:
        previous = table["pred_html"]
        # 相同 HTML 的多张表无法仅凭内容唯一对应正文块，保守保留原结果。
        if occurrences[previous] != 1:
            continue
        aligned = align_table_text(table)
        if aligned is None:
            continue
        blocks = [
            block
            for block in result["parsing_res_list"]
            if block.label == "table" and block.content == previous
        ]
        if len(blocks) != 1:
            continue
        table["pred_html"] = aligned
        blocks[0].content = aligned


def create_pipeline(mode):
    common = dict(
        device=DEVICE,
        use_doc_orientation_classify=False,
        use_doc_unwarping=USE_DOC_UNWARPING if mode == "document" else False,
        use_textline_orientation=False,
    )
    if mode == "text":
        from paddleocr import PaddleOCR

        return PaddleOCR(lang="ch", ocr_version="PP-OCRv6", **common)

    from paddleocr import PPStructureV3

    # 当前仓库的 PPStructureV3 不接受 ocr_version="PP-OCRv6"。
    return PPStructureV3(
        lang="ch",
        ocr_version="PP-OCRv5",
        use_table_recognition=True,
        use_formula_recognition=False,
        use_seal_recognition=False,
        use_chart_recognition=False,
        use_region_detection=False,
        format_block_content=False,
        layout_unclip_ratio={8: list(TABLE_BOX_EXPAND)},
        **common,
    )


def recognize_image(image_path, *, mode=None):
    """返回 TXT 路径和文字行；文档模式另存同名 HTML 和各表格的 XLSX。"""
    mode = RECOGNITION_MODE if mode is None else mode
    if mode not in {"document", "text"}:
        raise ValueError("RECOGNITION_MODE 必须是 'document' 或 'text'。")
    image_path = Path(image_path)
    if not image_path.is_absolute():
        image_path = PROJECT_DIR / image_path
    if not image_path.is_file():
        raise FileNotFoundError(f"找不到图片：{image_path}")

    # VS Code 直接启动 python.exe 时不一定加载 Conda 的缓存环境变量。
    # 必须在导入 PaddleOCR/PaddleX 之前设置，复用之前下载好的模型。
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(CACHE_DIR))
    print(f"正在加载 {mode} 模型，使用设备 {DEVICE}，请稍等……", flush=True)
    ocr = create_pipeline(mode)
    try:
        # 每次单独保存，避免覆盖同名照片或以前的识别结果。
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        output_dir = Path(
            tempfile.mkdtemp(prefix=f"{image_path.stem}_{stamp}_", dir=OUTPUT_DIR)
        )
        lines = []
        pages = []
        warnings = []
        for index, result in enumerate(ocr.predict_iter(str(image_path)), start=1):
            if mode == "text":
                lines.extend(result["rec_texts"])
                result.save_all(str(output_dir))
                continue

            # 原始 parsing_res_list 中是 LayoutBlock 对象；JSON 接口才是字典。
            align_document_tables(result)
            data = result.json["res"]
            page_lines = data.get("overall_ocr_res", {}).get("rec_texts", [])
            if not data.get("table_res_list"):
                paragraphs = [
                    block["block_content"]
                    for block in data.get("parsing_res_list", [])
                    if block["block_content"]
                ]
                if paragraphs:
                    page_lines = "\n\n".join(paragraphs).split("\n")
            lines.extend(page_lines)
            pages.append(render_document(data))
            result.save_to_json(str(output_dir))
            result.save_to_img(str(output_dir))
            # 不调用 save_all，避免无关的 Word 等导出依赖影响本任务。
            # 传目录而非文件名，支持一张图片内有多张表格。
            if data.get("table_res_list"):
                result.save_to_html(str(output_dir))
                try:
                    result.save_to_xlsx(str(output_dir))
                except Exception as exc:
                    warning = f"第 {index} 页 Excel 导出失败，表格仍可在网页查看：{exc}"
                    warnings.append(warning)
                    print(warning, file=sys.stderr)
        text_path = output_dir / f"{image_path.stem}.txt"
        text_path.write_text("\n".join(lines), encoding="utf-8")
        if mode == "document":
            save_document_report(output_dir, image_path, pages, warnings)
        return text_path, lines
    finally:
        ocr.close()


def main():
    print(f"当前 Python：{sys.executable}", flush=True)
    try:
        image_path = Path(IMAGE_PATH) if IMAGE_PATH else choose_image()
        if image_path is None:
            print("已取消，未加载模型。")
            return 0
        text_path, lines = recognize_image(image_path)
        print("\n识别结果：\n" + "\n".join(lines))
        print(f"\n识别结果保存位置：{text_path.parent}")
        report_path = text_path.with_suffix(".html")
        if report_path.is_file():
            if OPEN_RESULT:
                try:
                    webbrowser.open(report_path.resolve().as_uri())
                except Exception as exc:
                    print(f"浏览器未打开，请手动打开 {report_path}：{exc}")
            return 0
        preview = "\n".join(lines)[:500] if lines else "未检测到文字。"
        show_message(
            "识别完成",
            f"共识别 {len(lines)} 行文字：\n\n{preview}\n\n完整文字已保存到：\n{text_path}",
        )
        return 0
    except Exception as exc:
        print(f"识别失败：{exc}", file=sys.stderr)
        show_message(
            "识别失败",
            f"{exc}\n\n请确认 VS Code 右下角选择的是 pytorch_2 解释器。",
            error=True,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
