# Memory V2：SQLite 记忆、对话压缩与向量检索试验版

这是对 ai-companion-kit 的本地开发副本，新增了可选择启用的记忆后端。
普通聊天模型负责回复，整理模型负责摘要和候选记忆提取，embedding 模型负责语义检索。
前两个可以使用同一个模型，也可以分别配置服务地址、模型和密钥环境变量。

**本版已经用本地模拟 HTTP 服务验证完整调用链，但尚未接入真实模型、真实 QQ，
不能把离线演示当作真实模型记忆准确率的证明。**

## 先看演示

需要 Node.js **22.13 或更新**，本机验证版本为 22.20.0。
新后端使用 Node 内置 SQLite，无需数据库服务或原生 npm 扩展。
旧 JSON 后端保持原有 Node 版本要求，SQLite 模块只在启用时动态加载。

在仓库根目录运行：

~~~powershell
npm.cmd run memory:demo
~~~

Windows 也可以双击 tools/memory-v2-demo.cmd。
它使用明确标注的固定摘要和测试向量，演示：

1. 完整原文写入数据库。
2. 较早对话压缩为摘要，最近对话仍以原文提供。
3. 自动提取的记忆先进入 candidate，不作为已确认事实参与长期检索。
4. 确认后可以检索，新城市事实可以替代旧城市。
5. 群聊不会读到其他群或私聊的数据。

演示数据库、report.json 和 context.txt 保存在根目录 data/memory-v2-demo-时间戳/。
演示每次使用新目录，数据库和报告为测试数据。不会登录 QQ 或连接外部模型。

## 接真实模型，在终端试聊

先复制配置。在仓库根目录执行：

~~~powershell
Copy-Item packages/companion/config.memory-v2.example.json packages/companion/config.json
~~~

编辑 config.json，配置三组服务：

| 配置 | 任务 | 必要接口 |
| --- | --- | --- |
| 顶层 baseUrl / model | 正常回复 | POST /chat/completions |
| memory.organizer | 摘要和候选记忆提取 | POST /chat/completions |
| memory.embedding | 向量生成和检索 | POST /embeddings |

baseUrl 应包含 /v1（依服务实际要求），程序在后面追加接口路径。
示例中的整理服务是 DeepSeek，embedding 是本机 Ollama 的 bge-m3。
需要自行准备运行中的服务与模型。没有 embedding 时可将 enabled 改成 false，
检索回退为 SQLite FTS5 + 中文双字片段匹配；这时没有真实语义召回。
没有 organizer 时关闭它，原文和检索仍可用，但不会自动压缩或提取。

在 PowerShell 中设置当前窗口的密钥：

~~~powershell
$env:CHAT_API_KEY = "你的对话模型密钥"
$env:MEMORY_API_KEY = "你的整理模型密钥"
# 本机 Ollama 一般不需要；云 embedding 服务按其要求设置
$env:EMBEDDING_API_KEY = ""
node packages/companion/src/memory-chat.js --config packages/companion/config.json
~~~

聊天和整理共用同一服务时可把两个 apiKeyEnv 都设为同一个环境变量名。
代码不会自动读取 CC Switch 数据库或其中的凭据。
如果使用本机 API 网关，填网关实际提供的 Chat Completions 地址和模型；
不要把仅支持 Responses 的地址当作这里的聊天接口。
memory.embedding 必须指向真正提供 embeddings 的服务。

终端试聊固定使用 private:trial，和真实 QQ 会话分开：

~~~text
/compact           强制整理较早消息，仍保留最近 recentTurns 条原文
/memories          查看候选、已确认和退役记忆及来源
/approve 3         明确确认候选记忆 #3
/reject 4          拒绝候选记忆 #4
/search 我喝什么   检索已确认记忆
/exit              退出
~~~

摘要按照 scope 自动生成。先说超过 recentTurns 条消息再 /compact，才有可压缩的旧消息。
配置中 dataDir 相对于配置文件目录解析，示例数据库在 packages/companion/data-memory-v2/memory.db。
终端里输入的内容会发给你配置的真实服务，并可能产生费用。

## 接回原项目 QQ 入口

使用同一配置文件，填好机器人 QQ 网关参数和 ownerIds，先启动 OneBot 服务。
在 packages/companion/ 下安装 QQ 适配器依赖 ws，再从仓库根目录启动：

~~~powershell
node packages/companion/src/index.js --config packages/companion/config.json --dry-run
# 确认模型与 QQ 收消息正常后移除 --dry-run
~~~

dry-run 会请求聊天模型，但不会发 QQ 消息，也不记录这次模拟对话。
SQLite 初始化及首次旧数据导入仍会发生。
后台整理可能处理已有待整理数据；测试服务地址前请用独立 dataDir。

已改造的是仓库自带 packages/companion 的 Brain/CLI/OneBot 路径。
**安装.bat 下载的第三方 qq-bridge 和 patches/01-bridge.patch 属于另一条运行链路，
不会因这个后端自动获得 Memory V2。** 本版也没有改 DSH 的原生会话或接管其记忆。
旧日记命令仍读 JSON 记忆，暂未接入 SQLite；日记文件本身保持独立。

## 数据怎么保存

单个 memory.db 加运行时 WAL 文件：

