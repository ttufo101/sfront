// 冻结契约：starland.Admin 与 starland.Login 的请求/响应类型与 module 映射。
// 类型直接对齐 admin.proto / login.proto；int64/uint64 一律使用十进制字符串（gateway-protocol 唯一事实源）。
// 此文件是 endpoint registry 的唯一事实源，页面不得各自维护第二套清单。

export interface ListUsersRequest {
  page?: number
  page_size?: number
  keyword?: string
}
export interface UserInfo {
  uid: string
  email: string
  role: string // user / admin
  status: number // 1正常 2禁用
  created_at: string // int64 秒级字符串
  bound_device_count: number
}
export interface ListUsersResponse {
  users: UserInfo[]
  total: string // int64 字符串
}

export interface ListPlansRequest {}
export interface PlanInfo {
  plan_id: string
  name: string
  plan_type: string // time / traffic
  duration_days: number
  traffic_bytes: string // uint64 字符串
  speed_limit_mbps: number // 来自共享权益快照，只读展示
  max_devices: number // 来自共享权益快照，只读展示
  description: string
  price_amount: string // uint64 字符串（最小货币单位）
  currency: string
  recommended: boolean
  status: number // 1启用 2停用
  sort: number
  new_user_only: boolean // 是否新人专享
  badge: string // 套餐角标
  revision: string | number // uint64 十进制字符串（乐观锁修订号）
}
export interface ListPlansResponse {
  plans: PlanInfo[]
}
// 注意：speed_limit_mbps / max_devices 在 admin.proto 中已 reserved（6,7），
// 不再由前端下发——保存时由 admin 读取共享权益配置写入套餐快照。
export interface CreatePlanRequest {
  plan_id: string
  name: string
  plan_type: string
  duration_days: number
  traffic_bytes: string
  description: string
  price_amount: string
  currency: string
  recommended: boolean
  sort: number
  new_user_only: boolean
  badge: string
}
export interface CreatePlanResponse {
  success: boolean
  revision: string | number // uint64 十进制字符串（新建后的修订号）
}
export interface UpdatePlanRequest {
  plan_id: string
  name: string
  plan_type: string
  duration_days: number
  traffic_bytes: string
  description: string
  price_amount: string
  currency: string
  recommended: boolean
  status: number // 1启用 2停用
  sort: number
  new_user_only: boolean
  badge: string
  expected_revision: string | number // uint64，必须等于当前修订号，否则 Conflict
}
export interface UpdatePlanResponse {
  success: boolean
  revision: string | number // uint64 十进制字符串（更新后的新修订号）
}

// ---- 套餐共享权益配置（Admin.GetSharedPlanBenefitsConfig / UpdateSharedPlanBenefitsConfig）----
// 对齐 admin.proto + starcore.proto：所有套餐共享的连接性能（speed_limit_mbps/max_devices）与覆盖权益（regions/locations）。
// 保存套餐时 admin 读取此配置写入套餐快照，从而保证"所有套餐共享权益"的产品规则。
// revision 为 uint64、updated_at 为 int64（JS_NUMBER），用 string|number 兼容网关下行。
export interface SharedPlanBenefitLocation {
  code: string // 位置编码，如 jp、sg、us
  display_name: string // 展示名称，如 日本、新加坡、美国
  connection_point_count: number // 该位置对外展示的连接地点数量，由管理员维护
}
export interface SharedPlanBenefitRegion {
  code: string // 地区编码，如 asia、north_america
  display_name: string // 展示名称，如 亚洲、北美
  locations: SharedPlanBenefitLocation[] // 顺序即展示顺序
}
export interface GetSharedPlanBenefitsConfigRequest {}
export interface GetSharedPlanBenefitsConfigResponse {
  speed_limit_mbps: number // 全局统一带宽，单位 mbps；0 表示不限速
  max_devices: number // 全局统一设备数，单位：台
  regions: SharedPlanBenefitRegion[]
  revision: string | number // uint64 十进制字符串（网关亦可能下行为数字）
  updated_at: string | number // int64 秒级（JS_NUMBER）
}
export interface UpdateSharedPlanBenefitsConfigRequest {
  speed_limit_mbps: number
  max_devices: number
  regions: SharedPlanBenefitRegion[] // 整体替换，顺序即展示顺序
  expected_revision: string | number // 必须等于当前修订号，否则 Conflict
}
export interface UpdateSharedPlanBenefitsConfigResponse {
  success: boolean
  revision: string | number
  updated_at: string | number
}

