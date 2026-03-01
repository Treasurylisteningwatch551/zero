# ZeRo OS 技术栈与框架

本文档基于 ZeRo OS 架构设计和 UI/UX 设计规范，定义系统的技术选型、模块边界和实现框架。

---

## 总览

```
语言:        TypeScript (全栈)
运行时:      Bun
平台:        macOS (首要且唯一目标平台)
包管理:      bun (内置 workspace)
构建:        后端免构建（Bun 原生跑 TS） + Vite (前端)
```

选择 TypeScript 全栈的理由：AI Agent 系统的核心是 LLM API 调用、JSON 处理、流式输出——TypeScript 生态在这些领域最成熟。前后端共享类型定义减少序列化边界的错误。社区中 AI SDK（Anthropic SDK、OpenAI SDK）均以 TypeScript 为一等公民。

选择 Bun 而非 Node.js 的理由：

1. **内置 SQLite**（`bun:sqlite`）——ZeRo OS 的日志聚合、Metrics、Tag 索引全靠 SQLite，Bun 内置意味着去掉 `better-sqlite3` 这个最重的 native addon，消除编译链故障点。
2. **原生跑 TypeScript**——后端不需要构建步骤。AI 自我修改代码后可以直接 `bun run src/main.ts` 验证，跳过编译环节，缩短"改代码→验证→重启"的循环。
3. **启动速度快**——Supervisor 重启主进程时，启动越快健康检查越早完成。
4. **内置 Shell API**（`Bun.$`）——Bash 工具的命令执行不再需要 `execa`。
5. **内置 ID 生成**（`Bun.randomUUIDv7()`）——不再需要 `nanoid`。

---

## Monorepo 结构

