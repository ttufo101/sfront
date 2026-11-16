// 冻结契约：starland.Deployer（module: starland.deployer.com）的请求/响应类型与 module 映射。
// 类型直接对齐 deployer.proto；字段名沿用网关 native-json 的 snake_case（与 admin-contract.ts 一致）。
// deployer 是独立服务，契约单独维护，页面不得自维护第二套方法清单。
// 安全约定：台账零凭据列；前端只提交 operation_id 与有限参数，命令文本由后端白名单生成。
// 上下架：listing_status 由 admin.SetNodeListing 维护，deployer 只读；台账不再有 enabled 字段。
// 删除：由 admin.DeleteNodeAsset 单事务软删台账（deleted_at）并硬删依赖行；deployer 只按 include_deleted 过滤展示。

import { xrpcCall, type CallOptions } from './transport'

export const DEPLOYER_MODULE = 'starland.deployer.com'

// ---- 节点台账 ----

export interface NodeAsset {
  node_id: string
  node_type: string // relay / landing
  display_name: string
  region: string
  idc: string
  isp: string
  public_ip: string
  private_ip: string
  ssh_host: string
  ssh_port: number
  ssh_user: string
  host_key_fingerprint: string // 人工确认后固定的 sshd 主机公钥指纹
  auth_status: string // pending / ready / failed
  listing_status: string // listed 已上架 / delisted 已下架；由 admin.SetNodeListing 写入
  last_probe_at: string
  remark: string
  created_at: string
  updated_at: string
  deleted_at: string // 软删除时间；空=在用，非空=已删除（历史服务器）
}

export interface ListNodeAssetsRequest {
  node_type?: string // 空表示全部
  keyword?: string
  listing_status?: string // 空=全部；listed / delisted
  include_deleted?: boolean // true=包含已软删除节点，供「历史服务器」页使用；默认只返回在用
}
export interface ListNodeAssetsResponse {
  nodes: NodeAsset[]
}

/** 台账字段（创建/更新共用），刻意不含任何密码或私钥字段，也不含上下架状态。 */
export interface NodeAssetInput {
  node_id: string
  node_type: string
  display_name: string
  region: string
  idc: string
  isp: string
  public_ip: string
  private_ip: string
  ssh_host: string
  ssh_port: number
  ssh_user: string
  remark: string
}

export type CreateNodeAssetRequest = NodeAssetInput
export interface CreateNodeAssetResponse {
  node: NodeAsset
}

export type UpdateNodeAssetRequest = NodeAssetInput
export interface UpdateNodeAssetResponse {
  node: NodeAsset
}

// ---- 带外纳管辅助 ----

export interface GetBootstrapCommandRequest {
  node_id: string
}
export interface GetBootstrapCommandResponse {
  command: string // 可粘贴到节点执行的一行命令，仅含公钥
  public_key: string
  receipt_prefix: string // STARLAND_RECEIPT
}

export interface ConfirmBootstrapRequest {
  node_id: string
  receipt: string // STARLAND_RECEIPT|hostname|SHA256:...
  confirmed_fingerprint: string // 管理员人工核对后输入的指纹
}
export interface ConfirmBootstrapResponse {
  node: NodeAsset
  connected: boolean
  message: string
}

export interface TestConnectionRequest {
  node_id: string
}
export interface TestConnectionResponse {
  connected: boolean
  message: string
}

export interface GetPublicKeyRequest {}
export interface GetPublicKeyResponse {
  public_key: string // authorized_keys 行，接口永不返回私钥
  key_version: number
}

// ---- 白名单批量操作 ----

export interface ListOperationsRequest {
  node_type: string
}
export interface OperationInfo {
  operation_id: string
  node_type: string
  label: string
  param_keys: string[] // 该 operation 允许的参数名白名单
}
export interface ListOperationsResponse {
  operations: OperationInfo[]
}

export interface SubmitOperationBatchRequest {
  target_node_ids: string[]
  operation_id: string // 后端白名单映射，前端不得传命令文本
  params_json: string // 扁平 string map，仅枚举/整数参数
  client_request_id: string // 幂等键
}
export interface SubmitOperationBatchResponse {
  batch_id: string
}

export interface NodeTask {
  task_id: string
  batch_id: string
  node_id: string
  kind: string // command / collect / install / upgrade / rollback
  status: string // queued / running / succeeded / failed / canceled
  exit_code: number
  output: string
  error: string
  started_at: string
  finished_at: string
}

export interface OperationBatch {
  batch_id: string
  operator: string
  operation_id: string
  params_json: string
  target_node_ids: string[]
  client_request_id: string
  status: string // queued / running / succeeded / partial / failed / canceled
  total: number
  succeeded: number
  failed: number
  created_at: string
  finished_at: string
  tasks: NodeTask[]
}