export interface GrantUserPlanRequest {
  email: string
  plan_id: string
  client_request_id: string // 管理端生成的稳定幂等键
  operation_reason: string // 人工发放原因
}
export interface GrantUserPlanResponse {
  order_no: string
}
export interface UpdateUserSubscriptionRequest {
  email: string
  plan_type: string // time / traffic
  expires_at?: string // int64 秒级字符串，仅 time 生效
  traffic_total_bytes?: string // uint64 字符串，仅 traffic 生效
  client_request_id?: string // 管理端生成的稳定幂等键
  operation_reason?: string // 调整原因
}
export interface UpdateUserSubscriptionResponse {
  success: boolean
}
export interface RevokeUserPlanRequest {
  order_no: string
  client_request_id?: string // 管理端生成的稳定幂等键
  operation_reason?: string // 撤销原因
}
export interface RevokeUserPlanResponse {
  success: boolean
  already_revoked: boolean
}

// 按邮箱查询用户的时间和流量订阅快照（Admin.GetUserSubscriptions，已对齐 admin.proto）。
// 时间套餐与流量套餐共用 AdminSubscription 结构；无某类订阅时对应字段为 null/空。
export interface GetUserSubscriptionsRequest {
  email: string
}
export interface AdminSubscription {
  plan_id: string
  plan_name: string
  plan_type: string // time / traffic
  duration_days: number // 流量套餐为 0
  speed_limit_mbps: number // 带宽限制 mbps，0 表示不限速
  max_devices: number // 最大在线设备数，单位：台
  starts_at: string // int64 秒级字符串
  expires_at: string // int64 秒级字符串；流量套餐为 "0"
  remaining_days: number
  traffic_total_bytes: string // uint64 字符串
  traffic_used_bytes: string // uint64 字符串
  remaining_traffic_bytes: string // uint64 字符串
  status: number // 数据库订阅状态
  active: boolean // 当前是否仍可用
}
export interface GetUserSubscriptionsResponse {
  uid: string
  email: string
  time_subscription: AdminSubscription | null // 无时间订阅时为空
  traffic_subscription: AdminSubscription | null // 无流量订阅时为空
}

export interface GetProxyConfigRequest {}
export interface GetProxyConfigResponse {
  content: string // 完整 proxy.yaml 文本（明文，非 base64）
  revision: string | number // uint64 十进制字符串（乐观锁修订号）
}
export interface UpdateProxyConfigRequest {
  content: string
  expected_revision: string | number // 必须等于当前修订号，否则 Conflict
  client_request_id: string // 管理端生成的稳定幂等键
  operation_reason: string // 高风险操作原因
}
export interface UpdateProxyConfigResponse {
  success: boolean
  revision: string | number // uint64 十进制字符串（更新后的新修订号）
}