```
zero-os/
├── package.json                  # bun workspace 根
├── bunfig.toml                   # Bun 配置
├── tsconfig.base.json            # 共享 TS 配置
│
├── packages/
│   ├── core/                     # 核心运行时（Session、Agent、Tool 注册）
│   │   ├── src/
│   │   │   ├── session/          #   Session 生命周期管理
│   │   │   ├── agent/            #   Agent 执行引擎
│   │   │   ├── tool/             #   Tool 基类 + 6 个内置工具
│   │   │   ├── task/             #   SubAgent 编排器
│   │   │   ├── config/           #   config.yaml 解析与校验
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── model/                    # 模型层（Router + Provider Adapter）
│   │   ├── src/
│   │   │   ├── router.ts         #   Model Router（切换、降级链）
│   │   │   ├── registry.ts       #   Model Registry 解析
│   │   │   ├── adapters/
│   │   │   │   ├── base.ts       #     统一接口定义
│   │   │   │   ├── anthropic.ts  #     Anthropic Messages API
│   │   │   │   ├── openai-chat.ts#     OpenAI Chat Completions
│   │   │   │   └── openai-resp.ts#     OpenAI Responses API
│   │   │   └── stream.ts         #   流式输出统一处理
│   │   └── package.json
│   │
│   ├── memory/                   # 记忆模块
│   │   ├── src/
│   │   │   ├── store.ts          #   Markdown CRUD + Frontmatter 解析
│   │   │   ├── index.ts          #   memory.md 索引维护
│   │   │   ├── retrieval.ts      #   记忆检索（Embedding + Tag）
│   │   │   ├── embedding.ts      #   向量化 + 索引
│   │   │   └── lifecycle.ts      #   记忆写入、整理、归档、冲突解决
│   │   └── package.json
│   │
│   ├── observe/                  # 观测性
│   │   ├── src/
│   │   │   ├── logger.ts         #   JSONL 追加写入
│   │   │   ├── metrics.ts        #   SQLite 聚合
│   │   │   ├── trace.ts          #   调用链追踪
│   │   │   └── secret-filter.ts  #   输出过滤（密钥脱敏）
│   │   └── package.json
│   │
│   ├── secrets/                  # 保密箱
│   │   ├── src/
│   │   │   ├── vault.ts          #   加密/解密 secrets.enc
│   │   │   ├── keychain.ts       #   macOS Keychain 交互
│   │   │   └── filter.ts         #   全局输出过滤器
│   │   └── package.json
│   │
│   ├── channel/                  # Channel 抽象 + 内置实现
│   │   ├── src/
│   │   │   ├── base.ts           #   Channel 接口定义
│   │   │   ├── feishu/           #   飞书机器人
│   │   │   ├── telegram/         #   Telegram Bot
│   │   │   └── web/              #   Web Channel（Chat Drawer 后端）
│   │   └── package.json
│   │
│   ├── scheduler/                # 定时任务
│   │   ├── src/
│   │   │   ├── cron.ts           #   crontab 管理
│   │   │   ├── runner.ts         #   触发 Session 创建
│   │   │   └── policy.ts         #   重叠策略、misfire 处理
│   │   └── package.json
│   │
│   ├── supervisor/               # 保活与自我修复
│   │   ├── src/
│   │   │   ├── heartbeat.ts      #   心跳写入/检测
│   │   │   ├── repair.ts         #   诊断-修复-验证流程
│   │   │   ├── fuse.ts           #   熔断机制
│   │   │   └── launchd.ts        #   LaunchAgent plist 生成
│   │   └── package.json
│   │
│   └── shared/                   # 共享类型和工具函数
│       ├── src/
│       │   ├── types/            #   全局类型定义
│       │   │   ├── session.ts
│       │   │   ├── message.ts
│       │   │   ├── tool.ts
│       │   │   ├── memory.ts
│       │   │   ├── config.ts
│       │   │   └── index.ts
│       │   ├── utils/
│       │   │   ├── id.ts         #   ID 生成（Bun.randomUUIDv7）
│       │   │   ├── time.ts       #   时间处理
│       │   │   ├── yaml.ts       #   YAML 读写
│       │   │   └── lock.ts       #   文件锁
│       │   └── index.ts
│       └── package.json
│
├── apps/
│   ├── server/                   # 主进程（入口）
│   │   ├── src/
│   │   │   ├── main.ts           #   启动流程：解密→加载配置→启动服务
│   │   │   ├── bus.ts            #   全局事件总线
│   │   │   └── cli.ts            #   命令行入口
│   │   └── package.json
│   │
│   ├── web/                      # Web UI
│   │   ├── src/
│   │   │   ├── api/              #   Hono API 路由
│   │   │   ├── ws/               #   WebSocket 推送
│   │   │   ├── app/              #   React 前端
│   │   │   └── server.ts         #   Hono 服务 + 静态资源
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── supervisor/               # Supervisor 独立进程
│       ├── src/
│       │   └── main.ts           #   心跳监控 + 重启逻辑
│       └── package.json
│
└── .zero/                        # 运行时数据目录（.gitignore 部分条目）
```

### 包间依赖关系

```
shared ← 所有包都依赖
  ↑
core ← session/agent/tool 运行时
  ↑ ↑
  │ model ← Provider Adapter + Router
  │   ↑
  │ memory ← 记忆存储与检索
  │   ↑
  │ observe ← 日志/Metrics/Trace
  │   ↑
  │ secrets ← 保密箱
  │
channel ← 各 IM Channel
scheduler ← 定时任务
supervisor ← 保活
  │
  ↓
apps/server ← 主进程，组装所有包
apps/web ← Web UI，依赖 API 层
apps/supervisor ← 独立轻量进程
```

---

## 核心依赖

### 运行时 & 构建

| 类别 | 选型 | 版本 | 说明 |
|------|------|------|------|
| 运行时 | Bun | 1.2+ | 内置 SQLite、Shell API、原生 TS 执行 |
| 包管理 | bun | 内置 | workspace 协议，安装速度极快 |
| 前端构建 | Vite | 6.x | 开发热更新，生产打包（后端免构建） |
| 类型检查 | TypeScript | 5.7+ | `strict: true`，`bun run --check` 或 `tsc --noEmit` |
| 代码规范 | Biome | 1.x | 替代 ESLint + Prettier，速度快 |
| 测试 | `bun:test` | 内置 | Jest 兼容 API，无需额外安装 |

### AI / LLM

