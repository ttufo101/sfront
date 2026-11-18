# Starland 管理后台前端 — 项目长期约定

> 事实源：`E:\sfront\release-center.md`（**应用发布中心唯一有效方案 §13.16；落地出口声明式改造 §14，含 §14.7 执行记录 / §14.8 删除 / §14.9 出口页体验**）+ 冻结契约 `admin-contract.ts` / `deployer-contract.ts` + proto。本文件只留跨会话硬约定与排障要点，历史执行细节查方案文档。

## 技术栈与目录
- React 18 + TS + Vite + shadcn/ui 2.x + Tailwind 3.4 + react-router-dom；数据获取自研 useXrpcQuery/useXrpcMutation（无 TanStack Query）。primary=#0052D9。
- `src/features/<domain>/{api,components,pages}`、`src/lib/xrpc`(transport/contract/mock/hooks)、`src/app`、`src/components/ui`。依赖 app→features→components/lib；页面禁止直接 fetch 或手写信封。

## 网关协议（gateway-protocol 唯一事实源）
- HTTP POST，信封 `{com, req:{module,method,params}}`，响应 `{code,msg,data}`；后台 `/startlandapi`，module `starland.admin.com`（登录 `starland.login.com`，发布 `starland.deployer.com`）。
- int64/uint64 = 十进制字符串、字段 lower-camel、data 为 native-json 不二次解析。冻结契约在 `src/lib/xrpc/admin-contract.ts` + `deployer-contract.ts`，页面不得自维护第二套清单。
- 待与后端对齐：admin.proto int64 标 JS_NUMBER 与字符串约定冲突；LoginResponse 无 role（JWT 解码兜底）；GetUserSubscriptions 响应字段名暂定。

## 环境 / 构建 / 部署
- `.env`：`VITE_API_BASE`(空=同源反代)、`VITE_USE_MOCK`、`VITE_FILE_API_BASE`、`VITE_FILE_SERVICE_TOKEN`；dev vite proxy `/startlandapi`→API_BASE、`/api/v1`→文件服务(106.52.77.108:80)。
- 部署目标 = develop-tg `/opt/starland-admin-web`（**不是** openresty html 目录）：`cd dist && scp -r . develop-tg:/opt/starland-admin-web/ && ssh develop-tg "systemctl reload openresty"`（非交互 SSH 的 PATH 无 `openresty` 命令）。前端先传 assets 最后传 index.html。
- 校验用 `npx tsc --noEmit && npx vite build`，**勿用 `npm run build | tail`**（退出码恒 0 掩盖失败）。
- 沙箱 safe-delete：`npm i` 回滚会拦掉平台原生包（@esbuild/win32-x64、@rollup/rollup-win32-x64-msvc）且会 prune 已装依赖，**勿用 `npm i` 修复**，用 `npm pack` + `tar -xzf --strip-components=1` 补回（rollup 4.63.2 / esbuild 0.21.5）。原理是 Python sitecustomize hook 拦 `shutil.rmtree`/`os.remove`，rm/del/Python 删除均被拦；真删需 ctypes 直调 kernel32，仅在用户明确授权时用。

