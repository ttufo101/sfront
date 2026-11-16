# 应用发布中心 — 需求与设计定稿

> 状态：**S1–S5 已实施并完成真实下发验证**（2026-11-14，见 §12.4）；落地节点 `InitNodeIdentity` 机制已退役（§3.8 / §12.5）。**2026-11-15 起执行统一化改造，当前唯一有效方案见 §13**；§1–§12 中与 §13 冲突者以 §13 为准，历史决策保留供追溯。**§13 全链路（含控制面上线、护栏、S4 四台在线迁移、批次验收）已于 2026-11-15 17:50 全部完成，见 §13.14。**
> 事实源：本文件 + `src/lib/xrpc/*-contract.ts` + `proto/starland/deployer.proto` + `prototype/app-release-prototype.html`。页面不得自维护第二套方法清单。
> 全局约束（2026-11-15 修订）：当前为开发调试阶段，**需要考虑旧版本兼容（迁移期，范围见 §13.7）**、**不做旧版本备份**、**可以删除无效代码**。原「不做旧版本兼容」约定作废。

---

## 1. 原始需求

用户提出的 6 点粗需求：

1. 增加「服务」，属性含服务类型（中转/落地）、应用名称、应用配置文件名称、启动/重启/停止方式。
2. 服务下可创建「发布应用」，每次发布上传配置文件与应用可执行程序，版本号自动递增。
3. 有服务列表；进入单个服务显示其版本列表，含版本号、创建时间、查看配置文件、部署/升级按钮。
4. 点「部署」可指定该版本要部署到的服务器节点。
5. 点「升级」跳转到已安装该应用的服务器列表，展示 IP、服务器类型、当前部署版本。
6. 勾选服务器后升级，目标版本由用户选择。

后续多轮补充与纠偏见 §3；**回滚**作为一等能力在讨论中新增。

---

## 2. 概念澄清与数据模型

「服务」与「应用」是同一个东西，统一称 **应用定义 App**，服务类型只是它的一个属性。整体三层：

| 层 | 说明 |
|---|---|
| `App` 应用定义 | 一类服务的静态属性（启停方式、配置目标路径、制品路径等） |
| `AppVersion` 应用版本 | 每次发布产生一行，版本号自动递增，制品与配置模板创建后不可变 |
| `AppDeployment` 部署台账 | **`app_id × node_id` 唯一**，记录每台机器当前装了哪个版本，是升级/回滚列表的唯一事实源 |

第 5 点需求隐含了这张部署台账表——没有它，升级列表、重复安装判定、回滚都无从谈起。

另有三套「版本」概念必须分开，不得混用：
- 本发布中心的**服务端应用版本**；
- 客户端安装包版本（`/releases`、`PublishAppVersion`）；
- 控制面服务的部署脚本（`ops/deploy-one.sh`）。

---

## 3. 决策清单（按时间顺序，含被推翻项）

### 3.1 基础设计

| # | 决策 |
|---|---|
| 1 | 三层模型 App → AppVersion → AppDeployment |
| 2 | 应用定义与现有「控制面服务」「客户端安装包」在菜单和表上完全分离，新增一级「发布中心」 |
| 3 | 配置文件是**统一模板**，不随版本写死；身份字段不进版本 |
| 4 | 「上传可执行程序」放宽为**上传制品包**（tar.gz/zip + sha256），兼容单二进制与前端 dist |
| 5 | 启停/健康检查必须是**枚举**，后端白名单映射固定命令，禁止前端传自由文本命令或路径 |
| 6 | 部署与升级在后端是**同一个动作** `StartDeploy`，区别只在 UI 入口 |
| 7 | 版本列表**只放「部署」「查看配置」**，不放升级按钮（避免目标版本歧义） |
| 8 | 必须异步：网关 15s / deployer 10s 超时，`StartDeploy` 只入库返回 `batch_id`，前端轮询 |
| 9 | 复用现有 `t_operation_batch` / `t_node_task` / `t_deploy_audit`，不另起任务体系 |
| 10 | 节点级串行锁按 `node_id`；分批并发；排除已软删节点 |

### 3.2 回滚

| # | 决策 |
|---|---|
| 11 | 回滚是**独立 `mode=rollback`**，执行通道仍复用 `StartDeploy`，但 UI 独立入口、独立确认文案、独立任务类型 |
| 12 | **唯一回滚入口 = 已部署节点 tab**；取消「批次回滚」（任务列表「回滚此批次」）与「失败自动回滚」 |
| 13 | 目标版本**由人工统一指定一个**，不逐台覆盖、不由台账推导、不由系统自动计算 |
| 14 | 回滚**不产生新版本**，版本号仍由「新建版本」独占递增 |
| 15 | 健康检查失败**不自动回滚**，交人工判断；但台账必须如实记 `current_version = 目标版本` + `status=failed`，不得假装还在旧版 |
| 16 | 任务明细只留「重试」与「前往已部署节点回滚」跳转，不在明细里直接生成批次 |
| 17 | 逐节点校验：目标 > 任一节点当前版本 → **硬阻断整批**（这是升级，请走升级入口）；等于 → 该节点标「无需变更」跳过（全跳过则拒绝）；跨版本降级 → 软警告需确认；制品缺失 → 硬阻断 |

### 3.3 选择与交互

| # | 决策 |
|---|---|
| 18 | **选择只在列表页发生一次**；次级页面（向导）渲染**只读快照**，不给 checkbox、不新增节点。原型早期版本存在「弹窗内可再勾选导致提交集合与列表页不一致」的真实缺陷，已废除 |
| 19 | 升级向导 3 步 → **2 步**（确认范围+选目标版本 / 确认影响）；回滚向导同为 2 步 |
| 20 | 「部署」弹窗是唯一例外：从版本行点开、无上游列表勾选，保留勾选框作为唯一选择入口 |
| 21 | 部署节点选择器按 `service_type` 过滤，排除已软删节点 |
| 22 | 升级目标不允许选旧版（旧版一律走回滚入口） |
| 23 | 回滚确认页必须提示**停服重启会断开现有连接** |

### 3.4 配置、制品、范围

> ⚠️ #27 / #29 的制品形态已被 §13.3 取代（用户直传可执行程序，不再压缩解压）。

| # | 决策 |
|---|---|
| 24 | 配置**统一化管理**：版本里一份统一模板（含所有业务参数），不按节点渲染占位符 |
| 25 | 节点身份 3 行（`gateway-url` / `node-id` / `node-password`）**不进版本**，属随机器永久保留的本机状态 |
| 26 | `gateway-url` 不再强制统一（身份段整体保留即可，两台差异无需处理，线上配置不动） |
| 27 | 制品走**独立前缀 `deployer-artifacts/` + MinIO**，事实源是 MinIO；`/opt/deployer/artifacts/` 仅作下载缓存 |
| 28 | 服务端制品**不开放匿名 GetObject**，deployer 走文件服务鉴权下载 + `X-Service-Token`；跨机地址不能写 `127.0.0.1` |
| 29 | 制品按 `file_id` + sha256 固化、不可覆盖；回滚直接取历史对象，**不做整包备份** |
| 30 | `service_type` P0 只 `relay` / `landing`；`control` / `web` 后续迭代；节点来源 relay→`t_dataplane_node`，landing→`t_node_asset`，不新增映射列 |
| 31 | **不做 failed 状态门禁**：异常节点可直接发新批次，靠标红与「将覆盖现场」提示补偿 |
| 32 | **做提交漂移轻量提示**：提交带 `snapshot[{nodeId,currentVersion}]`，后端比对台账，不一致返回 `drifted_nodes`，人工确认后二次提交；**不做强乐观锁**（与客户端发布去掉 `expected_release_id` 的决策一致） |

### 3.5 首次部署的身份生成（最后一轮）⚠️ 已作废，见 §3.8 / §13.4

> 本节 33–39 的前提是「所有节点统一签发独立 identity 文件」。S5 真实下发后证明该前提对 `landing` 不成立，整套机制对落地机已退役；`relay` 侧也见 #53 遗留问题。以下仅作历史决策记录，**勿再沿用**。

| # | 决策 |
|---|---|
| 33 | 密码生成属于「**节点纳管**」，发布中心不生成、只消费本机已有的 `node-identity` 文件 |
| 34 | 一次性初始化做成**独立「初始化节点身份」按钮**（P0，显式、一次、可审计），不合并进 `StartDeploy(mode=install)` |
| 35 | hash 由 **deployer 直写同一 `starlandbd`**，不加 admin 服务间接口；抽公共包 `nodepwd` 让 admin/deployer 共用生成与校验规则 |
| 36 | 明文边界：只在 deployer 内存 + SSH 加密通道 + 目标机 `0600` 文件；**不经网关、不回前端、不进任务表/日志/DB 明文列** |
| 37 | **手工纳管路径保留为应急兜底**，但自动路径不回显明文 |
| 38 | 初始化必须**显式确认 `dataplane_node_id`**，不静默假设与 `t_node_asset.node_id` 对齐（既有约定是两者可以不对齐、不加 `external_ref` 映射列） |
| 39 | **自动/手动密码轮换后续迭代，P0 不做** |

### 3.7 实施期发现并修正（S3/S4/S5）

| # | 决策 |
|---|---|
| 40 | `identity_path` **由后端按 `service_type` 白名单推导**（`nodeIdentityPath()`），`CreateAppDefinitionRequest` 删除该字段（proto `reserved 7`）。原实现允许前端自由传路径，与 `InitNodeIdentity` 的硬编码路径不一致，会让所有部署被 identity 前置拒绝。三者（初始化写入 / 可选节点探测 / worker 探测）现在共用同一函数 |
| 41 | **统一配置模板是纯文本文件**，与制品归档共用 `deployer-artifacts/` 前缀；文件服务 `validateFileType` 增加扩展名白名单（yaml/yml/conf/json/toml/ini/cfg/txt/env）+ 可打印 UTF-8 校验。原实现只收 ZIP/GZIP，会导致「新建版本」永远 415 |
| 42 | 命令枚举唯一合法形态是 `systemd:<unit>` / `script:<绝对路径>` / `none`；`LifecycleCommand` 补齐 `start` / `stop` action，使 `start_cmd`/`stop_cmd` 真实可用。原型里 `UDP 26019 探测`、`HTTP GET / = 200` 等不可映射的伪枚举全部删除 |
| 43 | `bin_target_path` 语义明确为**制品解压目录**（worker 执行 `mkdir -p` + `tar -xzf -C`），不是二进制文件路径；原型与前端表单、示例数据统一改名。**⚠️ 已被 §13.3 取代**：改为二进制**文件路径**、制品不再解压 |
| 44 | 决策 35 的实施差异：P0 **未抽公共包 `nodepwd`**，deployer 在 `InitNodeIdentity` 内按 admin 同规则（32 字节随机 + base64url + bcrypt）复刻约 20 行。原因：各 app 是独立 Go module，抽包需给 proto module 引入 bcrypt 并重编 admin；规则一致性由注释锁定，后续迭代再统一 |
| 45 | **真实下发期修复**：`WriteFile` 必须 `mkdir -p` 补父目录。原命令是 `base64 -d > <path>`，目标机无 `/opt/hysteria/conf/` 时 `InitNodeIdentity` 直接 500，任何节点首次初始化都失败、整条链路卡死在第一步（DB 补偿已验证会回滚新增行、无残留） |
| 46 | **真实下发期修复**：`restart_cmd=none` 与 `health_check=none` 语义对齐——`none` = 不执行。原 `LifecycleCommand` 不认 `none` 且 worker 无条件调用重启，导致选合法枚举 `none` 的部署必然失败 |
| 47 | **真实下发期修复**：`ListDeployableNodes` 的 identity 探测不再依赖 `app_id`。原实现只在传 `app_id` 时探测，而节点身份页只传 `service_type`，页面永远显示「未初始化」；改为直接 `nodeIdentityPath(service_type)`，与 #40 的三处恒等一致 |
| 48 | **落地机进程托管形态**：Hysteria2 原为 `nohup` 裸进程、无 systemd unit，`restart_cmd: systemd:hysteria-server` 根本不存在。用户授权改造后，`45.32.20.165` 改为 `/etc/systemd/system/hysteria-server.service` 托管（等价启动命令 + `Restart=always`）。**其余落地机改造前不可用发布中心的重启/健康检查**。另已离线验证「统一模板 + identity 段」追加到 config.yaml 不会让 Hysteria2 拒绝启动 |

