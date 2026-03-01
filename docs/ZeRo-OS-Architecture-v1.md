# ZeRo OS

ZeRo OS 是一个可在本机自动执行任务的 AI 系统。

目标是把电脑作为实验场，让 AI 能执行命令、构建工具、自动修复并重启更新。

## 核心思想

1. AI 可以修改代码并修复 Bug。
2. AI 可以构建和扩展工具。
3. AI 可以在可控条件下完成自我更新与重启。

---

## 全局架构

```
┌─────────────────────────────────────────────────────────┐
│                       触发源                             │
│   ┌────────┐  ┌──────────┐  ┌──────────┐               │
│   │  飞书   │  │ Telegram │  │ Scheduler│    ...        │
│   └───┬────┘  └────┬─────┘  └────┬─────┘               │
└───────┼────────────┼─────────────┼──────────────────────┘
        │            │             │
        ▼            ▼             ▼
┌─────────────────────────────────────────────────────────┐
│                      Session                             │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  身份记忆（全局 + Agent + 备忘录）+ 工作记忆检索    │ │
│  └────────────────────────────────────────────────────┘ │
│                         │                                │
│  ┌──────────────────────▼─────────────────────────────┐ │
│  │                  Agent                              │ │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐│ │
│  │  │ Read │ │Write │ │ Edit │ │ Bash │ │ Browser  ││ │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────────┘│ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │ Task（SubAgent 编排）                         │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
│                         │                                │
│  ┌──────────────────────▼─────────────────────────────┐ │
│  │              Model Router                           │ │
│  │              Provider Adapter                       │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
        │              │              │
        ▼              ▼              ▼
┌─────────────┐ ┌────────────┐ ┌───────────┐
│  Anthropic  │ │   OpenAI   │ │  其他服务  │
└─────────────┘ └────────────┘ └───────────┘

横切关注点（所有层共享）：
  ├─ 保密箱（.zero/secrets.enc）
  ├─ 观测性（.zero/logs/）
  ├─ 记忆（.zero/memory/）
  ├─ 版本管理（Git）
  └─ 并发安全（Tool 级文件锁）
```

---

## 工作区结构

ZeRo OS 的所有数据统一存放在 `.zero/` 目录下：

```
.zero/
  ├─ config.yaml       # 系统配置（模型注册表、Scheduler、降级链等）
  ├─ fuse_list.yaml    # 熔断名单，AI 执行命令前检查，命中则拒绝并告警
  ├─ secrets.enc       # 加密密钥文件，主密钥存于 macOS Keychain
  ├─ channels/         # Channel 实现代码（飞书、Telegram 等）
  ├─ tools/            # AI 构建的自定义工具
  ├─ skills/           # AI 的技能定义，封装复杂业务流程
  ├─ logs/             # 日志与请求记录
  │   ├─ requests.jsonl  #   LLM 请求记录（追加写入）
  │   ├─ snapshots.jsonl #   上下文快照（变化时写入）
  │   ├─ operations.jsonl#   工具调用记录（追加写入）
  │   └─ metrics.db      #   SQLite，聚合查询用
  ├─ memory/           # 记忆库
  │   ├─ memo.md       #   备忘录（AI 与人类共同编辑）
  │   ├─ memory.md     #   全局索引页
  │   ├─ preferences/  #   身份记忆（global.md + agents/）
  │   ├─ sessions/     #   任务会话记录
  │   ├─ incidents/    #   故障案例
  │   ├─ runbooks/     #   可重复执行流程
  │   ├─ decisions/    #   架构和策略决策
  │   ├─ notes/        #   用户主动保存内容
  │   ├─ inbox/        #   待整理原始记录
  │   └─ archive/      #   归档数据
  └─ workspace/        # AI 的工作目录
      ├─ {agent}/      #   每个 Agent 独立的工作目录（如 coder/、ops/、explorer/）
      └─ shared/       #   共享目录，最终产出物放这里，供用户和其他 Agent 访问
```

每个 Agent 只在自己的目录下工作，临时文件和草稿不影响其他 Agent。需要交付的产出物放到 `shared/`，`shared/` 遵循 Write/Edit 的文件锁。

---

## 安全策略

系统默认放行所有操作，给予 AI 最大控制能力。仅通过熔断名单和操作日志做最低限度的保护。

### 熔断名单

