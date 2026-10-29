# Starland 管理后台 — 服务拓扑与账号参考

> 本文记录当前（2026-10-26 视角）已知的运行环境、服务/端口、账号鉴权、服务间调用拓扑与关键业务链路。
> 属于内部运维参考，**含密钥等敏感信息，勿提交到公开仓库**。带「⚠️待核对」的条目为尚未与后端最终对齐、或线上行为存疑的项。

---

## 1. 环境 / 机器

| 别名 | 公网 IP | 角色 |
|---|---|---|
| `develop-hy` (47.120.10.73) | 47.120.10.73 | 网关 + 各内部微服务 + MySQL |
| `develop-tg` (106.52.77.108) | 106.52.77.108 | 文件服务（openresty 前置）+ MinIO；同时托管管理后台静态站 |

SSH 入口：本机 `~/.ssh/config` 的 `develop-hy` / `develop-tg`。
服务启停：`/opt/<svc>/setup.sh start`；`login`/`gateway` 已注册 systemd（`systemctl restart starland-login starland-gateway`），`admin` 未注册 systemd 单元、用 `setup.sh`。

---

## 2. 服务清单与端口

### develop-hy (47.120.10.73)
| 服务 | 端口 | 说明 |
|---|---|---|
| 网关 gateway | **12001**（对外 `0.0.0.0`） | 接收 `/startlandapi`；路由 `starland.admin.com → 127.0.0.1:8050`；边缘校验用户 JWT |
| admin | **8050**（`127.0.0.1` 仅网关路由可达） | 管理后台后端，内部校验 operator |
| login | 8010 | 签发/刷新 access token（JWT） |
| feedback | 8060 | 反馈 / 诊断日志上报 |
| starcore | 8030 | 核心业务 |
| order | 8040 | 订单 |
| vfcode | 8020 | 验证码 |
| uidflake | 7010 | UID 雪花生成 |
| MySQL | starlandbd :3136 | 业务库 |

### develop-tg (106.52.77.108)
| 服务 | 端口 | 说明 |
|---|---|---|
| openresty | **80 / 443** | 前端静态站 + API 前置反代（见 §4 拓扑）。`location ^~ /internal/ { return 404 }` —— **内部接口禁止经公网入口** |
| fileupload（公网 listener） | **8080** | 文件服务主监听，处理 `/api/v1/*` 上传/下载。`RequirePermission` 当前为**标记不拦截**（仅记权限声明，不真正拒绝） |
| fileupload（内部 listener） | **8081**（loopback-only，`INTERNAL_HTTP_ADDR` 强制回环地址） | 处理 `/internal/*`（无鉴权、`ownerRestricted=false`）；**仅本机可访问**，openresty 已对 `/internal` 返回 404，公网/跨机不可达 |
| MinIO | 9000 | bucket=`fileupload`；`app-releases/*` 前缀匿名可读，`logs/`、`feedback-files/` 前缀私有 |

> openresty 的 web root 是 **`/opt/starland-admin-web`**（不是 nginx 默认 html 目录）。
> ⚠️ 源码位置：`/root/fileupload`（deploy-tg）。配置：`/root/fileupload/config/fileupload.env`（MinIO 凭据 `MINIO_SECRET_KEY`、bucket `fileupload`）。

### develop-hy (47.120.10.73) 微服务补充
- **admin 是 gRPC 服务**（协议 `grpc`，监听 `127.0.0.1:8050`），**不暴露 HTTP**；管理后台前端所有 admin 调用经网关 `:12001` 把 HTTP/xrpc 转 gRPC。
- 反馈详情（`GetFeedbackDetail`）返回的 `FeedbackAttachment.url` 由 admin 拼装：`feedback_files.public_base_url + /api/v1/feedback-files/{file_id}`（部署值 `http://106.52.77.108`）。
- ⚠️ 源码位置：`/root/sproj/starland/apps/admin`（deploy-hy）。

---

## 3. 前端管理后台（`E:\sfront`）

- 技术栈：React 18 + TypeScript + Vite + shadcn/ui + Tailwind。
- 部署目标：`develop-tg:/opt/starland-admin-web`（构建产物 `dist/` → scp → `openresty -s reload`）。
- 后端调用统一走**网关** `/startlandapi`（生产：页面同源，由 openresty 反代到 47.120.10.73:12001）。
- 文件请求走 `/api/v1`，生产下 `VITE_FILE_API_BASE` 置空 → 相对路径，跟随页面 origin（规避跨域/混合内容）。
- 网关信封：`{com:{jwt_token}, req:{module, method, params}}`，module 固定 `starland.admin.com`，响应 `{code,msg,data}`；int64/uint64 以十进制字符串传输。