// ---- 数据面中转节点管理（Admin.ListDataPlaneNodes / CreateDataPlaneNode / UpdateDataPlaneNode / RotateDataPlaneNodePassword）----
// 对齐 admin.proto（t_dataplane_node）：明文密码（node_password）只在创建/轮换响应返回一次，DB 仅存 bcrypt 哈希。
// 时间字段标了 [jstype=JS_NUMBER]，按惯例用 string|number 兼容网关下行。
// 状态以服务端为准：runtime_status（unknown/online/offline）与 scheduling_status（active/draining/isolated/disabled）
// 为两个独立维度，前端不得自行用客户端时间推导在线/离线（见 admin.md §12.3）。
export interface DataPlaneNode {
  node_id: string
  display_name: string
  enabled: boolean
  last_seen_at: string | number // int64 秒级（JS_NUMBER）；历史字段，心跳请使用 heartbeat_at
  created_at: string | number // int64 秒级（JS_NUMBER）
  updated_at: string | number // int64 秒级（JS_NUMBER）
  advertise_host: string // GetLinks 对外返回的公网 IP/域名；空=未配置
  runtime_status: string // unknown / online / offline
  scheduling_status: string // active / draining / isolated / disabled
  started_at: string | number // int64 秒级；Mihomo 启动时间，0/空=-
  heartbeat_at: string | number // int64 秒级；最近心跳，0/空=从未上报
  offline_at: string | number // int64 秒级；离线时间
  offline_reason: string // 离线原因
}
export interface ListDataPlaneNodesRequest {}
export interface ListDataPlaneNodesResponse {
  nodes: DataPlaneNode[]
}
export interface CreateDataPlaneNodeRequest {
  node_id: string // 节点标识（由调用方指定，非后端生成）
  display_name: string
}
export interface CreateDataPlaneNodeResponse {
  success: boolean
  node_password: string // 明文密码，仅本次响应返回一次
}
export interface UpdateDataPlaneNodeRequest {
  node_id: string
  display_name: string
  enabled: boolean // 全量更新（非 patch），未改的字段须传当前值
  advertise_host: string // 公网 IP/域名（仅 IP/域名，不含协议/端口/空格/?/#）；切到 active 时必填
  scheduling_status: string // active / draining / isolated / disabled
}
export interface UpdateDataPlaneNodeResponse {
  success: boolean
}
export interface RotateDataPlaneNodePasswordRequest {
  node_id: string
}
export interface RotateDataPlaneNodePasswordResponse {
  success: boolean
  node_password: string // 明文新密码，仅本次响应返回一次
}

// ---- 用户固定中转节点分配（Admin.GetUserRelayAssignment / SetUserRelayAssignment）----
// 对齐 admin.proto §14（t_user_relay_assignment）。node_id 空字符串表示清除固定分配；allow_fallback 控制
// 指定节点不可用时是否回退到 HRW 自动分配（见 plan.md §14.4）。
export interface GetUserRelayAssignmentRequest {
  uid: string
}
export interface GetUserRelayAssignmentResponse {
  assigned: boolean
  uid: string
  node_id: string
  allow_fallback: boolean
  updated_at: string | number // int64 秒级（JS_NUMBER）
}
export interface SetUserRelayAssignmentRequest {
  uid: string
  node_id: string // 空字符串表示清除固定分配
  allow_fallback: boolean
}
export interface SetUserRelayAssignmentResponse {
  success: boolean
}

export interface ListUserDevicesRequest {
  email: string
}
export interface UserDevice {
  uid: string
  device_id: string
  device_type: string
  bound_at: string // int64 秒级字符串
  last_login_at: string // int64 秒级字符串
  status: number // 1已绑定 2已剔除
}
export interface ListUserDevicesResponse {
  devices: UserDevice[]
}

export interface ListAnnouncementsRequest {}
export interface Announcement {
  id: string // uint64 字符串
  title: string
  content: string
  status: string // draft / published / unpublished
  published_at: string
  created_at: string
  updated_at: string
}
export interface ListAnnouncementsResponse {
  announcements: Announcement[]
}
export interface CreateAnnouncementRequest {
  title: string
  content: string
}
export interface CreateAnnouncementResponse {
  id: string
}
export interface UpdateAnnouncementRequest {
  id: string
  title: string
  content: string
}
export interface UpdateAnnouncementResponse {
  success: boolean
}
export interface PublishAnnouncementRequest {
  id: string
}
export interface PublishAnnouncementResponse {
  success: boolean
}
export interface UnpublishAnnouncementRequest {
  id: string
}
export interface UnpublishAnnouncementResponse {
  success: boolean
}

