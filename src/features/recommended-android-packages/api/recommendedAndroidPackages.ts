// Android 应用访问控制（VPN 排除）推荐包名配置 API（Admin 模块）。
// 读取 / 整体更新；与客户端读接口（starcore.GetRecommendedAndroidPackages）共用同一份 DB 配置。

import { adminCall } from '@/lib/xrpc/transport'
import {
  GetRecommendedAndroidPackagesConfigRequest,
  GetRecommendedAndroidPackagesConfigResponse,
  UpdateRecommendedAndroidPackagesConfigRequest,
  UpdateRecommendedAndroidPackagesConfigResponse,
} from '@/lib/xrpc/admin-contract'

/** 读取当前推荐包名配置（Admin.GetRecommendedAndroidPackagesConfig） */
export function getRecommendedAndroidPackagesConfig(
  params: GetRecommendedAndroidPackagesConfigRequest = {},
): Promise<GetRecommendedAndroidPackagesConfigResponse> {
  return adminCall('GetRecommendedAndroidPackagesConfig', params)
}

/** 整体替换推荐包名配置（Admin.UpdateRecommendedAndroidPackagesConfig），无乐观锁 */
export function updateRecommendedAndroidPackagesConfig(
  params: UpdateRecommendedAndroidPackagesConfigRequest,
): Promise<UpdateRecommendedAndroidPackagesConfigResponse> {
  return adminCall('UpdateRecommendedAndroidPackagesConfig', params)
}
