# 图片文字与表格识别

在 VS Code 中选择 `pytorch_2` Python 解释器，打开 `run_ocr.py`，点击“运行 Python 文件”，然后选择原始图片。

脚本默认使用 `RECOGNITION_MODE = "document"`：通过 PP-StructureV3 识别正文、表格区域、行列和合并单元格。识别完成后会打开结果网页，不再弹出成功提示框；实际失败仍会报告。无表格时，网页直接显示识别正文，保留识别出的段落和换行，不显示“未检测到表格”等提示、文件名标题或表格说明。有表格时，继续显示正文和表格，并导出 Excel。

结果位于 `inference_results/<图片名>_<时间>/`：

- `<图片名>.html`：正文和表格的综合预览，用浏览器打开。
- `<图片名>_table_*.xlsx`：每张表格的 Excel 文件，可编辑；识别到表格时才生成。
- `<图片名>_table_*.html`：每张表格的独立网页。
- `<图片名>.txt`：无表格时保留识别出的段落、换行和缩进；有表格时仅供复制文字，不保留表格排版。
- JSON 和标注图片：用于检查识别框、文字与版面分析结果。

网页中的行列、空单元格和 `rowspan` / `colspan` 来自表格结构模型，不是按文字出现顺序猜测的。导出前会检查单元格坐标：仅当几何分行与预测结构一致，且原有非空文字均能重新匹配时，按坐标重新匹配文字，缓解倾斜照片中的错列。无法确认对应关系时保留模型结果。模型仍可能识别错字、漏检表格或误判合并关系；字体、列宽和照片背景也不会逐像素还原。请对照原图检查结果，尤其是数字和单位。

## 可调整选项

在 `run_ocr.py` 顶部修改：

```python
IMAGE_PATH = ""                  # 留空弹出选择框，或填写原图路径
RECOGNITION_MODE = "document"    # document 保留表格；text 为原有的纯文字模式
DEVICE = "gpu:0"                # 无 GPU 时改为 "cpu"
OPEN_RESULT = True              # False 表示只保存文件，不自动打开浏览器
USE_DOC_UNWARPING = True         # 默认矫正拍照文档；扫描件可改为 False
TABLE_BOX_EXPAND = (1.0, 1.2)    # 保留边缘表头；不需扩大时改为 (1.0, 1.0)
```

文档模式使用当前 PP-StructureV3 支持的 PP-OCRv5 文字模型，纯文字模式继续使用 PP-OCRv6。文档模式需要加载版面、表格分类、结构和单元格模型，速度与显存占用会高于纯文字模式；未缓存的模型首次使用时需要下载。

如果缺少文档解析依赖，在同一 Python 环境安装与本仓库兼容的 PaddleX OCR 依赖：

```powershell
& 'D:\software\anaconda3\envs\pytorch_2\python.exe' -m pip install "paddlex[ocr]>=3.7.0,<3.8.0"
```

若原图有表格但结果只显示正文，先检查原图是否清晰、表格是否完整；可将原图裁剪到表格区域后重新识别。拍照倾斜、屏幕条纹、模糊和反光都会影响文字及表格结构识别。默认开启的文档矫正不能保证提高每张图片的准确率，可对比关闭后的结果。如果扩大区域后混入表格外正文，将 `TABLE_BOX_EXPAND` 改为 `(1.0, 1.0)`。

如果 Excel 导出失败，网页会显示具体原因，已生成的网页和文字仍会保留。若浏览器没有自动打开，手动打开结果目录中的同名 HTML。

## English

For images without tables, TXT output follows the recognized paragraph order and preserves line breaks and indentation, matching the browser report.

Run `run_ocr.py` with the `pytorch_2` interpreter in VS Code and select the original image. The default `document` mode uses PP-StructureV3 with PP-OCRv5 to recover paragraphs and table structure. The result opens in the browser without a success dialog; actual failures are still reported. When no table is detected, the page shows the recognized text directly, preserving recognized paragraphs and line breaks, with no missing-table notice, filename heading or table explanation. For images with detected tables, the browser report preserves predicted rows, columns, empty cells and merged cells; tables are also exported as individual XLSX files. Results are saved under `inference_results/<image>_<timestamp>/`.

Set `RECOGNITION_MODE = "text"` to keep the previous PP-OCRv6 text-only workflow. TXT output does not preserve tables. Set `OPEN_RESULT = False` to suppress browser opening, or `DEVICE = "cpu"` to run without a GPU. Document rectification is enabled by default; set `USE_DOC_UNWARPING = False` to disable it. `TABLE_BOX_EXPAND = (1.0, 1.2)` adds vertical margin to include edge headers; use `(1.0, 1.0)` if the margin includes unwanted text. Before export, text is matched to cell coordinates only when geometric rows agree with the predicted HTML structure and all existing nonempty cell text can be retained; otherwise the original model output is retained.

This is structural reconstruction, not a pixel-perfect reproduction. Verify recognized text, numbers and merged cells against the source. If the source contains a table but the result shows only body text, try a clear, tightly cropped table image. Additional models are downloaded on first use if not cached. The dependency command above installs the compatible PaddleX OCR extras. XLSX export errors appear in the HTML report without discarding the report.
