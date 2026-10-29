import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useXrpcQuery } from '@/lib/xrpc/hooks'
import { formatBytes, formatTimestamp, toNumberSafe } from '@/lib/format'
import { AdminFeedbackTicket, type FeedbackAttachment } from '@/lib/xrpc/admin-contract'
import { getFeedbackDetail, listFeedback, updateFeedbackStatus } from '@/features/feedback/api/feedback'
import { AttachmentGallery, Lightbox } from '@/features/feedback/components/AttachmentGallery'
import { getDiagnosticLogDownloadUrl } from '@/lib/upload/fileApi'
import { getValidAccessToken } from '@/lib/auth/session'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

const PAGE_SIZE = 20

const ticketTypeVariant = (t: string) =>
  t === 'diagnostic' ? 'secondary' : 'default'
const ticketTypeText = (t: string) => (t === 'diagnostic' ? '诊断日志' : '意见反馈')
const categoryText = (c: string) =>
  c === 'suggestion' ? '建议' : c === 'issue' ? '问题' : c === 'other' ? '其他' : c || '-'

const statusVariant = (s: string) => {
  switch (s) {
    case 'pending':
      return 'warning'
    case 'reviewing':
      return 'default'
    case 'resolved':
      return 'success'
    case 'closed':
      return 'secondary'
    default:
      return 'secondary'
  }
}
const statusText = (s: string) =>
  s === 'pending' ? '待处理' : s === 'reviewing' ? '处理中' : s === 'resolved' ? '已解决' : s === 'closed' ? '已关闭' : s || '-'

const STATUS_OPTIONS = [
  { value: 'pending', label: '待处理' },
  { value: 'reviewing', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'closed', label: '已关闭' },
]

