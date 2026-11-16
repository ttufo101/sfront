// 落地出口归属与人工上下架 API（Admin 模块，与代理配置同域）。
// 「下架」是业务动作：中转走 UpdateDataPlaneNode，落地走这里的 SetNodeListing。

import { adminCall } from '@/lib/xrpc/transport'
import type {
  ListProxyOutletsRequest,
  ListProxyOutletsResponse,
  SetNodeListingRequest,
  SetNodeListingResponse,
} from '@/lib/xrpc/admin-contract'

export function listProxyOutlets(
  params: ListProxyOutletsRequest = {},
): Promise<ListProxyOutletsResponse> {
  return adminCall('ListProxyOutlets', params)
}

/** 按机器上下架；proxy_names 非空时先把这些出口绑定到该机器，再统一改状态。 */
export function setNodeListing(params: SetNodeListingRequest): Promise<SetNodeListingResponse> {
  return adminCall('SetNodeListing', params)
}
