---
name: gateway-protocol
description: xrpc 网关 HTTP 调用协议。当公司前端调用后端、写接口封装、处理请求/响应信封时加载。固定路径、信封、成功码与 JSON 编码以此为准。
---

# xrpc 网关调用协议

> 本文件是固定路径、信封、成功码与 JSON 编码的唯一事实源。

## 一、一句话

前端**不直接调微服务**，只调网关 HTTP 接口。请求固定为 xrpc 信封 `{ com, req }`，响应固定为 `{ code, msg, data }`。

## 二、传输与路由

- 方法：`POST`，`Content-Type: application/json`。
- 路由（前端只引用、不拼接）：

| 用途 | 路径 | 前端允许 |
|---|---|---|
| 常规业务调用（Gateway.Call） | `/tools/api` | ✅ |
| 后台管理调用（Gateway.AdminCall） | `/tools/adminapi` | ✅ |
| internal-only | — | ❌ 不得生成 Web endpoint |

## 三、请求信封

```json
{
  "com": {
    "dev_id": "DEV-ABC123-XYZ456",
    "dev_type": "ios",            // android / ios / pc
    "app_ver": "v1.0.1",
    "os_ver": "ios8",
    "jwt_token": ""
  },
  "req": {
    "module": "im.ImContacts.com",   // 目标微服务模块名（三段式）
    "method": "Login",                // RPC 名，大驼峰
    "params": {}                      // 业务参数（protobuf.Struct，JSON对象）
  }
}
```

- `module`/`method` 来自冻结的契约（contract.yaml / 接口清单），**不得根据页面或服务名猜测**。
- `com` 由传输层运行时统一注入；字段名/内容由目标项目确定，Feature 和页面**不得手写**。
- `gateway-call` 与 `gateway-admin` 自动映射协议清单路径；`internal-only` 不得生成 Web endpoint。

## 四、响应信封

```json
{ "code": 0, "msg": "ok", "data": { "userId": "123", "name": "Tom" } }
```

- `data` 使用 `native-json`：业务 Proto Response 直接映射为 JSON 对象，**不包装成 JSON 字符串**。
- `code === 0` → 成功取 `data`；`code !== 0` → 业务错误，用 `msg` 提示。
- 无业务响应的 `google.protobuf.Empty` 映射为 `{}`。
- **客户端不得对 `data` 再执行 JSON 解析**，也不得用"字符串或对象均可"的兼容分支掩盖协议违规。
- 处理顺序固定：验证传输结果 → 验证公共信封 → `code != 0` 转业务错误 → 按 endpoint Response 解码验证 `data` → 返回业务对象。

## 五、Proto 序列化约定

| 项 | 规则 |
|---|---|
| int64 / uint64 | **十进制字符串**传输（避免 JS 精度损失） |
| enum | symbolic-name |
| bytes | base64-string |
| timestamp | rfc3339 |
| 字段名 | lower-camel-case |
| 未设置字段 | omitted |
| 空消息 | object |

- 字段命名、枚举、bytes、Timestamp、未设置字段和空消息不得由各接口另行约定。
- 协议升级必须在本 Markdown 中完成评审，并同步检查调用方、服务方和已有冻结契约；项目存在协议版本机制时按项目规则更新版本，不得虚构本规则未定义的版本号或校验值。

## 六、前端封装要点

1. 统一入口 `xrpcCall(module, method, params)`（后台用 `xrpcAdminCall`），不存在"每接口一个 URL"。
2. 封装层自动注入 `com`、自动解包 `code/msg/data`。
3. 接口按 `module` + `method` 注册，不写 HTTP path；请求/响应类型化，禁止 `any`。
4. **禁止**：页面直接 `fetch`/`axios` 拼 URL 或手写信封；每个接口各自 new client/写拦截器；在页面散落 `module`/`method` 字符串。

## 七、客户端分层与错误边界

- 页面/组件 → Feature Hook/API → endpoint registry → 共享 XRPC transport → 冻结契约；禁止跨层绕过。
- endpoint registry 必须集中映射冻结契约中的 `module/method`、exposure、请求/响应类型；不得并行维护第二套手写清单。
- transport 只负责路径选择、`com` 注入、信封、单次 JSON 解析、超时/取消和传输错误归一，不负责弹窗、路由跳转或业务恢复。
- 必须区分网络/超时/取消、`code != 0` 业务错误和响应形态错误；Feature 再把错误映射为用户可见状态。
- 已有可靠客户端或生成代码必须优先适配；未经批准不得创建平行 transport。