## 后端拓扑与排障
- 47.120.10.73(develop-hy)：网关+微服务+MySQL(starlandbd:3136)，对外 `0.0.0.0:12001` 收 `/startlandapi`；106.52.77.108(develop-tg)：文件服务(:80, openresty 前置)+MinIO。
- 端口：admin 8050 / feedback 8060 / login 8010 / starcore 8030 / order 8040 / vfcode 8020 / uidflake 7010 / deployer 8080。网关加 module：config.yaml 顶部加 `starland.deployer.com: {mod: ip, network: grpc, addr: 127.0.0.1:8080, timeout: 10s}` + `api:` 分组加 method 白名单，重启网关生效。
- 网关 `internal/server/deadline.go` 15s 超时 → 长任务必须异步（Start/Get/List + 任务表）。**网关→deployer HTTP client 是 10s**，`StartDeploy` 链路禁止任何 SSH；批次创建只做纯本地校验，基线铺底/形态复验放异步 worker fail-closed。
- 鉴权：网关 JWT `jwt.key` 与文件服务上传 JWT `JWT_SECRET` 同一密钥；管理员取反馈图/诊断日志需 `X-Service-Token`(=`VITE_FILE_SERVICE_TOKEN`)，fileupload 仅对 feedback/logs 开 `allowServiceBypass`。
- 应用版本发布：上传 `POST /api/v1/app-releases`（用户 token，不经网关）→ `file_id/filename/size/sha256`；登记 `PublishAppVersion` 时 `file_name/package_size_bytes/package_sha256/package_type` 必须从上传返回转发；下载 `GET /api/v1/app-releases/{file_id}` 公开。macOS 仅 dmg。
- SSH：develop-hy / develop-tg 走 `~/.ssh/config`；login/gateway 用 systemctl，其余 `/opt/<svc>/setup.sh`。**落地机 SSH 直连全被拒**，只有 deployer 内存中的 ed25519 纳管私钥能连；只读勘查用临时 Go 程序复用 `executor.NewSSHExecutor` + `store.GetNode()`，私钥绝不落盘。
- 数据面写操作前必先 `ListDataPlaneNodes` 取实时状态；`RotateDataPlaneNodePassword` 会立即使在线节点失效。
- 上线手法：新二进制写 `<binary>.new` 后 `mv -f` 原子替换（避免 Text file busy）；deployer `/opt/deployer/setup.sh restart`；fileupload `systemctl restart fileupload`。develop-hy glibc 2.32 二进制可在 develop-tg glibc 2.39 跑（先 `ldd`）。
- 排障：`WriteFile` 必须 `mkdir -p` 父目录；`restart_cmd=none`=不重启；`artifact_cache_dir` 是死配置；`t_operation_batch` 3 条历史纳管批次与 6 条历史任务不要清空。60MB+ ELF 曾因 `http.Client.Timeout=60s` 在下载阶段截断，已放宽 client 10min / itemCtx 15min；`ArtifactClient.fetch()` 对 `unexpected EOF` 最多 3 次 GET 重试（2s/4s），sha mismatch / ctx 取消不重试。**mihomo 构建**必须按 Makefile `-tags with_gvisor -trimpath -ldflags '-w -s'`，默认 `go build` 缺 TUN 栈不能上线。
- 反馈图片：`AttachmentGallery` + `fileApi.fetchFeedbackImageBlob`（管理员 Bearer + X-Service-Token）；根因是 fileupload 对 feedback 类型 `ownerRestricted=true`。登录页密码框有显隐切换。

## 部署策略（当前口径）
- **用户 11-16 最新口径（覆盖 11-15 的兼容约定）**：系统未真实上线、无真实用户，实施**不用考虑兼容性和线上稳定性**，可删除无效代码/配置。11-15「需考虑旧版本兼容」作废。
- 用户 11-13：后续所有包/组件发布走管理后台；`/root/sproj/AGENTS.md` 的「Mihomo 人工发布 / 未经明确要求不发布远端服务」是旧约定。**deployer 不可发布自身**（deploy-one.sh 会 stop 自杀）。
- **防火墙（用户硬口径）**：不读/不生成/不改 ufw 与 nft 白名单，人工处理；已清的只有 `hysteria_*` redirect 残留表。

## 应用发布中心（§13.16，唯一有效方案）
- 事实源 `release-center.md` §13.16（§13.1–§13.15 均为 11-15 历史，冲突以 §13.16 为准）+ `deployer.proto` + `deployer-contract.ts`。
- **模型**：`app_key` = 目录名 = 二进制名 = unit 名来源；启动命令可编辑（首段须 == app_key，token 白名单，禁 `%`/元字符）；`requires_identity` 显式开关；`//go:embed assets/setup-service.tpl.sh` 由 worker **每台每次部署重新渲染覆盖** `/opt/<key>/setup.sh`（派生物，不能「存在即跳过」）。
- 身份：mihomo fork 自读 `/etc/starland/node-identity`（0600、fail-closed）；`ConfirmBootstrap` 生成 32B 明文 → bcrypt 写 `t_dataplane_node` → SSH 写身份文件，幂等+失败回滚。**`issueNodeIdentity` 必须保留**（纳管签发复用）；`InitNodeIdentity` RPC 与 `LifecycleCommand` 的 `systemd:` 分支 / `safeUnitPattern` 已于 11-17 删除。
- 统一约定：`/opt/<app_key>/{<app_key>, conf/config.yaml, conf/server.crt, conf/server.key, setup.sh, log/}` + `/etc/systemd/system/starland-<app_key>.service`；生命周期只留 `script:/opt/<app_key>/setup.sh`（常驻 unit）。生产应用定义 2 条：`mihomo`(relay, `mihomo -d ./conf`, identity=1) / `hysteria`(landing, `hysteria server -c conf/config.yaml`, identity=0)。
- 制品：用户直传 ELF（按 `\x7fELF` magic 判定），内部不打包；worker 写 `.new` 后 `mv -f`；按 `bin_filename` 后缀保留 `.tgz/.zip` 解压分支供 rollback。
- **应用级 TLS（§13.16.8）**：证书属于应用定义、不随版本变；只存 `file_id+sha256`，明文在独立 MinIO 前缀 `deployer-secrets/`（GET 仅 `X-Service-Token`，上传走管理员 JWT + `deployer-secrets:upload`）；worker 落盘固定 `conf/server.crt`(0644)/`conf/server.key`(0600)，半套 fail-closed、两份拉齐校验 sha 后才写；不配=不下发也不删本机文件。编辑三态：不传=保持 / `tls_cert`=替换 / `clear_tls_cert=true`=移除。创建/编辑只校验元数据不拉内容（守 10s）。

