# self-notification-push

基于 TypeScript、[Hono](https://hono.dev/) 和 Cloudflare Workers 的 Bark Server 兼容实现。协议逐项对照 Bark App、Finb/bark-server 与官方推荐的 cwxiaos/bark-worker；除统一增加 `/bark` 前缀外，保持客户端注册和推送行为一致。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/HerbertHe/self-notification-push)

## 功能

- Bark App 设备注册、更新和有效性检查。
- v2 JSON 单设备与批量推送。
- v1 GET/POST、query、form、multipart 和多段 URL 兼容。
- title、subtitle、body、sound、level、badge、volume、call、copy、icon、image、group、ciphertext、archive、ttl、url、markdown、delete 等 Bark 参数。
- 内置官方 Bark App 所需的公开 APNs provider 配置，开箱即可注册和推送；同时支持自定义凭据覆盖。
- APNs ES256 token、D1 token 缓存、alert/background push、无效 device token 自动失效。
- Cloudflare D1 持久化，不依赖服务器、Docker、bbolt 或 MySQL。
- 可选 Basic Auth；注册和健康检查保持免鉴权。
- D1 session MCP Streamable HTTP，提供 `notify` 工具。
- FilterBox GET/POST Webhook，通过 `channel=bark` 转发并支持全部 `bark_*` 参数。
- D1 数据来源 key 白名单及受管理密钥保护的后门 CRUD；来源 key 与 Bark 设备 key 完全隔离。
- Deploy to Cloudflare 自动创建 D1；Workers Builds 在 Git push 后自动部署。

完整设计见 [Bark 实现方案](docs/IMPLEMENTATION_PLAN.md)，逐项核对结果见 [Bark 兼容矩阵](docs/COMPATIBILITY.md)。通知滤盒 Webhook → Bark 的扩展设计见 [FilterBox 实现方案](docs/FILTERBOX_IMPLEMENTATION_PLAN.md)，来源白名单和后门接口见 [来源 key 设计](docs/SOURCE_KEY_DESIGN.md)。

## 路由

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/bark` | 服务探测，返回 `ok` |
| GET | `/bark/ping` | Bark ping |
| GET | `/bark/healthz` | 存活检查 |
| GET | `/bark/info` | 版本和设备数量 |
| GET/POST | `/bark/register` | 旧版/新版设备注册 |
| GET | `/bark/register/:device_key` | 检查设备键 |
| POST | `/bark/push` | v2 单推或批推 |
| GET/POST | `/bark/:device_key/...` | 旧版路径推送 |
| POST | `/bark/mcp` | 通用 MCP endpoint |
| POST | `/bark/mcp/:device_key` | 固定设备 MCP endpoint |
| GET | `/filterbox/ping` | FilterBox 连通性检查 |
| GET/POST | `/filterbox/webhook` | FilterBox 多渠道 Webhook |
| GET/POST | `/backdoor/keys` | 查询/创建数据来源 key |
| GET/PUT/PATCH/DELETE | `/backdoor/keys/:key` | 查询、更新或删除数据来源 key |

响应与上游一致：

```json
{
  "code": 200,
  "message": "success",
  "timestamp": 1788300000
}
```

## 快速使用

部署后，在 Bark App 中把服务器地址设置为：

```text
https://你的域名/bark
```

旧版路径推送：

```bash
curl 'https://你的域名/bark/DEVICE_KEY/这是一条通知'
curl 'https://你的域名/bark/DEVICE_KEY/标题/正文?group=服务器&sound=minuet'
```

v2 JSON 推送：

```bash
curl -X POST 'https://你的域名/bark/push' \
  -H 'Content-Type: application/json' \
  -d '{
    "device_key": "DEVICE_KEY",
    "title": "部署完成",
    "body": "生产环境已经更新",
    "group": "deploy",
    "level": "timeSensitive",
    "sound": "minuet",
    "url": "https://example.com"
  }'
```

批量推送：

```bash
curl -X POST 'https://你的域名/bark/push' \
  -H 'Content-Type: application/json' \
  -d '{
    "device_keys": ["DEVICE_KEY_1", "DEVICE_KEY_2"],
    "title": "系统通知",
    "body": "批量推送测试"
  }'