### 3.6 已作废的旧结论（勿再沿用）

- 「升级向导允许选旧版本＝回滚」→ 作废。
- 「健康检查失败自动回滚，应用级默认开、批次可覆盖」→ 作废。
- 「失败节点保留 previous_version」→ 作废（账实不符）。
- 「台账推导回滚目标（推荐）」、`prevVersion()` 从 tasks 倒推 + `v3→v2` 兜底、「由上一成功批次推导」绿标、「逐台下拉只列装过的版本」→ 全部作废，改为人工指定。
- 「批次回滚（一键撤销一次变更）」与 `target_source` / `suggested_target` / `deviated_from_suggestion` / `origin_batch_id` 四个字段 → 全部删除。
- 「deployer 从 `t_dataplane_node` 取 `node-id`/`node-password` 追加 2 行」→ **不成立**（台账只有 bcrypt 不可逆 hash、无明文），改为本机 identity 文件保留。
- 「统一后的 `gateway-url` 选哪个地址」遗留待确认项 → 作废（身份段整体保留）。
- 「所有回滚都从已部署节点 tab 发起」之后仍保留「回滚此批次」入口 → 作废。
- 「所有节点（含落地机）都要 `InitNodeIdentity` 签发 identity 文件」→ **作废**，见 §3.8 / 决策 49–53。

### 3.8 落地节点身份机制退役（S5 真实下发后修正，2026-11-14 22:0x）

**结论：落地节点不需要 `InitNodeIdentity`；§3.5 对 `landing` 整体作废。**

| # | 决策 |
|---|---|
| 49 | `starland-dataplane` 段是 **Mihomo 中继专用**（向 Gateway 心跳鉴权）。在 `45.32.20.165` 实测：Hysteria2 二进制内 `starland-dataplane` / `node-password` 两个字符串命中数均为 **0**；对照 develop-hy 的 `/opt/mihomo/conf/config.yaml` 第 122 行确有该段。之前「追加身份段能启动」只是 YAML 容忍未知顶层键，不代表消费 |
| 50 | Hysteria2 落地机的真实凭据在本机 `config.yaml`（`auth.password` + `tls.cert/key`）。发布中心**不签发、不探测、不追加** identity 文件；`t_app_definition.identity_path` 对 landing 为空 |
| 51 | `InitNodeIdentity` 对 landing **硬拒绝**（明确文案）；`ListDeployableNodes(landing)` 恒 `identity_ready=true`、不 SSH 探测；worker 对 landing 跳过 identity 前置、配置模板原文写入。单一事实源 `data.NeedsNodeIdentity(serviceType)`（仅 relay 为 true），前端 `model.ts needsNodeIdentity()` 同规则 |
| 52 | `t_dataplane_node` **只存中继节点**。删除 `InitNodeIdentity` 误写入的落地机行；「中转接入」面板恢复语义（2 台 relay，无落地机） |
| 53 | **已结案（§13.4，不是修复而是问题消失）**：两台在线中继的身份段写在 `/opt/mihomo/conf/config.yaml` 内，而 `nodeIdentityPath("relay")` 指向不存在的 `/opt/mihomo/conf/node-identity.yaml`，故 `ListDeployableNodes(relay)` 两台均为 `false`。若发布 relay 应用，弹窗会禁用全部节点；若误点「初始化」还可能插入幽灵中继行。正确方向是 worker 覆盖配置前**从目标机现有 config.yaml 提取并保留 `starland-dataplane` 段**，而不是签发独立 identity 文件——改动会触碰在线中继，需单独授权 |

---

## 4. 数据模型

| 表 | 关键字段 | 说明 |
|---|---|---|
| `t_app_definition` | `app_id`、`app_key`(唯一)、`display_name`、`service_type`(relay/landing)、`config_filename`、`config_target_path`、`bin_target_path`(解压目录)、`start/stop/restart`(枚举)、`health_check`(枚举)、`identity_path`(**仅 relay 有值，landing 为空**；后端推导、非前端输入)、`created_by/at` | 应用定义；命令类字段一律枚举 |
| `t_app_version` | `version_id`、`app_id`、`version_no`、`bin_file_id`、`bin_sha256`、`bin_size`、`config_file_id`、`config_sha256`、`change_note`、`is_stable`、`created_by/at` | `UNIQUE(app_id,version_no)` 行锁自增；创建后不可变 |
| `t_app_deployment` | `app_id`、`node_id`、`current_version`(实况)、`last_success_version`、`previous_version`(仅展示参考)、`status`、`last_task_id`、`updated_at` | `UNIQUE(app_id,node_id)`；账实分离 |
| `t_operation_batch` | 现有列 + `mode`(install/upgrade/rollback) | 复用 |
| `t_node_task` | 现有列 + `from_version` / `to_version` / `health_result` | 复用 |
| `t_deploy_audit` | 现有列 | 复用；只记 node_id 与动作，不记任何凭据 |

> ⚠️ 本节身份落点已被 §13.4 取代：身份移到 `/etc/starland/node-identity`，由 mihomo 自读，不再位于会被覆盖的 config.yaml 内。

**节点身份不建表（历史描述）**：Mihomo 中继的身份段位于本机 `/opt/mihomo/conf/config.yaml`（`starland-dataplane`），Hysteria2 落地机凭据位于 `/opt/hysteria/config.yaml`（`auth.password` + `tls`）——两者都是**本机状态、不进版本**。发布中心不签发独立 identity 文件，`t_app_definition.identity_path` 仅 relay 有值、landing 为空；`t_dataplane_node` 只存中继注册行。遗留问题见 #53。

---

## 5. 接口契约

> ⚠️ 契约收敛见 §13.5：路径/命令改由后端推导，前端只提交 3 项。

挂在已有 `starland.deployer.com`（`127.0.0.1:8080`），网关 `config.yaml` 的 deployer 白名单同步补 method。

| RPC | 作用 |
|---|---|
| `Create/List/GetAppDefinition` | 应用定义管理 |
| `CreateAppVersion` / `ListAppVersions` | 版本登记与列表；版本号后端自增 |
| `GetAppVersionConfig` | 查看统一配置模板（可选附「按某节点合成后的结果（身份脱敏）」） |
| `ListAppDeployments` | 返回每台节点当前/上次成功版本、状态、装过的版本历史；**不返回目标版本** |
| `ListDeployableNodes` | 按 service_type 过滤、排除已软删节点 |
| ~~`InitNodeIdentity`~~ | **已退役**（§13.4）；旧前端兼容期内 RPC 可保留但前端不再调用 |
| `StartDeploy` | `mode` + `appId` + `targetVersion` + `nodeIds[]` + `snapshot[]` → `batch_id`；逐节点校验 + 漂移比对；**只入库立即返回** |
| `Get/ListDeployBatches` | 任务页轮询 |
| `RetryDeployItem` | 同批次续跑，不算新批次 |

文件服务新增 `deployer-artifacts` 前缀的上传与鉴权下载。

---

## 6. 交互与页面

```
发布中心
├─ 应用定义            /apps
│   └─ 应用详情        /apps/:appId
│        ├─ 版本列表（默认 tab）
│        ├─ 已部署节点（升级 / 回滚主入口）
│        ├─ 发布任务
│        └─ 应用设置
└─ 发布任务（全局）    /deploy-tasks
```

- **应用列表**：名称、服务类型、版本数、已部署节点数、最新稳定版、最近发布时间。
- **新建应用**：命令类字段全为枚举下拉，无自由文本。
- **版本列表**：`vN`、创建时间/人、制品名 + sha256 + 大小、配置模板、已部署节点数、变更说明；操作列只有「部署」「查看配置」。
- **部署弹窗**：从版本行点开，按 service_type 过滤节点；标注「首次安装 / 已装同版本·重复部署」；检查 identity 前置，缺失则拒绝并提示先初始化。
- **已部署节点 tab**：IP、节点名、类型、当前版本、上次成功版本、部署状态、最近部署时间；只列装过该应用且未软删的节点。勾选后可发起升级或回滚。
- **升级向导（2 步）**：① 只读节点快照 + 选目标版本（仅允许比当前更新的版本）② 确认摘要 + 断连风险 + 分批并发。
- **回滚向导（2 步）**：① 必选「统一目标版本」下拉 + 纯只读节点表（不预置推导默认值）② 确认摘要、逐节点校验结果、跨版本软警告、断连风险、分批并发、确认勾选。
- **任务页**：批次、应用、目标版本、类型（部署/升级/回滚）、成功/失败/进行中计数、耗时；展开看节点日志 + 重试；前端轮询到终态。
- **初始化节点身份**：节点台账页独立按钮，显式确认 `dataplane_node_id`，成功后不回显明文。

---

## 7. 执行流程

> ⚠️ 本节流程已被 §13.8 取代：install / upgrade / rollback 完全同一路径，无 identity 分支、无 service_type 分流。

**前置**：`landing` **无前置**（凭据在本机 `config.yaml`，`IdentityPath` 为空、worker 不探测，见 §3.8）；`relay` 仍需要 `starland-dataplane` 身份段，P0 由人工纳管写在 `config.yaml` 内（见 #53）。`InitNodeIdentity` 仅对 relay 开放，且当前两台在线中继均已登记，P0 无正当调用场景。

**主链路**：列表页勾选 → 只读快照 → 统一目标版本 + 逐节点校验 + 漂移两段式 → `StartDeploy` 只写任务表立即返回 `batch_id` → worker 按 `node_id` 串行锁、分批并发：

1. `landing` 跳过 identity 前置；`relay` 探测 `nodeIdentityPath`，缺失直接失败；
2. 从 MinIO 拉制品与统一配置模板，逐项校验 sha256；`relay` 读本机 identity 3 行合成 config.yaml，`landing` **直接写模板原文**（不追加任何身份段）；
3. 写临时制品 → 写配置（`WriteFile` 前置 `mkdir -p` 补父目录）→ 解压到 `bin_target_path` → 重启（枚举映射固定命令；P0 worker 用一次原子 `restart`，start/stop 为应用定义元数据；`restart_cmd=none` 表示不重启）；
4. 健康检查；
5. 写台账：成功 `status=healthy` 并滚动版本；失败如实记 `current_version=目标版本` + `status=failed`，`last_success_version` 不动，**不做任何自动回滚**；
6. 写审计。