极少数不可逆且大概率是误操作的命令会被拦截（如 `rm -rf /`、`mkfs`、`dd if=/dev/zero`）。名单维护在 `.zero/fuse_list.yaml`，用户可自行修改。

### 操作日志

所有操作记录完整的结构化日志，详见「观测性」章节。

---

## 工具

系统提供 6 个基础能力：

1. `Read`：读取文件内容，支持按范围读取。
2. `Write`：在工作区写入新内容。
3. `Edit`：对现有文件做精确修改。
4. `Bash`：执行系统命令（Mac）。
5. `Browser`：进行网页访问与浏览器操作。
6. `Task`：启动 SubAgent 执行特定任务，包含预设 SubAgent（Explorer 等），也支持用户自定义。

### Bash 安全约束

Bash 命令默认全放行，仅受熔断名单约束。所有执行记录写入操作日志。

---

## 工具构建

### 1) 使用网络已有 MCP/SKILL

1. 下载源码。
2. 做安全审查（可疑命令、异常外联、权限越界）。
3. 有风险先修复或隔离，再接入系统。
4. 审查通过后进入可信工具列表。

### 2) 自建 Tool/SKILL

1. **Tool**：封装外部 API（例如图片生成 API）。
2. **SKILL**：封装复杂业务流程（例如公众号上传、草稿审阅、发布）。

### 工具选择原则

1. 优先稳定和可审计。
2. 无法确认安全时，默认不自动启用。

---

## 模型层

系统支持多模型接入和运行时切换，采用两层架构：

```
┌─────────────────────────────────┐
│           Session               │
│  ┌───────────────────────────┐  │
│  │     Model Router          │  │
│  │  - 当前活跃模型            │  │
│  │  - 模型切换（精确/模糊/NL）│  │
│  │  - 降级链                  │  │
│  └──────────┬────────────────┘  │
│             │                   │
│  ┌──────────▼────────────────┐  │
│  │   Provider Adapters       │  │
│  │  - Anthropic Messages API │  │
│  │  - OpenAI Chat Completions│  │
│  │  - OpenAI Responses API   │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

### Model Registry（模型注册表）

以 Provider 为顶层组织，每个 Provider 配置一次连接信息和密钥，其下挂载多个模型：

```yaml
providers:
  anthropic:
    api_type: anthropic_messages
    base_url: https://api.anthropic.com
    api_key_ref: anthropic_api_key
    models:
      claude-opus:
        model_id: claude-opus-4-6
        max_context: 200000
        max_output: 32000
        capabilities: [tools, vision, reasoning]
        tags: [powerful]

      claude-sonnet:
        model_id: claude-sonnet-4-5-20250929
        max_context: 200000
        max_output: 8192
        capabilities: [tools, vision]
        tags: [fast, balanced]

  openai:
    api_type: openai_chat_completions
    base_url: https://api.openai.com
    api_key_ref: openai_api_key
    models:
      gpt-4o:
        model_id: gpt-4o
        max_context: 128000
        max_output: 16384
        capabilities: [tools, vision]
        tags: [fast, balanced]

  openai-responses:
    api_type: openai_responses
    base_url: https://api.openai.com
    api_key_ref: openai_api_key
    models:
      o3:
        model_id: o3
        max_context: 200000
        max_output: 100000
        capabilities: [tools, vision, reasoning]
        tags: [reasoning]

  deepseek:
    api_type: openai_chat_completions
    base_url: https://api.deepseek.com
    api_key_ref: deepseek_api_key
    models:
      deepseek-r1:
        model_id: deepseek-reasoner
        max_context: 65536
        capabilities: [tools, reasoning]
        tags: [cheap]
```

新增模型只需在对应 Provider 下添加条目，无需重复配置连接信息和密钥。新增 Provider 只需定义一次 `api_type`、`base_url` 和 `api_key_ref`。

### 模型定价与用量追踪

模型价格默认从 [litellm/model_prices_and_context_window.json](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) 获取，单位为 $/M tokens（每百万 Token 的美元价格）。如需覆盖，可在模型配置中显式指定：

```yaml
# 覆盖示例：在模型配置中添加 pricing 字段
claude-opus:
  model_id: claude-opus-4-6
  max_context: 200000
  max_output: 32000
  capabilities: [tools, vision, reasoning]
  tags: [powerful]
  pricing:                        # 可选，不填则使用 litellm 默认值
    input: 15.0                   # $/M input tokens
    output: 75.0                  # $/M output tokens
    cache_write: 18.75            # $/M 写入缓存 tokens
    cache_read: 1.5               # $/M 命中缓存 tokens
