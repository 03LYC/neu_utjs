# PaddleOCR 项目导览与开发指南

> 本文档面向在此仓库阅读、开发、评审或自动化修改代码的人。它既是项目地图，也是一份按任务选择入口、配置与验证手段的工作指南。

## 1. 项目是什么

PaddleOCR 是基于 PaddlePaddle 的 OCR 与文档智能工具箱。当前代码同时维护两条互补主线：

- **3.x 产品/SDK 层**：`paddleocr/` 向 Python 用户和 CLI 暴露模块、流水线、Office 文档转 Markdown 与官方云 API 客户端。大多数本地推理由 **PaddleX** 创建 predictor/pipeline 并实际执行。
- **模型研发/传统部署层**：`ppocr/`、`tools/`、`configs/` 提供 PP-OCR 系列及相关检测、识别、表格、KIE、端到端和超分模型的训练、评估、导出与传统推理工具。

不要把这两层混为一谈：修改 `paddleocr/` 通常是在改公开 SDK 包装、参数和兼容性；修改 `ppocr/` 通常会影响训练时的网络、数据、损失、后处理或指标。PaddleX 的流水线实现在本仓库之外，仓库内代码主要负责选择模型、合并配置和转发参数。

核心场景：通用文字 OCR（PP-OCRv3/v4/v5/v6）、PDF/图片结构化解析（PP-StructureV3、PaddleOCR-VL、HPD-Parsing）、表格/公式/版面/印章/图表、训练与多端部署，以及托管 API、MCP、LangChain 集成。

许可证为 Apache-2.0；根 `pyproject.toml` 将发布包命名为 `paddleocr`，要求 Python `>=3.8`，并通过 `setuptools_scm` 从 Git 标签生成版本号。

## 2. 先建立正确的全景模型

```text
使用者
  ├─ Python: from paddleocr import PaddleOCR / PPStructureV3 / ...
  ├─ CLI:    paddleocr <pipeline-or-model> ...
  └─ 云 API: PaddleOCRClient / TypeScript SDK / Go SDK
                     │
                     ▼
paddleocr/ 公开包装层 ── create_predictor/create_pipeline ──► PaddleX
  ├─ _models/       单模型 predictor 包装
  ├─ _pipelines/    多模块 pipeline 包装与参数覆盖
  ├─ _api_client/   托管官方 API 的同步/异步客户端
  └─ _doc2md/       DOCX/XLSX/PPTX → Markdown（独立于 OCR 模型）

模型训练/传统推理
  tools/{train,eval,export_model}.py
                 │  读取 YAML
                 ▼
  configs/ ──► ppocr/{data,modeling,losses,optimizer,postprocess,metrics}
                 │
                 ▼
           PaddlePaddle 动态图训练、评估、保存和静态模型导出
```

## 3. 顶层目录地图

| 路径 | 职责 | 何时应修改 |
| --- | --- | --- |
| `paddleocr/` | PyPI Python 3.x SDK、CLI、官方 API 客户端 | 公开模块、流水线、CLI、API 客户端、doc2md |
| `ppocr/` | 训练期组件：数据集、增强、网络、损失、后处理、指标、优化器、字典与工具 | 新算法、训练期 bug、数据/模型行为 |
| `tools/` | 传统训练、评估、导出、各任务推理、公共训练循环 | 调整训练入口、导出或传统 Python 推理 |
| `configs/` | 训练 YAML：`cls`、`det`、`e2e`、`kie`、`rec`、`sr`、`table` | 新模型配方、数据集/超参数、可复现实验 |
| `deploy/` | C++、Paddle-Lite、Serving、Docker、Android/iOS、ONNX 等部署工程 | 特定部署目标的代码或构建脚本 |
| `ppstructure/` | 历史/独立的版面、表格、KIE、文档恢复工具 | 维护旧式 PP-Structure 工具，不是 3.x SDK 主入口 |
| `tests/` | 轻量 pytest：SDK 包装、客户端、工具、安全与回归 | 改 Python 公共行为时同步更新 |
| `test_tipc/` | 训推一体端到端测试：准备数据/模型、执行脚本、比较基准结果 | 改训练、导出或多端部署链路 |
| `docs/`、`mkdocs.yml`、`overrides/` | 中英文 MkDocs 文档站和主题覆盖 | 用户文档、导航、文档 UI |
| `paddleocr-js/` | Node 20+ npm workspace；浏览器 ONNX Runtime Web SDK 与 Vite demo | 浏览器 SDK 或 demo |
| `api_sdk/` | 托管官方 API 的 TypeScript/Go SDK；Python 在 `_api_client/` | 云 API 协议/SDK 功能 |
| `mcp_server/` | 可单独打包的 MCP server（Python >=3.10） | AI Agent/MCP 集成 |
| `langchain-paddleocr/` | 独立 Hatch/uv 项目，提供 `PaddleOCRVLLoader` | LangChain 集成 |
| `applications/`、`benchmark/` | 场景应用与基准/历史实验 | 特定应用或 benchmark，不应当作 SDK 主路径 |
| `skills/` | 文档解析、文本识别的 Agent Skill 说明 | Agent 集成说明 |

