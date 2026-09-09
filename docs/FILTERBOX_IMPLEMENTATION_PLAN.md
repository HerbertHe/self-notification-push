# FilterBox Webhook → 多渠道推送实现方案

## 1. 目标

在现有 Hono + Cloudflare Workers 服务中增加 `/filterbox` 接口，接收通知滤盒（FilterBox）的 Webhook，并根据 `channel` 参数选择发送渠道。

当前只实现：

```text
channel=bark
```

后续如果需要 Telegram、邮件等渠道，再分别增加适配器。本阶段不实现 target、渠道管理、投递记录、Queue 或其他非必要功能。

所有 Bark 私有参数统一使用 `bark_` 前缀，例如：

```text
bark_title
bark_body
bark_sound
bark_device_key
```

进入 Bark 适配器后只移除一次 `bark_` 前缀，并将剩余参数交给现有 Bark `PushService`。这样可以完整支持 Bark 当前和未来的扩展参数，不需要在 FilterBox 模块重复实现一套 Bark 协议。

## 2. FilterBox 官方能力

FilterBox Webhook 支持：

- GET 和 POST。
- 自定义 URL、body 和 header。
- 在 URL/body 中使用通知字段。
- JSON body。

常用变量：

- `{android.title}`：通知标题
- `{android.text}`：通知正文
- `{filterbox.field.APP_NAME}`：App 名称
- `{filterbox.field.PACKAGE_NAME}`：App 包名
- `{filterbox.field.WHEN}`：通知时间

完整变量以 FilterBox 最近通知中的“调试信息”为准。

## 3. API

