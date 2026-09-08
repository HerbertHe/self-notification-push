# Bark Server Hono / Cloudflare Workers 完整实现方案

## 1. 目标与兼容边界

本项目以 TypeScript + Hono 重写 `Finb/bark-server`，运行于 Cloudflare Workers，所有 Bark 服务路由统一挂载在 `/bark` 下。

实现目标：

- 兼容 Bark Server v2 的注册、注册检查、单设备推送、批量推送、旧版路径推送、健康检查、服务信息、Basic Auth 和 MCP Streamable HTTP。
- 请求字段、字段优先级、默认值、HTTP 状态码和 JSON 响应格式与上游保持一致。
- 使用 Cloudflare D1 持久化设备键与 APNs device token。
- 使用 APNs Provider API 直接发送通知，支持 Bark 的全部扩展参数。
- 提供 Deploy to Cloudflare 一键部署；一键部署后，由 Workers Builds 对生产分支自动构建、迁移和部署。
- 提供本地开发、单元测试、契约测试、预览环境及故障排查文档。

不迁移 Go 服务特有、在 Worker 中没有意义的进程能力：监听地址、Unix Socket、本地 TLS 终止、bbolt 文件目录、MySQL TLS、连接池大小、进程信号和 Fiber 并发参数。这些能力由 Cloudflare 网络及 D1 托管，不属于 Bark HTTP 协议功能。

## 2. 路由契约

Hono 主应用通过 `app.route('/bark', barkApp)` 挂载。显式路由必须先注册，旧版动态推送路由最后注册，避免 `/:device_key` 吞掉 `ping`、`register`、`mcp` 等固定路径。

| 方法 | 路径 | 说明 | 默认鉴权 |
| --- | --- | --- | --- |
| GET | `/bark`、`/bark/` | 返回纯文本 `ok` | 是 |
| GET | `/bark/ping` | Bark 通用响应，`message: "pong"` | 否 |
| GET | `/bark/healthz` | 与上游一致，仅返回纯文本 `ok`（存活探针） | 否 |
| GET | `/bark/info` | 版本、构建时间、架构、commit、设备数 | 是 |
| POST | `/bark/register` | JSON/form 注册或更新设备 | 否 |
| GET | `/bark/register` | 兼容旧参数注册 | 否 |
| GET | `/bark/register/:device_key` | 检查设备键是否有效 | 否 |
| POST | `/bark/push` | v2 JSON 单推或批推；非 JSON 按 v1 解析 | 是 |
| GET/POST | `/bark/:device_key` | 旧版推送 | 是 |
| GET/POST | `/bark/:device_key/:body` | 旧版推送 | 是 |
| GET/POST | `/bark/:device_key/:title/:body` | 旧版推送 | 是 |
| GET/POST | `/bark/:device_key/:title/:subtitle/:body` | 旧版推送 | 是 |
| ALL | `/bark/mcp` | 通用 MCP，工具参数必须传 `device_key` | 是 |
| ALL | `/bark/mcp/:device_key` | 设备专用 MCP，路径键覆盖工具参数 | 是 |

统一响应：

```ts
type CommonResponse<T = unknown> = {
  code: number
  message: string
  data?: T
  timestamp: number // Unix 秒
}
```

成功默认为 `{ code: 200, message: 'success', timestamp }`。业务失败同时设置对应 HTTP 状态；404/405/未捕获异常也转换为该格式。`/bark`、`/bark/healthz` 保持纯文本例外。

### 请求解析兼容规则

- 字段名不区分大小写，内部统一为小写；Bark 既有 camelCase 参数（如 `isArchive`、`autoCopy`）转换为客户端期望的小写自定义字段。
- v1 支持 query、`application/x-www-form-urlencoded`、multipart form；同名字段以路径参数优先，其次 query/form。
- v2 由 `Content-Type: application/json` 触发，支持 query 覆盖 JSON、路径覆盖 query。
- 注册同时接受 `device_key`/`device_token` 和旧字段 `key`/`devicetoken`。
- 路径中的 title/subtitle/body 只执行一次百分号解码；非法编码返回 400。
- `device_keys` 可为 JSON 字符串数组，也兼容逗号分隔字符串；结果顺序必须与输入一致。
- `MAX_BATCH_PUSH_COUNT=-1` 表示无限制，并作为默认值与上游一致。

## 3. 推送参数与 APNs 映射

核心字段：`device_key`、`device_keys`、`title`、`subtitle`、`body`、`sound`、`id`。其余参数原样作为 Bark 自定义 payload 字段发送，包括但不限于：