| 类别 | 选型 | 说明 |
|------|------|------|
| Anthropic SDK | `@anthropic-ai/sdk` | Messages API，原生流式 + Tool Use |
| OpenAI SDK | `openai` | Chat Completions + Responses API |
| 流式处理 | 各 SDK 原生 | Anthropic 的 `stream()` / OpenAI 的 `stream: true` |
| Token 计数 | `tiktoken`（OpenAI） + Anthropic API 返回值 | 预估上下文占用，触发压缩 |
| Embedding | OpenAI `text-embedding-3-small` | 记忆向量化，1536 维 |

**不用 LangChain / Vercel AI SDK 的理由**：ZeRo OS 的 Provider Adapter 只需适配三种协议（Anthropic Messages、OpenAI Chat Completions、OpenAI Responses），抽象层极薄。引入框架会增加黑盒行为，干扰调试和自我修复。直接使用官方 SDK 对协议的控制力最强，也最容易做输出过滤和日志注入。

### 存储

| 类别 | 选型 | 说明 |
|------|------|------|
| 结构化存储 | `bun:sqlite` | Bun 内置，同步 API，零 native addon |
| 向量索引 | `vectra`（或 `hnswlib-node`） | 本地 HNSW 向量索引，无需外部服务 |
| YAML | `yaml`（`yaml` npm 包） | config.yaml 解析，支持 YAML 1.2 |
| Markdown Frontmatter | `gray-matter` | 记忆文件的元数据解析 |
| 文件锁 | `proper-lockfile` | 跨进程文件锁，Write/Edit/Memo 并发安全 |
| KV 缓存 | 内存 `Map` + `bun:sqlite` | 热数据内存缓存，持久化到 SQLite |

**为什么不用 PostgreSQL / Redis**：ZeRo OS 是单机系统，SQLite 的性能绰绰有余（百万级 JSONL 查询 < 50ms），零运维成本。向量检索用本地 HNSW，记忆量级（千条）远不需要 Pinecone 或 pgvector。

### 加密

| 类别 | 选型 | 说明 |
|------|------|------|
| AES 加密 | `node:crypto`（Bun 兼容） | AES-256-GCM，加密 `secrets.enc` |
| macOS Keychain | `security` CLI 命令（通过 `Bun.$`） | 读写主密钥，避免原生绑定的兼容性问题 |

使用 macOS `security` 命令行工具而非 `node-keytar` 等原生绑定，原因是：减少 native addon 依赖、AI 自我修复时更容易理解和排查、`security` 命令在所有 macOS 版本上可用。

```typescript
// keychain.ts 核心实现
const SERVICE = 'com.zero-os.vault'
const ACCOUNT = 'master-key'

export async function getMasterKey(): Promise<Buffer> {
  const result = await Bun.$`security find-generic-password -s ${SERVICE} -a ${ACCOUNT} -w`.text()
  return Buffer.from(result.trim(), 'base64')
}

export async function setMasterKey(key: Buffer): Promise<void> {
  const encoded = key.toString('base64')
  await Bun.$`security add-generic-password -s ${SERVICE} -a ${ACCOUNT} -w ${encoded} -U`
}
```

### 系统交互

| 类别 | 选型 | 说明 |
|------|------|------|
| 子进程 / Shell | `Bun.$` | Bun 内置 Shell API，tagged template，替代 `execa` |
| 文件监听 | `chokidar` | 监听 `.zero/` 目录变更，触发 UI 实时更新 |
| 浏览器自动化 | Playwright | Browser 工具的底层驱动 |
| Git 操作 | `simple-git` | 版本管理、自动 commit、回滚 |
| Cron 解析 | `cron-parser` | 解析 cron 表达式，计算下次执行时间 |
| 系统 Cron | `crontab` CLI | Scheduler 直接操作系统 crontab |

### Channel SDK

| Channel | 依赖 | 说明 |
|---------|------|------|
| 飞书 | `@larksuiteoapi/node-sdk` | 官方 SDK，事件订阅 + 消息发送 |
| Telegram | `telegraf` | 成熟的 Telegram Bot 框架 |
| Web | 内置（Hono WebSocket） | Chat Drawer 后端，不需额外依赖 |

