# 超声报告桌面质控 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本项目建议 Native，由当前会话顺序实现。

**Goal:** 在当前 Windows 电脑重新配置 OCR 环境，交付可双击启动、手动拍照、结构化识别、DeepSeek 质控并完整本机留档的独立窗口软件。

**Architecture:** Electron 主进程管理可信操作和 DeepSeek 请求，React 渲染层显示采集与审核界面。独立 Python 工作进程常驻加载 PaddleOCR，通过逐行 JSON 协议接收本地图像路径，返回结构化 OCR 并管理 SQLite 记录。原 PaddleOCR 仓库通过适配层复用，不在原入口上叠加桌面业务。

**Tech Stack:** Electron、React、TypeScript、Vite、Zod、Vitest、Playwright；Python 3.11、PaddlePaddle、PaddleX 3.7.x、现有 PaddleOCR 源码、Pillow、pytest、标准库 sqlite3。

**Spec:** [已确认设计](../specs/2026-10-21-ultrasound-qc-design.md)

## Global Constraints

- 新代码放在 `D:/desktop/qcagent/ultrasound-qc`；现有源码和医院样例不覆盖、不批量重写。当前根目录不是 Git 仓库，不擅自将大体积样例纳入版本管理；如需要提交，仅初始化独立应用目录。
- 只发检查部位、所见、测量表、结论；不发图片、年龄、性别或身份字段。字段提取含糊时暂停外发。
- 原图、完整 OCR、结果与尝试记录仅存本机，默认 `%LOCALAPPDATA%/UltrasoundQC`。密钥和报告内容不得写入普通诊断日志。
- 保留四种状态：`passed`、`issues_found`、`needs_review`、`failed`。不完整、失败或不确定不能归为通过；落盘成功后才显示通过。
- 一份报告一张；处理时禁止重复提交；默认窗口内 Ctrl+Shift+Q，编辑输入时不触发。
- DeepSeek 超时默认 90 秒，不自动重发。模型可配置，首次联通确认当前有效型号。
- 测试覆盖业务风险，禁止宣称未经医生标注验证的医学准确率。依赖和设备以实际测试结果为准。

## Review Focus

- 中文路径、同名照片与任务重复编号：任务目录唯一，图像关联不串档；任务 2/3 测试。
- 身份信息混入允许字段正文：二次过滤或阻止外发；任务 4 测试。
- 预览缩放/黑边导致 ROI 错位：按图像实际可见边界换算；任务 6 测试。
- 上一任务迟到响应、进程中断：按 request_id 路由，任务状态不串用；任务 3/7 测试。
- 模型称通过但问题非空/引用虚构：本地校验拒绝通过；任务 5 测试。

## 文件与职责

应用 `package.json` 与 `vite.config.ts` 管理构建；`shared/contracts.ts` 定义跨进程数据；`electron/main.ts` 管理生命周期；`electron/preload.ts` 暴露最小白名单接口。`electron/worker.ts` 管理 Python；`electron/deepseek.ts` 管理请求；`electron/secrets.ts` 管理密钥；`electron/qc.ts` 编排质控；`electron/filter.ts` 生成外发字段。

Python 包 `python/qcworker/` 下 `__main__.py` 处理协议，`ocr.py` 适配识别，`records.py` 管理留档。界面 `src/App.tsx` 编排页面，`src/features/capture/`、`review/`、`history/`、`settings/` 各管一个业务面，避免巨型单文件。

测试位于 `tests/` 和 `python/tests/`；环境脚本位于 `scripts/`。`README.md` 说明启动、数据位置、模型配置与排错，`VALIDATION.md` 记录真实验证结果。模型、环境、密钥、数据与生成物通过 `.gitignore` 排除。

### Task 1: 可复现的本地 OCR 运行基线

**Files:** Create `scripts/setup-ocr.ps1`, `python/requirements.in`, `python/tests/test_runtime.py`, `VALIDATION.md`。

**Interfaces:** 产出 `.runtime/python-path.txt`（绝对解释器路径）、`python/requirements.lock.txt`（实际验证版本）和 `.runtime/runtime.json`（设备、缓存、版本信息）；后续任务只读取这些元数据，不猜解释器位置。