- `level`: `critical | active | timeSensitive | passive`
- `volume`、`badge`、`call`
- `autocopy`、`copy`
- `icon`、`image`、`group`
- `ciphertext`、`isarchive`、`ttl`
- `url`、`action`
- `markdown`
- `delete`

普通通知的 `aps`：

```json
{
  "alert": { "title": "...", "subtitle": "...", "body": "..." },
  "sound": "1107",
  "category": "myNotificationCategory",
  "thread-id": "group",
  "mutable-content": 1
}
```

兼容细节：

- 默认声音为 `1107`；显式传入声音不以 `.caf` 结尾时自动补齐。
- title/subtitle/body 全为空时，将 body 改为 `Empty Message`，避免加密通知被 APNs 丢弃。
- `delete` 为 `1`、`"1"` 或 `1.0` 时发送 background push：`content-available: 1`，`apns-push-type: background`，不发送 alert/sound。
- `group` 同时写入 `aps.thread-id`，所有扩展字段的键转为小写。
- `id` 同时作为自定义字段和 `apns-collapse-id`。
- APNs topic 默认为 Bark App 的 `me.fin.bark`，expiration 与上游一致设为当前时间后 24 小时。
- 在发出请求前按 UTF-8 字节数校验 APNs payload 不超过 4096 bytes，超限返回明确错误。
- APNs 返回 410，或 400 且 reason 为 `BadDeviceToken` 时，把 D1 中该设备 token 置空，使后续注册检查与推送失败，行为与上游一致。
- APNs 非 2xx 响应解析 `{ reason, timestamp? }` 并记录 `apns-id`；对客户端保持上游兼容的 500 `push failed: ...`，日志中保留真实 APNs 状态。

## 4. APNs Provider 实现

使用 Workers 原生 `fetch` 与 Web Crypto，不引入依赖 Node HTTP/2 socket 的 APNs 库：

1. 将 PKCS#8 `.p8` 私钥导入 `crypto.subtle.importKey`，算法为 `ECDSA/P-256`。
2. 生成 APNs JWT：header `{ alg: 'ES256', kid }`，payload `{ iss: teamId, iat }`。
3. 在 Worker isolate 的模块级内存缓存 JWT 50 分钟；缓存不是正确性的前提，冷启动时重新生成即可。
4. `POST https://api.push.apple.com/3/device/{token}`，设置：
   - `authorization: bearer <jwt>`
   - `apns-topic: me.fin.bark`
   - `apns-push-type: alert|background`
   - `apns-expiration: <unix timestamp>`
   - `apns-collapse-id`（存在 id 时）
   - `content-type: application/json`
5. 与上游一样每次推送只向 APNs 提交一次，避免网络状态不确定时重试造成重复通知。

官方 Bark App 默认使用上游公开发布的 provider 配置，无需 Secret。以下变量仅用于兼容的自定义 App/topic 覆盖：

- `APNS_PRIVATE_KEY`
- `APNS_KEY_ID`
- `APNS_TEAM_ID`
- `APNS_TOPIC`（默认 `me.fin.bark`）
- 可选 `APNS_HOST`（测试时指向 mock server）

默认配置来自 MIT 许可的 `Finb/bark-server`，来源记录在 `NOTICE`。自定义覆盖凭据必须有权访问配置的 topic，并通过 Cloudflare Secret 注入。

## 5. D1 数据模型

首个迁移 `migrations/0001_init.sql`：

```sql
CREATE TABLE IF NOT EXISTS devices (
  device_key TEXT PRIMARY KEY NOT NULL,
  device_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_devices_updated_at
  ON devices(updated_at);
```

仓储接口：

```ts
interface DeviceRepository {
  count(): Promise<number>
  findToken(deviceKey: string): Promise<string>
  save(deviceKey: string | undefined, deviceToken: string): Promise<string>
  invalidate(deviceKey: string): Promise<void>
  delete(deviceKey: string): Promise<void>
}
```

- 新键使用加密安全随机数生成 22 字符 URL-safe key，以兼容上游 shortuuid 的外观；需对极小概率冲突重试。
- 更新使用 D1 prepared statement 和 `ON CONFLICT(device_key) DO UPDATE`。
- device token 长度上限与上游一致为 160；空 token 仅允许内部失效操作。
- 注册、查键和计数全部走 D1，不把权威映射放入最终一致的 KV。
- 批量推送先用单条 `IN (...)` 查询获取所有 token，再以受控并发调用 APNs，避免 N 次 D1 往返和无界 `Promise.all`。

