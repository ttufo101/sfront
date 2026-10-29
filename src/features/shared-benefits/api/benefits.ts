// 套餐共享权益配置 API（Admin 模块）：读取 / 整体更新所有套餐共享的连接性能与覆盖权益。
// 保存套餐时 admin 读取此配置写入套餐快照，保证"所有套餐共享权益"的产品规则。

import { adminCall } from '@/lib/xrpc/transport'
import {
  GetSharedPlanBenefitsConfigRequest,
  GetSharedPlanBenefitsConfigResponse,
  UpdateSharedPlanBenefitsConfigRequest,
  UpdateSharedPlanBenefitsConfigResponse,
} from '@/lib/xrpc/admin-contract'

/** 读取当前共享权益配置（Admin.GetSharedPlanBenefitsConfig） */
export function getSharedPlanBenefitsConfig(
  params: GetSharedPlanBenefitsConfigRequest = {},
): Promise<GetSharedPlanBenefitsConfigResponse> {
  return adminCall('GetSharedPlanBenefitsConfig', params)
}

/** 整体更新共享权益配置（Admin.UpdateSharedPlanBenefitsConfig），需带乐观锁 expected_revision */
export function updateSharedPlanBenefitsConfig(
  params: UpdateSharedPlanBenefitsConfigRequest,
): Promise<UpdateSharedPlanBenefitsConfigResponse> {
  return adminCall('UpdateSharedPlanBenefitsConfig', params)
}