---

## 4. 服务间调用拓扑

```
[C 端用户 / 管理员浏览器]
        │  https://106.52.77.108 (openresty 443)  或  http 80
        ▼
┌──────────────────────────────────────────────────────────┐
│ develop-tg (106.52.77.108)                                  │
│  openresty :80/:443                                         │
│    /                       → /opt/starland-admin-web (前端静态)
│    /startlandapi           → 反代 → 网关 47.120.10.73:12001
│    /api/v1/app-releases (GET 下载)  → MinIO :9000 (匿名)
│    /api/v1/app-releases (POST 上传) → fileupload :8080
│    /api/v1/log-files (*)            → fileupload :8080
│    /api/v1/feedback-files (*)       → fileupload :8080 (ownerRestricted)
│    /internal/*                       → return 404 (公网禁入)
│  fileupload :8080   (公网 listener；RequirePermission 仅标记)
│  fileupload :8081   (内部 listener, loopback-only, 无鉴权)
│  MinIO :9000        (bucket=fileupload；app-releases/* 匿名, logs/·feedback-files/ 私有)
└───────────────────────────┬──────────────────────────────┘
                            │  /startlandapi  (HTTP→gRPC, 边缘 JWT 校验)
                            ▼
┌──────────────────────────────────────────────────────────┐
│ develop-hy (47.120.10.73)                                   │
│  网关 :12001  (HTTP/xrpc → gRPC；路由 starland.admin.com → :8050)
│    内部 gRPC 转发:                                          │
│      login=8010  feedback=8060  starcore=8030               │
│      order=8040  vfcode=8020  uidflake=7010                 │
│  admin :8050 (gRPC, 127.0.0.1 only)  ← 仅网关 gRPC 可达     │
│  MySQL starlandbd :3136                                     │
└──────────────────────────────────────────────────────────┘
```

要点：
- **admin 是 gRPC 服务，不直接暴露公网**；唯一入口是 develop-hy 网关把 HTTP/xrpc 转 gRPC 到 `:8050`。
- 前端静态站、文件上传/下载、日志下载的"前门"都在 develop-tg 的 openresty，由它分流到 MinIO / fileupload 公网 listener / 远端网关。
- fileupload 有**两个 listener**：公网 `:8080`（带鉴权、ownerRestricted）与内部 `:8081`（loopback-only、无鉴权、`ownerRestricted=false`）。openresty 对 `/internal` 直接 `return 404`，所以**内部取图接口只能本机访问，公网与跨机（admin 在 develop-hy）均不可达**。
- 诊断日志走 `log-files`（fileupload 私有），安装包下载走 `app-releases`（MinIO 匿名读），反馈图片走 `feedback-files`（fileupload 私有，**ownerRestricted**）——三者不同存储前缀、不同鉴权要求。

---

## 5. 账号与鉴权

### 5.1 JWT 体系
- **签发方**：Login 服务（develop-hy:8010）。access token 默认有效期 **1h**，含 `exp / nbf / iat / sub(=用户ID)`。
- **网关边缘校验**：从请求体 `com.jwt_token` 读取 JWT；密钥 `jwt.key = starlandttfuo101`。
- **文件服务校验**：标准 HTTP 头 `Authorization: Bearer <token>`；密钥 `JWT_SECRET = starlandttfuo101`（与网关同一值）。
- **前端调用 admin**：信封 `com.jwt_token` 带管理员 token；调用 fileupload 用 `Authorization: Bearer`。

> ⚠️ 两个密钥当前为同一明文值 `starlandttfuo101`，属开发/联调密钥，生产应轮换并通过 Secret/配置注入，勿入源码。

### 5.2 发布账号白名单
- `PublishAppVersion` 内部校验 operator 的 email/uid，**仅 `ygliu_csdn@163.com` 可发布**（依据 token.md 第 195 行）。
- 前端字段全对也可能被后端以"非白名单"拒绝，非前端可控。

### 5.3 管理员角色
- ⚠️ `LoginResponse` **无 role 字段**；前端当前用 JWT 解码做**兜底占位**判定管理员，需后端明确下发 role 后才算权威。

---

## 6. 关键业务链路

### 6.1 版本发布（两段独立）
1. **上传安装包**：浏览器 → openresty `/api/v1` → fileupload `POST /api/v1/app-releases`（带**用户** token）。返回 `file_id/file_kind/filename/size/sha256/created_at/request_id`（**不含** platform/package_type）。前端用表单所选 platform/packageType 转发给 admin。
2. **发布登记**：浏览器 → openresty `/startlandapi` → 网关（边缘 JWT 校验）→ admin `PublishAppVersion`。
3. **下载安装包**：`GET /api/v1/app-releases/{file_id}` 为公开接口，openresty 直连 MinIO（匿名读）。

