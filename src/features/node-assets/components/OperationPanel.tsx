// 批量操作面板：白名单 operation 选择 → 提交异步批次 → 轮询逐台结果 → 查看单台日志。
// 安全约束：前端只提交 operation_id 与有限参数（params_json 扁平 string map），
// 命令文本一律由后端按 node_type 白名单生成；服务名是否合法由后端 allowedServices 最终裁决。
// 资源数据：probe.system / disk.usage / net.listen 可即时查看系统与磁盘/端口情况；
// CPU/内存等持续指标不在本服务采集，后续从外部监控系统读取。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Loader2, Play, RefreshCw, X } from 'lucide-react'
import { XrpcError } from '@/lib/xrpc/types'
import { isBatchTerminal, type NodeAsset, type OperationBatch, type OperationInfo } from '@/lib/xrpc/deployer-contract'
import { uuidV4 } from '@/lib/utils'
import {
  listOperations,
  submitOperationBatch,
  getOperationBatch,
  cancelOperationBatch,
  getTaskLog,
} from '../api/assets'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const NO_OP = '__none__'
const POLL_INTERVAL_MS = 2000

// 服务名输入建议值：仅作为默认值提示，后端 allowedServices 是唯一校验方。
// 现场接入真实服务名后，管理员可直接在输入框中改成白名单内的名称。
const SERVICE_HINT: Record<string, string> = {
  relay: 'starland-mihomo',
  landing: 'hysteria-server',
}

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'

function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'destructive'
    case 'running':
      return 'default'
    case 'canceled':
    case 'partial':
      return 'warning'
    default:
      return 'secondary'
  }
}

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  succeeded: '成功',
  partial: '部分成功',
  failed: '失败',
  canceled: '已取消',
}

interface LogState {
  taskId: string
  nodeId: string
  loading: boolean
  log: string
}