## 4. 3.x Python SDK 与 CLI

### 4.1 入口、依赖与发布边界

- 包导出面由 `paddleocr/__init__.py` 定义；新增公开 class/function 时，评估是否需要在这里导入并加入 `__all__`。
- 控制台入口是 `paddleocr.__main__:console_entry`（根 `pyproject.toml` 的 `[project.scripts]`），再转到 `paddleocr/_cli.py:main`。
- 基础依赖是 `paddlex[ocr-core]>=3.7.0,<3.8.0`；文档解析、信息抽取、翻译、doc2md 通过 extras 提供。改动 PaddleX 参数或功能时，要注意此版本边界。
- `paddleocr/_version.py` 从安装后的包元数据读取版本；直接从未安装源码导入时可能显示 `0.0.0`，不是发布版本。

### 4.2 SDK 的对象分层

| 层级 | 位置 | 机制 |
| --- | --- | --- |
| 通用抽象 | `_abstract.py`、`_common_args.py`、`_utils/` | 设备、推理引擎、HPI、TensorRT、MKL-DNN、CLI 工具与弃用提示 |
| 模型包装 | `_models/base.py` 与各模型文件 | `PaddleXPredictorWrapper` 调用 `paddlex.create_predictor()`；默认模型由具体类声明 |
| 流水线包装 | `_pipelines/base.py` 与各流水线文件 | `PaddleXPipelineWrapper` 读取/合并 PaddleX pipeline YAML，再调用 `paddlex.create_pipeline()` |
| 公开结果 | `predict_iter()` 与 `predict()` | 前者透传 iterator，后者收集为 list；两者均是公共契约 |

单模型类包括文字检测/识别、文字行方向、文档方向、图像矫正、版面、表格结构/单元格/分类、公式、印章、图表和文档 VLM 等；对应文件都在 `paddleocr/_models/`。

主要流水线：

| 公开类 | 文件 | 主要用途 |
| --- | --- | --- |
| `PaddleOCR` | `_pipelines/ocr.py` | 常规文字检测 + 识别，可选文档方向、矫正与行方向 |
| `PPStructureV3` | `_pipelines/pp_structurev3.py` | 版面感知的文档结构化解析，含表格/公式/印章/图表等可选子模块 |
| `PaddleOCRVL` | `_pipelines/paddleocr_vl.py` | VLM 文档解析 |
| `DocPreprocessor` | `_pipelines/doc_preprocessor.py` | 文档方向与图像矫正 |
| `DocUnderstanding` | `_pipelines/doc_understanding.py` | 文档理解 |
| `FormulaRecognitionPipeline` | `_pipelines/formula_recognition.py` | 公式识别 |
| `SealRecognition` | `_pipelines/seal_recognition.py` | 印章识别 |
| `TableRecognitionPipelineV2` | `_pipelines/table_recognition_v2.py` | 通用表格识别 v2 |
| `PPChatOCRv4Doc` | `_pipelines/pp_chatocrv4_doc.py` | 文档智能问答/抽取链路 |
| `PPDocTranslation` | `_pipelines/pp_doctranslation.py` | 文档翻译 |

### 4.3 参数、兼容性与 CLI