// ---- 客户端版本发布（Admin.ListAppVersions / PublishAppVersion / DisableAppVersion）----
// 对齐 admin.proto：上传在文件服务完成，Admin 仅保存版本号/构建号/发布说明并控制生效态。
export interface AppVersionRelease {
  release_id: string
  platform: string // android / ios / windows / mac
  latest_version: string // major.minor.patch
  build_number: string // uint64 十进制字符串，同平台严格递增
  minimum_version: string // 低于此版本强制升级
  file_id: string // 文件服务上传返回的文件 ID
  file_name: string
  package_size_bytes: string // uint64 十进制字符串
  package_sha256: string
  package_type: string // apk / ipa / exe / dmg / pkg
  update_url: string
  update_title: string
  update_description: string
  status: string // active / disabled / superseded
  operator_uid: string
  published_at: string // int64 秒级字符串（JS_NUMBER）
  created_at: string // int64 秒级字符串（JS_NUMBER）
  updated_at: string // int64 秒级字符串（JS_NUMBER）
}
export interface ListAppVersionsRequest {
  platform?: string // android / ios / windows / mac；空表示全部
  include_history?: boolean // false 只查当前生效版本；true 含 disabled 与 superseded 历史
}
export interface ListAppVersionsResponse {
  releases: AppVersionRelease[]
  /** 符合条件的记录总数（int64，协议按十进制字符串传输，网关也可能下发为数字） */
  total?: string | number
}
export interface PublishAppVersionRequest {
  file_id: string
  platform: string
  latest_version: string // major.minor.patch
  build_number: string // uint64 十进制字符串
  minimum_version: string
  update_title: string
  update_description: string
  client_request_id: string // 调用方生成 UUID，幂等发布
  expected_release_id: string // 当前发布 ID；首发留空，防并发覆盖
  // 以下 4 字段来自文件服务上传接口返回；admin 不回查文件服务，必须由前端转发
  file_name: string // 上传接口返回的原始文件名
  package_size_bytes: string // uint64 十进制字符串，上传接口返回的安装包大小
  package_sha256: string // 上传接口返回的 64 位小写十六进制 SHA-256
  package_type: string // apk / ipa / exe / dmg / pkg，须与 platform 匹配
}
export interface PublishAppVersionResponse {
  release: AppVersionRelease
}
export interface DisableAppVersionRequest {
  platform: string
  expected_release_id: string // 必须与当前生效发布一致
}
export interface DisableAppVersionResponse {
  success: boolean
}

// ---- 网络覆盖展示配置（Admin.GetNetworkCoverageConfig / UpdateNetworkCoverageConfig）----
// 对齐 admin.proto：后端仅配置「地区 → 地点」两级列表，主标语/副标题/底部说明/按钮文案由 C 端写死。
// revision 为 uint64、updated_at 为 int64（JS_NUMBER），按惯例用 string|number 兼容网关下行（可能下行为数字）。
export interface NetworkCoverageLocation {
  code: string // 地点 code，^[a-z][a-z0-9_]{0,31}$
  display_name: string // ≤32 字符（按 rune/字符计数）
}
export interface NetworkCoverageRegion {
  code: string // 地区 code，^[a-z][a-z0-9_]{0,31}$
  display_name: string // ≤32 字符
  locations: NetworkCoverageLocation[]
}
export interface GetNetworkCoverageConfigRequest {}
export interface GetNetworkCoverageConfigResponse {
  regions: NetworkCoverageRegion[]
  revision: string | number // uint64 十进制字符串（网关亦可能下行为数字）
  updated_at: string | number // int64 秒级（JS_NUMBER）
}
export interface UpdateNetworkCoverageConfigRequest {
  regions: NetworkCoverageRegion[]
  expected_revision: string | number // 必须等于当前修订号，否则 Conflict
}
export interface UpdateNetworkCoverageConfigResponse {
  success: boolean
  revision: string | number
  updated_at: string | number
}

