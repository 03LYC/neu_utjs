# SDD ledger — plan: D:/desktop/qcagent/docs/superpowers/plans/2026-10-21-ultrasound-qc.md

2026-10-21: 用户批准计划与顺序实现，授权自行配置环境；阻塞记录交接，不逐项询问。

Ruling: 工作区无 Git，采用新建独立 ultrasound-qc 目录隔离，不创建无来源的 worktree。旧 OCR 与医院样例保持原状。
Ruling: Windows 不运行技能的 POSIX 记账脚本，直接使用本文件记录相同阶段与测试证据。
Pre-flight: 任务1解释器配置被任务3/8读取；统一 .runtime/config.json 为跨开发/打包配置，python-path.txt 仅辅助。
Pre-flight: 任务2契约被任务3/4/5/6/7共享；源引用统一使用 sourceId，记录/尝试统一使用 recordId/attemptId。
Pre-flight: 任务4只生成四字段 payload，任务5只接收该 payload；任务7等待落盘才发布最终状态。
Task 1: in progress — 先建立运行基线。

Task 1 evidence: Python 3.11.15、PaddlePaddle GPU 3.3.1 cu129、PaddleX 3.7.2 安装完成；Python 全套 10 passed (含源路径验证)。模型下载及四类真实推理仍在进行。
Task 2 evidence: 留档5测试通过，覆盖中文路径、原稿、失败写入、路径越界与中断恢复。共享结果契约测试通过。
Task 3 evidence: OCR解析/模型复用4测试通过；进程路由3测试通过，真实 Python 工作进程已被桌面测试使用。
Task 4 evidence: 最小外发5测试通过；发送预览及编辑已实现，等待真实 OCR 输出校验。
Task 5 evidence: 网络超时/无效JSON/密钥错误/外发约束5测试、密钥存储2测试通过。未使用聊天明文密钥，真实API待本机录入。
Task 6/7 evidence: 窗口安全、摄像头模拟流及ROI、Windows密钥加密、真实SQLite历史的Electron端到端4测试通过；编排4测试通过。
Ruling: 模型下载采用 Paddle 官方 BOS 源，避免默认 HuggingFace 连通检查延迟。首轮 runtime import耗时107秒包含来源检查，后续工作进程禁用该额外检查。
Ruling: Electron 下载 GitHub fetch失败，设置当前安装命令 ELECTRON_MIRROR 为 npmmirror 后成功；不修改全局 npm 配置。
Ruling: 端到端首轮2失败是导航按钮图标参与无障碍名称；隐藏装饰图标后4项全通过，不放宽功能断言。

Task 1: complete — GPU四类真实样例识别与CPU介入样例识别成功；缓存后GPU初始化19.42秒，各图5531/1532/297/453毫秒；CPU初始化6.72秒、单图24578毫秒。模型初次下载不计稳定推理延迟。
Task 2/3: implemented — 原图原字节留档、结构化结果、原始Paddle JSON和完整文字均在本机保存；后续修订不覆盖原稿。进程协议与中断恢复有测试。
Task 4: implemented — 四类真实OCR输出均提取出部位、所见和结论；保留表格行列、合并和空单元格；不确定坐标/低置信度进入确认。
Task 5: implementation verified with simulated transport only — 实际DeepSeek联通需用户在本机设置页录入密钥；未将聊天密钥复制进工具命令/源码/普通配置，也未上传医院报告。
Task 6/7: implemented — 真实Electron界面5测试通过；完整“导入真实报告→真实GPU OCR→缺密钥失败留档”端到端另1测试通过（27.3秒，后续代码变更需终验）。本机实际ASUS FHD摄像头已打开，未采集/保存非报告画面。
Task 8: in progress — 本机exe和中文快捷方式已生成，打包启动/后台真实响应通过；正在审查修复后的最终打包与终验。

Review: 独立审查代理按技能要求以新上下文执行，报告两项确认的隐私/完整性缺陷及一项失败尝试留档缺陷；随后因该审查模型使用额度耗尽中断，未取得完整最终审查结论。未把中断当作审查通过。剩余代码由作者执行独立审查步骤，完整外部审查待补。
Review fix 1 RED→GREEN: 姓名/性别/年龄标签与值分散单元格时会泄漏；现在含身份字段的表格整体隔离、分散段落标签和值排除，并暂停外发要求核对完整性。三个新增回归用例复现后通过。
Review fix 2 RED→GREEN: 脱敏占位符不能算作有效所见；正文去除内容一律要求核对，空/仅占位符的必要字段无法发送。
Review fix 3 RED→GREEN: 每次run在OCR前创建尝试，后续更新同一尝试的实际发送内容和文档；OCR失败也保留失败尝试，重启时未完成尝试标为失败。
Self-review: Windows后台关闭实测挂起中的Python进程已终止；新增行为测试为特征验证（初次即通过），未凭猜测更改进程杀停实现。
Self-review: 编辑发送预览只能引用已允许的源ID，不能重新引入被隔离的身份单元格。
Ruling: 屏幕截图上开启UVDoc形变矫正会裁掉边缘标题/结论，真实对比后默认关闭；不把关闭后较完整的OCR当作绝对正确，仍保留低置信度/结构警告。形变矫正配置仍可由OCR运行配置显式打开。
Ruling: 本机项目初始无Git、无base branch/remote，保留 feat/ultrasound-qc 独立本地分支，不创建没有目标仓库的PR或合并流程。

