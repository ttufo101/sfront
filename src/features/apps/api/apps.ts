// 应用发布中心 API（独立 module starland.deployer.com，全部经网关 + requireAdmin 二次鉴权）。
// 事实源：src/lib/xrpc/deployer-contract.ts + proto/starland/deployer.proto + release-center.md。
// 页面不得自维护第二套方法清单，也不得直接 fetch。

import { callDeployer } from '@/lib/xrpc/deployer-contract'
import type {
  ListAppDefinitionsResponse,
  GetAppDefinitionRequest,
  GetAppDefinitionResponse,
  CreateAppDefinitionRequest,
  CreateAppDefinitionResponse,
  UpdateAppDefinitionRequest,
  UpdateAppDefinitionResponse,
  CreateAppVersionRequest,
  CreateAppVersionResponse,
  ListAppVersionsRequest,
  ListAppVersionsResponse,
  GetAppVersionConfigRequest,
  GetAppVersionConfigResponse,
  ListAppDeploymentsRequest,
  ListAppDeploymentsResponse,
  ListDeployableNodesRequest,
  ListDeployableNodesResponse,
  StartDeployRequest,
  StartDeployResponse,
  ListDeployBatchesRequest,
  ListDeployBatchesResponse,
  GetDeployBatchRequest,
  GetDeployBatchResponse,
  RetryDeployItemRequest,
  RetryDeployItemResponse,
} from '@/lib/xrpc/deployer-contract'

// ---- 应用定义 ----

export function listAppDefinitions(): Promise<ListAppDefinitionsResponse> {
  return callDeployer('ListAppDefinitions', {})
}

export function getAppDefinition(appId: string): Promise<GetAppDefinitionResponse> {
  return callDeployer('GetAppDefinition', { app_id: appId } satisfies GetAppDefinitionRequest)
}

export function createAppDefinition(
  params: CreateAppDefinitionRequest,
): Promise<CreateAppDefinitionResponse> {
  return callDeployer('CreateAppDefinition', params)
}

export function updateAppDefinition(
  params: UpdateAppDefinitionRequest,
): Promise<UpdateAppDefinitionResponse> {
  return callDeployer('UpdateAppDefinition', params)
}

// ---- 版本 ----

export function listAppVersions(appId: string): Promise<ListAppVersionsResponse> {
  return callDeployer('ListAppVersions', { app_id: appId } satisfies ListAppVersionsRequest)
}

export function createAppVersion(params: CreateAppVersionRequest): Promise<CreateAppVersionResponse> {
  return callDeployer('CreateAppVersion', params)
}

export function getAppVersionConfig(
  params: GetAppVersionConfigRequest,
): Promise<GetAppVersionConfigResponse> {
  return callDeployer('GetAppVersionConfig', params)
}

// ---- 部署台账与可选节点 ----

export function listAppDeployments(appId: string): Promise<ListAppDeploymentsResponse> {
  return callDeployer('ListAppDeployments', { app_id: appId } satisfies ListAppDeploymentsRequest)
}

/** 按 service_type 过滤、排除已软删/已下架节点。identity_ready 为兼容字段，前端不再消费。 */
export function listDeployableNodes(
  params: ListDeployableNodesRequest,
): Promise<ListDeployableNodesResponse> {
  return callDeployer('ListDeployableNodes', params)
}

// ---- 统一发布动作 ----

/** 三入口（install / upgrade / rollback）汇聚此处。返回 confirm_required 时需人工确认后二次提交。 */
export function startDeploy(params: StartDeployRequest): Promise<StartDeployResponse> {
  return callDeployer('StartDeploy', params)
}

export function listDeployBatches(
  params: ListDeployBatchesRequest = {},
): Promise<ListDeployBatchesResponse> {
  return callDeployer('ListDeployBatches', params)
}

export function getDeployBatch(batchId: string): Promise<GetDeployBatchResponse> {
  return callDeployer('GetDeployBatch', { batch_id: batchId } satisfies GetDeployBatchRequest)
}

/** 同批次内续跑失败项，不产生新批次。 */
export function retryDeployItem(
  params: RetryDeployItemRequest,
): Promise<RetryDeployItemResponse> {
  return callDeployer('RetryDeployItem', params)
}