## 落地出口声明式改造（§14，S0–S7 于 11-17 完成）
- 事实源 `release-center.md` §14（执行记录 §14.7 / 删除 §14.8 / 出口页体验 §14.9）+ `libs/proxyrender/render.go` + admin.proto 六个出口 RPC + 前端 `admin-contract.ts`。
- **模型**：`port` 唯一主键（`t_proxy_outlet`）；`t_proxy_runtime_config` 单行存 `26019-26078` 池、`landing_port=26019`、共享口令、relay/client 基础模板、digest、`revision`（乐观锁）。中转 = 1 条范围 listener `port: 26019-26078` + 每端口 `IN-PORT,<port>,<outbound>`（未分配→`REJECT`，末尾 `MATCH,DIRECT`）；范围 listener 下 `InName` 共用，`IN-NAME` 已弃用。落地 hysteria 只听 UDP `:26019`；`GetLinks` 每次渲染注入 listed 出口。
- **半自动发布**：`PreviewProxyChange` 纯内存渲染 + dry-run + diff（零写）→ 人工确认 → `PublishProxyChange` 校验 `expected_digest` 后 `ReplaceProxyOutlets`（事务内全表 DELETE + 只 INSERT 保留项）+ 建 `config_only` 版本（内联配置、继承 stable 的 ELF 四字段、worker 跳过写 ELF）+ `StartDeploy` 批次 + 轮询。`is_stable` 已修为每应用唯一。
- **下架 ≠ 删除**：`SetOutletListing` 只改 `listing_status`；`buildRelay` 用 `byPort`（全部声明、不看 `Listed`），故中转规则不变、旧客户端仍能连，`RelayDigest`/`LandingDigest` 也不变 → 不发批次。要 DB 不保留必须草稿删行→预览→发布，端口变 `REJECT` 并触发 1 个 mihomo 批次（§14.8）。
- **只改展示名/SNI 同样是零批次**：`buildRelay` 只用 port + node_id（outbound SNI 是常量），`buildLanding` 不含 outlets；region/sni 只进 `InjectClient`。11-17 零写实测 `relay_digest_same=true` / `landing_digest_same=true` / `total_digest_changed=true`（须重新预览取 digest）、订阅新名字出现旧名字消失。已上架行的展示名本来就可编辑，不需重新上架（§14.9）。
- **出口页（11-17 15:20）**：落地机下拉统一只显示 `public_ip`（node_id 过长会撑破容器），完整 `node_id · public_ip` 放 `SelectItem.title`；表格 `table-fixed min-w-[1000px]` + 固定列宽 + `SelectValue truncate` + `Badge whitespace-nowrap`。`display_name` 全链路已通但台账值不统一，用户选择不动数据。
- **公网可达**：11-17 15:09 用户人工重新设置防火墙，实测两台中继 `26019-26078` 全 60 端口 TCP 可达、26025 TLS 握手与端到端 delay 正常；历史拦点在主机之外的云安全组/上游 ACL（改 ufw 无效）。新增中继节点或扩池超出该段仍需人工确认。
- **策略组名（§14.10，11-17 16:00）**：`t_admin_proxy_config.content` 里 `urltest`→「自动选择」、`flback`→「故障转移」（各 2 处：组定义 + `Proxy` 静态引用），revision 3→4。名字只在模板里、`InjectClient` 不认组名 → 纯数据变更、零批次、订阅即时生效。前端 `validateProxyConfig.ts` 改为按 `type` 校验骨架，不再硬编码名字。多语言口径：YAML `name` 是配置标识符不是 UI 文案；推荐「模板占位符 + `GetLinks` 带 `lang` + 节点级替换」，digest 必须与语言解耦、替换覆盖 name/静态引用/rules target、出口 `region` 也要 locale map；**方案 B 未实施**。
- 终态（15:20）：3 条出口 `26020 JP` / `26022 US` / `26025 UK` 全 listed 且全部可用、revision 10、每台中继 60 socket/60 规则、3 台落地 UDP 26019、4 控制面服务 active。一次性探针/补丁/明文私钥副本与本地 `.tmp_outlet` 已清。

## 遗留 P2
- **凭据轮换（§13.15，最紧迫）**：git 提交 `e092547` 含明文 `X-Service-Token` 与 4 个诊断脚本里的管理员明文密码，工作区已删但历史仍在；必须轮换管理员密码与 service token（同步 `.env` / fileupload / deployer）。生产证书私钥在 `deployer-secrets/`，该前缀仅靠 service token 保护。
- 落地机 `config.yaml` 含明文 `auth.password`，用户明确选择保留，记为已知风险。今后不得把凭据写进脚本/仓库。
- 13 个孤儿制品与历史前端 bundle 待清理。