```

系统按每次 LLM 请求记录完整调用信息，使用 JSONL 追加写入，SQLite 做聚合查询。

**请求记录**（每次 LLM 调用都写入 `requests.jsonl`）：

```jsonl
{
  "id": "req_003",
  "parent_id": "req_002",
  "session_id": "sess_001",
  "snapshot_id": "snap_001",
  "model": "claude-sonnet",
  "provider": "anthropic",
  "user_prompt": "帮我改一下 config",
  "response": "好的，已修改...",
  "tokens": {
    "input": 3200,
    "output": 1800,
    "cache_write": 0,
    "cache_read": 800
  },
  "cost": 0.028,
  "ts": "2026-02-27T10:05:00Z"
}
```

**上下文快照**（仅在变化时写入 `snapshots.jsonl`）：

System Prompt、tools 等上下文信息不随每次请求重复记录，只在发生变化时产生一次快照，请求通过 `snapshot_id` 引用。

```jsonl
{
  "id": "snap_001",
  "session_id": "sess_001",
  "trigger": "session_start",
  "system_prompt": "你是 ZeRo OS 的 Coder Agent...",
  "tools": ["Read", "Write", "Edit", "Bash"],
  "identity_memory": "...",
  "ts": "2026-02-27T10:00:00Z"
}
```

产生新快照的时机：

- **Session 启动**：初始快照，记录完整上下文。
- **模型切换**：不同模型可能 System Prompt 格式不同。
- **工具变化**：新增或移除了 Tool。
- **上下文压缩**：对话历史接近上下文窗口上限时，用便宜模型做摘要压缩，压缩后产生新快照。

```jsonl
{
  "id": "snap_002",
  "session_id": "sess_001",
  "trigger": "context_compression",
  "parent_snapshot": "snap_001",
  "system_prompt": "...",
  "tools": ["Read", "Write", "Edit", "Bash"],
  "compressed_summary": "用户在讨论 ZeRo OS 架构设计，已完成安全策略和模型层...",
  "messages_before": 42,
  "messages_after": 8,
  "ts": "2026-02-27T11:30:00Z"
}
```

要复现任何一次请求的完整上下文：请求记录 + 对应快照 + `parent_id` 链条上的历史 prompt/response。

Token 用量和费用汇总到观测性 Metrics 中，支持按模型、Provider、Session、时间维度统计。

### Provider Adapter（协议适配层）

负责统一不同厂商的 API 调用格式，对上层暴露统一接口：

1. 将内部统一格式转换为各厂商 API 格式（消息结构、Tool Schema、流式输出）。
2. 处理认证、重试、错误码映射。
3. 新增 Provider 只需实现统一接口，不影响上层代码。

所有 Provider 均需配置 `base_url`。系统仅支持三种协议类型：

| 类型 | 默认 BaseUrl | 适用范围 |
|------|-------------|---------|
| Anthropic Messages API | `https://api.anthropic.com` | Claude 系列 |
| OpenAI Chat Completions | `https://api.openai.com` | GPT 系列、DeepSeek、Mistral、vLLM、Ollama 及所有 OpenAI 兼容服务 |
| OpenAI Responses API | `https://api.openai.com` | OpenAI Responses API |

非官方服务只需将 `base_url` 指向对应地址即可，无需额外适配。

### Model Router（模型路由层）

决定每条消息应由哪个模型处理。

**1. 模型切换**

支持三种方式触发切换，按优先级匹配：

| 方式 | 示例 | 说明 |
|------|------|------|
| 精确匹配 | `/model anthropic/Opus 4.6` | 完整的 Registry 名称，直接命中 |
| 模糊命令 | `/model opus` | 对 Registry 中的模型名称做模糊匹配 |
| 自然语言 | `帮我把模型更换为 opus` | 由当前模型识别意图，提取目标模型并匹配 |

匹配规则：

1. 精确匹配优先：输入与 Registry 中的名称完全一致，直接切换。
2. 模糊匹配次之：输入关键词与模型名称、model_id、tags 做模糊匹配，命中唯一结果则切换。
3. 多个匹配时列出候选，让用户选择。
4. 无匹配时提示可用模型列表。

**2. 降级链**

首选模型不可用时，自动沿降级链切换：