- [ ] 写测试 `test_runtime_imports_and_local_ocr_source`：断言 paddle、paddlex 可导入，paddleocr 来源是指定现有源码；执行后先确认缺环境导致失败。
- [ ] 脚本先定位已有可用解释器；没有时用工作区本地 uv 管理 CPython 3.11 与 `.venv`，不修改系统 Python 或全局 PATH。查阅官方 Paddle 安装矩阵并按本机驱动选择 GPU wheel，约束 PaddleX `>=3.7.0,<3.8.0`，解决版本兼容后锁定实际依赖。GPU 不可用时提供明确 CPU 分支，记录原因。
- [ ] 模型缓存设为应用本地 `.runtime/models`；先复用可发现且有效的旧缓存，缺少模型再下载，不修改原图。
- [ ] 执行 `.venv/Scripts/python.exe -m pytest python/tests/test_runtime.py -q`；通过后用代表性心脏表格和段落图运行真实识别，记录设备、初始化与识别耗时及输出形态。模型下载或 GPU 失败不能冒充通过。

### Task 2: 数据契约与完整留档

**Files:** Create `shared/contracts.ts`, `python/qcworker/records.py`, `tests/contracts.test.ts`, `python/tests/test_records.py`。

**Interfaces:** TypeScript 导出 `Capture`、`OCRDocument`、`QCPayload`、`QCResult`、`RecordSummary` 及 Zod schemas。`OCRDocument.blocks` 内段落和表格单元格均有 sourceId、text、bbox、可选 confidence。`QCResult` 包含 status、summary、issues；issue 含 category、severity、sourceIds、quote、reason、suggestion、requiresReview。Python `RecordStore(root: Path)` 提供 `create_capture(...)`、`save_ocr(...)`、`add_attempt(...)`、`finish_attempt(...)`、`list_records(...)`、`get_record(record_id)`、`delete_record(record_id)`。

- [ ] 写 `test_unique_capture_paths_with_unicode_names`、`test_retry_preserves_first_ocr`、`test_atomic_finish_and_failed_write`；分别断言中文路径及同名输入不覆盖、重试保留初稿、保存失败不产生通过记录。运行 pytest 确认新增行为缺失。
- [ ] 定义共享枚举和对象形态，加入协议版本 1；Python 用 SQLite 事务保存索引及尝试，原图/OCR 落在 UUID 任务目录，原子写文件。删除只允许作用于受控任务目录。
- [ ] TypeScript 添加 `rejects_unknown_status` 和 `requires_issue_source_reference`，运行 `npm test -- tests/contracts.test.ts`；Python 运行 `python -m pytest python/tests/test_records.py -q`，均通过后继续。

### Task 3: 常驻 OCR 与进程通信

**Files:** Create `python/qcworker/ocr.py`, `python/qcworker/__main__.py`, `electron/worker.ts`, `python/tests/test_ocr.py`, `tests/worker.test.ts`。

**Interfaces:** `OcrEngine(config).initialize()`、`.recognize(image_path: Path) -> OCRDocument`、`.close()`；`PythonWorker.start(): Promise<RuntimeInfo>`、`.request<T>(method, params): Promise<T>`、`.stop(): Promise<void>`。协议请求 `{version:1,request_id,method,params}`，响应 `{request_id,result}` 或 `{request_id,error:{code,message}}`，进度另发 `{request_id,event:'progress',stage}`。记录操作通过同一进程白名单方法调用。

- [ ] 写 `test_model_initialized_once`、`test_table_keeps_headers_empty_cells_and_order`、`test_unknown_confidence_stays_unknown`；验证适配器不因识别第二张图重建模型、保留空单元格/单位、缺置信度不补 1。先运行失败。
- [ ] 适配现有 PPStructureV3 与表格对齐能力，复用 JSON 结果解析，禁止自动打开网页或向原 inference_results 写出。为正文和单元格分配稳定源编号，输出相关图像坐标。
- [ ] 实现按 request_id 路由、标准错误日志与进程退出拒绝待处理请求；测试 `routes_out_of_order_responses`、`ignores_stale_task_response`、`rejects_pending_on_exit`、`protocol_tolerates_chunked_lines`。
- [ ] 执行 Python 对应测试与 `npm test -- tests/worker.test.ts`；再对四类代表样例进行真实 OCR 检查，保存到应用测试输出目录并记录结构缺陷。