---

## Web UI 技术栈

### 后端 API

| 类别 | 选型 | 说明 |
|------|------|------|
| HTTP 框架 | Hono | 极轻量，类型安全，内置 WebSocket 支持 |
| 序列化 | Hono RPC（`hc`） | 前端类型安全的 API 调用，无需 codegen |
| WebSocket | `hono/ws` | 实时推送：Session 状态、工具调用、事件流 |
| 静态资源 | `hono/serve-static` | 生产模式直接 serve Vite 构建产物 |

Hono RPC 消除了前后端之间的类型断层。API 路由定义即类型合约，前端通过 `hc<AppType>` 获得完整的路径、参数、响应类型推导：

```typescript
// apps/web/src/api/routes.ts
import { Hono } from 'hono'
import type { Session, Memory } from '@zero-os/shared'

const app = new Hono()
  .get('/api/sessions', async (c) => {
    const sessions: Session[] = await sessionStore.listActive()
    return c.json(sessions)
  })
  .get('/api/sessions/:id', async (c) => {
    const session = await sessionStore.get(c.req.param('id'))
    return c.json(session)
  })
  .get('/api/memory/search', async (c) => {
    const results: Memory[] = await memory.search(c.req.query('q') ?? '')
    return c.json(results)
  })
  .get('/api/metrics/cost', async (c) => {
    const range = c.req.query('range') ?? '7d'
    return c.json(await metrics.costByModel(range))
  })
  .put('/api/memo', async (c) => {
    await memo.update(await c.req.text())
    return c.json({ ok: true })
  })

export type AppType = typeof app
```

```typescript
// 前端调用（完整类型推导，无 codegen）
import { hc } from 'hono/client'
import type { AppType } from '../api/routes'

const client = hc<AppType>('/')
const sessions = await client.api.sessions.$get()
// sessions 的类型自动推导为 Session[]
```

### 前端

| 类别 | 选型 | 说明 |
|------|------|------|
| UI 框架 | React 19 | 社区生态最强，CodeMirror/recharts 集成最好 |
| 样式 | Tailwind CSS 4 | 与 UI/UX 设计规范的 utility-first 风格一致 |
| 路由 | TanStack Router | 类型安全路由，文件系统路由约定 |
| 状态管理 | Zustand | 轻量，适合中等复杂度 |
| 数据获取 | TanStack Query | 缓存 + 自动刷新 + WebSocket 集成 |
| 图表 | recharts | UI/UX 文档指定，React 原生 |
| Markdown 编辑 | CodeMirror 6 | Memo 页面 + Memory 编辑模式 |
| Markdown 渲染 | `react-markdown` + `remark-gfm` | Memory 详情面板的内容渲染 |
| 字体 | Geist + Geist Mono | UI/UX 文档指定 |
| 图标 | Lucide React | 线条风格，和 Calm Futurism 调性匹配 |
| 虚拟列表 | TanStack Virtual | Memory 列表、Logs 表格的大量数据渲染 |

### 前端目录结构