```
claude-opus → claude-sonnet → gpt-4o
```

降级时通知用户当前使用的模型已发生变化。

---

## 任务编排

任务编排是 SubAgent 之间的依赖和执行顺序管理。主 Agent 通过 Task 工具启动多个 SubAgent，并定义它们之间的依赖关系。

```
┌──────────────────────────────────────────────────┐
│              Task（主 Agent 发起）                 │
│                                                  │
│  ┌──────────────┐   ┌──────────────┐             │
│  │ SubAgent A   │   │ SubAgent B   │             │
│  │ 调研技术方案1 │   │ 调研技术方案2 │             │
│  └──────┬───────┘   └──────┬───────┘             │
│         │                  │                     │
│         │    A、B 无依赖    │                     │
│         │    并发执行       │                     │
│         ▼                  ▼                     │
│        ┌────────────────────┐                    │
│        │   等待 A + B 完成   │                    │
│        └─────────┬──────────┘                    │
│                  ▼                               │
│         ┌──────────────┐                         │
│         │ SubAgent C   │                         │
│         │ 整合两份报告  │                         │
│         │ 生成最终文档  │                         │
│         └──────────────┘                         │
│                                                  │
│  编排规则：                                       │
│  - 无依赖的 SubAgent 并发执行                     │
│  - 有依赖的 SubAgent 等上游全部完成后再启动        │
│  - 任一 SubAgent 失败，下游取消并通知用户          │
│  - 每个 SubAgent 有独立的超时时间                  │
└──────────────────────────────────────────────────┘
```

---

## 并发安全

多个 Session 同时运行时（多个 IM 窗口、Scheduler 触发等），由 Tool 层自行管理资源冲突：

- **Read**：无锁，任意并发。
- **Write / Edit**：按文件路径加锁，同一文件写互斥。
- **Bash**：默认无锁并发。
- **Browser**：实例级锁，同一时间只有一个 Session 能使用。

---

## Scheduler

> 定时器，本质上是另一个触发源，跟 IM 消息没有区别。

Scheduler 只做一件事：**到时间了，带着预定义的指令创建一个 Session**。后续执行流程与用户发消息完全一样。

```
┌──────────────────────────────────────┐
│              触发源                   │
│                                      │
│  ┌────────┐  ┌──────────┐           │
│  │  飞书   │  │ Telegram │    ...    │
│  └───┬────┘  └────┬─────┘           │
│      │            │                  │
│  ┌───┴────────────┴──────────┐      │
│  │     Scheduler (Cron)      │      │
│  │  - 每天 2:00 检查更新      │      │
│  │  - 每周一 9:00 生成周报    │      │
│  └─────────────┬─────────────┘      │
└────────────────┼─────────────────────┘
                 │
                 ▼
          创建 Session
          （与 IM 触发完全一样）
                 │
                 ▼
          Agent 执行任务
```

### 配置

```yaml
schedules:
  - name: daily_update_check
    cron: "0 2 * * *"
    instruction: "检查系统更新，有更新则执行升级"
    model: claude-sonnet

  - name: weekly_report
    cron: "0 9 * * 1"
    instruction: "整理上周的 sessions 和 incidents，生成周报"

  - name: memory_cleanup
    cron: "0 3 * * 0"
    instruction: "清理 inbox，归档过期记忆，更新 memory.md 索引"
```

### 实现

使用系统 Cron，每条定时任务对应一个 crontab entry。Cron 由系统管理，即使主进程在重启也不受影响。

### 任务重叠

同一个定时任务上一次还未完成，下一次触发时间又到了时的策略：

- `skip`（默认）：跳过本次。
- `queue`：排队等上一次结束。
- `replace`：终止上一次，启动新的。

### 错过执行

系统宕机期间错过的定时任务，默认不补执行。可通过 `misfire_policy: run_once` 配置恢复后补跑一次。

---

## 备忘录

备忘录是 AI 和人类之间的**异步协作协议**。AI 可以编辑，人类也可以编辑。人类通过编辑影响 AI 的任务方向，AI 通过编辑让人类知道当前状态和计划。

与记忆的区别：记忆是过去发生了什么，备忘录是**现在要做什么、接下来打算怎么做**。备忘录应始终保持精简，过时内容及时清理。

### 存储

`.zero/memory/memo.md`，作为身份记忆的一部分，每次 Agent 启动时加载。

### 结构