**关键**：`install` / `upgrade` / `rollback` 走**完全同一条执行路径**，代码里没有 `if first_install` 分支；唯一按 `service_type` 分流的点是「是否追加 identity 段」（`NeedsNodeIdentity`），与 mode 无关。

---

## 8. 安全边界

- 台账零凭据列；明文不进网关、浏览器、任务表、日志、DB。
- 落地节点不接受 `InitNodeIdentity`；`t_dataplane_node` 只存中继，避免落地机被「中转接入」面板当中继展示。
- 命令文本由后端白名单生成，前端只提交枚举与有限参数。
- 制品不开放匿名 GetObject；`X-Service-Token` 鉴权下载。
- 停服重启会断开现有用户连接，确认页必须有影响提示，支持分批并发（默认 1 台），不建议默认全选。
- 轮换密码会立即使在线节点失效（既有实测教训）；P0 不做自动轮换。

---

## 9. P0 明确不做

`control` / `web` 类型、自动或手动密码轮换、失败自动回滚、failed 状态门禁、强乐观锁、批次回滚入口、逐台不同的回滚目标版本、**整包备份**（仍不做）、内部分发打包（P0 不需要，见 §13.3）、审批与灰度策略、与营销页数字联动、台账绑定自动下发数据面。**「旧版兼容」已移出本清单**，改为迁移期必须考虑，见 §13.7。

**已知风险与补偿**：无 failed 门禁 → 异常节点可连续叠批次，靠列表标红 + 确认页「将覆盖现场」提示补偿；identity 是单点本机文件，丢失只能走手工纳管兜底或后续轮换恢复；`node_id` 不保证对齐 → 初始化显式确认；改台账绑定仍不会自动下发数据面。

---

## 10. 实施步骤

| # | 阶段 | 内容与验收 |
|---|---|---|
| S1 | 文件服务 | ✅ 新增 `deployer-artifacts` 前缀、MinIO 对象命名、鉴权下载 + `X-Service-Token`；验收：上传返回 file_id/sha256，鉴权下载 200、匿名 403 |
| S2 | 数据 + 契约 | ✅ 建 3 张新表、改 2 张旧表；proto 编译；网关白名单 + 重启；验收：13 个新方法探针全部到达 deployer（401/业务错），未登记方法 400 |
| S3 | deployer 核心 | ✅ `InitNodeIdentity`、`WriteFile`、版本自增、制品拉取校验、模板+identity 合成、worker、台账与审计、漂移比对；`go build` / `go test` 通过，二进制已部署重启 |
| S4 | 前端 | ✅ 契约 + API + 上传客户端 + 4 个页面 + 路由菜单；原型同步（命令枚举、identity 推导、解压目录）；验收 `tsc --noEmit` + `vite build` 通过，原型冒烟 45/45 |
| S5 | 联调验收 | ✅ 静态链路：经 openresty 同源代理跑通「建应用 → 上传归档/配置模板 → 版本自增 → 查看模板/脱敏合成 → 可选节点 → 台账 → StartDeploy 硬阻断 → 批次/重试错误路径」26 项全绿。✅ **真实下发**（用户授权 `45.32.20.165`）：`InitNodeIdentity` → install(v1) → upgrade(v2) → rollback(v1) 三个批次全部 `succeeded` / `health_result=passed`，真实执行制品解压、模板+identity 合成、`systemctl restart`、`is-active` 健康检查、台账滚动；硬阻断与漂移两段式均不产生批次。详见 §12.4 |
| S6 | 后续迭代 | control/web 接入、轮换、灰度、营销联动、`nodepwd` 公共包 |

**顺序理由**：S1/S2 是前置；S3 的 `WriteFile` 同时服务制品下发与身份写入；S4 可与 S3 并行开发但联调需等 S3；**中转 Mihomo 停服断连的验收放最后并避开高峰**。

---

## 11. 环境事实（排障用）

- 后端源码：`/root/sproj/starland/apps/{deployer,admin,starcore,gateway,fileupload}`（develop-hy）；proto `/root/sproj/proto`，`cd /root/sproj/proto && make compile` 生成 `/root/sproj/proto/src/starland/*.pb.go`。
- deployer：独立 module `deployer`，`go.mod` 在 `apps/deployer/`，`replace github.com/ttufo101/api => ../../../proto/src`；配置 `/opt/deployer/conf/config.yaml`，`database_dsn` 连同一 `starlandbd`。
- 网关白名单：deployer 组在 `/opt/gateway/conf/config.yaml` 约 190 行。
- 文件服务：源码在 develop-hy `/root/sproj/starland/apps/fileupload`，二进制与 env 在 develop-tg `/opt/fileupload`；`SERVICE_TOKEN` 已在 `fileupload.env`。**发布中心制品的上传/下载走 `/api/v1/deployer-artifacts`**（GET 需 `X-Service-Token`，不开放匿名），openresty 有对应的 POST 与 UUID GET 两条 location；`/api/v1/app-releases/:file_id` 是**客户端安装包**的公开下载路由，二者不要混用。
- 文件服务与 deployer 分属两台机器，**跨机地址不能写 `127.0.0.1`**（admin 回查文件服务配 127.0.0.1:8061 不通是已知坑）。
- 落地机 `45.32.20.165` 已于 2026-11-14 从 `nohup` 裸进程改为 `hysteria-server.service`（`/etc/systemd/system/`，日志仍 append 到 `/opt/hysteria/nohup.out`），原配置备份 `/opt/hysteria/config.yaml.pre-systemd`。**SSH 直连被拒**（本机、develop-hy、develop-tg 的 `id_rsa` 都不在 authorized_keys），只有 deployer 内存中的 ed25519 纳管私钥能连；只读勘查可临时写 Go 程序复用 `executor.NewSSHExecutor(store, &cfg)` + `store.GetNode()`，用完即删，切勿把私钥落盘。

---

## 12. 实施记录（2026-11-14）

### 12.1 落地清单

| 层 | 位置 | 内容 |
|---|---|---|
| 契约 | `proto/starland/deployer.proto` | 13 个发布中心 RPC；`CreateAppDefinitionRequest` 删 `identity_path`（`reserved 7`）；`ListAppVersionsRequest/Response` 改名 `ListDeployVersions*` 避与 admin.proto 冲突 |
| 数据 | `starlandbd` | 新建 `t_app_definition` / `t_app_version` / `t_app_deployment`；`t_operation_batch` 加 `mode/app_id/target_version`；`t_node_task` 加 `from_version/to_version/health_result` |
| 文件服务 | develop-hy 源码 / develop-tg 二进制 | `FileKindDeployerArtifact`、独立上传策略、`RequireServiceToken`、纯文本配置模板校验、openresty 双 location |
| 服务 | deployer | `internal/data/release.go`、`executor/artifact.go`、`executor/deploy_worker.go`、`service/release.go`；配置加 4 键；`go build ./...` + `go test ./...` 通过 |
| 网关 | `/opt/gateway/conf/config.yaml` | deployer 组追加 13 个 method，已 `systemctl restart starland-gateway` |
| 前端 | `src/lib/xrpc/deployer-contract.ts` | 13 个 RPC 的类型映射；`ServiceType` / `DeployMode` |
| 前端 | `src/lib/upload/fileApi.ts` | `uploadDeployerArtifact`（制品归档 / 配置模板两类，扩展名白名单） |
| 前端 | `src/features/apps/` | `api/apps.ts`、`lib/model.ts`（枚举与目标校验）、`lib/usePolling.ts`、`lib/useDeploySubmit.ts`、7 个弹窗/向导组件、4 个页面 |
| 路由 | `App.tsx` / `AdminLayout.tsx` | `/apps`、`/apps/:appId`、`/deploy-tasks`、`/node-identities`；菜单「应用发布 / 发布任务 / 节点身份」 |
| 原型 | `prototype/app-release-prototype.html` | 同步命令枚举、identity 推导、解压目录语义；`IDENTITY_BY_TYPE` 常量；冒烟 45/45 |

### 12.2 验收证据

- `deployer`：`go build ./...` / `go test ./...` 均 0；`fileupload` 同上；补了 `TestLifecycleCommandAllActions`、`TestDeployerArtifactAcceptsPlainTextConfigTemplate`、`TestDeployerArtifactRejectsBinaryDisguisedAsConfig`、`TestDeployerArtifactStillAcceptsArchives`、`TestConfigTemplateWhitelistDoesNotLeakToOtherKinds`。
- 网关：新方法 `ListAppDefinitions` 无 token → 401；未登记 `NoSuchMethod` → 400，证明白名单生效且请求确实到达服务。
- 13 个新方法逐一探针全部返回业务错误而非 `bad request`。
- 文件服务：YAML 上传 201；匿名下载 403；服务令牌下载 200 且字节完全一致；二进制伪装 `.yaml` 415。
- 全链路（经 develop-tg openresty 同源代理）：26 项全绿，含版本自增 v1→v2、模板无身份字段、合成示意密码 `******`、回滚目标高于当前被硬阻断、非法 mode 被拒、未产生任何真实批次。
- 前端：`npx tsc --noEmit` 与 `npx vite build` 通过；dist 已 scp 到 `/opt/starland-admin-web/` 并 reload；`/`、`/apps`、JS/CSS 资源均 200。
- 原型：`node --check` 通过；DOM 桩冒烟 `PASS 45 / FAIL 0`。
- 测试数据（临时应用 / 版本 / 台账 / 发布批次）已清理；发布中心三张业务表均为 0；`t_operation_batch` 中 3 条**历史纳管 operation 批次**与 6 条历史任务为既有数据，必须保留，不要按「清空批次表」清理。
- 真实下发 3 批次结果、硬阻断、漂移两段式、目标机实证见 §12.4。

### 12.3 未完成 / 需授权

> ⚠️ 2026-11-15 复核：第 6 项「relay 侧遗留（#53）」已由 §13.4 结案（问题消失）；第 2 项 `47.251.121.91` 的 nohup 改造与第 5 项 `artifact_cache_dir` 死配置并入 §13.9 的 S4 / S3 处理。以下保留历史记录。