Task 5 live verification: 从当前聊天中用户明确提供的唯一DeepSeek凭据读取到内存，经本机IPC交给safeStorage加密保存；没有在工具命令、源码、env或普通日志嵌入凭据明文。真实连接返回 deepseek-flash / deepseek-v4-pro，选用前者。4个纯合成文字API案例：正常通过、重复字检出、左右侧矛盾检出、单位矛盾检出，约1.0/1.7/2.7/2.4秒。医院报告未上传。
Ruling RED→GREEN: 实际API偶发顶层issues_found但各条requiresReview=true；保留所有引用有效的问题，并按条目标记统一成needs_review。顶层passed却包含问题仍拒绝，空问题状态/虚构引用仍拒绝。新增回归覆盖明确条目不能藏在待复核状态、谨慎条目不会因标签不一致丢失。
Task 8 external blocker: 最终重打包的未签名exe被Windows Smart App Control拦截；CodeIntegrity 3077确认。原先中间构建曾通过窗口启动验证，但这不能证明当前构建可启动。未修改安全策略，未通过改名/改哈希循环尝试规避拦截。签名或管理员批准交接用户。
Live full workflow: 开发运行环境（不是最终安装包）3个合成图片完成真实OCR→DeepSeek→SQLite留档：正常passed，错别字issues_found，左右侧矛盾issues_found，耗时26.3/2.4/4.0秒。原图字节和原始OCR留档核对通过。测试创建的3份合成记录已按ID清理，正式数据区保留加密API配置。
Self-review RED→GREEN: 模型响应成功但保存失败，失败尝试metadata应正确记为已外发；已修正sentToModel并测试，不把数据已发送的情况误写为未发送。

Continuation RED→GREEN: 模拟摄像头分辨率变化未使ROI失效、断连可捕获旧帧、返回页面忘记设备；对应端到端复现后修复。设备/尺寸变化要求重新框选或确认全画面，断连停止采集，设备配置本地保存。
Continuation RED→GREEN: 漏掉的OCR段落无法补录；新增手动段落，重新质控合并修订并保留原稿，端到端验证实际提交与SQLite原稿不变。
Continuation RED→GREEN: 全表格报告的部位/结论误进测量字段；按当前分区保留单元格上下文，所见标题加有效测量表可构成完整内容；只有标题仍不能发送。
Continuation RED→GREEN: 布局遗漏可见分区标题导致缺分区；仅补回全文OCR确实找到的标题，按图像坐标插入并保留警告。测试覆盖读取顺序、同一行避免重复、所见出现同词不吞掉结论。
Validation: 扩展四类各10张、40张GPU本地OCR全部完成，23张需核对、17张无自动核对原因；四字段无空缺。CPU心脏表格真实推理39609ms、70块59单元格，保留结构警告。所有医院内容仅存本机。
Live prompt correction: 纯表格12mm/12cm案例暴露模型误报所见缺失。提示词v2明确表格与所见同属报告内容；修订后正常表格passed，矛盾表格仅报告单位问题但归为needs_review，保留模型确定性波动这一限制，没有把未达到issues_found预期写成全部成功。
Final verification 02:27–02:28: typecheck通过，Vitest42通过，pytest20通过（1条ccache警告），Electron E2E10通过，构建打包通过。最终exe仍被Windows应用程序控制拦截，未修改安全策略；证据与哈希更新至VALIDATION.md。
Independent review resumed and completed: reviewer再次检查全量当前工作树，报告3项Important/P1-P2问题，无新Critical。导入外部路径重读导致原图/OCR关联错误（同名覆盖E2E复现失败）；空白身份标签漏检（自动过滤与最终校验各复现失败）；独立/空白医师标题未终止正文（复现失败）。
Final fix pass RED→GREEN: 导入时一次读取原始字节，预览解码及留档均源于同一快照，外部文件后续覆盖不影响原图；身份标签允许字间空白，两层过滤均覆盖；独立或带冒号非报告标题终止正文，相关医师表格整体隔离。3个过滤回归、1个真实OCR导入覆盖回归由失败变通过，额外表格测试通过。
Final evidence 02:31: typecheck通过，Vitest46通过；pytest20通过（Python未再更改），完整Electron E2E10通过26.9秒；重新构建打包成功，源码密钥模式匹配0，asar无医院样例/明文报告/凭据/历史。最终exe仍被应用程序控制拒绝，完整哈希记录见VALIDATION.md。独立审查已完成且报告问题已修复；余下不可自主解决项为系统签名/批准，以及医院现场和医生标注效果验收。