所有接口使用 `/filterbox` 前缀：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/filterbox/ping` | 连通性检查 |
| GET/POST | `/filterbox/webhook` | 接收 Webhook 并根据 channel 发送 |

推荐调用：

```text
POST /filterbox/webhook?channel=bark
```

也支持在 JSON 或 form body 中指定：

```json
{
  "channel": "bark"
}
```

渠道选择优先级：

1. query 中的 `channel`
2. body 中的 `channel`
3. 环境变量 `FILTERBOX_DEFAULT_CHANNEL`
4. 默认值 `bark`

不支持的渠道返回：

```json
{
  "code": 400,
  "message": "unsupported channel: telegram",
  "timestamp": 1788300000
}
```

## 4. 请求格式

### 推荐的 POST JSON

FilterBox URL：

```text
https://你的域名/filterbox/webhook?channel=bark
```

Headers：

```text
Content-Type: application/json
Authorization: Bearer 你的来源Key
```

Header 不便配置时，可在 POST JSON Body 中增加：

```json
{
  "x_snp_authorization": "你的来源Key"
}
```

Header 优先级最高；仅在请求完全没有 `Authorization` Header 时读取 Body。Header 存在但格式错误或 key 无效时返回 401，不回退到 Body。Body 方式不支持 GET、query 或 form，字段鉴权后删除，不参与渠道参数映射。

Body：

```json
{
  "title": "{android.title}",
  "body": "{android.text}",
  "app_name": "{filterbox.field.APP_NAME}",
  "package_name": "{filterbox.field.PACKAGE_NAME}",
  "when": "{filterbox.field.WHEN}"
}
```

如果需要指定 Bark 参数：

```json
{
  "title": "{android.title}",
  "body": "{android.text}",
  "app_name": "{filterbox.field.APP_NAME}",
  "package_name": "{filterbox.field.PACKAGE_NAME}",
  "when": "{filterbox.field.WHEN}",

  "bark_device_key": "你的Bark设备Key",
  "bark_group": "filterbox",
  "bark_sound": "minuet",
  "bark_level": "timeSensitive",
  "bark_isArchive": "1"
}
```

### GET

```text
https://你的域名/filterbox/webhook?channel=bark&title={android.title}&body={android.text}&app_name={filterbox.field.APP_NAME}&bark_device_key=你的Bark设备Key&bark_group=filterbox
```

GET 和 POST 使用同一套参数解析与映射。

## 5. 通用 FilterBox 参数

这些参数不带渠道前缀：

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `channel` | 发送渠道 | `bark` |
| `title` | FilterBox 通知标题 | 空字符串 |
| `body` | FilterBox 通知正文 | 依次读取 `text`、`message` |
| `text` | body 的兼容别名 | 空字符串 |
| `message` | body 的兼容别名 | 空字符串 |
| `app_name` | 来源 App 名称 | 空字符串 |
| `package_name` | 来源 App 包名 | 空字符串 |
| `when` | 通知时间 | 空字符串 |

`app_name`、`package_name` 和 `when` 只作为可用的通知上下文，不会自动改变 Bark 参数。避免服务端擅自添加标题、分组或时间。

默认 Bark 映射只有：

```text
title -> Bark title
body/text/message -> Bark body
```

如果存在 `bark_title` 或 `bark_body`，私有参数优先。

## 6. Bark 私有参数规则

所有以 `bark_` 开头的参数都属于 Bark 渠道：

```ts
function extractBarkParams(input: Record<string, unknown>) {
  const params: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    if (key.toLowerCase().startsWith('bark_')) {
      params[key.slice(5)] = value
    }
  }

  return params
}
```

处理原则：

- 参数 key 匹配 `bark_` 时不区分大小写。
- 只移除开头的一次 `bark_`。
- 移除前缀后的参数名按 Bark 协议规则处理。
- 已知参数执行必要的类型校验。
- 未知 `bark_*` 参数也透传给 Bark，保证未来 Bark 新增字段时不需要修改 FilterBox 接口。
- `bark_*` 不会被其他渠道读取。

## 7. 支持的 Bark 参数

### 设备参数

| FilterBox 参数 | Bark 参数 | 说明 |
| --- | --- | --- |
| `bark_device_key` | `device_key` | 单设备推送 |
| `bark_device_keys` | `device_keys` | 多设备推送，数组、JSON 数组字符串或逗号分隔字符串 |

`bark_device_keys` 非空时优先于 `bark_device_key`，与 Bark 批量推送规则一致。

如果请求没有提供设备参数，则查询 D1 `devices` 表，并向所有 `device_token` 非空的已注册 Bark 设备批量推送。不需要默认设备环境变量；相同 APNs device token 只发送一次。没有任何有效注册设备时返回 400 `no registered Bark devices`。

隐式广播响应只包含 `total`、`succeeded`、`failed` 统计，不把 D1 中的 Bark device key 暴露给数据来源。显式指定 `bark_device_keys` 时继续返回 Bark 的逐设备批量结果。

### 内容参数

| FilterBox 参数 | Bark 参数 | 默认值 |
| --- | --- | --- |
| `bark_title` | `title` | 通用 `title` |
| `bark_subtitle` | `subtitle` | 空 |
| `bark_body` | `body` | 通用 `body/text/message` |
| `bark_markdown` | `markdown` | 不发送 |
| `bark_ciphertext` | `ciphertext` | 不发送 |
| `bark_iv` | `iv` | 不发送 |

title、subtitle、body 都为空时，现有 Bark 核心会使用 `Empty Message`，与 bark-server 一致。

### 声音与提醒

| FilterBox 参数 | Bark 参数 | 默认行为 |
| --- | --- | --- |
| `bark_sound` | `sound` | Bark 默认 `1107` |
| `bark_level` | `level` | 不发送，由 Bark App 使用普通 active 行为 |
| `bark_volume` | `volume` | 不发送，由 Bark App 使用默认重要提醒音量 |
| `bark_badge` | `badge` | 不改变角标 |
| `bark_call` | `call` | 不启用连续铃声 |

`bark_level` 支持：

```text
critical
active
timeSensitive
passive
```

### 展示、分组与操作

| FilterBox 参数 | Bark 参数 | 默认行为 |
| --- | --- | --- |
| `bark_group` | `group` | 不分组 |
| `bark_icon` | `icon` | 不设置 |
| `bark_image` | `image` | 不设置 |
| `bark_url` | `url` | 点击不跳转到自定义 URL |
| `bark_action` | `action` | 使用 Bark 默认点击行为 |
| `bark_copy` | `copy` | 不设置复制文本 |
| `bark_autoCopy` | `autoCopy` | 不自动复制 |

### 归档和生命周期

| FilterBox 参数 | Bark 参数 | 默认行为 |
| --- | --- | --- |
| `bark_isArchive` | `isArchive` | 不覆盖 Bark App 本地归档设置 |
| `bark_ttl` | `ttl` | 不指定归档过期时间 |
| `bark_id` | `id` | 不设置 collapse id |
| `bark_delete` | `delete` | 不发送删除/background 通知 |

### 扩展参数

例如：

```json
{
  "bark_custom_field": "value"
}
```

会转换为：

```json
{
  "custom_field": "value"
}
```

并由 Bark 核心作为自定义 APNs payload 字段发送。

## 8. 参数优先级

以 Bark title 为例：

```text
bark_title
  > title
  > 空字符串