1. **健康检查失败分支未真实触发**：故意构造失败制品会让落地服务真实中断，需单独授权并避开高峰；「失败 → 重试 / 前往已部署节点回滚」目前只有静态链路验证。
2. **另一台落地机 `landing-47-251-121-91`** 的 Hysteria2 仍是 nohup 裸进程、无 systemd unit（见 #48），改造需另行授权；`identity_ready` 现为 `true`（落地机不再需要身份文件，见 §3.8）。
3. 决策 35 的公共包 `nodepwd` 未抽（见 §3.7 #44）；但整套 identity 机制对落地机已退役，该公共包的必要性随之下降。
6. **relay 侧遗留（#53）**：两台在线中继的 `identity_ready=false`（独立 identity 文件不存在，身份段实际在 `config.yaml` 内）。发布 relay 应用会被弹窗禁用；误点「初始化」可能插入幽灵中继行。修复需改 worker 为「从现有 config.yaml 提取并保留身份段」，会触碰在线中继，需单独授权。
4. `start_cmd` / `stop_cmd` 已在枚举与后端支持，但 P0 worker 只用 `restart_cmd` + `health_check`（设计 §7 的「停服→替换→启动」收敛为一次原子 `restart`），start/stop 目前是应用定义元数据。
5. **部署完整性核查（21:2x）**：控制面/边缘 8 类组件全部在线且配置生效（见下）。发现 `artifact_cache_dir: /opt/deployer/artifacts` 是**死配置**——全仓 Go 代码只有 `conf.go` 定义、无任何消费者，`ArtifactClient.Fetch` 是 `io.ReadAll` 纯内存下载再经 SSH stdin 写目标机，故目录不存在**不影响功能**；但配置项会误导排障，后续应删除该字段与两个 yaml 键（源码模板 + 运行配置）。未擅自改动运行配置/重启服务，需授权。

### 12.4 真实下发验证（2026-11-14 21:4x–21:58）

**授权**：用户「可以 45.32.20.165 落地节点上验证」+「目前这台机器上 hysteria 部署方式你可以按照合理的方式改造」。范围仅 `landing-45-32-20-165`。

**勘查结论（改造前）**：Hysteria2 是 `nohup` 裸进程（pid 1839，PPID=1），**无 systemd unit**；`/opt/hysteria/` 下为二进制、`config.yaml`(174 B)、`server.crt/key`、`nohup.out`；配置极简 `listen: :26019-26024` + `auth.type: password` + `tls`；日志中有两台中转的真实连接，确认**在承载线上流量**。`systemctl restart hysteria-server` / `is-active` 均不存在，发布中心的重启与健康检查必然跑不通。

**改造（已保留生效）**

- 离线验证最关键假设：临时端口 `:27019` 用「统一模板 + identity 段」启动 Hysteria2 → `server up and running` 后优雅退出，证明**在 config.yaml 追加 `starland-dataplane:` 段不会让 Hysteria2 拒绝启动**。
- 新增 `/etc/systemd/system/hysteria-server.service`(644)：`Type=simple`、`WorkingDirectory=/opt/hysteria`、`ExecStart=/opt/hysteria/hysteria server -c /opt/hysteria/config.yaml`、`Restart=always`、`RestartSec=3`、日志 append 到原 `nohup.out`；与原启动命令等价。`daemon-reload` + `enable --now` 后 kill 旧孤儿进程，切换有 1–3 秒断连，中转自动重连。
- 原配置备份 `/opt/hysteria/config.yaml.pre-systemd`(174 B)；现 `config.yaml`(412 B) = 模板 + identity 合成结果，第 14 行 `starland-dataplane:`；`node-identity.yaml` 保持 0600。

**真实下发的 3 个批次**（全部 `succeeded`、`health_result=passed`）

| # | mode | 目标 | 台账结果 | 目标机实证 |
|---|---|---|---|---|
| 1 | install | v1 | `current=v1 / status=healthy` | `RELEASE.txt=bundle v1`、`active`、UDP 26019 在听、日志 `server stopped → up and running` |
| 2 | upgrade | v2 | `current=v2 / previous=v1` | 配置与制品真实滚动 |
| 3 | rollback | v1 | `current=v1 / previous=v2 / healthy` | `RELEASE.txt` 回到 `bundle v1`、服务恢复 |

真实执行了：ed25519 纳管 SSH 写文件、`tar -xzf` 解压、模板 + identity 合成、`systemctl restart hysteria-server`、`systemctl is-active` 健康检查、台账与审计写入。**制品只含版本标记文件，未覆盖运行中的二进制**（避免 `Text file busy`）。

**另 2 项不产生批次的安全校验**

- 硬阻断：当前 v1 时回滚到 v2 → 返回 `blocked_reasons`，批次总数仍为 3。
- 漂移两段式：台账 v1、快照故意写 v2、目标 v2 → `confirm_required=true`、`drifted_nodes=["landing-45-32-20-165"]`、`batch_id` 空，批次总数仍为 3。

**验证期发现并修复的 3 个 P0 缺陷**（均在 develop-hy 改源码 → `go build ./...` + `go test ./...` → `mv -f` 原子替换二进制 → 重启 deployer）

| # | 缺陷 | 根因 | 修复 |
|---|---|---|---|
| 45 | `InitNodeIdentity` 返回 500 `No such file or directory` | `WriteFile` 用 `base64 -d > <path>`，不创建父目录；目标机无 `/opt/hysteria/conf/`。**任何节点首次初始化都会失败** | `artifact.go` 引入 `path`，命令前置 `mkdir -p <dir>`。失败时的 DB 补偿已验证生效（回滚新增行、无残留） |
| 46 | 选合法枚举 `none` 的部署必然失败 | `LifecycleCommand` 不认 `none`，worker 无条件调用重启（健康检查有 none 跳过，重启没有） | `deploy_worker.go` 重启分支前置 `if app.RestartCmd != "" && app.RestartCmd != "none"` |
| 47 | 节点身份页永远显示「未初始化」 | `ListDeployableNodes` 仅在传 `app_id` 时探测 identity，而 `NodeIdentityPage` 只传 `service_type` | `service/release.go` 改为直接 `nodeIdentityPath(service_type)`，与 #40 三处恒等 |

**验证后状态**

- 目标机：`hysteria-server` `active`、UDP 26019 在听、unit 644、备份在、`RELEASE.txt` 与临时配置测试文件已删。
- 数据：临时应用 / 2 版本 / 1 台账 / 3 批次 / 3 任务明细全部删除；`t_app_definition`、`t_app_version`、`t_app_deployment` 均为 0；3 条历史纳管批次与 6 条历史任务保留。
- **身份初始化成果保留**：`45.32.20.165` 的 `node-identity.yaml` 与 `t_dataplane_node` 行（`node_id=verify-landing-45-32-20-165`，验证期命名）保留，该节点 `identity_ready=true`、可直接发起部署。命名带 `verify-` 仅影响可读性，不参与发布中心任何流程（发布中心只读 `t_node_asset` + identity 文件）。
- 临时勘查程序 `cmd/probe`、源码 `.bak-verify*`、develop-hy `/tmp/hy-template.yaml` / `probe_cmds.txt` / `verify_state.json` 全部删除；删除后复跑 `go build ./...` / `go test ./...` 通过，deployer 运行中。

**仍未覆盖**：健康检查失败分支的真实触发与「失败 → 重试 / 前往已部署节点回滚」（需故意构造失败制品、会真实中断落地服务）；`start_cmd`/`stop_cmd` 的真实执行（P0 为元数据）；另一台落地机的 systemd 改造与身份初始化。

### 12.5 落地节点身份机制退役（22:0x–22:2x）

**触发**：「中转接入」面板出现第三条 `verify-landing-45-32-20-165`（从未连接 / 未部署 / 不可分配）。用户质疑「落地节点是否需要 InitNodeIdentity」，选择「移除整套机制」。

**根因与证据**

- 面板 `ListDataPlaneNodes` 是 `SELECT ... FROM t_dataplane_node ORDER BY node_id` 全量返回；`InitNodeIdentity` 无条件 `INSERT` 该表（Mihomo 中继心跳/鉴权注册表），落地机永不心跳 → 幽灵行。
- 该行 `enabled=1 / runtime_status=unknown / scheduling_status=disabled`；starcore `ListHealthyRelayNodes` 要求 `online` + `active` + 45s 心跳，所以**没有业务危害**，是纯语义污染。
- `starland-dataplane` 段是中继专用：Hysteria2 二进制内 `starland-dataplane` / `node-password` 命中数均为 **0**；中继 `config.yaml` 第 122 行确有该段。落地机凭据是 `auth.password` + `tls.cert/key`。

**改动（已上线）**

| 层 | 文件 | 内容 |
|---|---|---|
| 后端 | `internal/data/release.go` | 新增 `NeedsNodeIdentity(serviceType)`（仅 relay 为 true）单一事实源 |
| 后端 | `internal/service/release.go` | `CreateAppDefinition` 对 landing 不再推导/校验 `identity_path`（空）；`ListDeployableNodes(landing)` 恒 true、不 SSH 探测；`InitNodeIdentity` 对 landing 硬拒绝；`nodeIdentityPath` 只接受 relay |
| 后端 | `internal/executor/deploy_worker.go` | landing 跳过 identity 前置与合成，配置模板原文写入 |
| 单测 | `internal/service/release_test.go` | 更新 `TestNodeIdentityPathIsWhitelisted`，新增 `TestNeedsNodeIdentityOnlyForRelay` |
| 前端 | `src/features/apps/` | `model.ts` 加 `needsNodeIdentity()`、landing 路径改说明；`NodeIdentityPage` 只列 relay；DeployDialog / DeployWizard / AppFormDialog / ConfigViewDialog / VersionFormDialog / AppDetailPage 文案按类型分流；`npx tsc --noEmit` + `vite build` 通过，dist 已部署（`index-Ddoa1OVQ.js` 601890 B） |
| 原型 | `prototype/app-release-prototype.html` | `IDENTITY_BY_TYPE` + `needsIdentity()`、示例数据、配置说明按类型分流；`node --check` + DOM 桩冒烟 `45/45` |
| 数据 | `starlandbd` | 删除 `verify-landing-45-32-20-165`；`t_dataplane_node` 只剩 2 台 relay |
| 目标机 | `45.32.20.165` | 删除 `/opt/hysteria/conf/node-identity.yaml`；`config.yaml` 恢复 174 B 纯模板（无 `starland-dataplane` 段） |

**复验（真实 install 一次，用户已授权重启）**

- `CreateAppDefinition(landing)` 返回 `identity_path=''` ✓
- 批次 `B-b30217c8a91e02c51cf95930` `succeeded` / `health_result=passed`，台账 `v1 / healthy` ✓
- 目标机：`config.yaml` 174 B、`grep -c starland-dataplane = 0`、identity 文件 absent、`hysteria-server active`、UDP 26019、`RELEASE.txt=bundle v1`、日志 `server up and running` ✓
- 面板 `ListDataPlaneNodes` 返回 2 条全为 `relay-*`、无 landing 泄露 ✓
- `InitNodeIdentity(landing)` → 400 `node identity only applies to relay nodes; ...` ✓
- `ListDeployableNodes(landing)` 两台 `identity_ready=true` ✓
- 复验数据已清理：发布中心三张表为 0；`t_operation_batch` 3 条历史纳管批次 + `t_node_task` 6 条历史任务保留；`t_dataplane_node` 2 条。目标机 `RELEASE.txt` 与临时勘查程序已删，删后 `go build ./...` / `go test ./...` 复跑通过。

**新发现（P1，未改，见 #53）**：`ListDeployableNodes(relay)` 两台 `identity_ready=false`，因为 `/opt/mihomo/conf/node-identity.yaml` 不存在（中继身份段实际在 `config.yaml` 第 122 行）。发布 relay 应用会被弹窗禁用；误点「初始化」可能插入幽灵中继行。修复方向是 worker 覆盖配置前从目标机现有 `config.yaml` 提取并保留 `starland-dataplane` 段，会触碰在线中继，需单独授权。

