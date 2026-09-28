// 用户反馈与诊断日志 API：列表 / 详情 / 改状态，均复用 xrpc 后台调用（Admin 模块）。

import { adminCall } from '@/lib/xrpc/transport'
import {
  GetFeedbackDetailRequest,
  GetFeedbackDetailResponse,
  ListFeedbackRequest,
  ListFeedbackResponse,
  UpdateFeedbackStatusRequest,
  UpdateFeedbackStatusResponse,
} from '@/lib/xrpc/admin-contract'

/** 分页查询意见反馈与诊断日志（Admin.ListFeedback） */
export function listFeedback(params: ListFeedbackRequest): Promise<ListFeedbackResponse> {
  return adminCall('ListFeedback', {
    page: params.page ?? 1,
    page_size: params.page_size ?? 20,
    ticket_type: params.ticket_type ?? '',
    status: params.status ?? '',
    uid: params.uid ?? '',
    keyword: params.keyword ?? '',
    created_from: params.created_from,
    created_to: params.created_to,
  } as ListFeedbackRequest)
}

/** 查询单条反馈的完整内容与日志文件元信息（Admin.GetFeedbackDetail） */
export function getFeedbackDetail(feedbackId: string): Promise<GetFeedbackDetailResponse> {
  const req: GetFeedbackDetailRequest = { feedback_id: feedbackId }
  return adminCall('GetFeedbackDetail', req)
}

/** 更新反馈处理状态（Admin.UpdateFeedbackStatus） */
export function updateFeedbackStatus(feedbackId: string, status: string): Promise<UpdateFeedbackStatusResponse> {
  const req: UpdateFeedbackStatusRequest = { feedback_id: feedbackId, status }
  return adminCall('UpdateFeedbackStatus', req)
}
