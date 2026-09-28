// 网络覆盖展示配置 API（Admin 模块）：读取 / 整体更新「地区 → 地点」两级配置。

import { adminCall } from '@/lib/xrpc/transport'
import {
  GetNetworkCoverageConfigRequest,
  GetNetworkCoverageConfigResponse,
  UpdateNetworkCoverageConfigRequest,
  UpdateNetworkCoverageConfigResponse,
} from '@/lib/xrpc/admin-contract'

/** 读取当前网络覆盖配置（Admin.GetNetworkCoverageConfig） */
export function getNetworkCoverageConfig(
  params: GetNetworkCoverageConfigRequest = {},
): Promise<GetNetworkCoverageConfigResponse> {
  return adminCall('GetNetworkCoverageConfig', params)
}

/** 整体更新网络覆盖配置（Admin.UpdateNetworkCoverageConfig），需带乐观锁 expected_revision */
export function updateNetworkCoverageConfig(
  params: UpdateNetworkCoverageConfigRequest,
): Promise<UpdateNetworkCoverageConfigResponse> {
  return adminCall('UpdateNetworkCoverageConfig', params)
}