**原型边界**：原型保留身份前置的交互桩（relay 场景冒烟用），文案已明确标注落地节点不需要；实际实现以 `src/` 与本文档为准。

---

## 13. 统一化改造定稿（2026-11-15）

> **本节是当前唯一有效的执行方案。** 用户本轮拍板：① 按上一轮建议执行，但把「不做旧版本兼容」改为「**需要考虑旧版本兼容**」，仍不备份、可以删无效代码；② 制品改为**用户直传可执行程序**，不用来回压缩解压；内部分发允许打包，但不强制。

### 13.1 约束变更

| 项 | 结论 |
|---|---|
| 旧版本兼容 | **由「不做」改为「要考虑」**，覆盖文档头与 2026-11-06 的既有约定。范围严格限定为**迁移期兼容**（§13.7），不是永久双轨；历史版本数据清理后即可删兼容分支 |
| 备份 | 仍不做：不生成 `*.bak`、旧包归档、回滚档。**注意区分**：`t_app_version` 保留历史二进制对象以供回滚，属制品库固有能力，不算「备份旧版本」 |
| 无效代码 | 允许删除：identity 探测/合成 UI、`ReadIdentity`、`start_cmd`/`stop_cmd` 语义、`artifact_cache_dir` 死配置等。**注意**：`systemd:` 后端分支保留兼容旧 DB 行；`NodeIdentityPage` 按 §13.11 保留为只读运维说明页，两者均不删 |
| 生命周期 | 只保留**一种**操作接口 = `script:/opt/<app>/setup.sh`；systemd 仍作底层托管机制（接口与机制不是二选一） |
| 目录/配置/脚本 | 全部统一，安装流程不得对 mihomo 差异化 |

### 13.2 统一约定（`<app>` 由 `service_type` 白名单推导：relay→`mihomo`、landing→`hysteria`）

```
/opt/<app>/<app>                              可执行程序，0755，mv -f 原子替换
/opt/<app>/conf/config.yaml                   纯业务模板，0644，零节点身份凭据
/opt/<app>/conf/start-args                    可选：启动参数（每行一个，# 为注释）
/opt/<app>/setup.sh                           统一生命周期脚本，0755，所有服务同一份
/opt/<app>/log/                               本机状态
/etc/systemd/system/starland-<app>.service    常驻 unit（非 transient）
/etc/starland/node-identity                   0600 root，跨应用，不属于任何应用目录
```

- `conf/` 内除 `config.yaml` 外的一切、`/etc/starland/node-identity`、`log/`、`pid`、TLS 证书、`cache.db` 都是**本机状态**；发布中心只覆盖「二进制 + config.yaml」两个文件。
- 统一范围 = 发布中心纳管的应用（mihomo / hysteria）；控制面 10 个服务**只换用新脚本模板、不搬目录**。
- 脚本接口固定 `start | stop | restart | status`；`restart` 与 `status` 由 worker 调用，`start`/`stop` 供运维。

### 13.3 制品模型：用户直传可执行程序

**现状（S5）**：上传 `.tgz/.zip` → MinIO `deployer-artifacts/` → deployer `Fetch(file_id, sha256)` 取 `[]byte` → 写 `/tmp/starland-deploy-*.tgz` → `tar -xzf -C /opt/<app>` → 删临时文件。

**改造后**：

1. 前端「新建版本」第一项改为**可执行程序**（不限扩展名），第二项仍是统一配置模板（纯文本）。
2. 文件服务 `validateFileType` 对 `FileKindDeployerArtifact` 增加一档：**ELF magic `\x7fELF` → `application/octet-stream`**，按文件头而非扩展名判定（Go 二进制常无后缀，且能防伪装）。原有 zip/gzip 与纯文本两档**保留**，供历史版本与兼容使用。
3. deployer `Fetch` 不变（仍是按 `file_id` + sha256 下字节），**取消解压**：`WriteFile` 直写 `/opt/<app>/.<app>.new`（0755）→ `mv -f` 原子替换 `/opt/<app>/<app>`。
   - `mv -f` 是硬要求：`WriteFile` 内部是 `base64 -d > 路径`，直接覆盖运行中的二进制会 `Text file busy`。
4. **内部分发不打包**：现有链路本就是「HTTP 下字节 → SSH stdin base64 → 写目标机」，单文件直写比 tar 更短，且消掉 `/tmp` 残留、`unzip` 依赖、按后缀猜格式三处故障点。用户许可的「内部可压缩成包」作为**将来多文件制品**（如附带 `geoip.dat`）的扩展点保留，P0 不实现。
5. **旧版本兼容（新增约束的核心落点）**：`t_app_version` 已有行的 `bin_filename` 是 `.tgz/.zip`。worker 按后缀分流——归档走旧解压分支、新记录走直写分支。缺了这一条，rollback 到 v1/v2 会全批失败。历史版本清理后删掉旧分支。

### 13.4 身份外置：让发布碰不到身份

- mihomo fork 自读 `/etc/starland/node-identity`（`node_id` / `node_password` / `gateway_url`），读到即覆盖内存配置；**缺失 / 格式错 / 权限非 0600 → 拒绝启动**，日志只写原因不写值。
- **实施定稿（2026-11-15）**：不改 `ValidateConfig` / `normalizeConfig`（保留三字段非空校验作为兜底），而是在 `config.ParseRawConfig` 开头、`ValidateConfig` **之前**注入：`starland.ApplyNodeIdentity(&rawCfg.StarlandDataPlane, "")`。这样 `Parse(buf)` 与 `ParseRawConfig(rawCfg)` 两条路径都覆盖，且仅在 `Enabled=true` 时加载（非数据面实例不受影响）。实现见 `component/starland/identity.go`。
- `conf/config.yaml` 模板**零节点身份凭据**（不含 `node-id` / `node-password` / `gateway-url`），只有 `enabled` + 6 个业务参数；落地机可含跨机统一的 `auth.password`（见 §13.14.2，不属本机唯一凭据）。身份段不再位于会被覆盖的文件里，问题本身消失。
- **裸机时序（已实施）**：纳管最先发生，此时还没有 `config.yaml`。`ConfirmBootstrap` 在指纹确认且公钥重连成功后，**仅首次确认**（`auth_status` 原值非 `ready`）对 `relay` 调用内部 `issueNodeIdentity`：内存生成 32B 密码 → bcrypt hash 写 `t_dataplane_node` → 经已有 ed25519 SSH 通道把 YAML 写 `/etc/starland/node-identity`（0600）。明文只在内存与 SSH 通道内，绝不进日志/审计/任务表/DB/响应；写文件失败回滚注册表行。
- **凭据来源（用户 11-15 拍板）**：`node_id` **维持现有随机值**，不用 host key 指纹——指纹是公开哈希，只能做名字不能做凭证。新纳管节点用台账 `node.NodeID` 作为注册表主键，`t_node_asset` 与 `t_dataplane_node` 天然一致，**#38 的人工对齐步骤消解**；存量两台的旧 `node-id` 不动，由 S4 迁移时原样搬进身份文件。
- `gateway_url` 取自 `deployer.gateway_url` 配置，**去掉代码里的硬编码兜底**（`InitNodeIdentity` 曾写死 `47.120.10.73`，对 HY 是错的）；配置缺失直接 fail-closed 拒绝签发。⚠️ 当前为单值配置（线上是 `http://47.120.10.73:12001/startlandapi`），HY 本机中继用它会绕公网但可通；两台要各自最优需按节点覆盖，列为 P2。
- **幂等闸门**：`issueNodeIdentity` 在「注册表行 + 本机文件都已存在」时直接返回，绝不重新签发（新明文无法与既有 bcrypt hash 对齐，会让在线节点心跳 401）；「有行无文件」或「有文件无行」一律拒绝并提示人工对账。
- **实际删除/保留**：前端整套 identity UI、`ReadIdentity`、身份 `FileExists` 探测、`artifact_cache_dir` 死配置、`ListDeployableNodes` 的并发探测已删；`GetAppVersionConfig` 的 `merged` 脱敏示意**后端仍保留**（旧前端兼容，仅 `node_id` 非空时返回脱敏文本，无真实合成；§13.14 校正）、`nodeIdentityPath()`（白名单 → 唯一路径）、`InitNodeIdentity`（旧前端兼容入口，委托同一签发函数）、`data.NeedsNodeIdentity`（relay 判定）、`Insert/Rollback/Exists` **保留复用**，不再是无用代码。
- **#53 结案**（问题消失，非修复）。`LifecycleCommand` 的 `systemd:` 分支同样**保留**（见 §13.5 / §13.7），用于兼容 DB 里旧应用定义行。
- P2/P3 再议：用 host key 私钥签名或 mTLS 彻底消灭静态密码，需改 5 个组件 + 在线切换，且会让面向公网的 mihomo 持有机器根密钥，扩大爆炸半径，当前 2 台中继不划算。

### 13.5 契约收敛（后端推导，前端只填 3 项）

| 项 | 处理 |
|---|---|
| `CreateAppDefinitionRequest` | 前端只提交 `app_key` / `display_name` / `service_type`（+ 可选 `config_filename`）；**proto 不改动**，旧字段保留但不生效（保留字段本身就是对旧前端 dist 的兼容，比 `reserved` 更省事，也不复用编号） |
| 后端推导 | `config_target_path=/opt/<app>/conf/config.yaml`、`bin_target_path=/opt/<app>/<app>`、`restart_cmd=health_check=script:/opt/<app>/setup.sh` |
| `AppDefinition` 响应 | 旧字段保留并填推导值，供旧前端 dist 解析；`identity_ready` 保留为可选兼容字段，前端不再消费 |
| `start_cmd` / `stop_cmd` / `identity_path` | 语义退役，字段保留填旧值/空串，避免旧响应缺字段 |
| `GetAppVersionConfigResponse.merged` | 前端不再消费；后端仅保留脱敏示意（旧前端兼容），主字段 `template`，无真实合成动作 |
| 命令枚举 | 前端从 5 项收敛到 `script:<path>`；**后端 `LifecycleCommand` 保留 `systemd:` 分支**，兼容 `t_app_definition` 里旧命令行（否则升级/回滚旧应用会失败）。新应用一律推导 `script:/opt/<app>/setup.sh`，由统一脚本抹平 unit 名差异 → **#48 结案** |

代价：失去自定义路径能力。P0 仅两种服务、开发调试阶段，值得。

### 13.6 统一脚本模板

`ops/setup-service.sh` 已是 10 个控制面服务的事实标准（`deploy-one.sh` 用 `install -m 0755` 装到 `/opt/<svc>/setup.sh`）。改动**只动内部、不动接口**：