## 6. Basic Auth 与安全策略

- `BASIC_AUTH_USER` 和 `BASIC_AUTH_PASSWORD` 均为空时关闭鉴权；任一配置后启用。
- `ALLOW_NEW_DEVICE` 由 Cloudflare Dashboard 的 Variables and Secrets 管理，不写入仓库 `vars`；缺省时为 `true`，设为 `false` 时只阻止未知设备注册，不影响已有 device key 更新 token。
- Wrangler 启用 `keep_vars: true`，部署时保留 Dashboard 管理的 `ALLOW_NEW_DEVICE`；不得在本地 `vars` 重复声明该变量。
- 免鉴权范围与上游一致：`/bark/ping`、`/bark/healthz`、`/bark/register` 及注册检查子路径。
- 解析 `Authorization: Basic ...`，使用恒定时间比较；失败响应 401 并带 `WWW-Authenticate: Basic realm="Coffee Time"`。
- 日志绝不记录 Authorization、APNs 私钥、device token、完整 device key 或完整请求体。
- 设置请求体上限；批量数量上限可配置。可选 Cloudflare WAF/Rate Limiting 是部署加固项，不默认改变 Bark 协议行为。
- CORS 默认关闭；该服务不需要浏览器跨域。需要管理页面时只对白名单域开放。

## 7. MCP 完整兼容

实现与 `bark-worker` 一致的 MCP Streamable HTTP JSON-RPC transport，使用 D1 保存 session，并关闭 SSE 流式响应。至少实现：

- `initialize`
- `notifications/initialized`
- `ping`
- `tools/list`
- `tools/call`

注册一个 `notify` 工具。通用端点 schema 要求 `device_key`；设备专用端点从 URL 注入 key 且覆盖调用参数。工具参数覆盖 Bark 的 `title`、`subtitle`、`body`、`markdown`、`level`、`volume`、`badge`、`call`、`sound`、`icon`、`image`、`group`、`isArchive`、`ttl`、`url`、`copy`。成功返回文本 `Notification sent successfully`，失败返回 MCP tool error，不把业务错误转换成 transport 崩溃。

MCP session 使用 D1 保存，支持初始化、续期、一小时空闲/一天绝对过期和 DELETE 清理，不需要 Durable Object。契约测试应执行 initialize、notifications/initialized、tools/list、tools/call 和 DELETE。

## 8. 数据来源白名单扩展（不属于 Bark 协议）

`/filterbox/webhook` 等外部数据来源入口使用独立的 `source_keys` D1 白名单。来源 key 由受 `BACKDOOR_API_KEY` 保护的 `/backdoor/keys` 接口管理，只包含 key 和备注。

来源 key、后门管理密钥与 Bark device key 是三种独立凭据：来源 key 不能注册或定位 Bark 设备，Bark App 的 `/bark/register` 也不读取来源白名单。因此这项扩展不会改变 Bark 注册、检查和推送协议。完整设计见 [SOURCE_KEY_DESIGN.md](SOURCE_KEY_DESIGN.md)。

## 9. 推荐目录结构

```text
.
├── .github/workflows/ci.yml
├── docs/
│   ├── API.md
│   ├── DEPLOYMENT.md
│   └── IMPLEMENTATION_PLAN.md
├── migrations/0001_init.sql
├── src/
│   ├── index.ts
│   ├── app.ts
│   ├── env.ts
│   ├── bark/
│   │   ├── app.ts
│   │   ├── response.ts
│   │   ├── parser.ts
│   │   ├── middleware/basic-auth.ts
│   │   ├── routes/misc.ts
│   │   ├── routes/register.ts
│   │   ├── routes/push.ts
│   │   └── routes/mcp.ts
│   ├── apns/
│   │   ├── client.ts
│   │   ├── jwt.ts
│   │   ├── payload.ts
│   │   └── types.ts
│   └── repositories/device-repository.ts
├── test/
│   ├── contract/
│   ├── integration/
│   └── unit/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── wrangler.jsonc
```

运行时依赖仅保留 `hono`；开发依赖使用 `wrangler`、`typescript` 和 `vitest`。D1 查询简单，不强制引入 ORM。

## 10. 一键部署和自动部署

### Wrangler 配置