- 构造器先收集本类参数，再把 `device`、`engine`、`engine_config`、`enable_hpi`、`use_tensorrt`、`precision`、`enable_mkldnn`、`mkldnn_cache_capacity`、`cpu_threads`、`enable_cinn` 交给 `parse_common_args()`。
- 支持的 `engine`：`paddle`、`paddle_static`、`paddle_dynamic`、`transformers`、`onnxruntime`。扩展该集合时，必须同时确认 PaddleX 端支持。
- `paddlex_config` 为 `None` 时按默认名称加载；为字符串时读取 YAML；为 dict 时直接使用。类的 `_get_paddlex_config_overrides()` 用递归 merge 覆盖默认配置。
- `PaddleOCR` 的 `lang`/`ocr_version` 仅在未显式指定检测/识别模型时选择默认模型；显式指定时会被忽略并告警。
- 2.x 兼容性很重要：`_DEPRECATED_PARAM_NAME_MAPPING` 映射旧参数，旧 `.ocr()` 委托给 `.predict()`。不要无迁移方案地删除或改变这些路径。

`paddleocr/_cli.py` 集中注册所有 pipeline/model 子命令，并注册：

- `install_hpi_deps <cpu|gpu|npu>`：经 PaddleX 安装高性能依赖。
- `install_genai_server_deps <vllm|sglang|fastdeploy>`、`genai_server`：生成式模型服务支持。
- `doc2md`：DOCX/XLSX/PPTX 转 Markdown。
- `api`：托管 PaddleOCR 官方 API 的命令行入口。

```powershell
paddleocr ocr --input .\image.png --lang ch
paddleocr pp_structurev3 --input .\document.pdf --device gpu:0
paddleocr doc2md --input .\report.docx --output .\report.md
```

CLI 参数应与相应 Python 构造器保持同名、含义一致。增加 pipeline/model 时，除实现类外，还要提供 `get_cli_subcommand_executor()`，并将它注册进 `_cli.py`。

### 4.4 独立但相关的能力

- `paddleocr/_doc2md/` 是注册式转换器体系：`core.convert()` 根据扩展名从 `registry` 选择内置 DOCX、XLSX、PPTX converter。它不是 OCR/VLM 的包装；改动时应测试 `doc2md` extra。
- `paddleocr/_api_client/` 是对**托管官方 API**的 HTTP/polling 客户端，提供同步 `PaddleOCRClient` 和异步 `AsyncPaddleOCRClient`。它不会运行本地模型。协议改动须同步检查 `api_sdk/typescript/` 与 `api_sdk/go/`。

## 5. 训练、评估与导出

### 5.1 标准训练调用链

```text
tools/train.py
  └─ tools.program.preprocess()：解析 -c YAML 与 -o 覆盖项，设置设备/日志
       ├─ ppocr.data.build_dataloader()
       ├─ ppocr.postprocess.build_post_process()
       ├─ ppocr.modeling.architectures.build_model()
       ├─ ppocr.losses.build_loss()
       ├─ ppocr.optimizer.build_optimizer()
       ├─ ppocr.metrics.build_metric()
       └─ tools.program.train()：AMP、分布式、EMA、评估、checkpoint、日志
```

```powershell
# 单卡/默认设备训练
python tools/train.py -c configs/rec/PP-OCRv5/PP-OCRv5_server_rec.yml

# 多卡训练（示例；根据实际 GPU 数量修改）
python -m paddle.distributed.launch --gpus "0,1" tools/train.py -c configs/rec/PP-OCRv5/PP-OCRv5_server_rec.yml

# 评估、导出
python tools/eval.py -c <config.yml>
python tools/export_model.py -c <config.yml>
```

脚本接受 `-o Key.SubKey=value` 覆盖 YAML。`tools/program.py` 通过 `yaml.SafeLoader` 读取配置和覆盖值；不得改回不安全的 YAML loader，这一点有专门安全测试。

### 5.2 YAML 是训练期的契约

典型 YAML 包含下列一级节：

| 节 | 内容 |
| --- | --- |
| `Global` | 设备、epoch、日志、保存目录、预训练/断点、字典、分布式、AMP/静态图等 |
| `Architecture` | `model_type`、算法、Transform/Backbone/Neck/Head 及其参数 |
| `Loss` | 损失名和参数；蒸馏/多头模型可配置多个损失 |
| `Optimizer` | 优化器、学习率调度、正则和梯度裁剪 |
| `PostProcess` | 解码、检测后处理、字典与阈值 |
| `Metric` | 评价指标与主指标 |
| `Train` / `Eval` | Dataset、label 文件、数据变换、sampler、dataloader |

