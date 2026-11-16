import io, sys

P = '/root/sproj/proto/starland/deployer.proto'
s = io.open(P, encoding='utf-8').read()

RPC_ANCHOR = '  rpc GetTaskLog (GetTaskLogRequest) returns (GetTaskLogResponse);\n}'
RPC_BLOCK = '''  rpc GetTaskLog (GetTaskLogRequest) returns (GetTaskLogResponse);

  // ---- 应用发布中心：App -> AppVersion -> AppDeployment 三层模型 ----
  // 所有接口要求管理员 access token；StartDeploy 只写任务表立即返回 batch_id（异步执行）。
  rpc ListAppDefinitions (ListAppDefinitionsRequest) returns (ListAppDefinitionsResponse);
  rpc GetAppDefinition (GetAppDefinitionRequest) returns (GetAppDefinitionResponse);
  rpc CreateAppDefinition (CreateAppDefinitionRequest) returns (CreateAppDefinitionResponse);
  // 版本号由后端 UNIQUE(app_id, version_no) + 行锁自增，创建后制品与配置模板不可变。
  rpc CreateAppVersion (CreateAppVersionRequest) returns (CreateAppVersionResponse);
  rpc ListAppVersions (ListAppVersionsRequest) returns (ListAppVersionsResponse);
  // 查看统一配置模板；可选传 node_id 返回「模板 + 本机 identity」合成后的脱敏结果。
  rpc GetAppVersionConfig (GetAppVersionConfigRequest) returns (GetAppVersionConfigResponse);
  // 升级 / 回滚列表的唯一事实源；只返回当前实况与历史信息，绝不返回「建议目标版本」。
  rpc ListAppDeployments (ListAppDeploymentsRequest) returns (ListAppDeploymentsResponse);
  // 部署弹窗的节点候选：按 service_type 过滤、排除已软删节点、标记 identity 前置。
  rpc ListDeployableNodes (ListDeployableNodesRequest) returns (ListDeployableNodesResponse);
  // 一次性初始化节点身份：deployer 内存生成随机密码，明文只经 SSH 写目标机 0600 文件，
  // bcrypt hash 直写同一库；审计只记 node_id，响应绝不回显明文。
  rpc InitNodeIdentity (InitNodeIdentityRequest) returns (InitNodeIdentityResponse);
  // 三入口（部署 / 升级 / 回滚）汇聚的唯一动作；mode = install / upgrade / rollback。
  // 后端不计算目标版本，只做逐节点校验 + 漂移比对 + 写任务表。
  rpc StartDeploy (StartDeployRequest) returns (StartDeployResponse);
  rpc ListDeployBatches (ListDeployBatchesRequest) returns (ListDeployBatchesResponse);
  rpc GetDeployBatch (GetDeployBatchRequest) returns (GetDeployBatchResponse);
  // 重试是同一批次续跑，不产生新批次；回滚必须走已部署节点 tab 人工指定目标版本。
  rpc RetryDeployItem (RetryDeployItemRequest) returns (RetryDeployItemResponse);
}'''