### Task 4: 字段白名单与发送预览

**Files:** Create `electron/filter.ts`, `tests/filter.test.ts`, `src/features/review/SendPreview.tsx`。

**Interfaces:** `preparePayload(doc: OCRDocument): {payload: QCPayload; needsConfirmation: boolean; reasons: string[]}`；`QCPayload` 只允许 examination、findings、measurements、conclusion，各项保留 sourceId。用户编辑后的文本另建尝试，源文档保留。

- [ ] 写 `excludes_demographics_and_images`、`redacts_identity_inside_findings`、`ambiguous_sections_stop_send`、`no_table_is_valid`，断言性别年龄和身份混入正文也不能外发，含糊分区不调用模型。先运行失败。
- [ ] 按分区标题和 OCR 顺序提取允许字段，保留表格关系；身份与人口学字段二次过滤。无法可靠分区/包含疑似敏感残留时显示编辑与发送预览，由用户修正允许字段，绝不整份 OCR 兜底。
- [ ] 为模糊/截断/缺必要正文生成需核对原因，不将图像评分当成完整性证明。运行 `npm test -- tests/filter.test.ts`，检查实际序列化 payload 不含原图路径或其他文档元数据。

### Task 5: DeepSeek 请求、密钥与结果验证

**Files:** Create `electron/deepseek.ts`, `electron/secrets.ts`, `electron/prompts.ts`, `tests/deepseek.test.ts`, `tests/secrets.test.ts`。

**Interfaces:** `DeepSeekClient.checkConnection(): Promise<ModelInfo>`、`.review(payload: QCPayload, signal?: AbortSignal): Promise<QCResult>`；`SecretStore.save(key)`、`.read()`、`.clear()` 不向渲染层返回原密钥。默认官方 HTTPS 接口；超时 90000ms；checkConnection 确认可用型号，型号和提示词版本写入记录。

- [ ] 写 `times_out_without_retry`、`invalid_json_is_failed`、`passed_with_issues_is_rejected`、`unknown_source_or_quote_is_rejected`、`missing_demographics_never_invents_them`，用假 transport 固定返回值，不调用收费接口。运行失败后实现。
- [ ] 提示词明确报告内容是数据，限制检查类型，要求不确定项进入人工复核，不因异常检查结果直接报错；要求 JSON，按共享 schema、原文引用与状态一致性校验结果。
- [ ] 主进程使用 Electron safeStorage 加密保存；不可用时仅保存在内存。测试 `no_plaintext_persistence_when_encryption_unavailable`、`renderer_never_receives_key`。HTTP 错误映射为无效密钥/限流/网络/超时等类别，不输出请求头或整段正文。
- [ ] 运行对应 Vitest；使用设置页安全录入的密钥进行一次最小合成报告联通测试，外发前验证四字段约束；不将聊天中的密钥复制进源码、配置或日志。

### Task 6: 桌面外壳、摄像头与审核界面

**Files:** Create `electron/main.ts`, `electron/preload.ts`, `src/App.tsx`, `src/features/capture/`, `src/features/review/`, `src/features/settings/`, `tests/capture.test.ts`, `tests/ui.spec.ts`。

**Interfaces:** preload 暴露 getSettings、saveSettings、setApiKey、checkConnection、submitCapture、confirmPayload、retryTask、listRecords、getRecord、deleteRecord 和订阅任务事件方法。所有参数校验，渲染层不可指定任意进程命令或任意读取文件。