### 6.2 诊断日志
- 上报：`POST /api/v1/log-files`（C 端，fileupload 私有，需 token）。
- 下载：管理后台 `GET /api/v1/log-files/{file_id}`（fileupload 私有，需 token）。前端以 `fetch + Authorization + blob` 本地下载（不能用 `window.open`，新标签页不带 JWT）。

### 6.3 管理后台读/写（admin）
- 所有管理操作经网关 `/startlandapi` → admin :8050，module `starland.admin.com`。
- 高风险写操作（套餐/代理/订阅/共享权益/订单重试等）需带 `client_request_id`（幂等键）+ `operation_reason`（操作原因），并多用 `revision / expected_revision` 乐观锁。

### 6.4 反馈图片链路与「取图 404」根因（[2026-10-28] 读源码精确定位）

#### 协议接口（fileupload）
| 接口 | listener | 鉴权 | owner 限制 | 说明 |
|---|---|---|---|---|
| `POST /api/v1/feedback-files` | 公网 :8080 | `feedback-files:upload`（标记不拦截）+ Bearer | — | C 端上传；`ObjectPrefix=feedback-files`，写入 MinIO key=`feedback-files/{uuid}`，`metadata[Status]=pending`，`file_kind=feedback-image` |
| `GET /api/v1/feedback-files/:file_id` | 公网 :8080 | `feedback-files:download` + Bearer | **ownerRestricted=true** | 仅文件 owner 本人可下载；非 owner → `FILE_NOT_FOUND(404)` |
| `GET /internal/feedback-files/:file_id` | 内部 :8081（loopback） | 无 | `ownerRestricted=false` | 仅供本机 service 调用；openresty 对 `/internal` 返回 404，公网/跨机不可达 |

- 关键类型：fileupload `model.FileKindFeedback = "feedback-image"`（**kind 字符串**）；但存储 `ObjectPrefix = "feedback-files"`（**key 前缀**）——二者不同，不要混淆。
- 上传 `uploadFeedback()` 把整图读入内存做 JPEG/PNG/WebP 校验（≤10MiB、最长边≤2048px），落盘到 `feedback-files/{uuid}`，**不写任何独立元数据表**，只靠 MinIO object metadata。

#### admin 如何返回附件
- `admin/service/feedback_files.go::attachFeedbackFileURLs(ticket)`：若 `feedback_files.public_base_url` 非空且附件 `file_kind=="feedback-image"`，则 `attachment.Url = public_base_url + "/api/v1/feedback-files/" + file_id`。
- 部署值 `feedback_files.public_base_url = "http://106.52.77.108"` → 前端拿到的 `url` 指向**公网 ownerRestricted 接口**。
- ⚠️ **admin 没有任何 relay / 内部取图逻辑**：它不调用 fileupload 的 `/internal`，也不把图片字节回传前端，只拼一个公网 URL。

#### 管理后台取图 404 的精确根因
1. 图片由 **C 端用户上传**，`Owner-Uid` = 终端用户 id，存于 MinIO `feedback-files/{uuid}`（已用 boto3 实测：对象存在、合法 JPEG ✅）。
2. 管理后台用**管理员 token** 请求 `GET /api/v1/feedback-files/{uuid}`（无论前端直接 `<img src=url>` 还是带 token `fetch` 取 blob，都是打这个公网接口）。
3. fileupload `Download()` 对 feedback 类型设 `ownerRestricted=true`，校验 `OwnerUID(object) == principal.UserID`；**管理员 ≠ 上传用户 → 直接返回 `FILE_NOT_FOUND(404)`**。
4. **internal 取图接口（ownerRestricted=false）本可绕过 owner 校验，但它在 loopback :8081 且 openresty 对 `/internal` 返回 404 —— admin（develop-hy）跨机不可达；且 admin 代码根本没去调它。**

> 结论：**这不是前端 bug，也不是文件丢失，而是后端「反馈图片取图权限模型」对 admin 场景缺失**。owner 限制对 C 端"用户看自己的图"是对的，但 admin 要审别人的反馈图时没有可用通道（公网接口被 owner 卡死，内部接口跨机不可达，admin 又没做 relay）。`metadata[Status]=pending` 与 404 无关（Download 不查 Status）。

