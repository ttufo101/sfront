// 用户固定中转节点分配 API（Admin 模块）：读取与设置用户固定节点关系。
// 对齐 admin.proto §14：GetUserRelayAssignment 读取、SetUserRelayAssignment 保存或清除（node_id 空串=清除）。

import { adminCall } from '@/lib/xrpc/transport'
import {
  GetUserRelayAssignmentRequest,
  GetUserRelayAssignmentResponse,
  SetUserRelayAssignmentRequest,
  SetUserRelayAssignmentResponse,
} from '@/lib/xrpc/admin-contract'

/** 按 UID 读取用户当前的中转节点固定分配 */
export function getUserRelayAssignment(
  params: GetUserRelayAssignmentRequest,
): Promise<GetUserRelayAssignmentResponse> {
  return adminCall('GetUserRelayAssignment', params)
}

/** 保存或清除用户固定节点：node_id 传空字符串表示清除固定分配 */
export function setUserRelayAssignment(
  params: SetUserRelayAssignmentRequest,
): Promise<SetUserRelayAssignmentResponse> {
  return adminCall('SetUserRelayAssignment', params)
}