```

Bark body：

```text
bark_body
  > body
  > text
  > message
  > 空字符串
```

Bark device keys：

```text
bark_device_keys
  > bark_device_key
  > D1 中全部有效 Bark 设备
  > 没有有效设备时返回 400
```

其他 Bark 参数：

```text
bark_* 请求参数
  > Bark 自身默认值
```

服务端不为 sound、group、level、archive 等设置额外业务默认值，直接沿用已经与 Bark App 核对过的 Bark 核心行为。

## 9. 渠道适配结构

只保留最小接口：

```ts
interface NotificationChannel {
  readonly name: string
  send(input: Record<string, unknown>): Promise<ChannelResult>
}
```

当前注册：

```ts
const channels: Record<string, NotificationChannel> = {
  bark: new BarkChannel(pushService),
}
```

Webhook 流程：

```text
FilterBox GET/POST
       │
       ▼
解析 channel 与参数
       │
       ▼
channels[channel]
       │
       ▼
BarkChannel
       │
       ├── 提取 bark_*
       ├── 补 title/body/device keys 默认值
       └── 调用 PushService
```

以后增加渠道时，只增加一个适配器并注册：

```ts
channels.telegram = new TelegramChannel(...)
```

不提前实现渠道配置中心、动态插件或数据库抽象。

## 10. 响应

单设备成功：

```json
{
  "code": 200,
  "message": "success",
  "timestamp": 1788300000
}
```

多设备成功或部分失败时，复用 Bark 批量结构：

```json
{
  "code": 200,
  "message": "success",
  "data": [
    { "device_key": "key1", "code": 200 },
    { "device_key": "key2", "code": 400, "message": "device token invalid" }
  ],
  "timestamp": 1788300000
}
```

错误状态：

- 缺少、不存在或已撤销的来源 key：401。
- 不支持的 channel：400。
- 未显式指定目标且 D1 中没有有效 Bark 设备：400。
- title/body 均为空不是错误，交给 Bark 使用 `Empty Message`。
- Bark/APNs 错误：保留 Bark 核心的状态与响应信息。

## 11. 鉴权与安全

FilterBox Webhook 使用 D1 中的数据来源 key 白名单，不使用固定环境变量 token。来源 key 通过受保护的 `/backdoor/keys` CRUD 创建，并放入请求头：

```text
Authorization: Bearer <来源key>
```

未携带 `Authorization` Header 时，也可从 POST JSON Body 的 `x_snp_authorization` 读取。两种方式都查询同一张来源 key 白名单，不创建新的密钥类型。Header 存在时无论是否有效都不回退到 Body。该字段仅用于入口鉴权，与 Bark 注册、Bark device key、推送目标和 APNs 凭据无关。

三类密钥严格隔离：

- `BACKDOOR_API_KEY` 是 Cloudflare Secret，只鉴权 `/backdoor/*` 管理接口。
- 来源 key 存在 `source_keys` 表中，只鉴权 `/filterbox/webhook` 等数据来源入口。
- Bark device key 由 Bark App 的 `/bark/register` 产生，只定位推送设备。

来源 key 不参与 Bark 注册。Bark 路由不会读取 `source_keys` 表；只有 FilterBox 在未指定目标时读取全部有效 Bark 设备。

要求：

- `/filterbox/ping` 免鉴权，`/filterbox/webhook` 必须鉴权。
- 请求体最大 64 KiB。
- 日志不记录 Authorization、完整通知正文或 Bark device key。
- FilterBox 通知内容不落库。
- 直接提供 `bark_device_key(s)` 的能力受来源白名单保护。

不增加渠道 CRUD、投递历史或复杂权限模型；只增加用户明确需要的来源 key/备注 CRUD。

## 12. D1 与部署

来源白名单使用独立 D1 表：

```sql
CREATE TABLE source_keys (
  key TEXT PRIMARY KEY NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
```

时间字段仅供内部排序和维护，后门 API 只返回 `key` 和 `remark`。Bark device key 仍由原有 `devices` 表解析，二者没有外键或复用关系。

需要在 `wrangler.jsonc` 增加：

```json
{
  "vars": {
    "FILTERBOX_DEFAULT_CHANNEL": "bark"
  }
}
```

敏感配置通过 Secret 设置：

```bash
pnpm exec wrangler secret put BACKDOOR_API_KEY
```

FilterBox 不需要默认设备 Secret。显式传 `bark_device_key(s)` 时定向推送，否则广播给全部有效 Bark 设备。

现有 Deploy to Cloudflare、D1 migration 和自动部署流程保持不变。

## 13. 推荐代码结构

```text
src/filterbox/
├── app.ts
├── parser.ts
├── auth.ts
├── channel.ts
└── bark-channel.ts
```

挂载：

```ts
app.route('/bark', barkApp)
app.route('/filterbox', filterBoxApp)
```

职责：

- `app.ts`：路由和统一错误处理。
- `parser.ts`：GET/POST/JSON/form 解析与字段别名。
- `auth.ts`：Header Bearer 或 POST JSON `x_snp_authorization` 来源 key 白名单校验。
- `channel.ts`：最小渠道接口和 channel 选择。
- `bark-channel.ts`：`bark_*` 参数提取、默认值和 PushService 调用。

## 14. 测试计划

### FilterBox 输入

- GET query。
- POST JSON。
- POST form。
- query channel 覆盖 body channel。
- channel 缺省为 bark。
- 中文、emoji、换行、引号。

### Bark 参数

- 每一个已知 `bark_*` 参数映射到正确 Bark 参数。
- 未知 `bark_*` 参数移除前缀后透传。
- 不带 `bark_` 的未知参数不进入 Bark payload。
- `bark_title/body` 覆盖通用 title/body。
- 未传可选参数时使用 Bark 默认值。
- `bark_device_keys` 优先于 `bark_device_key`。
- 请求设备 key 优先；未指定时查询全部有效 Bark 设备。
- 单设备和批量结果。

### 安全与回归

- Header/POST JSON 来源 key、错误 key、正确 key、撤销后的 key。
- 错误 Header 与正确 Body 同时存在时仍返回 401，验证 Header 优先级。
- query、GET 和 form 中的 `x_snp_authorization` 不得通过鉴权。
- 后门密钥缺失时隐藏接口，错误时拒绝，CRUD 后立即影响白名单。
- 来源 key 与 Bark device key 数据和协议隔离。
- 请求体上限和日志脱敏。
- `/bark` 现有 14 个兼容测试继续通过。
- Wrangler dry-run 通过。

### 真实验收

1. Bark App 已通过 `/bark` 注册。
2. 配置 `BACKDOOR_API_KEY`，通过 `/backdoor/keys` 创建备注为 FilterBox 的来源 key。
3. 在 FilterBox 中创建 `channel=bark` 的 POST JSON Webhook，并通过 Bearer header 或 `x_snp_authorization` 提供来源 key。
4. 不传设备参数，验证普通 Android 通知到达全部有效 Bark 设备。
5. 显式传 `bark_device_key(s)`，验证只向指定设备推送。
6. 验证 title、body、中文、emoji 和换行。
7. 逐项验证 sound、group、level、badge、call、copy、icon、image、archive、ttl、url、markdown。
8. 验证多 device key 批量发送，并验证删除来源 key 后请求返回 401。

Android 15 可能隐藏验证码等敏感通知内容。服务端无法恢复 FilterBox 已经无法读取的正文，测试前应先查看 FilterBox 的“调试信息”。

## 15. 实施步骤

1. 增加 `/filterbox/ping` 和 `/filterbox/webhook`。
2. 实现 GET/POST/JSON/form 解析。
3. 实现 Bearer 与 POST JSON Body 来源 key 白名单校验。
4. 实现最小 channel 选择器，只注册 bark。
5. 实现所有 `bark_*` 参数的统一提取。
6. 补充 title/body/device keys 默认值。
7. 复用 PushService 完成单推和批推。
8. 增加 `source_keys` migration 和受管理密钥保护的最小 CRUD。
9. 增加逐参数、来源权限隔离测试和真实 FilterBox → Bark 验收。
10. 更新 README 和一键部署配置。

## 16. 完成定义

- 所有 FilterBox API 以 `/filterbox` 开头。
- FilterBox 通过 `channel` 参数选择发送渠道。
- 当前 `channel=bark` 可用，未来渠道只需增加适配器。
- 不存在 target 概念。
- 所有 Bark 私有参数使用 `bark_` 前缀。
- Bark 已知参数全部支持，未知 `bark_*` 参数可以透传。
- 未提供 Bark 可选参数时严格使用 Bark 自身默认值。
- GET、POST、JSON、form 均可调用。
- 除来源 key 白名单及其最小 CRUD 外，不新增渠道配置、Queue 或投递历史。
- 原有 Bark App 兼容性不回归。
- 真实 FilterBox → Bark App 端到端验证通过。