export function OperationPanel({
  selected,
  onClearSelection,
}: {
  selected: NodeAsset[]
  onClearSelection: () => void
}) {
  const [operations, setOperations] = useState<OperationInfo[]>([])
  const [opsLoading, setOpsLoading] = useState(false)
  const [opId, setOpId] = useState(NO_OP)
  const [serviceName, setServiceName] = useState('')
  const [lines, setLines] = useState('50')
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [batchId, setBatchId] = useState('')
  const [batch, setBatch] = useState<OperationBatch | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)
  const [log, setLog] = useState<LogState | null>(null)

  const nodeTypes = useMemo(
    () => Array.from(new Set(selected.map((n) => n.node_type))).sort(),
    [selected],
  )
  const crossType = nodeTypes.length > 1

  // 加载各节点类型的 operation 并求交集；跨类型时隐藏需要服务名的操作，
  // 因为同一 service_name 无法同时通过两种 node_type 的后端白名单。
  useEffect(() => {
    let cancelled = false
    if (nodeTypes.length === 0) {
      setOperations([])
      setOpId(NO_OP)
      return
    }
    setOpsLoading(true)
    Promise.all(nodeTypes.map((t) => listOperations({ node_type: t })))
      .then((results) => {
        if (cancelled) return
        const first = results[0]?.operations ?? []
        const common = first.filter((op) =>
          results.every((r) => (r.operations ?? []).some((o) => o.operation_id === op.operation_id)),
        )
        setOperations(crossType ? common.filter((op) => !op.param_keys?.includes('service_name')) : common)
      })
      .catch((e: XrpcError) => {
        if (!cancelled) toast.error(e.message || '加载可执行操作失败')
      })
      .finally(() => {
        if (!cancelled) setOpsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [nodeTypes, crossType])

  // 类型变化时给服务名一个建议默认值（可编辑）。
  useEffect(() => {
    if (nodeTypes.length === 1) setServiceName(SERVICE_HINT[nodeTypes[0]] ?? '')
  }, [nodeTypes])

  const currentOp = operations.find((o) => o.operation_id === opId)
  useEffect(() => {
    if (opId !== NO_OP && !currentOp) setOpId(NO_OP)
  }, [opId, currentOp])

  const needsService = !!currentOp?.param_keys?.includes('service_name')
  const needsLines = !!currentOp?.param_keys?.includes('lines')
  const dangerous = opId === 'service.restart' || opId === 'service.stop'

  const poll = useCallback(async (id: string): Promise<string | null> => {
    try {
      const res = await getOperationBatch({ batch_id: id })
      setBatch(res.batch)
      setPollError(null)
      return res.batch?.status ?? null
    } catch (e) {
      setPollError((e as XrpcError).message || '查询批次进度失败')
      return null
    }
  }, [])

  // 批次未进入终态时每 2 秒轮询一次；卸载或切换批次时自动停止。
  useEffect(() => {
    if (!batchId) return
    let active = true
    let timer: number | undefined
    const tick = async () => {
      const status = await poll(batchId)
      if (!active) return
      if (status && !isBatchTerminal(status)) {
        timer = window.setTimeout(tick, POLL_INTERVAL_MS)
      }
    }
    void tick()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [batchId, poll])

  const buildParamsJson = (): string | null => {
    const params: Record<string, string> = {}
    if (needsService) {
      const svc = serviceName.trim()
      if (!svc) {
        toast.error('请填写服务名')
        return null
      }
      params.service_name = svc
    }
    if (needsLines) {
      const n = Number(lines)
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        toast.error('日志行数须为 1~200 的整数')
        return null
      }
      params.lines = String(n)
    }
    return JSON.stringify(params)
  }

  const doSubmit = async () => {
    if (selected.length === 0) {
      toast.error('请先勾选目标节点')
      return
    }
    if (!currentOp) {
      toast.error('请选择要执行的操作')
      return
    }
    const paramsJson = buildParamsJson()
    if (paramsJson === null) return
    setSubmitting(true)
    try {
      const res = await submitOperationBatch({
        target_node_ids: selected.map((n) => n.node_id),
        operation_id: currentOp.operation_id,
        params_json: paramsJson,
        client_request_id: uuidV4(),
      })
      setBatch(null)
      setPollError(null)
      setBatchId(res.batch_id)
      toast.success(`批次已提交：${res.batch_id}（后台异步执行）`)
    } catch (e) {
      toast.error((e as XrpcError).message || '提交批次失败')
    } finally {
      setSubmitting(false)
      setConfirmOpen(false)
    }
  }

  const onSubmit = () => {
    if (dangerous) setConfirmOpen(true)
    else void doSubmit()
  }

  const onCancel = async () => {
    if (!batchId) return
    setCanceling(true)
    try {
      const res = await cancelOperationBatch({ batch_id: batchId })
      toast.success(`已取消 ${res.canceled} 个排队任务（已发出的命令无法撤销）`)
      await poll(batchId)
    } catch (e) {
      toast.error((e as XrpcError).message || '取消失败')
    } finally {
      setCanceling(false)
    }
  }

  const openLog = async (taskId: string, nodeId: string) => {
    setLog({ taskId, nodeId, loading: true, log: '' })
    try {
      const res = await getTaskLog({ task_id: taskId })
      setLog({ taskId, nodeId, loading: false, log: res.log || '（无输出）' })
    } catch (e) {
      setLog({ taskId, nodeId, loading: false, log: `读取日志失败：${(e as XrpcError).message}` })
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>批量操作</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            已选 <span className="font-medium text-foreground">{selected.length}</span> 台节点
            {selected.length > 0 && (
              <span className="ml-2 text-xs">
                {selected.slice(0, 6).map((n) => n.node_id).join('、')}
                {selected.length > 6 ? ` 等 ${selected.length} 台` : ''}
              </span>
            )}
          </div>
          {selected.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              <X className="h-4 w-4" />
              清空选择
            </Button>
          )}
        </div>

        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          运维命令由后端白名单生成，前端不接受任何命令文本。系统信息 / 磁盘使用 / 监听端口可即时查看节点资源情况；
          CPU、内存等持续监控指标本期不采集，后续从外部监控系统读取。
        </p>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>操作</Label>
            <Select value={opId} onValueChange={setOpId}>
              <SelectTrigger>
                <SelectValue placeholder="选择操作" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_OP} disabled>
                  请选择操作
                </SelectItem>
                {operations.map((op) => (
                  <SelectItem key={op.operation_id} value={op.operation_id}>
                    {op.label}（{op.operation_id}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>服务名 {needsService && <span className="text-destructive">*</span>}</Label>
            <Input
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="后端白名单内的服务名"
              disabled={!needsService}
            />
          </div>

          <div className="space-y-1.5">
            <Label>日志行数 {needsLines && <span className="text-destructive">*</span>}</Label>
            <Input
              type="number"
              min={1}
              max={200}
              value={lines}
              onChange={(e) => setLines(e.target.value)}
              disabled={!needsLines}
            />
          </div>

          <div className="flex items-end">
            <Button
              className="w-full"
              onClick={onSubmit}
              disabled={submitting || opsLoading || selected.length === 0 || !currentOp}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              提交批次
            </Button>
          </div>
        </div>

        {crossType && (
          <p className="text-xs text-warning">
            当前选中了多种节点类型，服务类操作已隐藏（后端按节点类型校验服务名白名单，跨类型请分批执行）。
          </p>
        )}
        {needsService && (
          <p className="text-xs text-muted-foreground">
            服务名仅作为白名单参数提交，非法值会被后端拒绝；命令固定为 systemctl 前缀，不会拼接自由文本。
          </p>
        )}

        {batch && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">批次 {batch.batch_id}</span>
                <Badge variant={statusVariant(batch.status)}>
                  {STATUS_LABEL[batch.status] ?? batch.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {batch.operation_id} · 共 {batch.total} 台 · 成功 {batch.succeeded} · 失败 {batch.failed}
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void poll(batchId)}>
                  <RefreshCw className="h-4 w-4" />
                  刷新
                </Button>
                {!isBatchTerminal(batch.status) && (
                  <Button variant="outline" size="sm" onClick={onCancel} disabled={canceling}>
                    取消排队任务
                  </Button>
                )}
              </div>
            </div>

            {pollError && <p className="text-xs text-destructive">进度查询异常：{pollError}</p>}

            {(batch.tasks ?? []).length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>节点</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>退出码</TableHead>
                    <TableHead>输出摘要</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batch.tasks.map((t) => (
                    <TableRow key={t.task_id}>
                      <TableCell className="font-mono text-xs">{t.node_id}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(t.status)}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {t.status === 'queued' ? '-' : t.exit_code}
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate font-mono text-xs text-muted-foreground">
                        {t.error || t.output || '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => void openLog(t.task_id, t.node_id)}>
                          <FileText className="h-4 w-4" />
                          日志
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        {selected.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">请先在上方节点清单中勾选目标节点。</p>
        )}
      </CardContent>

      {/* 危险操作二次确认 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认执行「{currentOp?.label}」？</DialogTitle>
            <DialogDescription>
              该操作将作用于 {selected.length} 台节点：{selected.map((n) => n.node_id).join('、')}。
              命令一经发出无法撤销，请确认当前没有正在进行的发布或变更。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              返回
            </Button>
            <Button variant="destructive" onClick={() => void doSubmit()} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              确认执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 单台任务日志 */}
      <Dialog open={!!log} onOpenChange={(open) => !open && setLog(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>任务日志 · {log?.nodeId}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{log?.taskId}</DialogDescription>
          </DialogHeader>
          <Textarea
            readOnly
            className="h-[420px] font-mono text-xs"
            value={log?.loading ? '加载中…' : log?.log ?? ''}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLog(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
