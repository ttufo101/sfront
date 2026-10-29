// 数据面中转节点管理 API（Admin 模块）：节点列表、创建、更新、轮换密码。
// 明文密码（node_password）仅在创建/轮换响应中返回一次，调用方须立即展示并提示保存。

import { adminCall } from '@/lib/xrpc/transport'
import {
  ListDataPlaneNodesRequest,
  ListDataPlaneNodesResponse,
  CreateDataPlaneNodeRequest,
  CreateDataPlaneNodeResponse,
  UpdateDataPlaneNodeRequest,
  UpdateDataPlaneNodeResponse,
  RotateDataPlaneNodePasswordRequest,
  RotateDataPlaneNodePasswordResponse,
} from '@/lib/xrpc/admin-contract'

/** 查询全部数据面节点及其启用状态 */
export function listDataPlaneNodes(
  params: ListDataPlaneNodesRequest = {},
): Promise<ListDataPlaneNodesResponse> {
  return adminCall('ListDataPlaneNodes', params)
}

/** 创建节点，返回一次性明文密码（node_password） */
export function createDataPlaneNode(
  params: CreateDataPlaneNodeRequest,
): Promise<CreateDataPlaneNodeResponse> {
  return adminCall('CreateDataPlaneNode', params)
}

/** 更新节点（全量更新）：展示名称、启用状态、公网地址与调度状态；未改字段须传当前值 */
export function updateDataPlaneNode(
  params: UpdateDataPlaneNodeRequest,
): Promise<UpdateDataPlaneNodeResponse> {
  return adminCall('UpdateDataPlaneNode', params)
}

/** 轮换节点密码，返回一次性明文新密码（node_password） */
export function rotateDataPlaneNodePassword(
  params: RotateDataPlaneNodePasswordRequest,
): Promise<RotateDataPlaneNodePasswordResponse> {
  return adminCall('RotateDataPlaneNodePassword', params)
}