#### 修复方向（后端）
- **✅ 方案 A 已实施并上线（2026-10-28）**：fileupload 公网 `GET /api/v1/feedback-files/:file_id` 增加「服务 token 免 owner 校验」分支——`config.ServiceToken`（env `SERVICE_TOKEN`）+ handler `serviceTokenBypassesOwner`（比对请求头 `X-Service-Token`，`crypto/subtle.ConstantTimeCompare`），**仅 feedback handler** 开启 `allowServiceBypass=true`，logs/releases handler 仍为 false（保持 owner 隔离）。该接口仍要求 Bearer，旁路仅在携带正确服务令牌时生效。前端 `fetchFeedbackImageBlob` 额外带 `X-Service-Token`（值来自 `VITE_FILE_SERVICE_TOKEN`，与 fileupload `SERVICE_TOKEN` 一致，已编入 bundle）。验证见 `tools/_verify_bypass.mjs`：真实 file_id 下「仅 Bearer→404 / Bearer+正确 token→200 image/jpeg / Bearer+错误 token→404 / 无 token→401」。
- **方案 B（未采用）**：admin 后端新增 relay 端点。因 admin 在 develop-hy、fileupload 内部在 develop-tg loopback，跨机仍不可达，且方案 A 已解决，故未实施。
- 前端侧已就绪（带 token + 服务令牌取 blob），**后端修通取图通道后无需改前端即可出图**——本期已验证。

---

## 7. ⚠️ 待核对 / 风险项

- **admin 回查 file_service**：api.md §5 称"不再回查文件服务"，但 admin 代码仍会 `HEAD /api/v1/app-releases/{file_id}` 回查（默认 `127.0.0.1:8061`，未配置 `file_service` 段时），可能因 403 导致发布失败。需后端配通 `file_service.service_token` 或改代码。
- **admin 启动配置**：`app_release.public_base_url` 须为 **HTTPS origin**，否则 admin 启动报错。
- **自签名证书**：CN/SAN = `106.52.77.108`；若用户以 HTTP 访问页面，写死 HTTPS 文件基址会触发跨域/混合内容（前端已用相对路径规避）。建议换 CA 证书（如腾讯云免费证书绑域名）。
- **审计/操作日志**：后端已建 `t_admin_audit_log` 表并由 `audit.go` 写入，但 **admin.proto 未暴露 `ListAuditLogs` 查询 RPC** —— 当前"只写不读"，前端无操作日志页面（功能缺口，非 bug）。
- **角色判定兜底**：见 §5.3，非权威。
- **订单状态取值**：网关下行小写字符串（paying/paid/.../manual_review 等），联调时需确认线上是否仍为小写。
- **反馈图片 admin 取图通道缺失（[2026-10-28] 已定位根因，同日已修复）**：原因为 fileupload 公网 `GET /api/v1/feedback-files/:file_id` 对 feedback 类型 `ownerRestricted=true`，仅文件 owner（C 端用户）可下载；admin 取别人图必 `FILE_NOT_FOUND(404)`。内部 `/internal/feedback-files/:file_id`（`ownerRestricted=false`）在 loopback :8081 且 openresty 对 `/internal` 返回 404，跨机不可达；admin 也未做 relay。→ 已于 2026-10-28 实施方案 A（`X-Service-Token` 免 owner 校验，仅 feedback handler 开启）修复并验证，详见 §6.4。

---

## 8. 服务器账号与部署依赖（⚠️敏感·本地专用）

> 本节含账号与内部地址，仅限本地运维参考。**不写入任何明文密码/密钥值**；两台机器 root 密码曾于联调对话中暴露，建议立即轮换并存入私有密钥库，本文件只记账号与地址。

### 8.1 登录账号
| 主机 | SSH 别名（`~/.ssh/config`） | 地址 | 系统账号 | 认证 |
|---|---|---|---|---|
| develop-hy | `develop-hy` | 47.120.10.73 | `root` | SSH key |
| develop-tg | `develop-tg` | 106.52.77.108 | `root` | SSH key |

- 远端服务进程尽量以**非 root** 专用账号运行（如 fileupload 由 `fileupload` 用户经 systemd 启动）；仅 SSH 登录与源码/部署目录操作用 `root`。