| 表 | 内容 |
| --- | --- |
| people | QQ 号、昵称、互动计数、首次/最近出现时间 |
| turns | 完整来信、生成回复、用户 ID、会话、时间、发送状态 |
| summaries | 每个会话的当前摘要、已覆盖消息编号 |
| summary_versions | 历次摘要版本及覆盖范围 |
| memories | 候选/已确认/退役/拒绝/遗忘记忆、来源编号、原话、人物、字段 |
| vectors | embedding 与服务地址+模型+revision 标识 |
| memory_fts | 英文单词、中文双字片段的 FTS5 索引 |
| work_queue | 持久化整理队列、失败次数、下次重试时间 |

Memory V3 会在 `memories` 上补充 `kind` 以外的记忆标签：`temperature`（hot/warm/cold/expired）、
`importance`、`confidence`、`last_reinforced`、`expires_at` 和 `decay_half_life`。
时间衰退只改变检索排序，不删除 `turns` 原文；用户再次提到或管理员执行 `reinforce` 时会强化记忆。

turns 不按 400 轮截断。每条原文完整保存，摘要和检索内容只是提示词里的有限视图。
数据落盘为明文。更换机器备份时先停止程序，再复制整个数据目录；
运行时只复制 memory.db 而漏掉 WAL 可能漏掉最近写入。

## 提取、确认与冲突

~~~text
收到并合批的消息
  → 保留每个原作者，写入完整来信
  → 使用当前会话摘要、近期原文、已确认记忆生成回复
  → 保存生成回复，再单独记录 QQ 发送状态
  → 后台整理较早消息
  → 验证提取结果的来源 ID、逐字引用、同一人物
  → 记为 candidate
  → 本地明确确认后变为 active
~~~

一次整理调用同时生成摘要和候选，避免每条消息都额外调用两次聊天模型。
候选的引用必须真实存在于用户来信，引用助手回复、未知消息、混合不同用户的候选被丢弃。
引用校验只能证明原话存在，不能证明模型推理正确，所以仍需要确认。
摘要本身是模型整理的工作上下文，不等于已确认事实，注入时明确标注这一点。

有 slot 的事实（如 city）在确认时替代相同 scope、用户、kind、slot 的旧事实，
旧记录标记 superseded，并保留替代链。没有 slot 的记忆不会自动推断冲突。
槽位目前由整理模型生成；需要检查字段名是否一致，不宣称已经解决所有语义冲突。

QQ 用户没有自动获得 /approve 管理能力。确认通过本机终端或管理 CLI 进行：

~~~powershell
node packages/companion/src/memory-cli.js --config packages/companion/config.json stats
node packages/companion/src/memory-cli.js --config packages/companion/config.json list private:10001 10001 candidate
node packages/companion/src/memory-cli.js --config packages/companion/config.json approve 3
node packages/companion/src/memory-cli.js --config packages/companion/config.json reinforce 3 0.9 warm
node packages/companion/src/memory-cli.js --config packages/companion/config.json source private:10001 10001 1 2
~~~

forget 只是将记忆从检索移除，原文、摘要和历史仍保留，**不是彻底删除隐私数据**。

## 权限与检索

- private:QQ号 只允许该用户身份读取。
- group:群号 内所有公开群消息属于该群上下文；群 A 不检索群 B。
- 相同 QQ 号在私聊与群内的资料暂不跨域共享，优先避免原项目全局聊天流水带来的泄露。
- 没有跨群共享同意管理界面，也没有多租户网络鉴权；只作为本地进程使用。
- 权限过滤在 SQL 中执行，之后计算向量相似度。只检索 active。
- 向量存 SQLite，用 JavaScript 做精确余弦计算；不是 ANN/HNSW 索引。
- 同时用 FTS5/中文片段匹配，不把时间新鲜度冒充相关性。
- 更换 embedding 服务、模型或 revision 会生成另一组向量，不混用旧模型向量。
- embedding 故障时回退关键词；整理失败时不推进摘要覆盖范围，后台重试。

默认最多检索 6 条，近期原文保留 8 条；记忆上下文限制 10000 个 JS 字符，
这不是精确 token 计量，也不包括用户当前输入和角色卡。
为了保证最新消息可见，各部分有独立预算，超长片段附带截断标记。

## 迁移与关闭

首次启用时，在同一个 dataDir 中读取 people.json 和 turns.jsonl，一次性事务导入，
原文件不改写。人物资料默认仅导入为该用户的私聊资料；旧文件来源标记 legacy-import。
旧群流水缺少可靠 userId 时保留空身份，不猜测是谁，因此不会从它自动提取人物记忆。
损坏 JSON 导入会失败并回滚，不覆盖原文件。

把 memory.backend 改回 json 可以恢复原后端，但 V2 后续新增内容不会自动写回旧 JSON。
需要重新迁移时使用一个新数据目录，先备份并复制旧文件。

## 验证范围与剩余工作

执行 npm.cmd run memory:test 检查持久化、压缩水位、隔离、来源校验、事实替代、
向量模型切换、失败恢复、旧数据导入、并发对话以及本机 HTTP 协议调用。
执行 npm.cmd run check 检查原项目语法与原有功能。

离线演示使用固定摘要和人工测试向量；HTTP 测试使用本机模拟服务。
尚未完成真实模型准确率评估、真实 QQ 发消息验收、长时间运行压测、可视化管理。
本版对单条超过整理输入预算的消息只提供带截断标记的摘录，完整原文仍可按编号追查。
递归摘要仍可能丢失细节；需要用原始聊天回归集评估，不能保证永不失忆或错记。
后台队列是持久化的，但同一 scope 应由单个机器人进程写入。
大规模向量数量下应评测后再考虑 sqlite-vec 或独立向量索引。

修改基于上游提交 809fe8b9db210878309ad89e1c96cd800833c446，遵循原仓库 MIT 许可证。