`wrangler.jsonc` 声明 Module Worker、D1 binding `DB`、兼容日期、可观测性和非敏感 vars。D1 使用可由 Deploy Button 自动替换的默认 database name/id。`package.json` 声明 Cloudflare binding 描述，并提供：

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "deploy": "wrangler d1 migrations apply DB --remote && wrangler deploy"
  }
}
```

README 放置：

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](
https://deploy.workers.cloudflare.com/?url=https://github.com/<owner>/<repo>
)
```

用户点击后，Cloudflare 会 fork/clone 仓库、创建并绑定 D1、执行迁移并首次部署，同时建立 Workers Builds Git 集成。此后生产分支每次 push 自动构建和部署，PR 获得预览构建。

原始仓库公开后才能用于通用 Deploy Button。官方 Bark App 使用上游公开 provider 配置实现零额外 Secret 部署；自定义 App 才需要配置 APNs Secrets。

### CI 与发布职责

- GitHub Actions `ci.yml`：安装锁定依赖、lint、typecheck、测试、构建检查；不部署生产。
- Workers Builds：唯一生产部署器，避免与 GitHub Actions 双重发布。
- 若组织策略禁止 Workers Builds，可提供可选 `deploy.yml`，使用 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`；启用它时关闭 Workers Builds 自动部署。
- 迁移先于 Worker 发布；迁移必须向后兼容。破坏性 schema 变更使用 expand/migrate/contract 三阶段。

## 11. 测试与验收

### 单元测试

- v1/v2 输入解析、大小写和覆盖优先级。
- 路径百分号解码与非法输入。
- sound 默认值和 `.caf` 兼容。
- alert/background payload、扩展字段、4096-byte 边界。
- ES256 JWT header/claims/signature及缓存刷新。
- APNs reason/status 映射与设备失效。
- Basic Auth 免鉴权与错误响应。

### Worker 集成测试

- 使用 Cloudflare Vitest pool + 本地 D1 跑迁移。
- 完整注册 -> 检查 -> 推送 -> APNs mock -> 成功响应闭环。
- 所有旧版 GET/POST 路径和 form/multipart/query 组合。
- v2 单推、字符串数组批推、逗号分隔批推、部分成功结果顺序。
- D1 并发注册更新与未知 device key。
- MCP 通用/设备专用端点。
- 404、405、异常、请求过大、批量超限。

### 契约与线上验收

建立同一组黑盒用例，分别请求上游 Bark Server 容器和 Hono Worker，对比：HTTP 状态、`code`、`message`、`data` 结构及生成的 APNs payload；忽略 timestamp 和服务实现特有的 info 字段。发布前至少通过：

1. Bark iOS App 把 Server URL 设置为 `https://<domain>/bark` 后能注册。
2. `/bark/<device-key>/hello`、三/四段旧路径均能到达设备。
3. `/bark/push` 的全部扩展参数在 App 内表现正确。
4. 批量中成功和失败设备各自返回准确结果。
5. 无效 APNs token 被失效，重新注册后恢复。
6. MCP 客户端可以发现并调用 notify。
7. Deploy Button 在全新 Cloudflare 账号上完成 D1 创建、迁移和部署。
8. 随后向生产分支推送一个无害改动，确认自动部署生效。

## 12. 实施阶段

### 阶段 A：工程和协议骨架

初始化 Hono/Workers/TypeScript、统一响应、中间件、固定路由、D1 migration、本地与 CI 基线。

### 阶段 B：设备注册和兼容解析

实现 D1 repository、注册/检查、v1/v2 parser 和所有旧路径，先用 APNs fake 完成闭环。

### 阶段 C：APNs

实现 JWT、payload、fetch client、错误映射、失效处理、受控并发和完整参数测试；再以真实 Bark 设备做端到端验证。

### 阶段 D：MCP 与加固

实现 Streamable HTTP、Basic Auth、日志脱敏、超时/重试、限制和 observability。

### 阶段 E：发布

完成 API/部署文档、Deploy Button、Workers Builds、预览环境、全新账号演练和上游契约对比。

## 13. 完成定义

只有满足以下条件才算“完整实现”：

- 路由表中全部接口可用且统一位于 `/bark`。
- 上游已公开的 Bark 推送字段全部透传或正确映射。
- Bark App 注册、推送、重注册真实通过。
- MCP 能被标准客户端初始化、发现和调用。
- D1 数据在 Worker 重启/重新部署后保持。
- 默认 provider 配置与上游公开版本一致且在 `NOTICE` 标明来源；任何自定义密钥不进入源码、构建日志和 Git 历史。
- 单元、集成、契约测试通过。
- 全新 Cloudflare 账号的一键部署演练通过，后续 Git push 自动部署通过。