当前配置按 `cls`、`det`、`e2e`、`kie`、`rec`、`sr`、`table` 划分。代表性样例：

- 检测：`configs/det/PP-OCRv4/PP-OCRv4_server_det.yml`（DB、检测增强、`DetMetric`）。
- 识别：`configs/rec/PP-OCRv5/PP-OCRv5_server_rec.yml`（SVTR_HGNet、多头 CTC+NRTR、MultiScaleDataSet）。
- 表格：`configs/table/table_master.yml`（TableMaster、结构标签与 bbox）。

从最接近的可运行配置派生，避免从零拼 YAML：数据变换 `KeepKeys`、Head 输出通道、PostProcess 和 Loss 存在严格的输入输出对应关系。

### 5.3 `ppocr/` 的组件边界

| 目录 | 说明 |
| --- | --- |
| `ppocr/data/` | Dataset、label encode、图像变换/增强、sampler、collate 与 DataLoader 构建 |
| `ppocr/modeling/architectures/` | `build_model()`、`BaseModel`、蒸馏模型及静态图封装 |
| `ppocr/modeling/backbones/`、`necks/`、`heads/`、`transforms/` | 可配置网络部件 |
| `ppocr/losses/` | 检测、识别、表格、KIE、公式、蒸馏等损失及 `build_loss()` allowlist |
| `ppocr/postprocess/` | 检测框恢复、文本/表格/VQA 解码及 `build_post_process()` allowlist |
| `ppocr/metrics/` | 检测、识别、表格、KIE、超分等指标及 `build_metric()` allowlist |
| `ppocr/optimizer/` | 优化器、学习率、正则、权重衰减调度 |
| `ppocr/utils/` | 保存/加载、日志、字符字典、可视化、profiler、EMA 等公共工具 |

许多 builder 通过显式 allowlist 再 `eval()`/属性查找构造组件。因此新增实现不只是加文件：还必须在对应 `__init__.py` 导入、注册到 builder 支持列表，并在 YAML 中使用完全匹配的 `name`。

识别模型的字典长度会在 `tools/train.py`/`tools/eval.py` 中写回 Head 的 `out_channels` 或多头 `out_channels_list`。变更字典、decoder、Head 或 loss 时，优先检查这段耦合逻辑和对应配置。

### 5.4 传统推理与部署

- `tools/infer/predict_system.py` 将检测、方向分类、识别组合为传统 Python OCR；同目录的 `predict_det.py`、`predict_rec.py`、`predict_cls.py` 等可单任务运行。
- `tools/infer_*.py` 是特定任务的传统推理入口（表格、超分、KIE、端到端等）。
- `deploy/cpp_infer/` 为 C++ 本地推理；`deploy/lite/` 为 Paddle-Lite；`deploy/hubserving/` 为服务；`deploy/paddle2onnx/`、`deploy/docker/`、`deploy/android_demo/`、`deploy/ios_demo/` 是其他目标。每个目录有自己依赖和构建说明，不能假设根 Python 环境足够。
- `ppstructure/` 仍有独立表格、版面、KIE、恢复工具。若需求是 3.x 的公开 PP-StructureV3 功能，应先修改 `paddleocr/_pipelines/pp_structurev3.py` 和相应文档，而不是误改历史脚本。

## 6. 测试、质量与安全

### 6.1 日常 Python 验证

根 `pyproject.toml` 定义 pytest 默认跳过 `resource_intensive`：

```powershell
# 安装项目及与本次改动匹配的 extras 后运行全部默认测试
python -m pytest --verbose tests/

# 聚焦公开 SDK 某一层
python -m pytest --verbose tests/pipelines/test_ocr.py
python -m pytest --verbose tests/models/test_text_recognition.py
python -m pytest --verbose tests/api_client/

# 仅运行轻量、不需完整 PaddleX 推理的单元/安全测试
python -m pytest --verbose tests/unit/ tests/tools/test_program_safe_yaml.py tests/security/
```

测试目录按 API 客户端、单模型包装、流水线包装、传统 `ppocr`、安全、工具、unit 和 `test_files/` 样本划分。许多 SDK 测试是参数转发/形状的契约测试；改变参数名称、默认值、返回类型、弃用行为或 CLI 时应精确更新它们。