// ---- 意见反馈与诊断日志（Admin.ListFeedback / GetFeedbackDetail / UpdateFeedbackStatus）----
// 对齐 admin.proto。字段与 feedback.proto 的 FeedbackTicket 一一对应，前端以 admin.proto 网关契约为准
// （feedback.proto 的 Admin* 方法标注"供 Admin 服务内部调用，不通过 Gateway 开放"）。
// 时间字段 created_at/updated_at/log_started_at/log_ended_at 标了 [jstype=JS_NUMBER]，按惯例用 string，
// formatTimestamp 已兼容 string|number，后端发数字或字符串均可正确解析。
// 对齐 feedback.proto FeedbackAttachment（后端经 file 服务校验后保存的可信附件元数据）。
// proto 已加 url 字段（field 10，"公开图片地址"，客户端提交忽略、服务端详情填写）；但线上 fileupload
// 的 feedback-files GET 仍要求管理员 Bearer token（无 token 返回 401），故前端不裸用 att.url，
// 而是用 file_id 走相对路径 + 管理员 token 取 blob 渲染（见 AttachmentGallery / fileApi.fetchFeedbackImageBlob）。
export interface FeedbackAttachment {
  file_id: string
  file_name: string
  file_kind: string // feedback-image
  mime_type: string // image/jpeg | image/png | image/webp
  size_bytes: string // uint64 十进制字符串
  sha256: string
  width: number
  height: number
  sort_order: number
  url?: string // 可选：后端返回的可访问地址（预签名 URL 或 relay 地址）
}

export interface AdminFeedbackTicket {
  feedback_id: string
  uid: string
  ticket_type: string // feedback / diagnostic
  category: string // suggestion / issue / other
  content: string
  contact: string
  description: string
  status: string // pending / reviewing / resolved / closed
  device_id: string
  device_type: string
  app_version: string
  os_version: string
  client_ip: string
  log_started_at: string // int64 字符串（JS_NUMBER）
  log_ended_at: string // int64 字符串（JS_NUMBER）
  file_id: string
  file_name: string
  size_bytes: string // uint64 十进制字符串
  sha256: string
  content_type: string
  created_at: string // int64 字符串（JS_NUMBER）
  updated_at: string // int64 字符串（JS_NUMBER）
  attachments?: FeedbackAttachment[] // 反馈图片附件（最多 3 张）
}
export interface ListFeedbackRequest {
  page?: number
  page_size?: number
  ticket_type?: string // feedback / diagnostic；空表示全部
  status?: string // pending / reviewing / resolved / closed；空表示全部
  uid?: string
  keyword?: string
  created_from?: number // int64（JS_NUMBER），可选
  created_to?: number // int64（JS_NUMBER），可选
}
export interface ListFeedbackResponse {
  tickets: AdminFeedbackTicket[]
  total: string // int64 字符串
}
export interface GetFeedbackDetailRequest {
  feedback_id: string
}
export interface GetFeedbackDetailResponse {
  ticket: AdminFeedbackTicket
}
export interface UpdateFeedbackStatusRequest {
  feedback_id: string
  status: string
}
export interface UpdateFeedbackStatusResponse {
  success: boolean
}

// ---- Login 契约（starland.Login）----
export interface LoginResponse {
  uid: string
  access_token: string
  refresh_token: string
  access_expire_at: string // int64 秒级字符串
  refresh_expire_at: string // int64 秒级字符串
}

