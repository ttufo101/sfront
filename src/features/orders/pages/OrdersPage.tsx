import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useXrpcQuery, useXrpcMutation } from '@/lib/xrpc/hooks'
import {
  type AdminListOrdersRequest,
  type AdminOrderItem,
  type AdminGetOrderDetailResponse,
  type ReviewOrderPaymentRequest,
} from '@/lib/xrpc/admin-contract'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

const PAGE_SIZE = 20

// 状态字段网关下行为小写字符串，取值见 admin.md §3.4
const ORDER_STATUS_OPTIONS = ['', 'paying', 'paid', 'success', 'fulfill_failed', 'refund_pending', 'closed', 'revoked']
const PAYMENT_STATUS_OPTIONS = ['', 'creating', 'ready', 'paid', 'expired', 'creation_unknown', 'manual_review', 'failed']
const ORDER_SOURCE_OPTIONS = ['', 'user', 'manual']

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'

function statusVariant(s: string): BadgeVariant {
  switch (s) {
    case 'success':
      return 'success'
    case 'paid':
      return 'default'
    case 'paying':
    case 'refund_pending':
    case 'manual_review':
      return 'warning'
    case 'fulfill_failed':
    case 'creation_unknown':
    case 'failed':
      return 'destructive'
    case 'closed':
    case 'revoked':
      return 'secondary'
    default:
      return 'outline'
  }
}

const STATUS_LABEL: Record<string, string> = {
  paying: '支付中',
  paid: '已支付',
  success: '成功',
  fulfill_failed: '发放失败',
  refund_pending: '退款待处理',
  closed: '已关闭',
  revoked: '已撤销',
  creating: '支付创建中',
  ready: '待支付',
  expired: '已过期',
  creation_unknown: '创建未知',
  manual_review: '人工审核',
  user: '用户购买',
  manual: '人工发放',
}

const fmtMoney = (amt: string | number, cur: string) => {
  const n = Number(amt)
  if (!isFinite(n)) return `${cur} -`
  return `${cur === 'CNY' ? '¥' : cur} ${(n / 100).toFixed(2)}`
}

const fmtTime = (v: string | number | undefined) => {
  if (v === undefined || v === null || v === '' || Number(v) === 0) return '-'
  const n = Number(v)
  if (!isFinite(n)) return String(v)
  return new Date(n * 1000).toLocaleString('zh-CN', { hour12: false })
}

const genId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

interface FilterForm {
  email: string
  uid: string
  order_no: string
  order_status: string
  payment_status: string
  order_source: string
  created_from: string
  created_to: string
}

const emptyFilter = (): FilterForm => ({
  email: '',
  uid: '',
  order_no: '',
  order_status: '',
  payment_status: '',
  order_source: '',
  created_from: '',
  created_to: '',
})

