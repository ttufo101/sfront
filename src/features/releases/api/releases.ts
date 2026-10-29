// 客户端版本发布 API：列表 / 发布（Admin 模块）。
// 停用由页面直接用 useXrpcMutation('DisableAppVersion') 调用。

import { adminCall } from '@/lib/xrpc/transport'
import {
  ListAppVersionsRequest,
  ListAppVersionsResponse,
  PublishAppVersionRequest,
  PublishAppVersionResponse,
} from '@/lib/xrpc/admin-contract'

/** 查询客户端版本发布记录（Admin.ListAppVersions） */
export function listAppVersions(params: ListAppVersionsRequest): Promise<ListAppVersionsResponse> {
  return adminCall('ListAppVersions', {
    platform: params.platform ?? '',
    include_history: params.include_history ?? false,
    ...(params.page != null ? { page: params.page } : {}),
    ...(params.page_size != null ? { page_size: params.page_size } : {}),
  } as ListAppVersionsRequest)
}

/** 发布一个已上传到文件服务的客户端安装包（Admin.PublishAppVersion） */
export function publishAppVersion(params: PublishAppVersionRequest): Promise<PublishAppVersionResponse> {
  return adminCall('PublishAppVersion', params)
}