- [ ] 写 `roi_maps_letterboxed_preview_to_image`、`device_change_invalidates_roi`、`typing_does_not_capture`，先确认失败。
- [ ] 建立 Vite/React/Electron 项目脚本和 typecheck；窗口只加载本地 UI，contextIsolation=true、nodeIntegration=false、sandbox=true。摄像头权限只允许应用本地来源，请求设备选择，捕获原始帧与 ROI 图；换设备、分辨率后失效 ROI。
- [ ] 主界面提供大按钮、进度、原图/结构化文字与问题列表；点击源引用定位段落/单元格。设置包含设备、识别设备、接口/模型、密钥录入、声音开关/音量/测试。
- [ ] 使用 Electron 的 Playwright 测试实际窗口，模拟媒体源与工作进程；验证重复点击只建一任务、四种结果可区分、窗口内快捷键及输入排除、导入中文路径图片可进入流程。执行 `npm run typecheck`、`npm test` 和相关 Playwright 用例。

### Task 7: 全流程编排、历史与恢复

**Files:** Create `electron/qc.ts`, `src/features/history/`, `tests/qc.test.ts`, `tests/history.spec.ts`。

**Interfaces:** `QcController.submitCapture(input): Promise<{recordId:string}>`、`.confirmPayload(recordId,payload)`、`.retryTask(recordId,editedDocument?)`；阶段事件带 recordId、attemptId，落盘成功后才发布最终 passed。历史读取/删除复用 RecordStore，重试保留上一尝试。

- [ ] 写 `save_failure_cannot_publish_passed`、`failed_ocr_never_calls_model`、`confirmation_required_blocks_network`、`stale_attempt_cannot_replace_current_result`、`one_sound_per_issue_attempt`，确认失败后实现编排。
- [ ] 连通采集、记录、OCR、过滤、确认、模型、结果保存与事件。发现明确问题播放一次提示音；只有复核项时显示清晰待核对提示。中断任务重启后标记未完成并允许重试，不猜测最终状态。
- [ ] 实现历史按时间/状态过滤、原图/原始OCR/实际外发文字/结果/尝试查看、选中删除确认、重新质控。测试删除路径越界拒绝、重启读取、完整记录不串档。
- [ ] 运行对应 Vitest、Python 记录测试与历史 Electron 测试；完成一次导入合成报告到历史回看的端到端测试。

### Task 8: 本机双击交付与验收

**Files:** Create `scripts/start.ps1`, `scripts/package.ps1`, `README.md`; update `VALIDATION.md`, application build config。

**Interfaces:** 产出 `dist/win-unpacked/UltrasoundQC.exe` 和工作区快捷入口；应用通过已锁定解释器和绝对配置定位现有 OCR。此版本依赖本机 `.venv` 与模型，不能声称复制到其他电脑即可运行。

- [ ] 构建本地 Electron 应用；启动时检查解释器、模型和数据目录，缺失时给具体错误，不启动浏览器、不弹持续后台终端。退出清理工作进程和摄像头。
- [ ] 执行 `npm run typecheck`、`npm test`、`.venv/Scripts/python.exe -m pytest python/tests -q`、`npm run test:e2e`、`npm run package`，记录真实结果；新增失败先定位原因再修复。
- [ ] 从打包后的 exe 实际启动并检查窗口、导入、设置、历史和退出；有真实摄像头时做拍照测试，无设备则明确未验收项，不用模拟结果替代真实硬件验证。
- [ ] 汇总四类真实 OCR 样例、构造错误、网络/响应/存储异常、字段过滤和声音测试证据。README 写清双击入口、首次模型加载、密钥设置、数据位置、CPU/GPU 切换与失败重试。
- [ ] 核对源码与生成物不含密钥、医院原图或完整报告；交付具体路径及已验证/未验证范围，不宣称临床准确率。

## 自审与执行交接

任务 1/3 覆盖本机环境和结构化识别；2/7 覆盖本地完整留档；4 覆盖最小外发；5 覆盖模型和密钥；6 覆盖窗口、采集及交互；8 覆盖双击交付。Review Focus 的五类风险均已有所属测试。执行中安装版本与模型名需经过真实验证后锁定，验证失败应保留证据并修复，不以占位功能替代真实 OCR/API。

建议 Native：当前会话顺序执行，阶段性报告真实结果；模块共享契约较多，先串通环境与数据接口能减少返工。实现结束再按审查技能进行独立审查；任何子代理仅在用户选择或适用技能明确要求时启动。