- 启动参数改从可选文件 `conf/start-args` 读取（**每行一个参数**，`#` 为注释，不允许空格/引号/`%`），消除脚本副本里的硬编码差异（`/opt/mihomo/setup.sh` 写过 `-d conf`、`/opt/deployer/setup.sh` 加过 `User/Group=deployer`、hysteria 需要 `server -c ...`）。
- 由 `systemd-run --collect`（**transient unit**、`Restart=no`）改为**常驻 unit** + `Restart=on-failure` + `RestartSec` + `StartLimitBurst` 限流。与 fail-closed 配套：身份文件缺失时拒绝启动，既不无限重启刷屏，也不静默长期离线。
- `stop` 能接管旧形态：既有 transient unit、手写 `hysteria-server.service`、nohup 裸进程。
- 接口不变 ⇒ 已运行的 10 个服务**不重启就不受影响**，可灰度；新模板同时用于 `deploy-one.sh` 的控制面部署，避免再次分叉。

### 13.7 兼容矩阵（本次新增约束的落点）

| 旧形态 | 兼容处理 | 生命周期 |
|---|---|---|
| `t_app_version` 里 `.tgz/.zip` 历史制品 | worker 按 `bin_filename` 后缀走旧解压分支 | 迁移期；历史版本清理后删 |
| DB 已有 `t_app_definition` 的旧路径/旧命令 | 读取时以推导值优先，旧值不生效；列保留不删 | 迁移期 |
| proto 旧字段号 | 字段与编号原样保留、后端忽略；不删不复用（删除才需要 `reserved`） | 永久 |
| 旧前端 dist 的响应解析 | `AppDefinition` 旧字段保留填充 | 迁移期 |
| 两台中继 `conf/config.yaml` 内含身份段 | 迁移时提取明文写入 `node-identity`，**先离线 `bcrypt.CompareHashAndPassword(DB hash, 明文)` 两台都为 true** | S4 一次性 |
| `45.32.20.165` 配置在 `/opt/hysteria/` 根 + 手写 unit | 迁到 `conf/`，装统一脚本与 `starland-hysteria.service`，删手写 unit | S4 一次性 |
| `47.251.121.91` 仍 nohup 裸进程 | 同一脚本接管、装 unit | S4 一次性（#48 结案） |
| 旧 transient unit | 脚本 `stop` 时先停旧名再清 transient | S4 一次性 |

**明确不兼容**（用户已授权删，属无效代码而非「旧版本」）：`InitNodeIdentity` 的**前端调用**（后端 RPC 保留为兼容入口）、`start_cmd`/`stop_cmd` 语义、identity 探测/合成 UI、`merged` 配置视图。`systemd:` 后端解析分支保留，属旧 DB 行兼容而非无效代码。

### 13.8 端到端执行逻辑

1. **纳管（裸机，最先）**：bootstrap 回执 → 人工确认 host key 指纹 → `ConfirmBootstrap` 重连成功且为首次确认时，deployer 内存生成 32B 密码 → bcrypt hash 写 `t_dataplane_node` → 经 ed25519 SSH 写 `/etc/starland/node-identity`（0600）。明文不回显、不落库。`CreateDataPlaneNode`（admin）保留为旧入口，纳管流程不再依赖它回显。
2. **新建应用**：前端只填 3 项，后端推导全部路径与命令并装统一脚本/unit。
3. **新建版本**：直传可执行文件 + 配置模板 → 文件服务按 magic 校验 → MinIO 按 `file_id` + sha256 固化。
4. **install / upgrade / rollback**：**完全同一条路径** —— 拉字节 → sha256 → 写纯模板 → 直写（或兼容旧包解压）二进制 → `setup.sh restart` → `setup.sh status` → 写台账。**无 `first_install` 分支、无 `service_type` 分流、无 identity 分支。**
5. **失败**：不自动回滚，台账如实记 `current_version=目标版本` + `status=failed`。
6. **轮换 / 重装**：改身份文件 → `restart`；文件缺失 → 拒绝启动 + 离线告警，恢复路径是重新纳管。

### 13.9 分阶段步骤

| 阶段 | 内容 | 风险 / 验收 |
|---|---|---|
| **S0 规范与契约** | 本节定稿；**proto 不改动**（旧字段与编号原样保留、仅后端忽略）、前端契约/表单/枚举/文案、原型归档、文件服务类型白名单 | 零风险；`tsc --noEmit` + `vite build`、`go test ./...` |
| **S1 统一脚本** | 改 `ops/setup-service.sh`：`conf/start-args` + 常驻 unit + 旧形态接管；`deploy-one.sh` 不动 | 低风险可灰度；`bash -n` + 一台非关键服务试点 `status/restart`，**不重启在线服务** |
| **S2 mihomo fork** | `identity.go` 加载身份 + fail-closed + 日志脱敏；`config.ParseRawConfig` 注入；5 场景单测（正常覆盖/缺文件/格式错/字段不全/权限宽） | 离线可验；`go test ./component/starland/...` + `go build ./config/...` |
| **S3 deployer + 前端** | 删 identity 探测/合成 UI、`ReadIdentity`、`artifact_cache_dir` 死配置；`systemd:` 后端分支保留兼容；字段后端推导、制品单文件直写 + 旧包兼容分支、worker 只写模板 + `setup.sh restart/status` | 不碰在线服务；`go test ./...`；发布中心三表测试数据清 0 留到上线窗口（保留 `t_operation_batch` 3 条历史纳管批次） |
| **S4 在线迁移** | ① 离线校验两台明文 ↔ DB bcrypt（不打印值）② **单台串行**：写身份文件 → 装脚本/unit → 配置迁 `conf/` 并删三个凭据字段 → 换二进制 → `restart` → 验 `status` + `runtime_status=online` + `heartbeat_at`，确认后再动第二台 ③ 落地机迁 `conf/` + 装脚本/unit（含 `47.251.121.91` 的 nohup 改造）④ 一次纯模板 install 批次验证统一路径 ⑤ 清理残留明文/旧 unit | **✓ 2026-11-15 17:00–17:49 已授权完成，单台串行，见 §13.14** |

**S4 验收（✓ 全部达成，见 §13.14）**：两台心跳 online、落地机 UDP 在听、批次 `succeeded` + `health_result=passed`、所有 `config.yaml` 里 `grep -c node-password = 0`、unit 非 transient、历史 `.tgz` 版本回滚批次成功（验证兼容分支）。

### 13.10 原待授权与风险（2026-11-15 17:50 已闭环）

> 用户已明确授权全部 S4（并说明「线上暂时没有用户、还在开发测试阶段，可以放心调试」）。以下保留风险说明供追溯，实际执行与验收见 §13.14。

- **S4 触碰两台在线中继 + 两台落地机**，且 `restart` 会断现有用户连接：需单独授权、非高峰、单台串行；两台中继同时挂会让 `GetLinks` 503。
- **最易翻车点**：`t_dataplane_node` 只有 bcrypt hash 无法反推明文，必须从现有 `config.yaml` 提取并先离线比对；漏了就是重启后心跳 401。
- **fail-closed 与 supervision**：`starland-mihomo.service` 现为 transient unit、`Restart=no`；必须换成常驻 unit 或补齐离线告警，否则「安全失败」会变成「无人发现的故障」。
- **身份文件成为新单点**：机器重装或误删 → 拒绝启动，恢复靠重新纳管；明文密码仍在磁盘，只是从会被覆盖的文件挪到不会被覆盖的文件。恢复流程见 §13.12。
- **纳管签发的单值 `gateway_url`**：当前 `deployer.gateway_url` 是全局配置，HY 本机中继用公网地址可通但绕路；多机最优值需按节点覆盖（P2）。配置缺失时 `ConfirmBootstrap` fail-closed 报错，属期望行为，不是静默降级。
- **重跑纳管的幂等**：仅 `auth_status` 原值非 `ready` 的首次确认才签发；存量两台重跑不会新增注册表行。若出现「有注册表行但目标机无身份文件」，必须走 §13.12 的人工对账，不得重新签发。
- fork 上游合并有维护成本；改动集中在 `component/starland` 与 `config/config.go` 约 30–50 行 + 单测，值得。
- P2/P3 扩展点：内部分发打包（多文件制品）、host key 签名/mTLS、控制面目录重排、`control`/`web` 服务类型。

### 13.11 本轮实施记录（2026-11-15，S0 + S1 + S2 + S3 主链路）

**线上状态：完全未动**。本轮只改源码 + 离线构建/单测，**没有部署前端 dist、没有替换任何后端二进制、没有重启任何服务、没有写任何目标机配置**。原因是新前端与新后端必须同批上线，单独部署任一侧都会让「新建应用 / 上传制品」失败。

| 层 | 文件 | 改动 | 验证 |
|---|---|---|---|
| 文档 | `release-center.md` | 新增 §13 全章；§3.4/#43/#53、§4/§5/§7/§9/§12.3、文档头约束加指向 | — |
| 前端 | `src/lib/upload/fileApi.ts` | `binary` 类型（不限扩展名）、ELF magic 交服务端；`archive` 仅兼容历史 | `tsc --noEmit` ✓ `vite build` ✓（573.64 kB） |
| 前端 | `src/features/apps/components/VersionFormDialog.tsx` | 改「可执行程序（直接上传，无需打包）」；身份文案改自读 | 同上 |
| 前端 | `src/features/apps/components/AppFormDialog.tsx` | 重写为 3 字段 + 只读推导布局；不再提交路径/命令 | 同上 |
| 前端 | `src/features/apps/lib/model.ts` | 删 `IDENTITY_PATH_BY_TYPE` / `needsNodeIdentity` / 5 项枚举；新增 `APP_DIR_BY_TYPE` / `NODE_IDENTITY_PATH` / `lifecycleScript()` | 同上 |
| 前端 | `deployer-contract.ts`、`api/apps.ts`、`DeployDialog`、`DeployWizard`、`ConfigViewDialog`、`AppDetailPage`、`NodeIdentityPage`、`AdminLayout` | 删 `InitNodeIdentity` 注册与调用、identity 前置探测/合成/禁用逻辑、合成后视图；节点身份页改只读说明页；旧字段保留为兼容字段 | 同上 |
| 文件服务 | `apps/fileupload/internal/service/file.go` + `deployer_elf_test.go` | `validateFileType` 增 ELF magic 档（保留归档/文本档）；错误消息更新；新增单测 | `go build ./...` + `go test ./...` ✓ |
| deployer | `apps/deployer/internal/service/release.go` | `CreateAppDefinition` 忽略前端路径/命令，按 `service_type` 推导 4 个路径与命令；身份路径置空 | `go build ./...` + `go test ./...` ✓ |
| deployer | `apps/deployer/internal/executor/deploy_worker.go` | 删 identity 前置探测与模板合成；模板原文写入；制品按 `bin_filename` 后缀分流（新 ELF → `WriteFile(.new, 0755)` + `mv -f` 原子替换；历史 `.tgz/.zip` → 原解压分支） | 同上 |
| 脚本 | `ops/setup-service.sh` | 重写：`conf/start-args` 参数外置、常驻 unit（`Restart=on-failure` + `StartLimitBurst/IntervalSec`）、旧手写 unit 与 nohup 接管；接口 `start/stop/restart/status` 不变 | `bash -n` ✓；远端 systemd 239（未用 240+ 的 `append:`）✓ |
| mihomo fork | `component/starland/identity.go` + `identity_test.go`、`config/config.go` | 身份文件自读 + 0600/fail-closed + 日志不泄值；`ParseRawConfig` 注入；5 场景单测 | `go test ./component/starland/...` ✓ `go build ./config/...` ✓ |