export interface GetOperationBatchRequest {
  batch_id: string
}
export interface GetOperationBatchResponse {
  batch: OperationBatch
}

export interface CancelOperationBatchRequest {
  batch_id: string
}
export interface CancelOperationBatchResponse {
  success: boolean
  canceled: number // 仅队列中的任务可取消
}

export interface GetTaskLogRequest {
  task_id: string
}
export interface GetTaskLogResponse {
  task_id: string
  log: string
}

// ---- 应用发布中心：App -> AppVersion -> AppDeployment ----
// 事实源：proto/starland/deployer.proto + release-center.md。
// 前端生命周期命令统一为 script:/opt/<应用目录>/setup.sh（动作 start|stop|restart|status）或 none；
// 后端仍保留 systemd:<unit> 解析分支，仅用于兼容 DB 里旧应用定义行（§13.5 / §13.7）；
// 路径与生命周期命令全部由后端按 service_type 白名单推导（release-center.md §13.5）。
// 旧字段保留填推导值，供旧前端 dist 解析；CreateAppDefinition 只提交 3 项。

export type ServiceType = 'relay' | 'landing'
export type DeployMode = 'install' | 'upgrade' | 'rollback'

export interface AppDefinition {
  app_id: string
  app_key: string
  display_name: string
  service_type: string
  config_filename: string
  config_target_path: string
  bin_target_path: string
  identity_path: string // 已退役（兼容字段）：身份改由应用自读 /etc/starland/node-identity
  start_cmd: string
  stop_cmd: string
  restart_cmd: string
  health_check: string
  created_by: string
  created_at: string
  updated_at: string
}
export interface ListAppDefinitionsRequest {}
export interface ListAppDefinitionsResponse { apps: AppDefinition[] }
export interface GetAppDefinitionRequest { app_id: string }
export interface GetAppDefinitionResponse { app: AppDefinition }
/** 其余路径/命令字段由后端推导；proto 不改动，旧字段与编号原样保留但不生效（兼容旧前端 dist，§13.5 / §13.7）。 */
export interface CreateAppDefinitionRequest {
  app_key: string
  display_name: string
  service_type: ServiceType
  config_filename?: string
}
export interface CreateAppDefinitionResponse { app: AppDefinition }

export interface AppVersion {
  version_id: string
  app_id: string
  version_no: number
  version_label: string // vN，后端自增
  bin_file_id: string
  bin_filename: string
  bin_sha256: string
  bin_size: string // int64，十进制字符串
  config_file_id: string
  config_filename: string
  config_sha256: string
  change_note: string
  is_stable: boolean
  created_by: string
  created_at: string
}
// 对应 proto 的 ListDeployVersionsRequest/Response（为避与 admin.proto 同名消息冲突而改名，RPC 名仍是 ListAppVersions）。
export interface ListAppVersionsRequest { app_id: string }
export interface ListAppVersionsResponse { versions: AppVersion[] }
export interface CreateAppVersionRequest {
  app_id: string
  bin_file_id: string
  bin_filename: string
  bin_sha256: string
  bin_size: string
  config_file_id: string
  config_filename: string
  config_sha256: string
  change_note: string
  is_stable: boolean
}
export interface CreateAppVersionResponse { version: AppVersion }
export interface GetAppVersionConfigRequest {
  app_id: string
  version_label: string
  node_id?: string // 兼容字段：传则后端附带脱敏示意文本，无真实合成
}
export interface GetAppVersionConfigResponse {
  version_label: string
  template: string
  /** 兼容字段：后端仍会返回脱敏示意文本（仅 node_id 非空时），无真实合成；前端不消费（§13.14.5 已校正）。 */
  merged?: string
}

/** current_version 是实况版本：健康检查失败也记本次目标版本，status=failed。 */
export interface AppDeployment {
  app_id: string
  node_id: string
  public_ip: string
  display_name: string
  node_type: string
  current_version: string
  last_success_version: string
  previous_version: string
  status: string
  last_batch_id: string
  updated_at: string
}
export interface ListAppDeploymentsRequest { app_id: string }
export interface ListAppDeploymentsResponse { deployments: AppDeployment[] }

export interface DeployableNode {
  node_id: string
  public_ip: string
  display_name: string
  node_type: string
  /** 已退役（兼容字段）：前端不再消费，身份由应用自读本机文件。 */
  identity_ready?: boolean
  current_version: string
  listing_status: string
}
export interface ListDeployableNodesRequest { service_type: string; app_id?: string }
export interface ListDeployableNodesResponse { nodes: DeployableNode[] }