GitHub Actions 在 Python 3.8、3.9、3.13 上运行 `tests/`；Python 3.8 只安装 `doc2md` extra，并额外跳过 `py38_incompatible`。GPU CI 用 Python 3.10 与 `.[all]`。据此选择最小验证集，且不要把仅在新 Python 版本可用的依赖无意引入核心路径。

### 6.2 TIPC 与子项目验证

- 端到端训练/推理/部署验证使用 `test_tipc/`。先运行 `prepare.sh` 准备数据和模型，再运行匹配的 `test_*.sh`；配置名编码训练硬件、单机/多机、AMP、推理模式、语言和目标硬件。
- 官方 API SDK：根目录运行 `python -m pytest tests/api_client/`；`api_sdk/typescript` 运行 `npm run lint`、`npm test`；`api_sdk/go` 运行 `go test ./...`。
- 浏览器 SDK：进入 `paddleocr-js/` 后运行 `npm run check`（格式、lint、SDK build、类型检查、测试、demo build）。
- LangChain、MCP 和各部署子项目都有独立依赖/构建元数据；只在确实改到该子项目时进入其目录执行其测试。

### 6.3 格式与提交前检查

根 `.pre-commit-config.yaml` 是 Python/C/C++ 的主要质量门：

- 通用：新增文件上限 512 KB、大小写冲突、合并冲突、符号链接、私钥、行尾。
- Python：Black 24.10；Flake8 只检查致命错误（`E9,F63,F7,F82,E721`），不覆盖 `benchmark/`、`test_tipc/`。
- C/C++/CUDA：clang-format（通过 `.clang_format.hook`）。

```powershell
pre-commit run --all-files
```

不要将模型权重、数据集、训练输出、缓存或密钥提交到仓库。任何读取 YAML、反序列化模型或处理用户文件的改动都应保持最小权限和安全解析；已有 `tests/security/` 和 `tests/tools/test_program_safe_yaml.py` 用来防止 pickle/YAML 反序列化漏洞回归。

## 7. 文档与发布

### 7.1 文档结构

- 文档站使用 MkDocs Material，入口 `mkdocs.yml`；`mkdocs-ci.yml` 在 CI 中继承它并启用严格模式。
- 中文为默认语言；英文文件以 `.en.md` 后缀配对，i18n 配置为 `docs_structure: suffix`。改动用户可见功能时，应同步检查中英文页面而非只改 README。
- 3.x 的主要文档在 `docs/version3.x/`：`pipeline_usage/`、`module_usage/`、`inference_deployment/`、`algorithm/`、`integrations/`、`paddlex/`、`other_devices_support/`；`docs/version2.x/` 是旧版资料。
- `overrides/` 是 Material 模板覆盖；`tools/resolve_doc_github_refs.py` 用于部署前解析文档中的 GitHub 引用占位符。

本地检查文档时，按 CI 安装 MkDocs 依赖，先解析引用，再构建：

```powershell
python tools/resolve_doc_github_refs.py --placeholder '{{PADDLEOCR_GITHUB_REF}}' --source-ref main
mkdocs build -f mkdocs-ci.yml
```

该解析命令会改写文档引用，运行前请确认工作区干净或在可丢弃副本中操作。文档 CI 还执行锚点检查；发布 CI 在 `main`/tag 推送时通过 `mike` 部署。

### 7.2 发布影响面

- Python 主包由 `python -m build` 构建，并在 GitHub Release 后发布到 PyPI。
- 修改 `pyproject.toml` 中 PaddleX 版本范围会影响 CPU/GPU CI 从对应 `release/<major.minor>` 分支构建/安装 PaddleX 的方式，应与 PaddleX 兼容性一起验证。
- `api_sdk/typescript`、`api_sdk/go`、`mcp_server/`、`langchain-paddleocr/`、`paddleocr-js/` 有各自版本和发布流程；不要因为修改根包就无关地改动它们的版本。

## 8. 生态模块的边界