### 8.2 部署依赖矩阵
- **openresty (develop-tg)**：反代 fileupload `:8080`、远端网关 `47.120.10.73:12001`、MinIO `:9000`（匿名读 `app-releases/`）；托管前端静态站 `/opt/starland-admin-web`；对 `/internal/` 强制 `return 404`。
- **fileupload (develop-tg)**：依赖 MinIO（127.0.0.1:9000，bucket `fileupload`，凭据在 `/opt/fileupload/config/fileupload.env`）、`JWT_SECRET=starlandttfuo101`；`SERVICE_TOKEN` 用于反馈图跨 owner 旁路（仅 feedback handler）；双 listener `:8080` 公网 / `:8081` loopback。
- **网关 gateway (develop-hy)**：依赖 login `:8010`（JWT 校验）、admin `:8050`（gRPC）、MySQL `starlandbd:3136`；边缘 JWT 密钥 `starlandttfuo101`。
- **admin (develop-hy, gRPC :8050)**：依赖 MySQL、网关转发；回查 fileupload（默认 127.0.0.1:8061，未配 `file_service` 段时可能 403，见 §7）；启动要求 `app_release.public_base_url` 为 HTTPS origin。
- **login (develop-hy)**：依赖 MySQL，签发 JWT（默认 1h）。
- **前端 (E:\sfront)**：依赖网关 `/startlandapi`（admin 调用）、fileupload `/api/v1`（文件/反馈图，生产相对路径）、`VITE_FILE_SERVICE_TOKEN`（须与 fileupload `SERVICE_TOKEN` 一致）。

### 8.3 关键配置 / 凭据落点
- fileupload 运行配置：`/opt/fileupload/config/fileupload.env`（MinIO 凭据、SERVICE_TOKEN；改前已备份 `.bak`）。
- 源码：fileupload `/root/fileupload`（非 git 库，改前 4 文件 `.bak`）；admin `/root/sproj/starland/apps/admin`。
- 前端环境：`E:\sfront\.env`（`VITE_*` 变量，已 git 忽略）。

---

## 9. 中转节点管理与用户固定分配（2026-10-29 前端对齐 admin.md §12 / plan.md §14）

### 9.1 节点管理页 `/data-plane-nodes`
- 列表双状态列**独立展示**：`runtime_status`（unknown/online/offline → 从未连接/在线/离线）与 `scheduling_status`（active/draining/isolated/disabled → 参与调度/排空/已隔离/已禁用）；`enabled=false` 额外显示高风险「已停用」。**前端不根据客户端时间自推在线/离线**（以服务端 `runtime_status` 为准）。
- 其余列：公网地址 `advertise_host`（空显示「未配置」）、最近心跳 `heartbeat_at`（相对时间+悬浮绝对）、启动时间 `started_at`、离线信息 `offline_at`/`offline_reason`（仅离线显示）、只读「可分配」派生提示（启用+在线+参与调度+心跳有效+已配置公网地址）。
- 每 **15 秒静默轮询** `ListDataPlaneNodes`：不关弹窗、不闪全屏、失败保留上次数据并显示顶部非阻塞错误+重试。
- 操作：编辑、隔离/恢复、停用/启用、轮换密码（隔离/停用/轮换均带影响说明与二次确认）；创建/轮换密码以一次性弹窗展示明文（关闭后不可再查）。
- 编辑弹窗含 `display_name`/`enabled`/`advertise_host`/`scheduling_status`；切到 `active` 时 `advertise_host` 必填且须为纯 IP/域名（禁协议/端口/空格/?/#）。

### 9.2 用户固定分配页 `/users/relay/:uid`
- 经 `GetUserRelayAssignment` 读取、`SetUserRelayAssignment` 保存（`node_id` 空串=清除固定关系）。
- 两种互斥模式：**自动分配**（HRW 在健康节点中分配）/ **固定到指定节点 + `allow_fallback` 开关**（不可用时是否回退到自动分配）。
- 节点下拉**列出全部节点**（离线/隔离仍可选并提示风险，避免已固定但离线的节点从表单消失）；严格固定到不可用节点前强制风险提示。保存后重新查询确认。

### 9.3 后端字段与协议
- `t_dataplane_node`（admin.proto `DataPlaneNode`）：`node_id, display_name, enabled, advertise_host, runtime_status, scheduling_status, started_at, heartbeat_at, offline_at, offline_reason`（`last_seen_at` 保留为历史字段）。
- `t_user_relay_assignment`：`uid, node_id, allow_fallback` + 审计字段。
- `GetLinks` 分配规则（plan.md §14.4）：固定节点优先；`allow_fallback=false` 且节点不可用→返回暂无可用节点；否则 HRW 在健康节点集合中选择；固定配置约 15 秒同步到 Starcore 内存。
- RPC：`ListDataPlaneNodes / CreateDataPlaneNode / UpdateDataPlaneNode / RotateDataPlaneNodePassword / GetUserRelayAssignment / SetUserRelayAssignment`，全部经网关 `starland.admin.com`。
