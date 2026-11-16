// 节点运维台 API（独立 module starland.deployer.com，不经 admin）。
// 所有调用都经网关 JWT 校验 + deployer 内部 requireAdmin 二次鉴权与审计。
// 注意：本页面不采集资源指标，CPU/内存等监控数据后续从外部系统读取。

import { callDeployer } from '@/lib/xrpc/deployer-contract'
import type {
  ListNodeAssetsRequest,
  ListNodeAssetsResponse,
  CreateNodeAssetRequest,
  CreateNodeAssetResponse,
  UpdateNodeAssetRequest,
  UpdateNodeAssetResponse,
  GetBootstrapCommandRequest,
  GetBootstrapCommandResponse,
  ConfirmBootstrapRequest,
  ConfirmBootstrapResponse,
  TestConnectionRequest,
  TestConnectionResponse,
  GetPublicKeyResponse,
  ListOperationsRequest,
  ListOperationsResponse,
  SubmitOperationBatchRequest,
  SubmitOperationBatchResponse,
  GetOperationBatchRequest,
  GetOperationBatchResponse,
  CancelOperationBatchRequest,
  CancelOperationBatchResponse,
  GetTaskLogRequest,
  GetTaskLogResponse,
} from '@/lib/xrpc/deployer-contract'

export function listNodeAssets(params: ListNodeAssetsRequest = {}): Promise<ListNodeAssetsResponse> {
  return callDeployer('ListNodeAssets', params)
}

export function createNodeAsset(params: CreateNodeAssetRequest): Promise<CreateNodeAssetResponse> {
  return callDeployer('CreateNodeAsset', params)
}

export function updateNodeAsset(params: UpdateNodeAssetRequest): Promise<UpdateNodeAssetResponse> {
  return callDeployer('UpdateNodeAsset', params)
}

/** 读取 deployer 认证公钥行（只读，永不返回私钥）。 */
export function getPublicKey(): Promise<GetPublicKeyResponse> {
  return callDeployer('GetPublicKey', {})
}

/** 生成带外预置公钥的一键命令，命令内只有公钥，没有私钥。 */
export function getBootstrapCommand(params: GetBootstrapCommandRequest): Promise<GetBootstrapCommandResponse> {
  return callDeployer('GetBootstrapCommand', params)
}

/** 解析回执 + 人工确认指纹，后端固化指纹后用纯公钥重连验证（不做 TOFU）。 */
export function confirmBootstrap(params: ConfirmBootstrapRequest): Promise<ConfirmBootstrapResponse> {
  return callDeployer('ConfirmBootstrap', params)
}

export function testConnection(params: TestConnectionRequest): Promise<TestConnectionResponse> {
  return callDeployer('TestConnection', params)
}

export function listOperations(params: ListOperationsRequest): Promise<ListOperationsResponse> {
  return callDeployer('ListOperations', params)
}

/** 提交多节点批量操作，立即返回 batch_id，实际执行全异步。 */
export function submitOperationBatch(params: SubmitOperationBatchRequest): Promise<SubmitOperationBatchResponse> {
  return callDeployer('SubmitOperationBatch', params)
}

export function getOperationBatch(params: GetOperationBatchRequest): Promise<GetOperationBatchResponse> {
  return callDeployer('GetOperationBatch', params)
}

/** 仅能取消尚未开始的子任务，已发出的命令无法撤销。 */
export function cancelOperationBatch(params: CancelOperationBatchRequest): Promise<CancelOperationBatchResponse> {
  return callDeployer('CancelOperationBatch', params)
}

export function getTaskLog(params: GetTaskLogRequest): Promise<GetTaskLogResponse> {
  return callDeployer('GetTaskLog', params)
}