```
apps/web/src/app/
├── components/
│   ├── ui/                     # 基础组件（Button、Card、Badge、Input...）
│   ├── layout/
│   │   ├── Sidebar.tsx         #   侧边栏（全局共享）
│   │   ├── StatusBar.tsx       #   系统状态微缩版
│   │   └── ChatDrawer.tsx      #   Chat Drawer（右侧滑出）
│   ├── session/
│   │   ├── SessionList.tsx
│   │   ├── SessionTimeline.tsx #   时间线主体
│   │   ├── SessionMinimap.tsx  #   时间轴 minimap
│   │   ├── ToolCallBlock.tsx   #   工具调用块
│   │   └── ContextPanel.tsx    #   右侧上下文面板
│   ├── memory/
│   │   ├── MemoryList.tsx
│   │   ├── MemoryDetail.tsx
│   │   ├── MemoryEditor.tsx    #   编辑模式
│   │   ├── ConfidenceDots.tsx  #   Confidence 指示器
│   │   └── TypeBadge.tsx       #   类型标签（统一颜色）
│   ├── dashboard/
│   │   ├── SystemStatus.tsx
│   │   ├── AttentionCard.tsx   #   需要关注
│   │   ├── CostOverview.tsx    #   费用概览
│   │   ├── ActiveSessions.tsx
│   │   └── ActivityFeed.tsx    #   事件流
│   ├── metrics/
│   │   ├── CostChart.tsx       #   堆叠条形图
│   │   ├── TokenChart.tsx
│   │   ├── ModelDistribution.tsx
│   │   └── DetailTable.tsx
│   └── shared/
│       ├── FlipNumber.tsx      #   数字翻牌动画
│       ├── PulseDot.tsx        #   脉搏动画
│       └── MarkdownRenderer.tsx
├── routes/
│   ├── __root.tsx              # 根布局（Sidebar + 主内容区）
│   ├── dashboard.tsx
│   ├── sessions/
│   │   ├── index.tsx           #   列表视图
│   │   └── $sessionId.tsx      #   详情页
│   ├── memory.tsx
│   ├── memo.tsx
│   ├── logs.tsx
│   ├── config.tsx
│   └── metrics.tsx
├── stores/
│   ├── session.ts              # 活跃 Session 状态
│   ├── ws.ts                   # WebSocket 连接管理
│   └── ui.ts                   # UI 状态（Drawer 开关、当前页等）
├── hooks/
│   ├── useWebSocket.ts         # WebSocket 订阅
│   ├── useRealtimeQuery.ts     # TanStack Query + WS 自动刷新
│   └── useKeyboard.ts          # 键盘导航
├── lib/
│   ├── api.ts                  # Hono RPC client 初始化
│   ├── format.ts               # 数字格式化、时间格式化
│   └── colors.ts               # 类型→颜色映射（全站统一）
├── styles/
│   └── globals.css             # Tailwind 入口 + 自定义 CSS 变量
└── main.tsx
```

---

## 实时通信架构

Web UI 的实时性是 Dashboard 和 Session 回放的核心。架构设计围绕一个全局事件总线展开。

```
┌─────────────────────────────────────────────────────────┐
│                     主进程                                │
│                                                          │
│  Session 执行引擎                                        │
│    │                                                     │
│    ├── Tool 调用 ──→ bus.emit('tool:call', {...})        │
│    ├── 模型切换 ──→ bus.emit('model:switch', {...})      │
│    ├── 通知 ────→ bus.emit('notification', {...})        │
│    └── 状态变更 ──→ bus.emit('session:update', {...})    │
│                                                          │
│  观测模块                                                │
│    └── JSONL 写入时同步 emit 对应事件                     │
│                                                          │
│  全局事件总线（EventEmitter）                             │
│    │                                                     │
│    ├──→ WebSocket Hub ──→ 所有连接的 Web UI 客户端       │
│    ├──→ JSONL Logger（写日志）                            │
│    └──→ Metrics Collector（更新 SQLite）                  │
└─────────────────────────────────────────────────────────┘
```

### WebSocket 协议

客户端连接后发送订阅消息，服务端按需推送：

```typescript
// 客户端 → 服务端：订阅
{ "type": "subscribe", "topics": ["session:*", "tool:*", "metrics:cost"] }

// 服务端 → 客户端：事件
{ "type": "event", "topic": "tool:call", "data": { "sessionId": "sess_001", "tool": "bash", "input": "ls -la", "status": "success", "duration_ms": 45 } }

// 服务端 → 客户端：Session 流式输出
{ "type": "stream", "sessionId": "sess_001", "delta": "好的，我来看一下..." }
```

使用主题通配符（`session:*` 匹配所有 Session 事件）减少订阅管理复杂度。Dashboard 订阅全局事件，Session 详情页订阅特定 Session 事件。

---

## 核心模块设计

### Provider Adapter 接口

三种协议适配器实现统一接口：