**本轮追加完成（同日第二批，纯离线）**

| 项 | 落地 | 验证 |
|---|---|---|
| 纳管写入身份文件 | `ConfirmBootstrap` 首次确认且重连成功后调用 `issueNodeIdentity`；签发逻辑从旧 `InitNodeIdentity` 抽为内部函数，路径/格式改为 `/etc/starland/node-identity` 三行 YAML；`gateway_url` 配置化、去掉硬编码兜底；注册表行 + 文件双存在即幂等跳过，写文件失败回滚 | `go build ./...` + `go test ./...` ✓；新增 `node_identity_test.go`（格式 / 不安全值 / fail-closed 3 组） |
| S3 剩余无效代码 | 删 `ReadIdentity`、`artifact_cache_dir` 死配置、`ListDeployableNodes` 并发身份探测（`IdentityReady` 恒 true 兼容旧 dist）；`systemd:` 分支、`InitNodeIdentity` RPC、`nodeIdentityPath`、`NeedsNodeIdentity` 按兼容/复用**保留** | 同上 |
| 防幽灵行闸门 | `ConfirmBootstrap` 记录确认前 `auth_status`，仅首次确认签发；存量节点重跑不新增 `t_dataplane_node` 行 | 同上 |
| 原型 | 标注为历史归档 + 页面顶部醒目提示；**旧示例数据与交互桩未重写**（仍含 identity 合成 / `artifact_cache_dir` 注入等作废桩，仅供追溯，勿执行） | 内嵌 JS 语法检查 ✓ |
| S4 前置工具（**未执行**） | `apps/deployer/tools/verify-node-identity/main.go` + `/root/sproj/ops/verify-node-identity.sh`：stdin 读明文与 hash，只输出 MATCH / MISMATCH，不回显值 | `bash -n` ✓、`go build ./...` ✓；**未读取任何生产凭据、未运行比对** |

**全部已完成（2026-11-15 17:50，见 §13.13 / §13.14）**

1. ~~上线窗口~~ 14:42 前后端同批替换并重启（§13.13）。
2. ~~S4 在线迁移~~ 17:00–17:20 单台串行完成 2 中继 + 2 落地机；bcrypt 离线比对两台均 `MATCH`；身份文件、统一脚本/常驻 unit、纯业务模板全部落机（§13.14）。
3. ~~批次验收~~ 17:35–17:49 真实发出 3 个批次：`install` ELF 直写分支、`rollback` 历史 `.tgz` 解压分支、修复超时后重验 `install`，两个终态批次均 `succeeded` + `health=passed`；测试数据已按 §13.12 精确清理，三表回到 0/0/0。
4. **过程中发现并修复的缺陷**：60 MB+ ELF 制品下载被 60s 硬超时截断（`context deadline exceeded`），已放宽三处超时并加防回归单测（§13.14）。
5. **P2（未做，非阻断）**：大制品跨机下发约 5.5 分钟偏慢（可走内网地址 / 内部分发压缩）、`gateway_url` 按节点覆盖、多文件制品内部分发打包、host key 签名 / mTLS、控制面目录重排。

**上线硬约束（已解除）**：原要求「S1 统一脚本/常驻 unit 必须先落目标机」，现已随 S4 装到 4 台目标机并验收 `gate=READY`；`StartDeploy` 的 `migrationGate` 会在缺脚本 / 缺身份文件时自动拒绝批次，不再依赖人工纪律。

### 13.12 运维手册与上线顺序

**必须严格按此顺序，前后端不得单侧更新。**

1. 替换 `fileupload` / `deployer` 二进制并重启（两者都改过 `validateFileType` / `CreateAppDefinition` / worker）。**（✓ 2026-11-15 14:42 已完成，见 §13.13）**
2. scp 前端 dist 到 `develop-tg:/opt/starland-admin-web/` + `openresty -s reload`。**（✓ 已完成）**
3. 把 S1 的 `ops/setup-service.sh` 装到**每一台目标机** `/opt/<app>/setup.sh`（0755），写 `conf/start-args`，注册常驻 unit。**这一步不做，任何新批次会卡在 `restart`。** **（✓ 已随 S4 装到 4 台目标机并验收 `gate=READY`，见 §13.14）**
4. S4 单台串行迁移（✓ 2026-11-15 17:00–17:20 已授权完成）：
   - 每台先用 `/root/sproj/ops/verify-node-identity.sh` 做明文 ↔ bcrypt 比对，`MATCH` 才继续；
   - 写 `/etc/starland/node-identity`（0600 root）→ 装脚本/unit → 配置迁 `conf/` 并删三个凭据字段 → 换二进制 → `setup.sh restart` → 验 `setup.sh status` + `runtime_status=online` + `heartbeat_at`；
   - 一台确认恢复后再动下一台；两台中继同时挂会让 `GetLinks` 503。
5. 一次纯模板 `install` 批次 + 一次历史 `.tgz` 版本 `rollback` 批次，分别验证新路径与兼容分支。**（✓ 17:35–17:49 已完成，两个终态批次均 `succeeded` + `health=passed`）**

**身份文件恢复**：机器重装或误删 `/etc/starland/node-identity` → mihomo 拒绝启动（fail-closed，日志只给原因）。恢复路径是重新纳管；若该 `node_id` 在 `t_dataplane_node` 已有行，纳管会拒绝自动重签（防止新明文与旧 hash 不匹配），需先人工清理注册表行与台账状态，或按轮换流程生成新密码并同步 DB hash。**绝不手工复制旧 config.yaml 里的明文去凑**。

**排障**：常驻 unit `Restart=on-failure` + `StartLimitBurst` 限流；身份缺失时不会无限重启，但需心跳离线告警兜底。`artifact_cache_dir` 已删，目录不存在属正常。`t_operation_batch` 里 3 条历史纳管批次与 6 条历史任务不要随测试数据一起清空。**大制品下发**：`ArtifactClient` HTTP 超时 10min、单台任务预算 15min；60 MB+ ELF 跨机（develop-hy → develop-tg 文件服务 → SSH 写目标机）实测约 5.5 分钟，若超时优先查 `download artifact` 而非误判为凭据问题（§13.14）。

### 13.13 上线记录与 S4 前冻结边界（2026-11-15 14:42 执行）

**已上线（前后端同批，仅控制面）**

| 项 | 结果 |
|---|---|
| `develop-hy:/opt/deployer/deployer` | 58,441,077 → **58,445,396** B；`/opt/deployer/setup.sh restart` 重建 transient unit，新进程 PID 3108792（14:42:25），`127.0.0.1:8080` 在听，日志 `config loaded` 无 panic |
| `develop-tg:/opt/fileupload/bin/fileupload` | 23,852,612 → **23,852,668** B（增量仅 ELF magic 分支；发布中心上传链路此前已在线）；`systemctl restart fileupload`，新进程 14:42:10，`/health/live` 200，属主/权限保持 `fileupload:fileupload 755` |
| 前端 dist | `index-pRWtNwq7.js`（573.64 kB）+ `index-VeL-ya_l.css` → `develop-tg:/opt/starland-admin-web/`；`nginx -t` + `-s reload` ✓；本地与线上 `index.html` md5 `6e64be2e…`、js md5 `3cdd4094…` **完全一致**；js / css 均 200 |
| 跨机兼容 | develop-hy glibc 2.32 编译 → develop-tg glibc 2.39 运行；目标机 `ldd` 无 `not found`（libresolv / libpthread / libc 均解析） |
| RPC 链路 | 网关匿名请求 `401 token is missing`（鉴权层正常）；直连 `127.0.0.1:8080` gRPC 拨号成功、返回业务级 `Unauthenticated: user id is missing`（服务注册 + 拦截器正常，非连接失败）。带有效管理员 token 的完整业务流程待登录后确认 |

**构建/部署手法**：新二进制先写 `<binary>.new` 再 `mv -f` 原子替换（运行中进程持有旧 inode，不会 `Text file busy`）；前端先传 assets、最后传 `index.html`，避免短暂指向不存在的 js。历史 assets 文件保留不删（无引用、无风险、用户已确认不做备份）。

**三表现状（上线前只读核查）**：`t_app_definition` 0 / `t_app_version` 0 / `t_app_deployment` 0 / `t_operation_batch` 3（历史纳管批次，按 §13.12 保留）。当时「测试数据清 0」无需执行；历史 `.tgz` rollback 兼容分支已于 17:36 用真实批次补验通过，验收数据随后也精确清理（§13.14）。

> **✅ 冻结边界已解除（2026-11-15 17:49，见 §13.14）。以下为当时 S4 前的历史约束记录，不再生效。**
>
> 现在**新 deployer 已上线，但目标机仍是旧形态**：mihomo fork 的新二进制未部署（源码改动未上线）、两台中继 `config.yaml` 仍含 `starland-dataplane` 身份段与明文密码、落地机凭据仍在根目录 `config.yaml`、目标机没有 `/opt/<app>/setup.sh` 与常驻 unit。
>
> ~~**禁止对 `relay` / `landing` 发起任何 `StartDeploy` 批次**~~（install / upgrade / rollback 都不行）：新 worker 会把纯业务模板原文写进 `conf/config.yaml`，覆盖现存凭据 → 中继心跳 401 / 落地机接入凭据丢失；且 `restart` 会因缺统一脚本失败。**现已可正常发布**，且 `migrationGate` 会在目标机形态不完整时自动 fail-closed 拒绝。
>
> **允许**：登录、新建应用定义（只写 DB）、上传版本与制品、查看列表 / 配置 / 批次。
>
> **解冻条件**：按 §13.12 完成 S4 单台串行迁移（bcrypt 比对 → 身份文件写入 → 统一脚本/unit 落机 → 配置迁 `conf/` → 换 mihomo 二进制并验心跳），再用一次纯模板 `install` 批次验证。**（✓ 2026-11-15 17:49 全部满足，见 §13.14）**

---

### 13.14 S4 在线迁移、批次验收与缺陷修复（2026-11-15 16:54–17:50 执行）

**总结果**：4 台目标机全部迁到统一形态、护栏上线、3 个真实批次跑通（其中 1 个暴露缺陷，修复后重验通过）、测试数据清理完毕；**§13.13 的冻结边界解除**，发布中心现在可以正常对 relay / landing 发批次。

#### 13.14.1 顺序与时间线

| 时刻 | 动作 | 结果 |
|---|---|---|
| 16:54:33 | 第 2 次控制面上线：`StartDeploy` 加 `migrationGate` 护栏 —— 目标机缺 `/opt/<app>/setup.sh`、relay 缺 `/etc/starland/node-identity` 或权限非 0600 即拒绝批次；走已有 ed25519 通道一次 SSH 探测，连接失败同样 fail-closed | PID 3118354，8080 在听；`go build` + `go test` ✓ |
| 17:0x | 两台中继明文 ↔ DB bcrypt 离线比对 | 首次因 `node-id: "..."` 的 YAML 双引号未剥离，查库未命中；修解析后两台均 **MATCH**（不打印值、不落盘） |
| 17:00:06 | 第 1 台中继 `relay-47-120-10-73-01` 切换 | 常驻 unit、`heartbeat_at` 17:00:22 刷新 |
| 17:04:12 | 确认第 1 台恢复后才切第 2 台 `relay-106-52-77-108-01` | 两台心跳 17:04:28 / 17:04:22 均 online |
| 17:1x | 落地机 `45.32.20.165`（原手写 unit）迁移 | 常驻 `starland-hysteria.service` active、旧 unit inactive、UDP 26019 在听 |
| 17:2x | 落地机 `47.251.121.91`（原 nohup 裸进程，systemd 255）迁移 | 同上，**#48 结案** |
| 17:35–17:49 | 3 个批次验收 → 超时缺陷修复 → 第 3 次控制面上线 → 数据清理 | 见 13.14.3 / 13.14.4 |