// ---- 订单管理（Admin.ListOrders / GetOrderDetail / RetryOrderFulfillment）----
// 对齐 admin.proto（AdminListOrders* / AdminGetOrderDetail* / AdminRetryOrderFulfillment*）
// 与 order.proto（OrderResponse / PaymentInfo / AdminPaymentDetail / AdminPaymentEvent）。
// 金额 price_amount 为 uint64 十进制字符串；时间字段标 [jstype=JS_NUMBER] 用 string|number 兼容网关下行。
// 状态字段（order.status / payment_status / order_status）网关下行为小写字符串，取值见 admin.md §3.4：
// 订单业务状态 paying/paid/success/fulfill_failed/refund_pending/closed/revoked；
// 支付状态 creating/ready/paid/expired/creation_unknown/manual_review/failed。

export interface CryptoTransferAction {
  amount: string // 固定 USDT 实付数量，十进制字符串
  token: string // 当前为 USDT
  network: string // polygon / solana / tron
  receive_address: string
  qr_payload: string // 收款二维码原文
}
export interface RedirectAction {
  checkout_url: string
}
export interface PaymentInfo {
  payment_method_id: string
  status: number // PaymentStatus 枚举值
  action_type: number // PaymentActionType 枚举值
  payment_deadline_at: string | number // int64 秒级
  crypto_transfer?: CryptoTransferAction
  redirect?: RedirectAction
}
export interface OrderResponse {
  order_no: string
  uid: string
  plan_id: string
  plan_name: string
  plan_type: string // time / traffic
  price_amount: string // uint64 十进制字符串（最小货币单位）
  currency: string
  status: string // 订单业务状态（小写）
  paid_at: string | number // int64 秒级；未支付为 0
  created_at: string | number // int64 秒级
  payment_method_id: string
  payment_method_name: string
  payment_action_type: number // PaymentActionType 枚举值
}
export interface AdminPaymentDetail {
  payment: PaymentInfo
  provider: string
  provider_session_id: string
  transaction_id: string // 链上交易 ID
  last_error: string
  close_after_at: string | number // int64 秒级（安全关闭时间）
  next_reconcile_at: string | number // int64 秒级
}
export interface AdminPaymentEvent {
  id: string | number // int64（JS_NUMBER）
  event_type: string
  status: string
  error_message: string
  created_at: string | number // int64 秒级
  processed_at: string | number // int64 秒级
}
export interface AdminOrderItem {
  order: OrderResponse
  order_source: string // user / manual
  payment_status: string // 支付状态（小写）
  updated_at: string | number // int64 秒级
}
export interface AdminListOrdersRequest {
  email?: string
  uid?: string
  order_no?: string
  order_status?: string
  payment_status?: string
  payment_method_id?: string
  order_source?: string
  created_from?: string | number // int64 秒级
  created_to?: string | number // int64 秒级
  page?: number
  page_size?: number
}
export interface AdminListOrdersResponse {
  orders: AdminOrderItem[]
  total: string | number // int64
}
export interface AdminGetOrderDetailRequest {
  order_no: string
}
export interface AdminGetOrderDetailResponse {
  order: OrderResponse
  order_source: string
  payment: AdminPaymentDetail
  events: AdminPaymentEvent[]
  operator_uid: string
  operation_reason: string
  updated_at: string | number // int64 秒级
}
export interface AdminRetryOrderFulfillmentRequest {
  order_no: string
  client_request_id: string
  operation_reason: string
}
export interface AdminRetryOrderFulfillmentResponse {
  success: boolean
  status: string // 重试后的订单业务状态
}

