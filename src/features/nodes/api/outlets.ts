// 落地出口声明式模型 API（Admin 模块）。
// 端口是唯一主键；预览零写操作，人工确认后才落库 + 发纯配置批次。

import { adminCall } from '@/lib/xrpc/transport'
import type {
  ListProxyOutletsRequest,
  ListProxyOutletsResponse,
  SetOutletListingRequest,
  SetOutletListingResponse,
  GetProxyRuntimeConfigRequest,
  GetProxyRuntimeConfigResponse,
  UpdateProxyRuntimeConfigRequest,
  UpdateProxyRuntimeConfigResponse,
  PreviewProxyChangeRequest,
  PreviewProxyChangeResponse,
  PublishProxyChangeRequest,
  PublishProxyChangeResponse,
} from '@/lib/xrpc/admin-contract'

export function listProxyOutlets(
  params: ListProxyOutletsRequest = {},
): Promise<ListProxyOutletsResponse> {
  return adminCall('ListProxyOutlets', params)
}

/** 纯客户端可见性开关：不改中转规则、不发批次。 */
export function setOutletListing(params: SetOutletListingRequest): Promise<SetOutletListingResponse> {
  return adminCall('SetOutletListing', params)
}

export function getProxyRuntimeConfig(
  params: GetProxyRuntimeConfigRequest = {},
): Promise<GetProxyRuntimeConfigResponse> {
  return adminCall('GetProxyRuntimeConfig', params)
}

export function updateProxyRuntimeConfig(
  params: UpdateProxyRuntimeConfigRequest,
): Promise<UpdateProxyRuntimeConfigResponse> {
  return adminCall('UpdateProxyRuntimeConfig', params)
}

/** 渲染 + dry-run + diff，服务端不写库、不建版本、不发批次。 */
export function previewProxyChange(
  params: PreviewProxyChangeRequest,
): Promise<PreviewProxyChangeResponse> {
  return adminCall('PreviewProxyChange', params)
}

/** diff 预览确认后调用：落库 + 建 config_only 版本 + 发批次。 */
export function publishProxyChange(
  params: PublishProxyChangeRequest,
): Promise<PublishProxyChangeResponse> {
  return adminCall('PublishProxyChange', params)
}