MESSAGES = '''
// ==================== 应用发布中心 ====================
// 说明：命令类字段（start_cmd / stop_cmd / restart_cmd / health_check）一律为枚举标识，
// 由 deployer 白名单映射成固定命令，禁止前端传命令文本或路径。
message AppDefinition {
  string app_id = 1;
  string app_key = 2;
  string display_name = 3;
  string service_type = 4;        // P0 只有 relay / landing
  string config_filename = 5;
  string config_target_path = 6;
  string bin_target_path = 7;
  string identity_path = 8;       // 本机身份文件，不属于版本配置
  string start_cmd = 9;
  string stop_cmd = 10;
  string restart_cmd = 11;
  string health_check = 12;
  string created_by = 13;
  string created_at = 14;
  string updated_at = 15;
}
message ListAppDefinitionsRequest {}
message ListAppDefinitionsResponse { repeated AppDefinition apps = 1; }
message GetAppDefinitionRequest { string app_id = 1; }
message GetAppDefinitionResponse { AppDefinition app = 1; }
message CreateAppDefinitionRequest {
  string app_key = 1;
  string display_name = 2;
  string service_type = 3;
  string config_filename = 4;
  string config_target_path = 5;
  string bin_target_path = 6;
  string identity_path = 7;
  string start_cmd = 8;
  string stop_cmd = 9;
  string restart_cmd = 10;
  string health_check = 11;
}
message CreateAppDefinitionResponse { AppDefinition app = 1; }

// 制品与统一配置模板都以 file_id + sha256 固化在 MinIO deployer-artifacts/ 前缀，不可覆盖。
// bin_size 用十进制字符串，遵循网关 int64 序列化约定。
message AppVersion {
  string version_id = 1;
  string app_id = 2;
  int32 version_no = 3;
  string version_label = 4;       // vN
  string bin_file_id = 5;
  string bin_filename = 6;
  string bin_sha256 = 7;
  string bin_size = 8;
  string config_file_id = 9;
  string config_filename = 10;
  string config_sha256 = 11;
  string change_note = 12;
  bool is_stable = 13;
  string created_by = 14;
  string created_at = 15;
}
message ListAppVersionsRequest { string app_id = 1; }
message ListAppVersionsResponse { repeated AppVersion versions = 1; }
message CreateAppVersionRequest {
  string app_id = 1;
  string bin_file_id = 2;
  string bin_filename = 3;
  string bin_sha256 = 4;
  string bin_size = 5;
  string config_file_id = 6;
  string config_filename = 7;
  string config_sha256 = 8;
  string change_note = 9;
  bool is_stable = 10;
}
message CreateAppVersionResponse { AppVersion version = 1; }
message GetAppVersionConfigRequest {
  string app_id = 1;
  string version_label = 2;
  string node_id = 3;             // 可选：返回按该节点合成后的结果（身份段脱敏）
}
message GetAppVersionConfigResponse {
  string version_label = 1;
  string template = 2;            // 统一模板原文，不含任何节点身份
  string merged = 3;              // 模板 + identity 3 行；node_id 为空时为空串
}

// current_version 是实况版本：健康检查失败时仍记本次目标版本，status=failed，
// last_success_version / previous_version 保持不变，绝不假装节点还在旧版本。
message AppDeployment {
  string app_id = 1;
  string node_id = 2;
  string public_ip = 3;
  string display_name = 4;
  string node_type = 5;
  string current_version = 6;
  string last_success_version = 7;
  string previous_version = 8;
  string status = 9;
  string last_batch_id = 10;
  string updated_at = 11;
}
message ListAppDeploymentsRequest { string app_id = 1; }
message ListAppDeploymentsResponse { repeated AppDeployment deployments = 1; }

message DeployableNode {
  string node_id = 1;
  string public_ip = 2;
  string display_name = 3;
  string node_type = 4;
  bool identity_ready = 5;
  string current_version = 6;
  string listing_status = 7;
}
message ListDeployableNodesRequest {
  string service_type = 1;
  string app_id = 2;
}
message ListDeployableNodesResponse { repeated DeployableNode nodes = 1; }

// dataplane_node_id 必须由运维显式确认：既有约定允许它与 t_node_asset.node_id 不对齐，
// 且不新增 external_ref 映射列，后端不得静默推导。
message InitNodeIdentityRequest {
  string node_id = 1;
  string dataplane_node_id = 2;
}
message InitNodeIdentityResponse {
  bool success = 1;
  string message = 2;             // 绝不回显明文密码
}

// 漂移轻量提示：提交携带勾选时的版本快照，后端比对台账，不一致返回 drifted_nodes
// 并置 confirm_required=true；人工确认后带 confirm_drift=true 二次提交，不做强乐观锁。
message DeploySnapshot {
  string node_id = 1;
  string current_version = 2;
}
message StartDeployRequest {
  string app_id = 1;
  string mode = 2;                // install / upgrade / rollback
  string target_version = 3;      // 人工指定的统一目标版本，后端不计算
  repeated string node_ids = 4;   // 列表页只读快照，次级页面不可新增
  repeated DeploySnapshot snapshots = 5;
  int32 concurrency = 6;
  string client_request_id = 7;
  bool confirm_drift = 8;
}
message StartDeployResponse {
  bool success = 1;
  string batch_id = 2;
  string message = 3;
  bool confirm_required = 4;
  repeated string drifted_nodes = 5;
  repeated string blocked_reasons = 6;  // 目标>当前=升级、制品缺失、目标=当前全部跳过等
}

message DeployItem {
  string task_id = 1;
  string node_id = 2;
  string public_ip = 3;
  string from_version = 4;
  string to_version = 5;
  string status = 6;              // queued / running / succeeded / failed / skipped
  string health_result = 7;
  string error = 8;
  string started_at = 9;
  string finished_at = 10;
}
message DeployBatch {
  string batch_id = 1;
  string app_id = 2;
  string mode = 3;
  string target_version = 4;
  string operator = 5;
  string status = 6;
  int32 total = 7;
  int32 succeeded = 8;
  int32 failed = 9;
  int32 skipped = 10;
  int32 concurrency = 11;
  string created_at = 12;
  string finished_at = 13;
  repeated DeployItem items = 14;
}
message ListDeployBatchesRequest {
  string app_id = 1;
  string mode = 2;
  int32 limit = 3;
}
message ListDeployBatchesResponse { repeated DeployBatch batches = 1; }
message GetDeployBatchRequest { string batch_id = 1; }
message GetDeployBatchResponse { DeployBatch batch = 1; }
message RetryDeployItemRequest {
  string batch_id = 1;
  string node_id = 2;
}
message RetryDeployItemResponse {
  bool success = 1;
  string message = 2;
}
'''

if 'rpc StartDeploy ' in s:
    print('ALREADY_PATCHED'); sys.exit(0)
if s.count(RPC_ANCHOR) != 1:
    print('RPC_ANCHOR_COUNT', s.count(RPC_ANCHOR)); sys.exit(1)
s = s.replace(RPC_ANCHOR, RPC_BLOCK, 1)
s = s.rstrip('\n') + '\n' + MESSAGES
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('S2_PROTO_PATCH_OK bytes', len(s.encode('utf-8')))