```

## 一键部署

点击页面顶部的 Deploy to Cloudflare：

1. Cloudflare 会复制仓库、创建 Worker 和 D1 数据库，并建立 Workers Builds Git 集成。
2. 部署页面只要求填写 `BACKDOOR_API_KEY`；可通过 `openssl rand -hex 32` 生成。
3. 首次部署执行 D1 migration 并发布 Worker。
4. 此后向生产分支 push 会自动构建和部署；Pull Request 会获得预览构建。

与 `bark-server` 和 `bark-worker` 一样，本项目内置官方 Bark App 自托管服务所使用的公开 provider 配置，因此接入官方 Bark App 不需要额外 APNs Secret。该配置来源和授权说明见 [NOTICE](NOTICE)。

Deploy Button 会把 `.dev.vars.example` 中出现的变量作为部署 Secret 展示，因此该文件只声明后门管理所需的 `BACKDOOR_API_KEY`。APNs 自定义凭据、Basic Auth 和默认 FilterBox 目标都是可选配置，不在首次部署页面中强制填写。

只有为兼容的自定义 App/topic 部署时，才需要同时覆盖：

| Secret | 说明 |
| --- | --- |
| `APNS_PRIVATE_KEY` | 自定义 PKCS#8 `.p8` 私钥完整内容 |
| `APNS_KEY_ID` | Apple APNs Key ID |
| `APNS_TEAM_ID` | Apple Developer Team ID |

自定义凭据必须有权访问对应的 `APNS_TOPIC`：

```bash
pnpm exec wrangler secret put APNS_PRIVATE_KEY
pnpm exec wrangler secret put APNS_KEY_ID
pnpm exec wrangler secret put APNS_TEAM_ID
pnpm exec wrangler deploy
```

## 手动部署

要求 Node.js 20+、pnpm 10+ 和 Cloudflare 账号。

```bash
pnpm install
pnpm exec wrangler login
pnpm exec wrangler d1 create self-notification-push-db
```

将命令返回的 D1 `database_id` 写入 `wrangler.jsonc`，然后执行：

```bash
pnpm exec wrangler d1 migrations apply DB --remote
pnpm exec wrangler deploy
```

绑定自定义域名后，确保 Worker route 覆盖 `/bark*`、`/filterbox*` 和 `/backdoor*`；更简单的做法是让整个自定义域名指向该 Worker。

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm exec wrangler d1 migrations apply DB --local
pnpm dev
```

本地服务默认为 `http://localhost:8787`，Bark API 根地址为 `http://localhost:8787/bark`。`.dev.vars` 已加入 `.gitignore`，不要提交真实密钥。

`.dev.vars.example` 同时也是 Deploy Button 的 Secret 声明文件，所以不会列出可选 Secret。本地确实需要可选配置时，直接追加到 `.dev.vars`，例如：

```dotenv
BASIC_AUTH="user:password"
# 只有自定义 App/topic 才同时填写以下三项
APNS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
APNS_KEY_ID="你的Apple Key ID"
APNS_TEAM_ID="你的Apple Team ID"
```

## 配置

非敏感配置位于 `wrangler.jsonc`：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APNS_TOPIC` | `me.fin.bark` | APNs topic |
| `APNS_HOST` | `https://api.push.apple.com` | APNs production host |
| `MAX_BATCH_PUSH_COUNT` | `-1` | 单次批推上限，`-1` 与 bark-server 默认值一致 |
| `ALLOW_QUERY_NUMS` | `true` | `/bark/info` 是否统计设备数 |
| `APP_VERSION` | `1.0.0` | `/bark/info` 和 MCP 版本 |

`ALLOW_NEW_DEVICE` 不写入 `wrangler.jsonc`，由 Cloudflare 后台管理：

```text
Workers & Pages
→ self-notification-push
→ Settings
→ Variables and Secrets
→ Add variable
→ ALLOW_NEW_DEVICE
```

变量使用纯文本值：

- `true`：允许 Bark App 注册新设备。
- `false`：禁止未知设备注册；已经存在的 Bark device key 仍可更新 device token。
- 未配置：代码默认按 `true` 处理。

`wrangler.jsonc` 已启用 `keep_vars: true`，因此后续 `pnpm deploy` 或 Git 自动部署会保留后台配置的 `ALLOW_NEW_DEVICE`。不要再把同名变量加入本地 `vars`，否则本地值会重新成为部署配置源。其他仍列在 `vars` 中的固定变量继续由 Git 管理。

兼容 bark-worker 的鉴权方式：

```bash
pnpm exec wrangler secret put BASIC_AUTH
```

值的格式为 `用户名:密码`。也兼容 bark-server 的分离配置：

```bash
pnpm exec wrangler secret put BASIC_AUTH_USER
pnpm exec wrangler secret put BASIC_AUTH_PASSWORD
```

所有鉴权变量均为空时关闭鉴权。启用后 `/bark/ping`、`/bark/healthz`、`/bark/register` 仍免鉴权，其余 Bark 路由需要 Basic Auth：

```bash
curl -u 'user:password' 'https://你的域名/bark/DEVICE_KEY/受保护的通知'
```

## FilterBox Webhook

FilterBox 的所有接口使用 `/filterbox` 前缀。Webhook 不使用 Bark 设备 key 鉴权，而是要求一个独立的数据来源 key。先配置后门管理密钥：

```bash
pnpm exec wrangler secret put BACKDOOR_API_KEY
```

