// 批次明细：节点级日志/状态 + 「重试」与「前往已部署节点回滚」。
// 明确定稿：任务明细里不直接生成回滚批次，失败不自动回滚，交人工判断。

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDeployBatch, retryDeployItem } from '../api/apps'
import type { DeployBatch } from '@/lib/xrpc/deployer-contract'
import {
  BATCH_STATUS_LABEL,
  MODE_LABEL,
  TASK_STATUS_LABEL,
  formatShortTime,
  isBatchTerminal,
  taskTone,
} from '../lib/model'
import { XrpcError } from '@/lib/xrpc/types'

interface Props {
  batchId: string
  onClose: () => void
}

export function TaskDetailDialog({ batchId, onClose }: Props) {
  const navigate = useNavigate()
  const [batch, setBatch] = useState<DeployBatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState<string | null>(null)

  const load = () => {
    getDeployBatch(batchId)
      .then((r) => setBatch(r.batch))
      .catch((e) => toast.error(e instanceof XrpcError ? e.message : '加载批次失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // 未进入终态时持续轮询，到终态停止。
    const timer = setInterval(() => {
      getDeployBatch(batchId).then((r) => {
        setBatch(r.batch)
        if (isBatchTerminal(r.batch.status)) clearInterval(timer)
      }).catch(() => clearInterval(timer))
    }, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId])

  const onRetry = async (nodeId: string) => {
    setRetrying(nodeId)
    try {
      const res = await retryDeployItem({ batch_id: batchId, node_id: nodeId })
      toast.success(res.message || '已重新入队')
      load()
    } catch (e) {
      toast.error(e instanceof XrpcError ? e.message : '重试失败')
    } finally {
      setRetrying(null)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>批次明细 · {batchId}</DialogTitle>
          <DialogDescription>
            {batch
              ? `${MODE_LABEL[batch.mode] ?? batch.mode} → ${batch.target_version} · ${BATCH_STATUS_LABEL[batch.status] ?? batch.status} · 成功 ${batch.succeeded} / 失败 ${batch.failed} / 跳过 ${batch.skipped}`
              : '加载中…'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : (
          <div className="max-h-80 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>服务器 IP</TableHead>
                  <TableHead>从 → 到</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>健康检查</TableHead>
                  <TableHead>错误 / 日志</TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(batch?.items ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      暂无节点明细
                    </TableCell>
                  </TableRow>
                )}
                {(batch?.items ?? []).map((it) => (
                  <TableRow key={it.task_id}>
                    <TableCell className="font-mono text-xs">{it.public_ip || it.node_id}</TableCell>
                    <TableCell className="text-xs">{it.from_version || '—'} → {it.to_version}</TableCell>
                    <TableCell>
                      <Badge variant={taskTone(it.status)}>
                        {TASK_STATUS_LABEL[it.status] ?? it.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{it.health_result || '—'}</TableCell>
                    <TableCell className="max-w-xs whitespace-pre-wrap break-all text-xs text-muted-foreground">
                      {it.error || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatShortTime(it.started_at)}
                    </TableCell>
                    <TableCell>
                      {it.status === 'failed' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retrying === it.node_id}
                          onClick={() => void onRetry(it.node_id)}
                        >
                          {retrying === it.node_id ? '重试中…' : '重试'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          失败不自动回滚。台账已如实记为本次目标版本 + status=failed，请到「已部署节点」人工判断后发起回滚。
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
          {batch?.app_id && (
            <Button
              onClick={() => {
                onClose()
                navigate(`/apps/${batch.app_id}?tab=deployments`)
              }}
            >
              前往已部署节点回滚
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