| 模块 | 语言/工具链 | 关键事实 |
| --- | --- | --- |
| `api_sdk/` | Python、TypeScript、Go | 调用托管官方 API，不加载本地 OCR 模型；Python 位于主包 |
| `mcp_server/` | Python >=3.10、`mcp`/`fastmcp` | 可用远端 API 或 `local` extra 运行本地文档解析 |
| `langchain-paddleocr/` | Python >=3.10、Hatch/uv、Ruff/Mypy | `PaddleOCRVLLoader` 将解析结果提供给 LangChain；独立严格工具配置 |
| `paddleocr-js/` | Node >=20.11、TypeScript、npm workspaces | `packages/core` 发布为 `@paddleocr/paddleocr-js`；使用 ONNX Runtime Web 与 OpenCV.js |
| `api_sdk/typescript/` | Node >=18、tsup/Vitest | 发布为 `@paddleocr/api-sdk` |
| `api_sdk/go/` | Go 1.21 | 模块路径为 `github.com/PaddlePaddle/PaddleOCR/api_sdk/go` |

跨模块变更应以协议/用户 API 为边界：先定义请求、返回、错误和兼容策略，再分别更新各语言实现和其测试；不要把主包的本地推理逻辑复制进云 API SDK。

## 9. 按任务选择入口

| 需求 | 首先阅读/修改 | 至少验证 |
| --- | --- | --- |
| 新增 3.x 单模型包装 | `paddleocr/_models/base.py` 与相邻模型文件 | 对应 `tests/models/`，Python 导出与 CLI |
| 新增/调整 3.x 流水线参数 | `paddleocr/_pipelines/base.py` 与目标 pipeline | `tests/pipelines/`，参数是否正确合并并传给 PaddleX |
| 改公共 CLI | `paddleocr/_cli.py`、`_common_args.py`、目标 executor | `paddleocr --help` 与 CLI/目标测试 |
| 改官方云 API | `_api_client/`、`api_sdk/typescript/`、`api_sdk/go/` | `tests/api_client/`、TS、Go 测试 |
| 改 OCR 网络/损失/解码 | `ppocr/modeling`、`losses`、`postprocess`、训练 YAML | 最小单测 + 代表性 train/eval/export 或 TIPC |
| 新训练配方 | 从接近的 `configs/` YAML 派生 | YAML 路径、数据键、组件名、单卡 dry run |
| 改传统部署 | 目标 `deploy/*` 或 `tools/infer/*` | 目标平台构建/推理测试；必要时 TIPC |
| 改浏览器端 | `paddleocr-js/` | 在子项目运行 `npm run check` |
| 改文档 | 对应 `docs/version3.x/` 页面、必要时 `mkdocs.yml` | MkDocs build、链接/锚点与中英文配对 |

## 10. 修改时的通用原则

1. **先定层次与用户面。** 明确这是公开 SDK、PaddleX 配置桥接、训练期组件、传统部署还是独立子项目，避免跨层修补。
2. **保持公开 API 向后兼容。** 特别是 `PaddleOCR` 2.x 兼容参数、`.ocr()`、CLI 参数、模型默认选择与结果对象。
3. **让配置和代码一起演进。** 新建组件必须导入/注册，YAML `name` 必须与 builder 允许列表一致；同时检查数据变换键、Head、Loss、PostProcess、Metric。
4. **按改动范围测试。** 先跑最小相关测试，再在有合适硬件/模型资源时扩展至训练、导出或 TIPC。没有数据或 GPU 时不能伪称已做端到端验证。
5. **控制依赖影响。** 主包核心依赖应保持轻量；可选能力放在已有 extras 或相应独立子项目中，并兼顾 Python 3.8 兼容测试矩阵。
6. **不混入生成物。** 输出目录、权重、下载数据、缓存和构建产物应在仓库外或被忽略；变更应聚焦任务。

## 11. 新贡献的最小完成清单

- [ ] 已选定正确子系统，并说明它与 PaddleX/训练/部署层的边界。
- [ ] 公共 Python/CLI 变更已更新导出、参数说明、弃用兼容与测试。
- [ ] 训练组件已在相应 builder 注册，且 YAML、数据键、Head、Loss、PostProcess、Metric 相互匹配。
- [ ] 文档变更已检查中英文对应页和 MkDocs 导航/链接。
- [ ] 已执行适合改动范围的 pytest、子项目检查或 TIPC；未执行的重量级验证已明确说明原因。
- [ ] 已运行或至少评估 `pre-commit run --all-files`，没有提交模型、数据、密钥或构建产物。