一个文件，上半部分是全局区域，下半部分按 Agent 分区：

```markdown
# 备忘录

## 目标
- 本周完成 v2.0 发布
- Channel 模块重构，计划下周开始

## 需要用户处理
- Telegram Bot Token 还未提供
- v2.0 changelog 需要人工审核

---

### Coder Agent
**进行中**：重构 Provider Adapter，预计今天完成
**计划**：完成后跑单元测试，通过则提交 PR

### Ops Agent
**进行中**：部署 Telegram Bot，等待用户提供 Token
**计划**：部署完成后自动跑回归测试

### Explorer Agent
**进行中**：无
**计划**：无
```

### 编辑规则

- **目标** 和 **需要用户处理**：全局区域，任何 Agent 可追加，人类可修改排序和优先级。
- **Agent 分区**：每个 Agent 只读写自己的区域，不动别人的。
- **并发写入**：通过文件锁（与 Write/Edit 工具的锁一致）保证不会同时写。

### Agent 间的可见性

备忘录也是 Agent 之间的协作协议。每个 Agent 能看到备忘录全文（包括其他 Agent 的分区），但只暴露结论和状态，不暴露过程。

```
Agent A 能看到的：
  ✓ 备忘录全文（包括其他 Agent 的分区）
  ✓ 自己的 Session 上下文
  ✓ 自己的身份记忆 + 全局身份记忆

Agent A 看不到的：
  ✗ 其他 Agent 的 Session 上下文
  ✗ 其他 Agent 的身份记忆
```

如果 Agent A 需要 Agent B 的详细信息（如调研结果），应通过任务编排的 SubAgent 依赖关系传递，而不是直接访问对方上下文。

---

## 保密箱

保密箱统一管理所有密钥（API Key、Token、Secret 等）。核心规则：**AI 可以用，不可以输出。**

### 存储

密钥存储在加密文件 `.zero/secrets.enc` 中，该文件加入 `.gitignore`，不进版本控制。

加密方式：使用 AES 加密，主密钥存储在 macOS Keychain 中。

```
macOS Keychain
  └─ 主密钥（唯一存入 Keychain 的内容）
       │
       └─ 加解密 .zero/secrets.enc
              │
              └─ anthropic_api_key
              └─ openai_api_key
              └─ feishu_app_secret
              └─ telegram_bot_token
              └─ ...
```

系统启动时用主密钥解密到内存，运行期间从内存读取，磁盘上始终是密文。

### 输出过滤

AI 在所有输出场景（聊天回复、日志、记忆写入）中自动过滤密钥值，防止泄露。

---

## 记忆模块

记忆模块位于 `.zero/memory/`，使用 Markdown + 双向链接管理历史信息。

### 目录结构

1. `memory.md`：全局索引页。
2. `sessions/`：一次任务全过程。
3. `incidents/`：故障案例。
4. `runbooks/`：可重复执行流程。
5. `decisions/`：架构和策略决策。
6. `preferences/`：身份记忆（`global.md` + `agents/` 各 Agent 身份）。
7. `notes/`：用户主动保存内容。
8. `inbox/`：待整理原始记录。
9. `archive/`：归档数据。

### 记忆模板（统一最小字段）

每条记忆建议包含：

1. `id`
2. `type`
3. `title`
4. `created_at`
5. `updated_at`
6. `status`
7. `session_id`（全局页如 `memory.md` 可为空或 `global`）
8. `confidence`（0~1，用于自动化决策门槛）
9. `tags`
10. `related`

### 模型如何使用记忆

记忆分两层加载，模型只能"看到"被塞进上下文的内容：

**第一层：身份记忆（每次 Agent 启动固定加载）**

身份记忆分两级，Agent 启动时合并加载：

```
Agent 加载的身份记忆 = 全局身份 + 当前 Agent 身份 + 备忘录
```

- **全局身份**：所有 Agent 共享，包含用户偏好、沟通语言、基本信息。
- **Agent 身份**：每个 Agent 特有的上下文，如技术栈、工作流程、输出风格。
- **备忘录**（`.zero/memory/memo.md`）：当前目标、各 Agent 状态、待处理事项。

存储结构：

```
preferences/
  global.md          # 全局身份：用户偏好、语言、基本信息
  agents/
    coder.md         # 代码 Agent：技术栈、代码风格、项目上下文
    ops.md           # 运维 Agent：服务器配置、部署流程
    writer.md        # 写作 Agent：文风、目标受众
    explorer.md      # 调研 Agent：信息来源偏好、输出格式
```

