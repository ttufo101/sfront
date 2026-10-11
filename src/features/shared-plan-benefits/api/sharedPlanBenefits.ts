// 套餐共享权益配置 API（Admin 模块）：读取 / 整体更新「连接性能 + 地区 → 地点」共享权益配置。
// 替代原 NetworkCoverageConfig。

import { adminCall } from '@/lib/xrpc/transport'
import {
  GetSharedPlanBenefitsConfigRequest,
  GetSharedPlanBenefitsConfigResponse,
  UpdateSharedPlanBenefitsConfigRequest,
  UpdateSharedPlanBenefitsConfigResponse,
} from '@/lib/xrpc/admin-contract'

/** 读取当前套餐共享权益配置（Admin.GetSharedPlanBenefitsConfig） */
export function getSharedPlanBenefitsConfig(
  params: GetSharedPlanBenefitsConfigRequest = {},
): Promise<GetSharedPlanBenefitsConfigResponse> {
  return adminCall('GetSharedPlanBenefitsConfig', params)
}

/** 整体更新套餐共享权益配置（Admin.UpdateSharedPlanBenefitsConfig），需带乐观锁 expected_revision */
export function updateSharedPlanBenefitsConfig(
  params: UpdateSharedPlanBenefitsConfigRequest,
): Promise<UpdateSharedPlanBenefitsConfigResponse> {
  return adminCall('UpdateSharedPlanBenefitsConfig', params)
}