// ---- 集中映射 ----
export interface AdminContract {
  ListUsers: { req: ListUsersRequest; res: ListUsersResponse }
  ListPlans: { req: ListPlansRequest; res: ListPlansResponse }
  CreatePlan: { req: CreatePlanRequest; res: CreatePlanResponse }
  UpdatePlan: { req: UpdatePlanRequest; res: UpdatePlanResponse }
  GrantUserPlan: { req: GrantUserPlanRequest; res: GrantUserPlanResponse }
  UpdateUserSubscription: { req: UpdateUserSubscriptionRequest; res: UpdateUserSubscriptionResponse }
  RevokeUserPlan: { req: RevokeUserPlanRequest; res: RevokeUserPlanResponse }
  GetUserSubscriptions: { req: GetUserSubscriptionsRequest; res: GetUserSubscriptionsResponse }
  GetProxyConfig: { req: GetProxyConfigRequest; res: GetProxyConfigResponse }
  UpdateProxyConfig: { req: UpdateProxyConfigRequest; res: UpdateProxyConfigResponse }
  ListDataPlaneNodes: { req: ListDataPlaneNodesRequest; res: ListDataPlaneNodesResponse }
  CreateDataPlaneNode: { req: CreateDataPlaneNodeRequest; res: CreateDataPlaneNodeResponse }
  UpdateDataPlaneNode: { req: UpdateDataPlaneNodeRequest; res: UpdateDataPlaneNodeResponse }
  RotateDataPlaneNodePassword: { req: RotateDataPlaneNodePasswordRequest; res: RotateDataPlaneNodePasswordResponse }
  GetUserRelayAssignment: { req: GetUserRelayAssignmentRequest; res: GetUserRelayAssignmentResponse }
  SetUserRelayAssignment: { req: SetUserRelayAssignmentRequest; res: SetUserRelayAssignmentResponse }
  GetSharedPlanBenefitsConfig: { req: GetSharedPlanBenefitsConfigRequest; res: GetSharedPlanBenefitsConfigResponse }
  UpdateSharedPlanBenefitsConfig: { req: UpdateSharedPlanBenefitsConfigRequest; res: UpdateSharedPlanBenefitsConfigResponse }
  ListUserDevices: { req: ListUserDevicesRequest; res: ListUserDevicesResponse }
  ListAnnouncements: { req: ListAnnouncementsRequest; res: ListAnnouncementsResponse }
  CreateAnnouncement: { req: CreateAnnouncementRequest; res: CreateAnnouncementResponse }
  UpdateAnnouncement: { req: UpdateAnnouncementRequest; res: UpdateAnnouncementResponse }
  PublishAnnouncement: { req: PublishAnnouncementRequest; res: PublishAnnouncementResponse }
  UnpublishAnnouncement: { req: UnpublishAnnouncementRequest; res: UnpublishAnnouncementResponse }
  ListAppVersions: { req: ListAppVersionsRequest; res: ListAppVersionsResponse }
  PublishAppVersion: { req: PublishAppVersionRequest; res: PublishAppVersionResponse }
  DisableAppVersion: { req: DisableAppVersionRequest; res: DisableAppVersionResponse }
  GetNetworkCoverageConfig: { req: GetNetworkCoverageConfigRequest; res: GetNetworkCoverageConfigResponse }
  UpdateNetworkCoverageConfig: { req: UpdateNetworkCoverageConfigRequest; res: UpdateNetworkCoverageConfigResponse }
  ListFeedback: { req: ListFeedbackRequest; res: ListFeedbackResponse }
  GetFeedbackDetail: { req: GetFeedbackDetailRequest; res: GetFeedbackDetailResponse }
  UpdateFeedbackStatus: { req: UpdateFeedbackStatusRequest; res: UpdateFeedbackStatusResponse }
  ListOrders: { req: AdminListOrdersRequest; res: AdminListOrdersResponse }
  GetOrderDetail: { req: AdminGetOrderDetailRequest; res: AdminGetOrderDetailResponse }
  RetryOrderFulfillment: { req: AdminRetryOrderFulfillmentRequest; res: AdminRetryOrderFulfillmentResponse }
}

export type AdminMethod = keyof AdminContract

export const ADMIN_MODULE = 'starland.admin.com'
export const LOGIN_MODULE = 'starland.login.com'
