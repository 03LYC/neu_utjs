# 2026-10-24 重启后 OCR 错误排查

当前状态：界面可以启动，OCR 核心依赖仍被 Windows 应用控制阻止；不能把本次状态标记为已恢复。

## 已证实的原因

1. 新进程单独 `import chardet` 即失败，错误为 `language__mypyc` 扩展加载失败，系统提示“应用程序控制策略已阻止此文件”。Windows Code Integrity 事件 3077 与之对应。
2. 将 chardet 7.7.0 更换为官方同版本纯 Python wheel 后，独立进程导入及合成 ASCII 编码检测通过；版本与公开接口不变。
3. 后续实际冷启动仍失败：`libpaddle.pyd` 和 NVIDIA/CUDA 动态库也出现拦截；普通用户运行环境中最终报告 `WinError 4551`，指出 `nvidia/cusolver/bin/cusolverMg64_11.dll` 或其依赖被阻止。界面冷启动直接导入合成图片同样失败。
4. 应用控制策略 ID 为 `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`，`VerifiedAndReputablePolicyState=1`。所检查的 Paddle、cuSOLVER、cuBLAS、CUDA runtime 核心文件均未嵌入有效签名；这不能单独证明文件有害，但与本机策略拒绝证据一致。
5. 抽查 `libpaddle.pyd`、`cusolverMg64_11.dll`、`cudart64_12.dll` 的哈希与其已安装发行包 RECORD 一致，没有发现迁移改变这些文件内容的证据。

上次 2026-10-23 的结果只能证明当时启动、预加载与合成测试通过，没有充分证明重启后的各项依赖持续满足系统信任要求。此次以新的进程、不预加载模型的直接导入流程复测，不能继续沿用上次“正常运行”的结论。

## 本次已做的局部修复

- 安装官方 `chardet-7.7.0-py3-none-any.whl`，SHA256：`11cf9b719ea3675a2a7d8a3071bbe4d7ea24b26bfe39a51588d515ddd05cacad`。
- 在锁文件固定此官方纯 Python 构建和哈希；安装脚本检测版本和纯 Python 标记，避免未来恢复成受影响的编译构建。
- 增加全新进程导入与编码检测回归检查。
- 未更改 OCR 模型、质控提示词、判断规则、界面或隐私过滤；未关闭、修改或绕过 Windows 安全策略。
- 下载包、备份、诊断输出均在本项目 `.runtime` 下。编译版 chardet 备份为 `.runtime/backups/importerror-20261024/chardet-7.7.0-compiled.zip`。

## 当前验证结果

- chardet 新进程导入与合成字符串检测：通过。
- Python 检查：20 passed，1 failed；失败项为真实 Paddle/OCR 环境导入，仍受系统策略阻止。
- 普通用户环境冷启动真实 GPU OCR：失败，WinError 4551。
- 界面直接导入合成图片、无预加载：失败，OCR 未产出，未调用付费 API、未发送医院资料。

## 完整恢复所需的下一步

推荐采用受系统信任的签名部署，由开发方或组织签名服务核验并签署完整程序及所需二进制依赖，按现行策略验收。不能仅签主 exe 而忽略加载的动态库。本机个人和计算机个人证书存储未发现证书，当前没有可直接使用的本机代码签名私钥；组织远程签名服务或外置令牌需另行提供。

如果电脑所有者考虑调整智能应用控制设置，该决定影响整个电脑，应明确确认后再处理，不属于项目内依赖修复。本次没有执行此操作。

Microsoft 文档说明，Smart App Control 会按云端信任和有效签名判断程序；当前不提供仅针对单个应用的例外。对开发者的推荐方案是有效可信签名，并包含应用的所有二进制文件：

- [Microsoft Smart App Control 常见问题](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)
- [Microsoft 应用与驱动控制：签署全部应用代码](https://learn.microsoft.com/en-us/windows/security/book/application-security-application-and-driver-control)
- [为 Smart App Control 签署应用](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)

## 可复核证据

- `.runtime/restart-verification-20261024/security-evidence.json`：策略状态、核心文件路径、签名、SHA256 和事件。
- `.runtime/logs/cold-ocr-20261024.log`：最初 chardet 失败的完整合成测试堆栈。
- `.runtime/logs/cold-ocr-fixed-user-20261024.log`：普通用户环境复测的 GPU 核心库失败堆栈。
- `.runtime/restart-verification-20261024/cold-ui-summary.json`：无预加载界面复测结果。
