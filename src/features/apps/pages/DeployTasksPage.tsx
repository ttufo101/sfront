// 全局发布任务 /deploy-tasks：跨应用批次列表，进行中自动轮询到终态。
// 展开明细只有「重试」与「前往已部署节点回滚」，不在明细里直接生成批次。

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listAppDefinitions, listDeployBatches } from '../api/apps'
import { TaskDetailDialog } from '../components/TaskDetailDialog'
import type { AppDefinition, DeployBatch } from '@/lib/xrpc/deployer-contract'
import {
  BATCH_STATUS_LABEL,
  MODE_LABEL,
  MODE_TONE,
  formatShortTime,
  isBatchTerminal,
  taskTone,
} from '../lib/model'

export function DeployTasksPage() {
  const [batches, setBatches] = useState<DeployBatch[]>([])
  const [apps, setApps] = useState<AppDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [appFilter, setAppFilter] = useState('all')
  const [modeFilter, setModeFilter] = useState('all')
  const [taskBatch, setTaskBatch] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await listDeployBatches({
        app_id: appFilter === 'all' ? '' : appFilter,
        mode: modeFilter === 'all' ? '' : modeFilter,
        limit: 50,
      })
      setBatches(res.batches ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载发布任务失败')
    } finally {
      setLoading(false)
    }
  }, [appFilter, modeFilter])

  useEffect(() => {
    listAppDefinitions().then((r) => setApps(r.apps ?? [])).catch(() => setApps([]))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const hasActive = batches.some((b) => !isBatchTerminal(b.status))
    if (!hasActive) return
    const timer = setInterval(() => void load(true), 3000)
    return () => clearInterval(timer)
  }, [batches, load])

  const appName = (id: string) => apps.find((a) => a.app_id === id)?.display_name ?? id

  return (
    <>
      <PageHeader
        title="发布任务"
        description="部署 / 升级 / 回滚全类型批次。StartDeploy 只写任务表立即返回，前端轮询到终态。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-1 h-4 w-4" /> 刷新
          </Button>
        }
      />

      <div className="mb-3 flex items-center gap-3">
        <Select value={appFilter} onValueChange={setAppFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="全部应用" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部应用</SelectItem>
            {apps.map((a) => (
              <SelectItem key={a.app_id} value={a.app_id}>{a.display_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={modeFilter} onValueChange={setModeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="install">部署</SelectItem>
            <SelectItem value="upgrade">升级</SelectItem>
            <SelectItem value="rollback">回滚</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">共 {batches.length} 个批次</span>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>批次</TableHead>
              <TableHead>应用</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>目标版本</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>成功 / 失败 / 跳过</TableHead>
              <TableHead>发起人</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && batches.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-14 text-center text-sm text-muted-foreground">
                  还没有发布批次
                </TableCell>
              </TableRow>
            )}
            {batches.map((b) => (
              <TableRow key={b.batch_id}>
                <TableCell className="font-mono text-xs">{b.batch_id}</TableCell>
                <TableCell className="max-w-xs truncate text-xs">{appName(b.app_id)}</TableCell>
                <TableCell>
                  <Badge variant={MODE_TONE[b.mode] ?? 'secondary'}>{MODE_LABEL[b.mode] ?? b.mode}</Badge>
                </TableCell>
                <TableCell className="font-medium">{b.target_version}</TableCell>
                <TableCell>
                  <Badge variant={taskTone(
                    b.status === 'running' || b.status === 'queued' ? 'running'
                      : b.status === 'succeeded' ? 'succeeded'
                        : b.status,
                  )}>
                    {BATCH_STATUS_LABEL[b.status] ?? b.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{b.succeeded} / {b.failed} / {b.skipped}（共 {b.total}）</TableCell>
                <TableCell className="text-xs text-muted-foreground">{b.operator || '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatShortTime(b.created_at)}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setTaskBatch(b.batch_id)}>
                    查看明细
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {taskBatch && <TaskDetailDialog batchId={taskBatch} onClose={() => setTaskBatch(null)} />}
    </>
  )
}