```typescript
// packages/model/src/adapters/base.ts

interface CompletionRequest {
  messages: Message[]
  tools?: ToolDefinition[]
  system?: string
  stream: boolean
  maxTokens?: number
}

interface CompletionResponse {
  id: string
  content: ContentBlock[]        // text + tool_use 混合
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  usage: TokenUsage
}

interface TokenUsage {
  input: number
  output: number
  cacheWrite?: number
  cacheRead?: number
  reasoning?: number
}

interface StreamEvent {
  type: 'text_delta' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'done'
  data: unknown
}

interface ProviderAdapter {
  readonly apiType: string

  complete(req: CompletionRequest): Promise<CompletionResponse>

  stream(req: CompletionRequest): AsyncIterable<StreamEvent>

  // 检查 API 可达性（降级链用）
  healthCheck(): Promise<boolean>
}
```

每个适配器负责：消息格式转换（统一格式 ↔ 厂商格式）、Tool Schema 转换（统一 JSON Schema ↔ 厂商格式）、认证头注入、错误码映射、重试逻辑。

### Tool 基类

```typescript
// packages/core/src/tool/base.ts

interface ToolContext {
  sessionId: string
  workDir: string              // Agent 工作目录
  logger: Logger
  secretFilter: SecretFilter   // 输出过滤
}

interface ToolResult {
  success: boolean
  output: string
  outputSummary: string        // 写入日志的摘要
  artifacts?: string[]         // 产出文件路径
}

abstract class BaseTool {
  abstract name: string
  abstract description: string
  abstract parameters: JSONSchema

  // 熔断检查（Bash 工具覆写）
  protected async fuseCheck(input: unknown): Promise<void> {}

  // 执行前钩子（加锁等）
  protected async beforeExecute(ctx: ToolContext, input: unknown): Promise<void> {}

  // 实际执行
  protected abstract execute(ctx: ToolContext, input: unknown): Promise<ToolResult>

  // 执行后钩子（解锁、写日志）
  protected async afterExecute(ctx: ToolContext, result: ToolResult): Promise<void> {}

  // 对外暴露的唯一入口
  async run(ctx: ToolContext, input: unknown): Promise<ToolResult> {
    await this.fuseCheck(input)
    await this.beforeExecute(ctx, input)
    const result = await this.execute(ctx, input)
    await this.afterExecute(ctx, result)
    return result
  }
}
```

6 个内置工具的锁策略在 `beforeExecute`/`afterExecute` 中实现：

| 工具 | 锁 |
|------|-----|
| Read | 无锁 |
| Write | `proper-lockfile` 按文件路径 |
| Edit | `proper-lockfile` 按文件路径 |
| Bash | 无锁（受熔断名单约束） |
| Browser | 实例级互斥锁（同一时间仅一个 Session） |
| Task | 无锁（SubAgent 各自独立） |

### Session 生命周期

```typescript
// packages/core/src/session/session.ts

class Session {
  readonly id: string
  readonly source: 'feishu' | 'telegram' | 'scheduler' | 'web'
  private messages: Message[] = []
  private modelRouter: ModelRouter
  private agent: Agent
  private memoryRetriever: MemoryRetriever

  async handleUserMessage(content: string): Promise<void> {
    // 1. 命令解析（/new、/model 等）
    if (content.startsWith('/')) {
      return this.handleCommand(content)
    }

    // 2. 记忆检索（独立单轮调用，不进入主上下文）
    const relevantMemories = await this.memoryRetriever.retrieve(
      content, this.agent.identityMemory
    )

    // 3. 组装上下文
    const context = this.buildContext(relevantMemories)

    // 4. Agent 循环（tool use loop）
    await this.agent.run(context, content)
  }

  private buildContext(memories: Memory[]): AgentContext {
    return {
      systemPrompt: this.agent.systemPrompt,
      identityMemory: this.agent.identityMemory,
      retrievedMemories: memories,
      conversationHistory: this.messages,
      tools: this.agent.tools,
    }
  }
}
```

### SubAgent 编排

