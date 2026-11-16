# Starland 管理后台前端 — 项目长期约定

> 详细方案与实施记录以 `E:\sfront\release-center.md`（**当前唯一有效方案 = §13**）为准；本文件只留跨会话仍有效的硬约定与排障要点。

## 技术栈与目录
- React 18 + TS + Vite + shadcn/ui 2.x + Tailwind 3.4；react-router-dom；数据获取自研 useXrpcQuery/useXrpcMutation（无 TanStack Query）。primary=#0052D9。
- `src/features/<domain>/{api,components,pages}`；`src/lib/xrpc`(transport/contract/mock/hooks)；`src/app`；`src/components/ui`。依赖方向 app→features→components/lib；页面禁止直接 fetch 或手写信封。

## 网关协议（gateway-protocol 唯一事实源）
- HTTP POST，信封 `{com, req:{module,method,params}}`，响应 `{code,msg,data}`；后台路径 `/startlandapi`，module `starland.admin.com`（登录 `starland.login.com`，发布中心 `starland.deployer.com`）。
- int64/uint64=十进制字符串、字段 lower-camel、data 为 native-json 不二次解析。冻结契约 `src/lib/xrpc/admin-contract.ts` + `deployer-contract.ts`，页面不得自维护第二套清单。
- 待与后端对齐：admin.proto int64 标 JS_NUMBER 与字符串约定冲突；LoginResponse 无 role（现 JWT 解码兜底）；GetUserSubscriptions 响应字段名为暂定。

## 环境/构建/部署
- `.env`：`VITE_API_BASE`(空=同源反代)、`VITE_USE_MOCK`、`VITE_FILE_API_BASE`、`VITE_FILE_SERVICE_TOKEN`。dev vite proxy `/startlandapi`→API_BASE、`/api/v1`→文件服务(106.52.77.108:80)。
- 部署目标 = develop-tg `/opt/starland-admin-web`（**不是** openresty html 目录）；`cd dist && scp -r . develop-tg:/opt/starland-admin-web/ && ssh develop-tg "openresty -s reload"`。
- 沙箱 safe-delete：`npm i` 回滚会拦掉平台原生包（@esbuild/win32-x64、@rollup/rollup-win32-x64-msvc），且装新依赖会 prune 掉已装的。**勿用 `npm i` 修复**，用 `npm pack` + `tar -xzf --strip-components=1` 只写补回（rollup 4.63.2 / esbuild 0.21.5）。校验用 `npx tsc --noEmit && npx vite build`，勿用 `npm run build | tail`（退出码恒 0 掩盖失败）。
- safe-delete 原理：Python sitecustomize hook `shutil.rmtree`/`os.remove`；rm/del/Python 删除均被拦，真删需 ctypes 直调 kernel32，仅在用户明确授权时用。

## 后端拓扑与排障
- 47.120.10.73(develop-hy)：网关+微服务+MySQL(starlandbd:3136)，对外 `0.0.0.0:12001` 收 `/startlandapi`。106.52.77.108(develop-tg)：文件服务(:80, openresty 前置)+MinIO。
- 端口：admin 8050 / feedback 8060 / login 8010 / starcore 8030 / order 8040 / vfcode 8020 / uidflake 7010 / deployer 8080（8010–8070 已占满）。网关加 module：config.yaml 顶部加 `starland.deployer.com: {mod: ip, network: grpc, addr: 127.0.0.1:8080, timeout: 10s}` + `api:` 分组加 method 白名单，重启网关生效。
- 网关 `internal/server/deadline.go` 15s 超时 → 长任务必须异步（Start/Get/List + 任务表）。
- 鉴权：网关 JWT `jwt.key` 与文件服务上传 JWT `JWT_SECRET` 同一密钥；管理员取反馈图/诊断日志需带 `X-Service-Token`（= `VITE_FILE_SERVICE_TOKEN`），fileupload 仅对 feedback/logs handler 开 `allowServiceBypass`。
- 应用版本发布：上传 `POST /api/v1/app-releases`（用户 token，不经网关）→ `file_id/filename/size/sha256`；登记 `/startlandapi`→`PublishAppVersion`（`file_name/package_size_bytes/package_sha256/package_type` 必须从上传返回转发）；下载 `GET /api/v1/app-releases/{file_id}` 公开，openresty 直连 MinIO。发布账号白名单在后端；macOS 仅 dmg。
- SSH：develop-hy / develop-tg 走 `~/.ssh/config`；login/gateway 用 systemctl，其余用 `/opt/<svc>/setup.sh`。**落地机（45.32.20.165 / 47.251.121.91）SSH 直连全被拒**，只有 deployer 内存中的 ed25519 纳管私钥能连；只读勘查用临时 Go 程序复用 `executor.NewSSHExecutor` + `store.GetNode()`，私钥绝不落盘。
- 数据面节点：写操作前必先 `ListDataPlaneNodes` 取实时状态；`RotateDataPlaneNodePassword` 会立即使在线节点失效，优先选明确 disabled 节点；误转须改 config.yaml `node-password` 并重启（**需授权**）。
- 反馈图片：`AttachmentGallery` + `fileApi.fetchFeedbackImageBlob`（管理员 Bearer + X-Service-Token）；根因是 fileupload 对 feedback 类型 `ownerRestricted=true`。登录页密码框有显隐切换，失败时明文核对输入。