**迁移手法**：mihomo 新二进制按 Makefile 正式参数 `-tags with_gvisor -trimpath -ldflags '-w -s'` 重编（61,718,676 B、静态 stripped、gvisor 标记 4809 与线上旧二进制一致；**默认 `go build` 缺 TUN 栈，不能直接上线**）。经 `tools/s4migrate` 复用 `executor.NewSSHExecutor` + `store.GetNode()` 走纳管通道，私钥不落盘。每台先写身份文件（0600）→ 装 6268 B 统一脚本 → 写 `conf/start-args` → 配置迁 `conf/` 并删 3 行凭据 → 换二进制 → `setup.sh restart`；统一脚本自己创建常驻 unit 并接管旧 transient / 手写 unit / nohup。

#### 13.14.2 最终形态全量核对（4 台，只读）

| 检查项 | 2 台中继 | 2 台落地机 |
|---|---|---|
| 护栏探测 | `gate=READY` | `gate=READY` |
| unit | `/etc/systemd/system/starland-mihomo.service`，`Restart=on-failure`，active | `/etc/systemd/system/starland-hysteria.service`，`Restart=on-failure`，active，`legacy_active=inactive` |
| 身份 / 配置 | `/etc/starland/node-identity` 0600；`conf/config.yaml` 0644，`node-password` 命中 **0** | `conf/config.yaml` 0644；UDP 26019 在听；`conf/start-args` 3 行 |
| 二进制 | 61,718,676 B，sha256 与素材一致 | 原二进制不动 |
| 心跳 | 两台 `runtime_status=online`，`heartbeat_at` 持续刷新（17:49 复核） | — |

> **落地机凭据的核查结论**：两台 `/opt/hysteria/config.yaml` 的 sha256 与密码行摘要**完全相同**，属**跨机统一的业务接入配置**，不是本机唯一凭据；TLS 证书在 `/opt/hysteria/` 根目录、不属于 `conf/`，发布中心不会触碰。因此 §13.2 / §13.4 的「零凭据」应精确理解为「零**节点身份**凭据」（无 `node-id` / `node-password` / `gateway-url`），模板仍可包含统一的 `auth.password`。

#### 13.14.3 真实批次验收（同一临时应用，素材与线上实况一致）

素材：ELF = 已上线的 mihomo 二进制（61,718,676 B，sha256 `ef9473bf…`）；模板 = 迁移后的 `conf/config.yaml`（2,812 B，sha256 `d175e752…`）；历史包 = 含同名 `mihomo` 的 `.tgz`（22,727,879 B，gzip magic `1f 8b`）。`CreateAppDefinition` 只提交 3 项，读回推导值 `config_target_path=/opt/mihomo/conf/config.yaml`、`bin_target_path=/opt/mihomo/mihomo`、`restart_cmd=health_check=script:/opt/mihomo/setup.sh`，与 §13.5 一致。

| 批次 | 模式 / 目标 | 结果 | 说明 |
|---|---|---|---|
| `B-b64e0b61…` 17:35:45 | `install` v2（ELF 直写） | **partial（1 failed）** | `download artifact: context deadline exceeded ... while reading body` —— 暴露 60s 硬超时缺陷，见 13.14.4 |
| `B-4f3b7465…` 17:36:46 | `rollback` v1（历史 `.tgz` 解压） | **succeeded / health=passed** | `tar -xzf` 解压分支真实跑通；二进制与模板 sha256 与素材一致、服务 active、心跳 online；**未触发 `Text file busy`** |
| `B-31adfbdc…` 17:43:14 | `install` v2（修复后重验） | **succeeded / health=passed** | ELF 单文件直写 + `mv -f` 原子替换分支通过，耗时约 5.5 分钟 |

#### 13.14.4 发现并修复的缺陷：大体积制品下载超时

- **根因**：`NewArtifactClient` 的 `http.Client{Timeout: 60 * time.Second}` 是硬上限，61.7 MB ELF 跨机从 develop-tg 文件服务下载在读取 body 阶段被切断；22.7 MB `.tgz` 能在 60s 内完成，所以 rollback 反而先通过。另 `deploy_worker.go` 的 `itemCtx=5min` / `long=60s` 对整条链路也偏紧。
- **修复**：`artifact.go` client 超时 → `10min`；`deploy_worker.go` 单台任务预算 → `15min`、`long` → `2min`（`ssh.ClientConfig.Timeout` 只管 TCP 拨号，命令执行时长由 `itemCtx` 约束）；新增 `internal/executor/artifact_fetch_timeout_test.go` 防回归。
- **上线**：17:42:49 第 3 次控制面上线，仅替换 `develop-hy:/opt/deployer/deployer`（58,451,031 B）并 `setup.sh restart`，PID 3123261，8080 在听；`go build ./...` + `go test ./...` ✓。前端 dist 与 fileupload 二进制无需改动。
- **已知限制**：`WriteFile` 的 `session.CombinedOutput` 不受 ctx 约束，超大制品若卡在 SSH 写入阶段需靠任务预算之外的手段发现，列 P2。

#### 13.14.5 数据清理与文档校正

- 按 `app_id` 精确删除本次验收产生的 1 条应用定义、2 个版本、1 条部署台账、3 个批次、3 条子任务、6 条审计；**保留** `t_operation_batch` 3 条历史纳管批次（app_id 为空）、`t_node_task` 6 条历史任务、`t_deploy_audit` 26 条历史审计。清理后三表回到 `0 / 0 / 0`。
- MinIO 中 3 个验收制品对象（`file_id` 固化）**保留**：文件服务只提供上传 / 下载、无删除端点，对象无引用且不参与任何业务，不做强制清理。
- 目标机无残留：`/opt/mihomo/*.new`、`/tmp/starland-deploy-*` 均为 0；二进制 sha256 `ef9473bf…`、模板 sha256 `d175e752…` 与素材一致。
- **文档偏差校正**：`GetAppVersionConfig.merged` 的脱敏示意**后端仍在**（旧前端兼容，仅 `node_id` 非空时返回脱敏文本，无真实合成），此前 §13.4 / §13.7 记为「已删」有误，已修正；文件服务 `validateFileType` 里「deployer 拉取后与本机 identity 合成」是过时注释，已改为「原文写入、身份由应用自读」（仅注释，Go 二进制行为不变，无需重新上线）。
- **§13.2 / §13.4「零凭据」** 精确化为「零节点身份凭据」，见 13.14.2。

#### 13.14.6 剩余（P2，非阻断）

1. 60 MB+ 制品跨机下发约 5.5 分钟偏慢：可让 deployer 走文件服务内网地址，或在内部分发阶段压缩（用户已允许「上传裸 ELF、内部分发可打包」）。
2. `deployer.gateway_url` 单值配置按节点覆盖（HY 本机中继目前绕公网）。
3. 多文件制品的内部分发打包、host key 签名 / mTLS、控制面目录重排、`control` / `web` 服务类型。
4. 心跳离线告警（身份文件 fail-closed 时虽不会无限重启，仍需告警兜底）。

---

### 13.15 收尾复核与清理（2026-11-16 08:2x，A + B 已执行）

**范围**：修正已上线的错误文案、清理死代码与残留、校正本文档自相矛盾处。不含 C（源码提交）；未触碰数据面与目标机。

| 层 | 改动 | 验证 |
|---|---|---|
| 前端文案 | `NodeIdentityPage.tsx` 三处错误事实改为 §13.4 口径（node_id 沿用台账随机值、`ConfirmBootstrap` 内存签发且明文不回显、`gateway_url` 取单值配置）；`AppsPage.tsx` 空状态去掉「配置路径、启停枚举」 | 线上 js grep：旧文案 0、新文案 1 |
| 前端死代码 | 删零引用的 `usePolling.ts`、`serviceTypeOf()`、`Verdict` 的 `'执行'`、`configNodeId` prop；`isBatchTerminal()` 收敛为契约层唯一实现，`model.ts` 改为 re-export | `tsc --noEmit` ✓ `vite build` ✓（573.64 kB） |
| 契约注释 | `deployer-contract.ts` 四处过时注释（systemd 分支限定后端兼容、proto 不 reserved、`merged` 后端仍在） | 同上 |
| 本文档 | §13.1 删除清单口径、§13.9 S0 的 proto reserved、§13.11 原型「已同步」描述、§13.14 小节号 14.x→13.14.x 及交叉引用 | 全文 grep 无残留 |
| 线上产物 | 重新部署 `index-DYGTsP1x.js` + 原 css，先传 assets 后传 index.html；非交互 SSH 的 PATH 里没有 `openresty` 命令，改用 `systemctl reload openresty` | 本地 / 线上 md5 一致，index / js / css 均 200，served html 指向新 js |
| 远端清理 | 删 `/tmp/mihomo-config.bak-20261114151450`（含明文 `node-password` / `gateway-url`）、7 个旧二进制与工具副本（约 319 MB）、仓库 8 个 `.bak-*`；`/opt/deployer/conf/config.yaml` 删掉失效的 `artifact_cache_dir` 键 | 全部不存在、`artifact_cache_dir=0`、deployer PID 3123261 与 8080 正常、磁盘 72%→71% |
| 本地清理 | 删 `.tmp_fu/`（含 65 B 明文 service token）、被误跟踪的 `vite.config.ts.timestamp-*.mjs`、4 个硬编码管理员明文密码的一次性诊断脚本；保留通用 `feedback-file-tool.mjs` | 目录 / 文件均不存在，`tsc --noEmit` ✓ |
| 数据面复核 | 未改动 | 三表 0 / 0 / 0，两台中继 online 且 08:29 心跳持续刷新 |

**⚠️ 安全待办（删文件不能清除 git 历史）**：提交 `e092547` 里的 `.tmp_fu/svc_token.txt`（65 B 明文 `X-Service-Token`）与 4 个已删诊断脚本里的管理员账号明文密码**仍在 git 对象中**。必须轮换该管理员密码与文件服务 service token（同步 `.env` 的 `VITE_FILE_SERVICE_TOKEN` 与 fileupload 侧配置），必要时清理仓库历史；仅删工作区文件无效。今后不得把凭据写进 `tools/` 脚本或仓库。

**未做（C，需另行授权）**：本地仍有 9 项修改 + 8 项未跟踪 + 22 项删除（本次产生的删除也在此列）、远端 `starland` 仍有大量修改 / 未跟踪（含整个 `apps/deployer/`）未提交；`apps/deployer/tools/` 的 4 个一次性运维工具源码保留在仓库目录但未纳管；13 条历史 pending 任务台账未收口。


