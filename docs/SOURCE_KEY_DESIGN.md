# 数据来源 key 白名单与后门接口设计

## 1. 目的与边界

通知滤盒等外部系统是“数据来源”。它们调用 Webhook 前必须通过白名单鉴权，因此服务提供独立的来源 key。这个概念与 Bark 设备注册无关：Bark App 继续按照官方协议调用 `/bark/register`，来源 key 不会注册设备，也不能用于选择推送目标。

本设计只包含 `key` 和 `remark` 的 CRUD，不引入用户、角色、渠道配置、投递历史或复杂权限。

## 2. 三类 key

| 类型 | 存储位置 | 用途 | 创建方式 |
| --- | --- | --- | --- |
| 后门管理密钥 `BACKDOOR_API_KEY` | Cloudflare Secret | 调用 `/backdoor/*` | Wrangler/Cloudflare 控制台 |
| 数据来源 key | D1 `source_keys` | 调用 `/filterbox/webhook` | 后门 CRUD |
| Bark 设备 key | D1 `devices` | 定位 Bark/APNs 设备 | Bark App `/bark/register` |

任何一类 key 都不会隐式获得另一类权限。`/bark/register` 只读写 `devices`；`/filterbox/webhook` 只用来源 key 做入口鉴权。请求显式提供 `bark_device_key(s)` 时只发送到指定设备，未提供时发送到 `devices` 表中的全部有效设备。

## 3. 后门鉴权

所有 `/backdoor/*` 请求使用：

```text
Authorization: Bearer <BACKDOOR_API_KEY>
```

- 未配置 `BACKDOOR_API_KEY`：整个后门接口返回 404，不能调用。
- 已配置但 header 缺失或错误：返回 401。
- 管理密钥只放在 Cloudflare Secret，不提供 HTTP 创建或查询能力。
- API 响应和日志不回显管理密钥。

## 4. CRUD API

| 方法 | 路径 | JSON body | 说明 |
| --- | --- | --- | --- |
| GET | `/backdoor/keys` | 无 | 列出所有来源 key 和备注 |
| POST | `/backdoor/keys` | `{ "key"?: string, "remark"?: string }` | 创建；省略 key 时安全随机生成 |
| GET | `/backdoor/keys/:key` | 无 | 查询单个来源 key |
| PUT/PATCH | `/backdoor/keys/:key` | `{ "key"?: string, "remark"?: string }` | 修改 key 和/或备注 |
| DELETE | `/backdoor/keys/:key` | 无 | 删除并立即撤销权限 |

请求体只接受 `key`、`remark`。key 必须是 16–128 位 URL-safe 字符（字母、数字、`_`、`-`）；自动生成值为 32 个随机字节的 base64url。remark 最长 200 字符。API 只返回这两个业务字段。

创建示例：

```bash
curl -X POST 'https://你的域名/backdoor/keys' \
  -H 'Authorization: Bearer 你的BACKDOOR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"remark":"FilterBox"}'
```

## 5. Webhook 鉴权流程

`/filterbox/ping` 保持公开。`GET/POST /filterbox/webhook` 从 Bearer header 取得来源 key，并对 `source_keys.key` 做主键查询：存在则继续解析和投递，不存在则返回 401。删除或替换 key 后无需缓存失效，下一次请求立即采用 D1 中的新状态。

成功通过入口鉴权只代表该来源可以提交通知，并不会自动产生 Bark 设备 key。Bark 投递仍走现有 `PushService`，完整支持所有 `bark_*` 参数及 Bark 默认值。

## 6. 数据模型与迁移

`migrations/0003_source_keys.sql` 创建独立表：

```sql
CREATE TABLE IF NOT EXISTS source_keys (
  key TEXT PRIMARY KEY NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
```

`created_at`、`updated_at` 只用于内部维护和稳定排序，不属于公开 CRUD 字段。表与 Bark 的 `devices` 表无关联。

## 7. 最小安全要求

- 为 `BACKDOOR_API_KEY` 使用高熵随机值，并只通过 Secret 配置。
- 为每种数据来源创建不同 key，备注写清用途，泄露时只撤销对应 key。
- FilterBox 使用 HTTPS，并把来源 key 放在 Authorization header，不放 URL query。
- 不记录 Authorization、来源 key、Bark 设备 key或完整通知正文。
- 可在 Cloudflare 层为 `/backdoor/*` 增加 Access/WAF 作为额外防护，但不改变应用协议。