Agent 身份记忆支持自我进化：Agent 在工作中发现新的偏好或模式时，可自行更新自己的身份记忆文件。

**第二层：工作记忆（按需检索）**

用户发消息后，通过一次**独立的单轮调用**判断是否需要历史上下文。该调用不占用主 Session 上下文。

```
用户发消息
  │
  ▼
┌──────────────────────────────┐
│  记忆检索（独立单轮调用）      │
│  输入：用户消息 + 身份记忆     │
│  输出：相关记忆片段（或空）     │
│  - 不进入主 Session 上下文    │
│  - 可使用更便宜的模型          │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  主 Session                   │
│  上下文 = 身份记忆             │
│         + 检索到的记忆片段     │
│         + 对话历史             │
│         + 用户消息             │
└──────────────────────────────┘
```

检索时的过滤条件：

- `status = verified`
- `confidence >= 阈值`
- 语义匹配（Embedding）+ Tag 过滤
- 返回 Top N 条最相关结果

### 记忆的写入

1. 任务开始创建 `session` 记录。
2. 关键事件写入 `inbox`。
3. 任务结束整理为 `session` 总结。
4. 从总结提炼到 `incident/runbook/decision`。
5. 仅 `verified` 且高 `confidence` 的内容可用于自动修复。

### 记忆整理

1. 每次任务结束清理 `inbox`。
2. 合并重复 `incident`，更新 `runbook`。
3. 过期或低价值内容移入 `archive`。
4. 在 `memory.md` 维护最新索引链接。

### 容量管理

1. 单条记忆设置大小上限。
2. 总记忆设置容量上限。
3. 自动归档策略：按 `confidence` 衰减 + 最近访问时间综合评分，低分内容移入 `archive`。

### 冲突解决

当多条记忆出现矛盾时，按以下优先级决策：

1. `confidence` 更高的优先。
2. `updated_at` 更新的优先。
3. 无法自动决策时标记冲突，等待用户裁决。

### 检索机制

1. 对记忆内容做 Embedding，维护向量索引，支持语义检索。
2. 维护结构化 Tag 索引（JSON/SQLite），支持精确过滤。
3. Markdown 文件作为人类可读的展示层，底层由结构化存储驱动。

---

## 观测性

系统的所有操作统一通过结构化日志、Metrics 和 Trace 进行记录，既用于安全策略中的事后排查，也用于 AI 自身的诊断和自我修复。

日志存储在 `.zero/logs/` 目录下，使用 JSONL 追加写入，SQLite 做聚合查询：

```
.zero/logs/
  ├─ requests.jsonl      # 每次 LLM 请求记录
  ├─ snapshots.jsonl     # 上下文快照（变化时写入）
  ├─ operations.jsonl    # 工具调用记录
  └─ metrics.db          # SQLite 聚合查询
```

### 结构化日志

工具调用记录写入 `operations.jsonl`，每条包含：

```json
{
  "ts": "2026-02-27T10:05:00Z",
  "level": "info",
  "session_id": "sess_001",
  "event": "tool_call",
  "tool": "bash",
  "input": "ls -la",
  "output_summary": "listed 12 files",
  "duration_ms": 45,
  "model": "claude-sonnet"
}
```

### Metrics

从 JSONL 日志汇总到 `metrics.db`，持续收集核心指标：

1. 任务成功率 / 失败率。
2. 平均执行时间。
3. 自我修复触发次数和成功率。
4. 各模型的 Token 用量和费用（按模型、Provider、Session、时间维度）。
5. 工具调用频率和错误率。
6. 缓存命中率（cache_read / 总 input tokens）。

### Trace

复杂任务记录完整调用链：Session → 调用的 Tool → 每步耗时 → 最终结果。用于事后分析和 Runbook 生成。

---

## 通知

通知策略不是"只在完成时通知"，而是"有进展就通知"，尤其是：

1. 需要用户授权。
2. 需要验证码或扫码。
3. 自动重试多次失败。
4. 触发熔断或回滚。
5. 模型降级切换。

### 通知与对话共存

在 IM 场景中，通知和用户对话在同一个聊天窗口内。通知作为上下文的一部分，AI 可以感知和回应。

消息通过 `type` 字段区分：