## 部署策略（当前有效）
- 用户 11-15 修订：开发调试阶段**需要考虑旧版本兼容**（迁移期，范围见 `release-center.md` §13.7）、**不做备份**、**可删无效代码**。11-06 的「不做兼容」约定作废。
- 用户 11-13 明确：后续所有包/组件发布走管理后台；`/root/sproj/AGENTS.md` 里「Mihomo 人工发布 / 未经明确要求不发布远端服务」是旧约定。deployer 为独立服务，**不可发布自身**（deploy-one.sh 会 stop 自杀）。

## 应用发布中心（唯一有效方案 = release-center.md §13）
- 事实源：`release-center.md` + `deployer-contract.ts` + `proto/starland/deployer.proto` + `prototype/app-release-prototype.html`。S1–S5 已完成，45.32.20.165 真实跑通 install→upgrade→rollback；§1–§12 与 §13 冲突处以 §13 为准。**§13 全链路（含 S4 四台在线迁移 + 批次验收）已于 11-15 17:50 完成，执行记录见 §13.14。**
- 身份：mihomo fork 自读 `/etc/starland/node-identity`（0600、fail-closed），`config.ParseRawConfig` 在 `ValidateConfig` 前注入；发布中心不签发/不探测/不合成/不覆盖。**纳管写入已实现（11-15 第三批）**：`ConfirmBootstrap` 首次确认后由 deployer 生成 32B 明文 → bcrypt 写 `t_dataplane_node`（node_id=台账主键）→ SSH 写身份文件；幂等 + 失败回滚 + `gateway_url` 配置化无硬编码。`InitNodeIdentity` RPC 保留为旧前端兼容入口。
- **兼容决策（与早期草稿相反，勿再按旧文档删）**：proto 不改（保留旧字段即兼容）、`LifecycleCommand` 的 `systemd:` 分支保留（兼容 DB 旧应用定义行）；已删的是 identity UI、`ReadIdentity`、`artifact_cache_dir`、并发身份探测。
- 制品：用户直传 ELF（文件服务按 `\x7fELF` magic 判定，不靠扩展名），内部不打包；worker 写 `.new` 后 `mv -f` 原子替换；按 `bin_filename` 后缀保留历史 `.tgz/.zip` 解压分支供 rollback。
- 统一约定：`/opt/<app>/{<app>, conf/config.yaml, conf/start-args, setup.sh, log/}` + `/etc/systemd/system/starland-<app>.service`；生命周期只留 `script:/opt/<app>/setup.sh`（常驻 unit，非 transient）；路径/命令由后端按 service_type 推导，前端只提交 3 项。范围 = mihomo/hysteria，控制面只换模板不搬目录。
- **状态（11-15 17:50 全链路完成）**：控制面先后三次上线（14:42 前后端同批 / 16:54 `migrationGate` 护栏 / 17:42 大制品超时修复）。**S4 四台全部迁移完成**（2 中继 + 2 落地机：身份文件 0600、统一 `setup.sh`、常驻 unit `Restart=on-failure`、纯业务模板、mihomo 新二进制），两台心跳 online、落地机 UDP 26019 在听、`gate=READY`。**冻结边界已解除，可以正常对 relay/landing 发批次**；`StartDeploy` 的护栏会在目标机形态不完整时自动 fail-closed 拒绝。详见 §13.13 / §13.14。
- 上线手法：新二进制写 `<binary>.new` 后 `mv -f` 原子替换（避免 Text file busy）；前端先传 assets 最后传 index.html；deployer 用 `/opt/deployer/setup.sh restart` 重建 transient unit；fileupload 用 `systemctl restart fileupload`；前端重载用 `systemctl reload openresty`（非交互 SSH 的 PATH 里没有 `openresty` 命令）。develop-hy glibc 2.32 编译的二进制可在 develop-tg glibc 2.39 跑（先 `ldd` 校验）。
- 已完成：纳管写入、S3 死代码清理、原型归档、上线窗口、两台明文↔DB bcrypt 离线比对（均 MATCH）、S4 单台串行迁移、3 个真实批次验收（install ELF 直写 / rollback 历史 `.tgz` / 超时修复后重验 install，终态两个批次均 `succeeded`+`health=passed`）、测试数据清理（三表 0/0/0，保留 3 条纳管批次 + 6 条历史任务 + 26 条历史审计）。剩余 P2 见 §13.14.6（大制品下发 5.5 分钟偏慢、`gateway_url` 按节点覆盖等）。
- 排障：`WriteFile` 必须 `mkdir -p` 父目录；`restart_cmd=none` = 不重启；运行中二进制用 `mv -f` 别 `cp`（Text file busy）；`artifact_cache_dir` 是死配置；`t_operation_batch` 3 条历史纳管批次与 6 条历史任务不要清空。**大制品**：60MB+ ELF 曾因 `http.Client.Timeout=60s` 在 `download artifact` 阶段被截断，已放宽 client 10min / `itemCtx` 15min，跨机实测约 5.5 分钟；超时先查下载而非误判凭据。**mihomo 构建**必须按 Makefile `-tags with_gvisor -trimpath -ldflags '-w -s'`，默认 `go build` 缺 TUN 栈不能上线。
- **凭据卫生（11-16 收尾发现）**：git 提交 `e092547` 含 65 B 明文 `X-Service-Token`（`.tmp_fu/svc_token.txt`）与 4 个 `tools/_*.mjs` 诊断脚本里的管理员明文密码；工作区文件已删但**历史仍在，必须轮换管理员密码与 service token**（同步 `.env` 与 fileupload 配置）。今后不得把凭据写进脚本 / 仓库；`tools/` 只保留通用 `feedback-file-tool.mjs`。A+B 清理记录见 `release-center.md` §13.15。