`BACKDOOR_API_KEY` 未配置时，所有 `/backdoor/*` 请求均返回 404，不能创建或查询来源 key。配置后，为 FilterBox 创建一个来源 key：

```bash
curl -X POST 'https://你的域名/backdoor/keys' \
  -H 'Authorization: Bearer 你的BACKDOOR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"remark":"FilterBox"}'
```

响应中的 `data.key` 是 FilterBox 专用的来源 key。FilterBox 推荐配置：

```text
Method: POST
URL: https://你的域名/filterbox/webhook?channel=bark
Header: Authorization: Bearer <刚创建的来源key>
Header: Content-Type: application/json
```

Body：

```json
{
  "title": "{android.title}",
  "body": "{android.text}",
  "app_name": "{filterbox.field.APP_NAME}",
  "package_name": "{filterbox.field.PACKAGE_NAME}",
  "when": "{filterbox.field.WHEN}",
  "bark_group": "filterbox",
  "bark_level": "active"
}
```

通过 `channel` 参数选择发送渠道，目前实现 `bark`。所有 Bark 私有参数使用 `bark_` 前缀：

```text
bark_device_key / bark_device_keys
bark_title / bark_subtitle / bark_body / bark_markdown
bark_sound / bark_level / bark_volume / bark_badge / bark_call
bark_group / bark_icon / bark_image
bark_url / bark_action / bark_copy / bark_autoCopy
bark_ciphertext / bark_iv
bark_isArchive / bark_ttl / bark_id / bark_delete
```

请求提供 `bark_device_key(s)` 时只推送到指定设备；未提供时自动查询 D1 并推送给所有 device token 非空的已注册 Bark 设备，不需要额外环境变量。相同 APNs device token 只推送一次，避免历史 key 导致重复通知。未提供 `bark_title` 和 `bark_body` 时分别使用通用 `title` 和 `body/text/message`；其他未提供的参数使用 Bark 自身默认值。未知的 `bark_*` 参数也会移除前缀后透传。

隐式全设备推送只返回 `{ total, succeeded, failed }` 统计，不向数据来源暴露数据库中的 Bark device key。显式传入 `bark_device_keys` 时仍返回逐设备结果。

三类 key 不可混用：

- `BACKDOOR_API_KEY`：只保护 `/backdoor/*`，由 Cloudflare Secret 配置。
- 来源 key：由后门 CRUD 存入 D1 白名单，只允许通知滤盒等来源调用 `/filterbox/webhook`。
- Bark 设备 key：由 Bark App 通过 `/bark/register` 注册，只用于定位 APNs 设备。

来源 key 不会注册 Bark 设备，Bark 的注册协议也不会读取来源白名单。FilterBox 未指定 `bark_device_key(s)` 时广播给全部有效的已注册 Bark 设备；删除来源 key 后对应 Webhook 权限立即失效。

后门 CRUD 示例：

```bash
# 查询列表
curl -H 'Authorization: Bearer 你的BACKDOOR_API_KEY' \
  'https://你的域名/backdoor/keys'

# 修改备注或同时替换 key
curl -X PATCH 'https://你的域名/backdoor/keys/旧来源key' \
  -H 'Authorization: Bearer 你的BACKDOOR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"remark":"家庭通知滤盒"}'

# 撤销来源权限
curl -X DELETE 'https://你的域名/backdoor/keys/来源key' \
  -H 'Authorization: Bearer 你的BACKDOOR_API_KEY'
```

完整规则和 GET/form 示例见 [FilterBox 实现方案](docs/FILTERBOX_IMPLEMENTATION_PLAN.md)。

## MCP

通用 endpoint 需要 AI 客户端在 `notify` 参数中传 `device_key`：

```text
https://你的域名/bark/mcp
```

推荐使用设备专用地址，客户端无需知道 device key 参数结构：

```text
https://你的域名/bark/mcp/DEVICE_KEY
```

服务实现 D1 session、`initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call` 和 `DELETE` session，并以非流式 JSON 模式返回 Streamable HTTP 响应。

## 测试

```bash
pnpm run typecheck
pnpm test
pnpm exec wrangler deploy --dry-run
```

测试覆盖 APNs payload、background push、4096-byte 限制、v1/v2 参数优先级、注册/检查、旧版 URL、批量部分失败、Basic Auth、MCP、FilterBox 来源白名单及后门 CRUD。

## 自动部署

- `.github/workflows/ci.yml` 只负责 typecheck、测试和 Worker dry-run。
- 生产发布由 Deploy to Cloudflare 建立的 Workers Builds 完成，避免两个 CI 同时发布。
- D1 migration 在 `pnpm deploy` 中先于 Worker 发布执行。
- 如改用 GitHub Actions 发布，应先关闭 Workers Builds，并在 GitHub Secrets 中配置 Cloudflare API Token 和 Account ID。

## License

[MIT](LICENSE)