```
Session 上下文：

  [type: message]       用户：帮我改一下 config
  [type: message]       AI：好的，已修改
  [type: notification]  📋 定时任务：系统更新检查，发现新版本 v1.2.3
  [type: message]       用户：刚才那个更新是什么情况
  [type: message]       AI：刚才定时任务检测到新版本 v1.2.3，主要更新了...
```

- `type: message` — 正常对话。
- `type: notification` — 系统通知，在 IM 端用卡片样式渲染，视觉上与对话区分。

通知不需要隔离，也不需要创建独立 Session。它就是当前上下文的一部分，用户随时可以追问。

### Channel

> 长连接，用于即时通知和交互。如飞书机器人、Telegram 机器人、钉钉机器人等。

Channel 支持**双向交互**：不仅推送通知，用户也可通过 Channel 下达指令、审批授权、回答确认问题。

允许系统自建 Channel，代码放在 `.zero/channels/` 目录下，以便用户审查和管理权限。

示例：接入飞书机器人

1. 读取官方 API 文档。
2. 构建连接工具和监听服务。
3. 向用户申请 `App ID` / `App Secret`。
4. 凭证存入保密箱，仅在授权后可调用。

---

## Session

Session 是多轮对话的载体，也是任务执行的载体。每个 Session 在 Memory 中形成一条记录，包含上下文和总结。

在 IM 场景中，一个聊天窗口对应一个 Session。多个 IM 窗口（飞书私聊、Telegram 对话等）同时活跃时，各自运行独立的 Session，互不干扰。

### 生命周期

1. **创建**：用户发消息、Scheduler 触发、或系统自动创建。
2. **执行**：AI 根据上下文执行任务，期间不断更新 Session 记录。所有消息（对话 + 通知）都在同一上下文中。
3. **结束**：任务完成或空闲超时，生成总结并提炼记忆。
4. **归档**：过期或不再需要的 Session 移入 archive。
5. **查询**：用户可随时查询历史 Session，查看总结和相关记忆。

### Session 数据结构

```yaml
session:
  id: "sess_20260227_001"
  created_at: "2026-02-27T10:00:00Z"
  source: "feishu"              # 触发来源：feishu / telegram / scheduler / web
  current_model: "claude-opus"
  model_history:
    - model: "claude-sonnet"
      from: "2026-02-27T10:00:00Z"
      to: "2026-02-27T10:05:00Z"
    - model: "claude-opus"
      from: "2026-02-27T10:05:00Z"
      to: null
```

### 支持命令

1. `/new [model]` — 创建新 Session，可选指定模型。
2. `/model [model]` — 携带参数则切换当前 Session 使用的模型；不携带参数则返回当前模型名称。

---

## 版本管理

所有变更纳入 Git 管理，支持可靠的回滚和审计。

1. ZeRo OS 自身代码通过 Git 管理，每次自我修改自动 Commit。
2. 每个 Tool/SKILL 有版本号，升级不兼容时可回退。
3. 配置变更同样纳入版本控制。
4. 成功启动并稳定运行超过设定时间后，自动打 Tag 标记为 `stable`。
5. 回滚操作等价于 `git revert` 到最近的 `stable` Tag。

---

## 自我修复

自我修复包含两部分：保活与心跳。

### 保活机制

1. 使用 `LaunchAgent`（用户级服务）保活 `Supervisor`。用户登录后自动启动，锁屏和睡眠期间持续运行，Keychain 保持可用。
2. 主程序每 10 秒写一次心跳。
3. `Supervisor` 每 20 秒检查心跳更新时间。
4. 超过 50 秒未更新，判定主程序失活。

### 修复流程

检测 → 诊断 → 修复 → 验证 → 重启 → 观察。

### 修复边界

AI 可自主执行所有修复操作，包括重启进程、回滚版本、清理文件、重装依赖、修改代码等。仅受熔断名单约束。

### 熔断机制

连续 N 次修复失败后触发熔断：

1. 锁定系统，停止自动修复。
2. 回滚到最近 `stable` 版本。
3. 通知用户介入。
4. 写入 `incidents/` 记录完整的故障诊断链。

### 诊断知识来源

修复流程依赖记忆模块中的结构化知识：

1. `incidents/` 提供历史故障的匹配参考。
2. `runbooks/` 提供可执行的修复步骤。
3. 仅 `verified` 且 `confidence >= 0.8` 的 Runbook 可用于自动修复。