```typescript
// packages/core/src/task/orchestrator.ts

interface TaskNode {
  id: string
  agent: AgentConfig          // SubAgent 配置
  instruction: string
  dependsOn: string[]         // 上游任务 ID
  timeout: number
}

class TaskOrchestrator {
  async execute(nodes: TaskNode[]): Promise<Map<string, TaskResult>> {
    const results = new Map<string, TaskResult>()
    const pending = new Set(nodes.map(n => n.id))

    while (pending.size > 0) {
      // 找出所有依赖已满足的节点
      const ready = nodes.filter(n =>
        pending.has(n.id) &&
        n.dependsOn.every(dep => results.has(dep))
      )

      if (ready.length === 0 && pending.size > 0) {
        throw new Error('Deadlock detected in task graph')
      }

      // 并发执行就绪节点
      const executions = ready.map(node =>
        this.executeNode(node, results).then(result => {
          results.set(node.id, result)
          pending.delete(node.id)
        })
      )

      // 任一失败，取消下游
      const settled = await Promise.allSettled(executions)
      for (const r of settled) {
        if (r.status === 'rejected') {
          // 取消所有以失败节点为上游的节点
          this.cancelDownstream(nodes, results, pending)
        }
      }
    }

    return results
  }
}
```

---

## 记忆检索实现

### 双通道检索

```typescript
// packages/memory/src/retrieval.ts

class MemoryRetriever {
  private vectorIndex: VectorIndex     // HNSW 向量索引
  private tagIndex: TagIndex           // SQLite tag 索引

  async retrieve(
    query: string,
    identityMemory: string,
    options: RetrievalOptions = {}
  ): Promise<Memory[]> {
    const { topN = 5, confidenceThreshold = 0.6 } = options

    // 1. 用便宜模型判断是否需要检索
    const needsRetrieval = await this.shouldRetrieve(query, identityMemory)
    if (!needsRetrieval) return []

    // 2. 向量语义检索
    const queryEmbedding = await this.embed(query)
    const semanticResults = await this.vectorIndex.search(queryEmbedding, topN * 2)

    // 3. Tag 精确过滤
    const filtered = semanticResults.filter(r =>
      r.status === 'verified' &&
      r.confidence >= confidenceThreshold
    )

    // 4. 返回 Top N
    return filtered.slice(0, topN)
  }
}
```

### Embedding 管线

```typescript
// packages/memory/src/embedding.ts

class EmbeddingPipeline {
  // 内容变更时增量更新向量
  async onMemoryUpdate(memory: Memory): Promise<void> {
    const text = this.memoryToText(memory)     // 标题 + 摘要 + tags
    const vector = await this.embed(text)
    await this.vectorIndex.upsert(memory.id, vector, {
      type: memory.type,
      status: memory.status,
      confidence: memory.confidence,
      tags: memory.tags,
    })
  }

  // 使用 OpenAI text-embedding-3-small
  private async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    })
    return response.data[0].embedding
  }
}
```

向量索引存储在 `.zero/memory/vectors/` 下，使用 HNSW 算法。千条量级的记忆，检索延迟 < 10ms。

---

## 启动流程

```
用户登录 macOS
  │
  ▼
LaunchAgent 启动 Supervisor
  │
  ▼
Supervisor 启动主进程（apps/server）
  │
  ▼
┌──────────────────────────────────────────┐
│  主进程启动序列                            │
│                                           │
│  1. 从 macOS Keychain 读取主密钥           │
│  2. 解密 .zero/secrets.enc 到内存          │
│  3. 加载 config.yaml                      │
│  4. 初始化 SQLite (metrics.db)            │
│  5. 加载向量索引                           │
│  6. 初始化 Model Registry + Router        │
│  7. 初始化 6 个基础 Tool                   │
│  8. 启动 Channel 监听（飞书/TG/Web）       │
│  9. 启动 Web UI（Hono 服务）               │
│  10. 同步 Scheduler 到系统 crontab         │
│  11. 开始写心跳                            │
│  12. 发送启动通知                          │
└──────────────────────────────────────────┘
```

---

## 数据流总览

一次完整的用户交互，数据经过的路径：