export interface DeploySnapshot { node_id: string; current_version: string }
export interface StartDeployRequest {
  app_id: string
  mode: DeployMode
  target_version: string // 人工统一指定，后端不计算
  node_ids: string[] // 列表页只读快照，次级页面不可新增
  snapshots: DeploySnapshot[]
  concurrency: number
  client_request_id: string
  confirm_drift?: boolean
}
export interface StartDeployResponse {
  success: boolean
  batch_id: string
  message: string
  confirm_required?: boolean
  drifted_nodes?: string[]
  blocked_reasons?: string[]
}

export interface DeployItem {
  task_id: string
  batch_id: string
  node_id: string
  public_ip: string
  from_version: string
  to_version: string
  status: string // queued / running / succeeded / failed / skipped
  health_result: string
  error: string
  started_at: string
  finished_at: string
}
export interface DeployBatch {
  batch_id: string
  app_id: string
  mode: string
  target_version: string
  operator: string
  status: string
  total: number
  succeeded: number
  failed: number
  skipped: number
  concurrency: number
  created_at: string
  finished_at: string
  items: DeployItem[]
}
export interface ListDeployBatchesRequest { app_id?: string; mode?: string; limit?: number }
export interface ListDeployBatchesResponse { batches: DeployBatch[] }
export interface GetDeployBatchRequest { batch_id: string }
export interface GetDeployBatchResponse { batch: DeployBatch }
export interface RetryDeployItemRequest { batch_id: string; node_id: string }
export interface RetryDeployItemResponse { success: boolean; message: string }

// ---- 集中映射 ----

export interface DeployerContract {
  ListNodeAssets: { req: ListNodeAssetsRequest; res: ListNodeAssetsResponse }
  CreateNodeAsset: { req: CreateNodeAssetRequest; res: CreateNodeAssetResponse }
  UpdateNodeAsset: { req: UpdateNodeAssetRequest; res: UpdateNodeAssetResponse }
  GetBootstrapCommand: { req: GetBootstrapCommandRequest; res: GetBootstrapCommandResponse }
  ConfirmBootstrap: { req: ConfirmBootstrapRequest; res: ConfirmBootstrapResponse }
  TestConnection: { req: TestConnectionRequest; res: TestConnectionResponse }
  GetPublicKey: { req: GetPublicKeyRequest; res: GetPublicKeyResponse }
  ListOperations: { req: ListOperationsRequest; res: ListOperationsResponse }
  SubmitOperationBatch: { req: SubmitOperationBatchRequest; res: SubmitOperationBatchResponse }
  GetOperationBatch: { req: GetOperationBatchRequest; res: GetOperationBatchResponse }
  CancelOperationBatch: { req: CancelOperationBatchRequest; res: CancelOperationBatchResponse }
  GetTaskLog: { req: GetTaskLogRequest; res: GetTaskLogResponse }
  ListAppDefinitions: { req: ListAppDefinitionsRequest; res: ListAppDefinitionsResponse }
  GetAppDefinition: { req: GetAppDefinitionRequest; res: GetAppDefinitionResponse }
  CreateAppDefinition: { req: CreateAppDefinitionRequest; res: CreateAppDefinitionResponse }
  CreateAppVersion: { req: CreateAppVersionRequest; res: CreateAppVersionResponse }
  ListAppVersions: { req: ListAppVersionsRequest; res: ListAppVersionsResponse }
  GetAppVersionConfig: { req: GetAppVersionConfigRequest; res: GetAppVersionConfigResponse }
  ListAppDeployments: { req: ListAppDeploymentsRequest; res: ListAppDeploymentsResponse }
  ListDeployableNodes: { req: ListDeployableNodesRequest; res: ListDeployableNodesResponse }
  StartDeploy: { req: StartDeployRequest; res: StartDeployResponse }
  ListDeployBatches: { req: ListDeployBatchesRequest; res: ListDeployBatchesResponse }
  GetDeployBatch: { req: GetDeployBatchRequest; res: GetDeployBatchResponse }
  RetryDeployItem: { req: RetryDeployItemRequest; res: RetryDeployItemResponse }
}

export type DeployerMethod = keyof DeployerContract

/** 类型安全的 deployer 调用（与 adminCall 平行，走同一网关 /startlandapi）。 */
export function callDeployer<K extends DeployerMethod>(
  method: K,
  params: DeployerContract[K]['req'],
  opts?: CallOptions,
): Promise<DeployerContract[K]['res']> {
  return xrpcCall<DeployerContract[K]['res']>(
    DEPLOYER_MODULE,
    method,
    params as Record<string, unknown>,
    opts,
  )
}

/** 批量任务是否已进入终态（前端据此停止轮询）。 */
export function isBatchTerminal(status: string): boolean {
  return ['succeeded', 'partial', 'failed', 'canceled'].includes(status)
}
