# Bark App / Bark Server 兼容矩阵

本矩阵以 2026-09-02 获取的以下版本为核对基准：

- Bark App `f5570d373e861dee588c06bfa9fcba447eddc0b3`
- Finb/bark-server `3df8990fcbc407a3f5638eea8cedc3289d1a405d`
- cwxiaos/bark-worker `3db0918856d5aca4d141300c84d5c7a9f851ba44`

唯一有意改变的 HTTP 路径是统一增加 `/bark`：App 中服务器地址必须填写 `https://host/bark`。Bark App 自己会在该地址后拼接 `/ping` 和 `/register`。

`/filterbox` 和 `/backdoor` 是 Bark 协议之外的扩展。后门维护的是外部数据来源白名单，不维护 Bark device key；它不会拦截、替换或改变 Bark App 注册流程。

## Bark App 直接通信

| 客户端行为 | Bark App 实际协议 | 本实现 | 状态 |
| --- | --- | --- | --- |
| 检查服务器 | `GET <server>/ping`，要求 2xx | `GET /bark/ping`，返回 `{code:200,message:"pong",timestamp}` | 一致 |
| 首次注册 | `GET <server>/register?key=&devicetoken=<token>` | 生成 22 位兼容 short key，保存 token | 一致 |
| 更新 token | `GET <server>/register?key=<key>&devicetoken=<token>` | key 存在时原键更新 | 一致 |
| 旧 key 丢失 | 提交旧 key 后服务端返回新 key | 查不到旧 key 时重新生成并在 `data.key` 返回 | 一致 |
| 注册响应 | JSON `data.key` 必须存在 | 同时返回 `key`、`device_key`、`device_token` | 一致 |
| 服务器地址 | App 将 `/ping`、`/register` 拼到用户地址 | 用户地址填写到 `/bark` | 仅前缀差异 |

## HTTP API

| 功能 | 上游 | 本实现 | 状态 |
| --- | --- | --- | --- |
| 根探测 | `GET /` -> `ok` | `GET /bark` -> `ok` | 一致 |
| ping | `GET /ping` | `GET /bark/ping` | 一致 |
| healthz | `GET /healthz` -> `ok` | `GET /bark/healthz` -> `ok` | 一致 |
| info | version/build/arch/commit/devices | 字段结构相同，值反映 Worker 构建 | 运行时等价 |
| 旧注册 | GET query：`key`、`devicetoken` | 支持 | 一致 |
| v2 注册 | POST：JSON/form/XML，兼容新旧字段名 | 支持 | 一致 |
| 注册检查 | `GET /register/:device_key` | 支持 | 一致 |
| v2 推送 | `POST /push` | `POST /bark/push` | 一致 |
| 旧版推送 | GET/POST 0–3 个消息路径段 | `/bark/:device_key/...` | 一致 |
| URL/form/query | query、urlencoded、multipart、路径最高优先级 | 支持 | 一致 |
| JSON | `application/json` 及 `+json` | 支持 | 一致 |
| 批量 | 数组或逗号字符串，结果保持输入顺序 | 支持；同时兼容 bark-worker 的 v1 批量 | 兼容超集 |
| 批量默认上限 | `-1` | `-1` | 一致 |
| Basic Auth | ping/register/healthz 免鉴权 | 相同；兼容合并及分离配置 | 一致/超集 |
| 通用响应 | code/message/data/timestamp | 相同 | 一致 |

## APNs 与 Bark 通知字段

| 项目 | 上游行为 | 本实现 | 状态 |
| --- | --- | --- | --- |
| APNs topic | `me.fin.bark` | `me.fin.bark` | 一致 |
| Provider 配置 | 上游公开 Bark provider key/team/key-id | 默认内置相同配置，可选 Secret 覆盖 | 一致 |
| JWT | ES256，缓存约 3000 秒 | Web Crypto ES256，isolate + D1 3000 秒缓存 | 一致 |
| APNs endpoint | production `/3/device/:token` | 相同 | 一致 |
| 默认声音 | `1107` | `1107` | 一致 |
| 自定义声音 | 自动补 `.caf` | 相同 | 一致 |
| 空 alert | body 使用 `Empty Message` | 相同 | 一致 |
| 普通通知 | alert、category、thread-id、mutable-content | 相同 | 一致 |
| 删除通知 | background、content-available、mutable-content | 相同 | 一致 |
| collapse id | `id` -> `apns-collapse-id` | 相同 | 一致 |
| expiration | 当前时间 + 86400 秒 | 相同 | 一致 |
| 无效 token | 410/BadDeviceToken 将 token 置空 | 相同 | 一致 |
| payload 限制 | APNs 4096 bytes | 发送前校验 4096 bytes | 一致且更早报错 |

以下 Bark App 实际读取的自定义字段均以字符串形式送入 APNs payload：

- `group`、`call`、`isarchive`
- `icon`、`image`
- `ciphertext`、`iv`
- `level`、`volume`
- `url`、`copy`、`autocopy`、`automaticallycopy`
- `badge`、`action`、`id`
- `markdown`、`ttl`

## MCP

| 能力 | bark-worker D1 版 | 本实现 | 状态 |
| --- | --- | --- | --- |
| initialize | 创建 session，返回 `mcp-session-id` | 相同 | 一致 |
| protocolVersion | `2025-03-26` | 相同 | 一致 |
| notifications/initialized | 校验并续期 session | 相同 | 一致 |
| tools/list | 暴露 notify schema | 字段、annotations、required 规则相同 | 一致 |
| tools/call | 通用/固定 device key | 相同 | 一致 |
| session 期限 | 1 小时空闲、1 天绝对期限 | 相同 | 一致 |
| DELETE | 删除 session | 相同 | 一致 |
| SSE | 禁用 | 禁用 | 一致 |

## Cloudflare 运行时替代项

以下是运行方式替代，不影响 Bark App 或 HTTP 协议：

- bbolt/MySQL 替换为 D1。
- Go HTTP server、Unix Socket、本地 TLS 和进程信号替换为 Workers fetch runtime。
- Go APNs HTTP/2 client 替换为 Workers `fetch`；Cloudflare 负责上游协议协商。
- Go 连接池/并发 CLI 参数替换为 Workers 平台调度。

## 自动化验证

当前测试覆盖：

- Bark App 实际使用的 GET ping 和 GET register/query/data.key 闭环。
- 新旧 key、注册检查、旧版路径推送。
- v1/v2 输入优先级和批量顺序/部分失败。
- Bark App payload 字符串类型、默认/自定义声音、background、4096 bytes。
- 默认公开 APNs provider 配置可成功生成 ES256 bearer token。
- BadDeviceToken 失效。
- Basic Auth 免鉴权规则。
- MCP session、tools/list、tools/call 和非法 session。
- Wrangler D1 migration、构建 dry-run 和本地 Worker/D1 烟雾测试。

真实 APNs 端到端测试仍需要一台已安装 Bark 的 iPhone；自动测试不会向真实设备发送通知。