export function FeedbackPage() {
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')
  const [ticketType, setTicketType] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword), 300)
    return () => clearTimeout(t)
  }, [keyword])

  const { data, loading, error, refetch } = useXrpcQuery(
    'ListFeedback',
    { page, page_size: PAGE_SIZE, ticket_type: ticketType, status, keyword: debounced },
    [page, debounced, ticketType, status],
  )

  const total = data ? toNumberSafe(data.total) : 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const [detail, setDetail] = useState<AdminFeedbackTicket | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [statusDraft, setStatusDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [zoom, setZoom] = useState<FeedbackAttachment | null>(null)

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    try {
      const res = await getFeedbackDetail(id)
      setDetail(res.ticket)
      setStatusDraft(res.ticket.status)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDetailLoading(false)
    }
  }

  const saveStatus = async () => {
    if (!detail || statusDraft === detail.status) {
      setDetail(null)
      return
    }
    setSaving(true)
    try {
      await updateFeedbackStatus(detail.feedback_id, statusDraft)
      setDetail({ ...detail, status: statusDraft })
      toast.success('状态已更新')
      refetch()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const hasLogFile = useMemo(
    () => !!detail && detail.ticket_type === 'diagnostic' && !!detail.file_id,
    [detail],
  )

  const [downloading, setDownloading] = useState(false)
  // 诊断日志是私有接口（/api/v1/log-files/{id}），必须带管理员 Bearer token；
  // 新标签页 window.open 无法携带 JWT，故用 fetch + blob 触发本地下载。
  const downloadLog = async () => {
    if (!detail?.file_id) return
    setDownloading(true)
    try {
      const token = await getValidAccessToken()
      const res = await fetch(getDiagnosticLogDownloadUrl(detail.file_id), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        toast.error(`下载失败（HTTP ${res.status}）`)
        return
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = detail.file_name || detail.file_id
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
      toast.success('已开始下载')
    } catch (e) {
      // 网络层失败（fetch 直接 reject）：通常是证书未被浏览器信任、跨域被拦截或目标不可达。
      // 给出可操作的提示，方便用户对照控制台 net::ERR_CERT / CORS 报错定位。
      const msg = e instanceof TypeError
        ? '下载失败：网络连接被阻止。请确认浏览器已信任 106.52.77.108 的自签名证书，或检查控制台是否有 net::ERR_CERT / CORS 报错'
        : (e as Error).message || '下载失败'
      toast.error(msg)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      <PageHeader title="用户反馈" description="查看用户提交的意见反馈与诊断日志，处理并流转工单状态" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={ticketType || 'all'} onValueChange={(v) => { setTicketType(v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="feedback">意见反馈</SelectItem>
            <SelectItem value="diagnostic">诊断日志</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status || 'all'} onValueChange={(v) => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="搜索 UID / 内容 / 工单号"
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
          className="max-w-sm"
        />
        <Button variant="outline" onClick={() => refetch()}>刷新</Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <StateBlock title="加载失败" description={error.message} action={<Button onClick={() => refetch()}>重试</Button>} />
      ) : !data || data.tickets.length === 0 ? (
        <StateBlock title="暂无反馈" description={debounced || ticketType || status ? '没有符合筛选条件的工单' : '当前还没有用户反馈'} />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>工单号</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>UID</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tickets.map((t) => (
                  <TableRow key={t.feedback_id}>
                    <TableCell className="font-mono text-xs">{t.feedback_id}</TableCell>
                    <TableCell>
                      <Badge variant={ticketTypeVariant(t.ticket_type)}>{ticketTypeText(t.ticket_type)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{categoryText(t.category)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(t.status)}>{statusText(t.status)}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.uid}</TableCell>
                    <TableCell className="text-muted-foreground">{formatTimestamp(t.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="link" size="sm" onClick={() => openDetail(t.feedback_id)}>查看详情</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              共 {total} 条 · 第 {page}/{totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>下一页</Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>反馈详情 · {detail?.feedback_id}</DialogTitle>
          </DialogHeader>
          {detailLoading || !detail ? (
            <div className="space-y-2 py-8">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-4 overflow-auto py-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant={ticketTypeVariant(detail.ticket_type)}>{ticketTypeText(detail.ticket_type)}</Badge>
                <Badge variant={statusVariant(detail.status)}>{statusText(detail.status)}</Badge>
                {detail.category && <span className="text-xs text-muted-foreground">分类：{categoryText(detail.category)}</span>}
              </div>

              {(detail.content || detail.description) && (
                <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-sm">
                  {detail.content && <p className="whitespace-pre-wrap">{detail.content}</p>}
                  {detail.description && <p className="whitespace-pre-wrap text-muted-foreground">说明：{detail.description}</p>}
                  {detail.contact && <p className="text-xs text-muted-foreground">联系方式：{detail.contact}</p>}
                </div>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label="UID" value={detail.uid} />
                <Field label="设备" value={detail.device_type ? `${detail.device_type} · ${detail.device_id}` : '-'} />
                <Field label="客户端版本" value={detail.app_version || '-'} />
                <Field label="系统版本" value={detail.os_version || '-'} />
                <Field label="客户端 IP" value={detail.client_ip || '-'} />
                <Field label="创建时间" value={formatTimestamp(detail.created_at)} />
                <Field label="更新时间" value={formatTimestamp(detail.updated_at)} />
                {detail.ticket_type === 'diagnostic' && (
                  <>
                    <Field label="日志开始" value={detail.log_started_at && detail.log_started_at !== '0' ? formatTimestamp(detail.log_started_at) : '-'} />
                    <Field label="日志结束" value={detail.log_ended_at && detail.log_ended_at !== '0' ? formatTimestamp(detail.log_ended_at) : '-'} />
                  </>
                )}
              </dl>

              {hasLogFile && (
                <div className="space-y-1 rounded-lg border p-3 text-sm">
                  <p className="font-medium">诊断日志文件</p>
                  <p className="truncate text-muted-foreground">{detail.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(detail.size_bytes)} · {detail.content_type || '未知类型'}
                  </p>
                  <p className="break-all font-mono text-xs text-muted-foreground">SHA256: {detail.sha256 || '-'}</p>
                  <Button variant="outline" size="sm" className="mt-1" onClick={downloadLog} disabled={downloading}>
                    {downloading ? '下载中…' : '下载日志'}
                  </Button>
                </div>
              )}

              <AttachmentGallery attachments={detail.attachments} onZoom={setZoom} />

              <div className="space-y-2 border-t pt-4">
                <Label>处理状态</Label>
                <Select value={statusDraft} onValueChange={setStatusDraft}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="选择状态" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>关闭</Button>
            <Button onClick={saveStatus} disabled={saving || !detail || statusDraft === detail.status}>
              {saving ? '保存中…' : '保存状态'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Lightbox att={zoom} onClose={() => setZoom(null)} />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all">{value || '-'}</dd>
    </div>
  )
}