```
用户发消息（飞书/TG/Web）
  │
  ├──→ Channel 接收，创建/复用 Session
  │
  ├──→ 记忆检索（独立调用，走便宜模型）
  │      └──→ Embedding API → 向量检索 → 返回记忆片段
  │
  ├──→ 组装上下文 = 身份记忆 + 检索记忆 + 对话历史 + 用户消息
  │      └──→ 写入 snapshots.jsonl（如有变化）
  │
  ├──→ Model Router 选择模型
  │      └──→ Provider Adapter 调用 LLM API（流式）
  │             └──→ 写入 requests.jsonl
  │
  ├──→ Agent 处理响应
  │      ├── 文本响应 → 流式推送给 Channel + WebSocket
  │      └── Tool Use → 执行工具
  │             ├──→ 熔断检查
  │             ├──→ 文件锁（如需要）
  │             ├──→ 执行
  │             ├──→ 写入 operations.jsonl
  │             ├──→ bus.emit('tool:call', ...)
  │             └──→ 结果返回给 Agent，继续循环
  │
  ├──→ Session 结束
  │      ├──→ 生成总结
  │      ├──→ 写入 memory/sessions/
  │      ├──→ 提炼 incident/runbook/decision
  │      └──→ 更新 memory.md 索引
  │
  └──→ 全程密钥过滤（所有输出经 SecretFilter）
```

---

## 部署

ZeRo OS 是纯本机系统，不涉及服务器部署。"部署"即安装到用户的 Mac 上。

### 初始安装

```bash
# 1. 克隆仓库
git clone https://github.com/user/zero-os.git
cd zero-os

# 2. 安装依赖
bun install

# 3. 构建前端（后端免构建）
bun run build:web

# 4. 初始化（交互式）
#    - 生成主密钥存入 Keychain
#    - 创建 .zero/ 目录结构
#    - 配置 API Key
#    - 注册 LaunchAgent
bun zero init

# 5. 启动
bun zero start
```

### LaunchAgent 配置

```xml
<!-- ~/Library/LaunchAgents/com.zero-os.supervisor.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.zero-os.supervisor</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/.bun/bin/bun</string>
    <string>run</string>
    <string>/path/to/zero-os/apps/supervisor/src/main.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/path/to/.zero/logs/supervisor.log</string>
  <key>StandardErrorPath</key>
  <string>/path/to/.zero/logs/supervisor.error.log</string>
</dict>
</plist>
```

### 自更新

AI 修改代码后的自动更新流程：

```
AI 修改代码
  │
  ├──→ git add + git commit（自动）
  ├──→ bun run build:web（仅需重建前端，后端免构建）
  ├──→ 验证（启动新进程，健康检查通过）
  ├──→ 通知 Supervisor 重启主进程
  ├──→ 观察期（设定时间内无异常）
  └──→ git tag stable（标记稳定版本）
```

---

## 依赖清单

核心生产依赖（不含 devDependencies）：

```
# AI / LLM
@anthropic-ai/sdk          # Anthropic Messages API
openai                     # OpenAI Chat Completions + Responses + Embedding
tiktoken                   # Token 计数

# 存储（SQLite 由 bun:sqlite 内置提供）
vectra                     # 本地 HNSW 向量索引
yaml                       # YAML 解析
gray-matter                # Markdown Frontmatter

# Web
hono                       # HTTP + WebSocket + RPC
react                      # UI
react-dom
recharts                   # 图表
@codemirror/view           # Markdown 编辑器
@codemirror/lang-markdown
@tanstack/react-router     # 路由
@tanstack/react-query      # 数据获取
zustand                    # 状态管理
@tanstack/react-virtual    # 虚拟列表
react-markdown             # Markdown 渲染
remark-gfm
lucide-react               # 图标

# 系统交互（子进程 / Shell / ID 生成由 Bun 内置提供）
chokidar                   # 文件监听
playwright                 # 浏览器自动化
simple-git                 # Git 操作
proper-lockfile            # 文件锁
cron-parser                # Cron 解析

# Channel
@larksuiteoapi/node-sdk    # 飞书
telegraf                   # Telegram
```

总计约 22 个核心依赖（Bun 内置替换了 `better-sqlite3`、`execa`、`nanoid`）。无重型框架（无 LangChain、无 Next.js、无 Prisma），无 native addon，保持可审计和 AI 可理解。