export function OrdersPage() {
  // 支持从侧边栏「人工审核」入口带入 payment_status=manual_review 预置筛选
  const [searchParams] = useSearchParams()
  const initialPaymentStatus = searchParams.get('payment_status') ?? ''
  const initialFilter: FilterForm = { ...emptyFilter(), payment_status: initialPaymentStatus }
  const [filter, setFilter] = useState<FilterForm>(initialFilter)
  const [params, setParams] = useState<AdminListOrdersRequest>(() => {
    const p: AdminListOrdersRequest = { page: 1, page_size: PAGE_SIZE }
    if (initialPaymentStatus) p.payment_status = initialPaymentStatus
    return p
  })
  const [detail, setDetail] = useState<AdminGetOrderDetailResponse | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [retryReason, setRetryReason] = useState('')

  const query = useXrpcQuery('ListOrders', params, [params])
  const detailMut = useXrpcMutation('GetOrderDetail')
  const retryMut = useXrpcMutation('RetryOrderFulfillment')
  // 人工裁决（确认放行 / 驳回）：仅对 payment_status=manual_review 的订单可用，为最终结论。
  const reviewMut = useXrpcMutation('ReviewOrderPayment')
  const [reviewReason, setReviewReason] = useState('')
  const [reviewEvidence, setReviewEvidence] = useState('')
  // 二次确认弹窗状态：open 控制显隐，decision 记录待执行的裁决方向。
  const [confirm, setConfirm] = useState<{ open: boolean; decision: 'approve' | 'reject' }>({ open: false, decision: 'approve' })

  // 侧边栏「订单管理」(/orders) 与「人工审核」(/orders?payment_status=manual_review) 指向同一组件实例，
  // React Router 仅在 query 变化时不会重挂载，useState 初始化只执行一次，导致切换时 filter/params 不更新、列表不刷新。
  // 这里监听 URL 的 payment_status，变化时把预置筛选同步进状态并重新拉取，保证「切换即刷新」。
  // 跳过首次挂载：首屏已由 useState 初值正确处理，避免重复请求。
  const urlPaymentStatus = searchParams.get('payment_status') ?? ''
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    setFilter({ ...emptyFilter(), payment_status: urlPaymentStatus })
    setParams({
      page: 1,
      page_size: PAGE_SIZE,
      ...(urlPaymentStatus ? { payment_status: urlPaymentStatus } : {}),
    })
    // 切换视图时关闭可能打开的详情，避免残留上一条订单的数据。
    setDetail(null)
    setDetailOpen(false)
  }, [urlPaymentStatus])

  const buildParams = (f: FilterForm, page: number): AdminListOrdersRequest => {
    const p: AdminListOrdersRequest = { page, page_size: PAGE_SIZE }
    if (f.email) p.email = f.email
    if (f.uid) p.uid = f.uid
    if (f.order_no) p.order_no = f.order_no
    if (f.order_status) p.order_status = f.order_status
    if (f.payment_status) p.payment_status = f.payment_status
    if (f.order_source) p.order_source = f.order_source
    if (f.created_from) p.created_from = Math.floor(new Date(f.created_from).getTime() / 1000)
    if (f.created_to) p.created_to = Math.floor(new Date(f.created_to).getTime() / 1000)
    return p
  }

  const doSearch = () => setParams(buildParams(filter, 1))
  const doReset = () => {
    setFilter(emptyFilter())
    setParams({ page: 1, page_size: PAGE_SIZE })
  }
  const goPage = (page: number) => setParams((prev) => ({ ...prev, page }))

  // 快捷筛选：互斥维度，点击即查
  const quick = (patch: Partial<FilterForm>) => {
    const nf = { ...filter, ...patch }
    setFilter(nf)
    setParams(buildParams(nf, 1))
  }

  const openDetail = async (orderNo: string) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setRetryReason('')
    try {
      const r = await detailMut.mutateAsync({ order_no: orderNo })
      setDetail(r)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDetailLoading(false)
    }
  }

  const doRetry = async () => {
    if (!detail) return
    if (!retryReason.trim()) return toast.error('请填写重试原因')
    try {
      const r = await retryMut.mutateAsync({
        order_no: detail.order.order_no,
        client_request_id: genId(),
        operation_reason: retryReason,
      })
      toast.success(`已触发重试，当前状态：${r.status}`)
      const r2 = await detailMut.mutateAsync({ order_no: detail.order.order_no })
      setDetail(r2)
      setRetryReason('')
      query.refetch()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // 仅当详情中支付会话状态为 manual_review（枚举值 6）时才展示裁决入口。
  const isManualReview = detail ? paymentStatusName(detail.payment?.payment?.status) === 'manual_review' : false
  const isCrypto = !!detail?.payment?.payment?.crypto_transfer

  // 打开二次确认弹窗，记录本次裁决方向（approve=确认放行 / reject=驳回）。
  const openConfirm = (decision: 'approve' | 'reject') => setConfirm({ open: true, decision })

  // 执行人工裁决：原因必填；链上支付确认放行时强制填写交易哈希证据；
  // 调用 ReviewOrderPayment 后刷新详情与列表（订单自动退出 manual_review 队列）。
  const doReview = async () => {
    if (!detail) return
    if (!reviewReason.trim()) return toast.error('请填写裁决依据')
    if (confirm.decision === 'approve' && isCrypto && !reviewEvidence.trim())
      return toast.error('链上支付确认放行需填写交易哈希证据')
    try {
      const r = await reviewMut.mutateAsync({
        order_no: detail.order.order_no,
        decision: confirm.decision,
        operation_reason: reviewReason,
        evidence: reviewEvidence.trim() || undefined,
      } as ReviewOrderPaymentRequest)
      toast.success(`已${confirm.decision === 'approve' ? '确认放行' : '驳回'}，当前状态：${r.status}`)
      const r2 = await detailMut.mutateAsync({ order_no: detail.order.order_no })
      setDetail(r2)
      setReviewReason('')
      setReviewEvidence('')
      setConfirm({ open: false, decision: 'approve' })
      query.refetch()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const total = Number(query.data?.total ?? 0)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const curPage = Number(params.page ?? 1)
  const canRetry = detail?.order.status === 'paid' || detail?.order.status === 'fulfill_failed'

  return (
    <div>
      <PageHeader
        title={urlPaymentStatus === 'manual_review' ? '人工审核' : '订单管理'}
        description={urlPaymentStatus === 'manual_review' ? '支付状态为「人工审核」的订单：核对支付明细后确认放行或驳回，裁决为最终结论' : '查询用户支付订单与人工订单，查看支付明细与事件，并对允许状态的订单重试权益发放'}
      />

      {filter.payment_status === 'manual_review' && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
          人工审核：下列订单的<b>支付状态为「人工审核」</b>（支付渠道未能自动确认成功/失败）。请打开详情核对支付明细、渠道交易号与链上交易 ID 后再行裁决。
          <b>确认放行</b>将把订单标记为已支付并触发权益发放（系统每 5 秒自动发放，或可用「重试发放」）；
          <b>驳回</b>将关闭订单且不发放。人工裁决为最终结论，请据实操作并填写依据。
        </div>
      )}

      {/* 筛选栏 */}
      <div className="mb-4 rounded-xl border p-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>邮箱</Label>
            <Input placeholder="user@example.com" value={filter.email} onChange={(e) => setFilter({ ...filter, email: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>UID</Label>
            <Input placeholder="用户 UID" value={filter.uid} onChange={(e) => setFilter({ ...filter, uid: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>订单号</Label>
            <Input placeholder="订单号" value={filter.order_no} onChange={(e) => setFilter({ ...filter, order_no: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>业务状态</Label>
            <Select value={filter.order_status} onValueChange={(v) => setFilter({ ...filter, order_status: v })}>
              <SelectTrigger>
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                {ORDER_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o || 'all'} value={o}>
                    {o ? (STATUS_LABEL[o] ?? o) : '全部'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>支付状态</Label>
            <Select value={filter.payment_status} onValueChange={(v) => setFilter({ ...filter, payment_status: v })}>
              <SelectTrigger>
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o || 'all'} value={o}>
                    {o ? (STATUS_LABEL[o] ?? o) : '全部'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>订单来源</Label>
            <Select value={filter.order_source} onValueChange={(v) => setFilter({ ...filter, order_source: v })}>
              <SelectTrigger>
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                {ORDER_SOURCE_OPTIONS.map((o) => (
                  <SelectItem key={o || 'all'} value={o}>
                    {o ? (STATUS_LABEL[o] ?? o) : '全部'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>创建起始</Label>
            <Input type="datetime-local" value={filter.created_from} onChange={(e) => setFilter({ ...filter, created_from: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>创建截止</Label>
            <Input type="datetime-local" value={filter.created_to} onChange={(e) => setFilter({ ...filter, created_to: e.target.value })} />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={doSearch}>查询</Button>
          <Button variant="outline" onClick={doReset}>
            重置
          </Button>
        </div>
      </div>

      {/* 快捷筛选 */}
      <div className="mb-3 flex flex-wrap gap-2">
        <span className="self-center text-xs text-muted-foreground">快速筛选：</span>
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={() => quick({ order_status: '', payment_status: 'creation_unknown' })}
        >
          支付创建未知
        </Badge>
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={() => quick({ order_status: '', payment_status: 'manual_review' })}
        >
          人工审核
        </Badge>
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={() => quick({ payment_status: '', order_status: 'paid' })}
        >
          已支付未发放
        </Badge>
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={() => quick({ payment_status: '', order_status: 'fulfill_failed' })}
        >
          发放失败
        </Badge>
        <Badge
          variant="outline"
          className="cursor-pointer"
          onClick={() => quick({ payment_status: '', order_status: 'refund_pending' })}
        >
          退款待处理
        </Badge>
        <Badge variant="secondary" className="cursor-pointer" onClick={doReset}>
          清除筛选
        </Badge>
      </div>

      {/* 列表 */}
      {query.loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : query.error ? (
        <StateBlock title="加载失败" description={query.error.message} action={<Button onClick={() => query.refetch()}>重试</Button>} />
      ) : !query.data || query.data.orders.length === 0 ? (
        <StateBlock title="暂无订单" description="未查询到符合条件的订单" />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>订单号</TableHead>
                <TableHead>UID</TableHead>
                <TableHead>套餐</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>业务状态</TableHead>
                <TableHead>支付状态</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.orders.map((item: AdminOrderItem) => (
                <TableRow key={item.order.order_no}>
                  <TableCell className="font-mono text-xs">{item.order.order_no}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.order.uid}</TableCell>
                  <TableCell>
                    <div className="font-medium">{item.order.plan_name}</div>
                    <div className="text-xs text-muted-foreground">{item.order.plan_type === 'time' ? '时长' : '流量'}</div>
                  </TableCell>
                  <TableCell>{fmtMoney(item.order.price_amount, item.order.currency)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{STATUS_LABEL[item.order_source] ?? item.order_source}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(item.order.status)}>{STATUS_LABEL[item.order.status] ?? item.order.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(item.payment_status)}>{STATUS_LABEL[item.payment_status] ?? item.payment_status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{fmtTime(item.updated_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="link" size="sm" onClick={() => openDetail(item.order.order_no)}>
                      查看
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 分页 */}
      {!query.loading && query.data && total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            共 {total} 条，第 {curPage} / {pages} 页
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={curPage <= 1} onClick={() => goPage(curPage - 1)}>
              上一页
            </Button>
            <Button variant="outline" size="sm" disabled={curPage >= pages} onClick={() => goPage(curPage + 1)}>
              下一页
            </Button>
          </div>
        </div>
      )}

      {/* 详情抽屉 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>订单详情</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="space-y-2 py-8">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : detail ? (
            <div className="space-y-5 py-2 text-sm">
              {/* 订单快照 */}
              <section>
                <h3 className="mb-2 font-semibold">订单快照</h3>
                <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                  <KV k="订单号" v={detail.order.order_no} mono />
                  <KV k="UID" v={detail.order.uid} mono />
                  <KV k="套餐" v={`${detail.order.plan_name}（${detail.order.plan_type === 'time' ? '时长' : '流量'}）`} />
                  <KV k="金额" v={fmtMoney(detail.order.price_amount, detail.order.currency)} />
                  <KV k="业务状态" v={STATUS_LABEL[detail.order.status] ?? detail.order.status} />
                  <KV k="下单时间" v={fmtTime(detail.order.created_at)} />
                  <KV k="支付时间" v={fmtTime(detail.order.paid_at)} />
                  <KV k="订单来源" v={STATUS_LABEL[detail.order_source] ?? detail_order_source(detail.order_source)} />
                </div>
              </section>

              {/* 支付明细 */}
              <section>
                <h3 className="mb-2 font-semibold">支付明细</h3>
                <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                  <KV k="支付方式" v={`${detail.payment?.provider || '-'}${detail.payment?.payment?.payment_method_id ? ` / ${detail.payment?.payment?.payment_method_id}` : ''}`} />
                  <KV k="支付状态" v={STATUS_LABEL[paymentStatusName(detail.payment?.payment?.status)] ?? String(detail.payment?.payment?.status ?? '-')} />
                  <KV k="渠道会话号" v={detail.payment?.provider_session_id || '-'} mono />
                  <KV k="链上交易 ID" v={detail.payment?.transaction_id || '-'} mono />
                  <KV k="安全关闭时间" v={fmtTime(detail.payment?.close_after_at)} />
                  <KV k="下次对账时间" v={fmtTime(detail.payment?.next_reconcile_at)} />
                  <KV k="最近错误" v={detail.payment?.last_error || '无'} danger={!!detail.payment?.last_error} />
                  {detail.payment?.payment?.crypto_transfer && (
                    <>
                      <KV k="链上网络" v={detail.payment.payment.crypto_transfer.network} />
                      <KV k="固定金额" v={detail.payment.payment.crypto_transfer.amount} />
                      <KV k="收款地址" v={detail.payment.payment.crypto_transfer.receive_address} mono />
                    </>
                  )}
                </div>
              </section>

              {/* 操作审计 */}
              <section>
                <h3 className="mb-2 font-semibold">本次操作信息</h3>
                <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                  <KV k="操作人 UID" v={detail.operator_uid || '-'} mono />
                  <KV k="操作原因" v={detail.operation_reason || '-'} />
                </div>
              </section>

              {/* 人工裁决：仅 manual_review 状态可裁决（最终结论，替代自动对账） */}
              {isManualReview && (
                <section>
                  <h3 className="mb-2 font-semibold">人工裁决</h3>
                  <div className="space-y-3 rounded-lg border border-primary/30 p-3">
                    <Textarea
                      placeholder="请填写裁决依据（必填）"
                      value={reviewReason}
                      onChange={(e) => setReviewReason(e.target.value)}
                    />
                    {isCrypto && (
                      <div className="space-y-2">
                        <Label>链上交易哈希（确认放行时必填，作为支付证据）</Label>
                        <Input
                          placeholder="0x… 或 tron / 链上 tx id"
                          value={reviewEvidence}
                          onChange={(e) => setReviewEvidence(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button onClick={() => openConfirm('approve')} disabled={reviewMut.loading}>
                        确认放行
                      </Button>
                      <Button variant="destructive" onClick={() => openConfirm('reject')} disabled={reviewMut.loading}>
                        驳回
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      确认放行 = 标记已支付并触发权益发放；驳回 = 关闭订单且不发放。裁决为最终结论。
                    </p>
                  </div>
                </section>
              )}

              {/* 支付事件时间线 */}
              <section>
                <h3 className="mb-2 font-semibold">支付 / 补偿事件</h3>
                {detail.events.length === 0 ? (
                  <p className="text-muted-foreground">暂无事件</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.events.map((ev, i) => (
                      <li key={i} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{ev.event_type}</span>
                          <Badge variant={statusVariant(ev.status)}>{ev.status}</Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          创建：{fmtTime(ev.created_at)}　处理：{fmtTime(ev.processed_at)}
                        </div>
                        {ev.error_message && <div className="mt-1 text-xs text-destructive">错误：{ev.error_message}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* 重试发放 */}
              <section>
                <h3 className="mb-2 font-semibold">权益发放重试</h3>
                {canRetry ? (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="请填写重试原因（高风险操作）"
                      value={retryReason}
                      onChange={(e) => setRetryReason(e.target.value)}
                    />
                    <Button onClick={doRetry} disabled={retryMut.loading}>
                      重试发放
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      仅 <code className="rounded bg-muted px-1">paid</code> /{' '}
                      <code className="rounded bg-muted px-1">fulfill_failed</code> 状态的订单允许重试。
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    当前订单状态为 <code className="rounded bg-muted px-1">{detail.order.status}</code>，不在可重试范围（仅 paid / fulfill_failed）。
                  </p>
                )}
              </section>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 二次确认：高风险操作前的最后一道核对 */}
      <Dialog open={confirm.open} onOpenChange={(o) => setConfirm({ ...confirm, open: o })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm.decision === 'approve' ? '确认放行该订单？' : '驳回该订单？'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirm.decision === 'approve'
              ? '将把订单标记为「已支付」并触发权益发放（系统每 5 秒自动发放，或可用「重试发放」）。请确认已核对支付明细 / 链上交易号。'
              : '将关闭订单且不发放权益。注意：若为链上转账，资金不可退回，需线下补偿。请确认实际未到账。'}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm({ ...confirm, open: false })}>
              取消
            </Button>
            <Button
              variant={confirm.decision === 'approve' ? 'default' : 'destructive'}
              onClick={doReview}
              disabled={reviewMut.loading}
            >
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function KV({ k, v, mono, danger }: { k: string; v: string; mono?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={`text-right break-all ${mono ? 'font-mono text-xs' : ''} ${danger ? 'text-destructive' : ''}`}>{v}</span>
    </div>
  )
}

// PaymentStatus 枚举值为数字，映射回可读名
function paymentStatusName(status?: number): string {
  const map: Record<number, string> = {
    0: 'unspecified',
    1: 'creating',
    2: 'ready',
    3: 'paid',
    4: 'expired',
    5: 'creation_unknown',
    6: 'manual_review',
    7: 'failed',
  }
  return status === undefined ? '' : map[status] ?? String(status)
}

function detail_order_source(src: string): string {
  return STATUS_LABEL[src] ?? src
}
