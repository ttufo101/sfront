// 部署弹窗（从版本行点开）：这是全流程唯一保留勾选框的入口。
// 升级/回滚都在「已部署节点」列表页勾选，次级向导只渲染只读快照，不提供 checkbox、不新增节点。

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { listDeployableNodes } from '../api/apps'
import type { AppDefinition, DeployableNode } from '@/lib/xrpc/deployer-contract'
import { SERVICE_TYPE_LABEL, versionNo } from '../lib/model'
import { useDeploySubmit } from '../lib/useDeploySubmit'
import { DriftConfirmDialog, BlockedReasonsDialog } from './DeployFeedback'
import { uuidV4 } from '@/lib/upload/sha256'

interface Props {
  open: boolean
  app: AppDefinition
  versionLabel: string
  onClose: () => void
  onSubmitted: (batchId: string) => void
}

export function DeployDialog({ open, app, versionLabel, onClose, onSubmitted }: Props) {
  const [nodes, setNodes] = useState<DeployableNode[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [concurrency, setConcurrency] = useState(1)
  const deploy = useDeploySubmit(onSubmitted)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setSelected(new Set())
    listDeployableNodes({ service_type: app.service_type, app_id: app.app_id })
      .then((r) => setNodes(r.nodes ?? []))
      .catch((e) => toast.error(e instanceof Error ? e.message : '加载可选节点失败'))
      .finally(() => setLoading(false))
  }, [open, app.app_id, app.service_type])

  const toggle = (n: DeployableNode) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(n.node_id)) next.delete(n.node_id)
      else next.add(n.node_id)
      return next
    })
  }

  const selectedNodes = nodes.filter((n) => selected.has(n.node_id))

  const onSubmit = () => {
    if (selectedNodes.length === 0) {
      toast.error('请至少勾选一台服务器')
      return
    }
    void deploy.submit({
      app_id: app.app_id,
      mode: 'install',
      target_version: versionLabel,
      node_ids: selectedNodes.map((n) => n.node_id),
      snapshots: selectedNodes.map((n) => ({ node_id: n.node_id, current_version: n.current_version || '' })),
      concurrency,
      client_request_id: uuidV4(),
      confirm_drift: false,
    })
  }

  const targetNo = versionNo(versionLabel)

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>部署 {versionLabel} · {app.display_name}</DialogTitle>
            <DialogDescription>
              按服务类型过滤（{SERVICE_TYPE_LABEL[app.service_type]}），已软删/已下架节点不出现。
              统一模板原文写入目标机，节点身份由应用自读本机文件、发布中心不合成；停服重启会断开现有连接。
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在加载可部署节点…
            </div>
          ) : (
            <div className="max-h-80 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>服务器 IP</TableHead>
                    <TableHead>节点名称</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>当前版本</TableHead>
                    <TableHead>安装类型</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        没有可选的已上架节点
                      </TableCell>
                    </TableRow>
                  )}
                  {nodes.map((n) => {
                    const cur = versionNo(n.current_version)
                    const installType = cur === 0
                      ? '首次安装'
                      : cur === targetNo
                        ? '已装同版本 · 重复部署'
                        : cur < targetNo
                          ? '覆盖旧版本'
                          : '降级覆盖'
                    return (
                      <TableRow key={n.node_id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={selected.has(n.node_id)}
                            onChange={() => toggle(n)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{n.public_ip}</TableCell>
                        <TableCell>{n.display_name || '-'}</TableCell>
                        <TableCell>{SERVICE_TYPE_LABEL[n.node_type] ?? n.node_type}</TableCell>
                        <TableCell>{n.current_version || '—'}</TableCell>
                        <TableCell className="text-xs">{installType}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="deploy-concurrency">分批并发（台）</Label>
              <Input
                id="deploy-concurrency"
                type="number"
                min={1}
                max={10}
                value={concurrency}
                onChange={(e) => setConcurrency(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-28"
              />
            </div>
            <p className="flex-1 text-xs text-muted-foreground">
              已选 {selectedNodes.length} 台。默认 1 台串行，避免同时重启多台造成大面积断连。
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              本机身份文件 <span className="font-mono">/etc/starland/node-identity</span>（0600）由纳管流程写入、
              应用启动时自读；文件缺失时应用拒绝启动，需先完成节点纳管。发布中心只覆盖二进制与
              <span className="font-mono">conf/config.yaml</span> 纯业务模板，不签发、不合成、不覆盖任何凭据。
            </span>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={deploy.submitting}>
              取消
            </Button>
            <Button onClick={onSubmit} disabled={deploy.submitting || loading || selectedNodes.length === 0}>
              {deploy.submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              提交部署批次
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deploy.drift && (
        <DriftConfirmDialog
          nodes={deploy.drift.nodes}
          submitting={deploy.submitting}
          onConfirm={deploy.confirmDrift}
          onCancel={deploy.cancelDrift}
        />
      )}
      {deploy.blocked && (
        <BlockedReasonsDialog reasons={deploy.blocked} onClose={deploy.clearBlocked} />
      )}
    </>
  )
}
