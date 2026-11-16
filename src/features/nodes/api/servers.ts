// 服务器删除 API（Admin 模块单事务：台账软删 + 依赖表硬删）。
// 「下架」与「删除」是两步：先下架（中转 isolated / 落地 delisted），再从台账删除。
// 前端只需一次调用，避免跨服务多次调用产生「台账已删、依赖还在」的半删状态。

import { adminCall } from '@/lib/xrpc/transport'
import type {
  DeleteNodeAssetRequest,
  DeleteNodeAssetResponse,
} from '@/lib/xrpc/admin-contract'

/**
 * 删除已下架服务器。
 * 返回 blocked_uids 时表示被严格固定用户阻断、本次未删除，需先在用户详情页迁移。
 */
export function deleteNodeAsset(params: DeleteNodeAssetRequest): Promise<DeleteNodeAssetResponse> {
  return adminCall('DeleteNodeAsset', params)
}
