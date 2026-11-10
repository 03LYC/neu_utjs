# 2026-10-23 本机迁移恢复

项目位置：`D:/lyc_dev/qcagent/ultrasound-qc`。

## 已恢复

- 下载 uv 0.13.5 和 CPython 3.11.15 到 `.runtime/tools`、`.runtime/python`，下载包、缓存、临时文件均保存在项目 `.runtime` 下。
- 修复 `.venv` 的 Python 解释器引用，保留已有 Paddle GPU 3.3.1、PaddleX 3.7.2 及模型文件；未重新下载整套模型。
- 开发和打包配置改为相对于项目根解析，消除 `D:/desktop/qcagent` 和原用户 `dearc` 的启动依赖。
- 重建前端、Electron 后台和 `dist/win-unpacked` 正式程序。
- 根目录 `超声报告质控.lnk` 指向 `启动超声报告质控.cmd`；它先设置本地缓存，再启动正式 exe。正常启动无需安装或重新构建。
- 未关闭或修改 Windows 应用控制策略。正式 exe 已通过本次实际窗口验收；原交接中的拦截记录不代表本次最终启动结果。

## 验证

| 检查 | 本次结果 |
|---|---|
| Python | 3.11.15，可从本项目启动 |
| 显卡 | RTX 5090 Laptop，CUDA 可用，GPU 数量 1 |
| TypeScript | 通过 |
| 单元测试 | 50 passed，含新增迁移路径检查 |
| Python 测试 | 20 passed |
| 桌面界面检查 | 9 passed，使用临时数据及模拟摄像头 |
| 合成报告真实 OCR | GPU 成功，6 个结构化文本块，单次识别约 5.6 秒，原图与结果本机留档 |
| 正式打包版 | 实际窗口打开，GPU 模型初始化成功 |
| 现有 DeepSeek 配置 | 加密密钥可用，模型列表连接成功，选中 deepseek-flash |

合成报告验证使用独立测试目录且无 API 密钥，其最终缺少密钥状态符合预期；未调用收费质控接口。正式 API 检查仅查询模型列表，没有发送医院图片或报告。实际摄像头画质与医学质控效果仍按原验收范围评估。

证据：`.runtime/migration-verification/summary.json`、`packaged-summary.json`、`synthetic-ocr.png`、`packaged-settings.png`。原配置和快捷方式备份在 `.runtime/backups/migration-20261023`。

## 后续使用

双击上一级目录的 `超声报告质控.lnk` 或 `启动超声报告质控.cmd`。进入设置可预加载 GPU OCR；导入报告图片或打开摄像头后正常使用。

现有历史、图片和加密密钥继续保存在 `C:/Users/neu_l/AppData/Local/UltrasoundQC`，未删除或迁移这些数据。下载、Python、模型及构建缓存使用 D 盘项目目录。

以后再次移动整个项目时，先运行 `powershell -ExecutionPolicy Bypass -File scripts/setup-ocr.ps1` 修复解释器。该参数只作用于当次 PowerShell 进程，不更改持久执行策略。重新打包使用 `scripts/package.ps1`，复用项目内 Electron 文件，无需重复下载 Electron。

运行环境的位置设置依据 [uv 官方存储说明](https://docs.astral.sh/uv/reference/storage/)。虚拟环境修复使用 [uv venv --allow-existing](https://docs.astral.sh/uv/reference/cli/#uv-venv)，保留同版本 Python 的现有依赖并通过上述检查验证。
