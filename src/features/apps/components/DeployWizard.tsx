// 升级 / 回滚 2 步向导。
// 关键定稿：选择只在「已部署节点」列表页发生一次；这里只渲染只读快照，
// 没有 checkbox、不能新增节点、不能逐台指定目标版本。
// 回滚目标由人工统一指定一个，不预置推导默认值、不产生新版本。

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import type { AppDefinition, AppDeployment, AppVersion, DeployMode } from '@/lib/xrpc/deployer-contract'
import {
  evaluateTargets,
  MODE_LABEL,
  SERVICE_TYPE_LABEL,
  versionNo,
  type TargetNode,
} from '../lib/model'
import { useDeploySubmit } from '../lib/useDeploySubmit'
import { DriftConfirmDialog, BlockedReasonsDialog } from './DeployFeedback'
import { uuidV4 } from '@/lib/upload/sha256'

interface Props {
  open: boolean
  mode: Exclude<DeployMode, 'install'>
  app: AppDefinition
  /** 列表页已勾选的部署台账行 —— 只读快照，本向导不再变更集合。 */
  deployments: AppDeployment[]
  versions: AppVersion[]
  onClose: () => void
  onSubmitted: (batchId: string) => void
}

export function DeployWizard({
  open,
  mode,
  app,
  deployments,
  versions,
  onClose,
  onSubmitted,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [target, setTarget] = useState('')
  const [concurrency, setConcurrency] = useState(1)
  const [confirmRisk, setConfirmRisk] = useState(false)
  const deploy = useDeploySubmit(onSubmitted)

  const snapshot: TargetNode[] = useMemo(
    () =>
      deployments.map((d) => ({
        nodeId: d.node_id,
        ip: d.public_ip,
        name: d.display_name,
        current: d.current_version,
      })),
    [deployments],
  )

  useEffect(() => {
    if (!open) return
    setStep(1)
    setTarget('')
    setConcurrency(1)
    setConfirmRisk(false)
  }, [open])

  const maxCurrent = Math.max(0, ...snapshot.map((n) => versionNo(n.current)))
  // 升级目标必须比所有已选节点当前版本都新（后端对任一不 newer 的节点硬阻断整批）。
  const candidateVersions =
    mode === 'upgrade'
      ? versions.filter((v) => versionNo(v.version_label) > maxCurrent)
      : versions

  const evaluation = evaluateTargets(mode, target, snapshot)

  const goNext = () => {
    if (!target) {
      toast.error(mode === 'rollback' ? '请选择统一目标版本' : '请选择升级目标版本')
      return
    }
    if (evaluation.blocked) {
      toast.error(evaluation.blocked)
      return
    }
    if (evaluation.executable === 0) {
      toast.error('所有节点都已在目标版本，无需变更')
      return
    }
    setStep(2)
  }

  const onSubmit = () => {
    if (!confirmRisk) {
      toast.error('请确认已了解停服重启的影响')
      return
    }
    void deploy.submit({
      app_id: app.app_id,
      mode,
      target_version: target,
      node_ids: snapshot.map((n) => n.nodeId),
      snapshots: snapshot.map((n) => ({ node_id: n.nodeId, current_version: n.current || '' })),
      concurrency,
      client_request_id: uuidV4(),
      confirm_drift: false,
    })
  }

  const toneVariant = (tone: 'green' | 'gray' | 'red' | 'orange') =>
    tone === 'green' ? 'success' : tone === 'red' ? 'destructive' : tone === 'orange' ? 'warning' : 'secondary'

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {MODE_LABEL[mode]} · {app.display_name}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                第 {step} / 2 步 {step === 1 ? '选择目标版本' : '确认影响'}
              </span>
            </DialogTitle>
            <DialogDescription>
              本页是列表页勾选结果的只读快照，不能新增或修改节点。
              {mode === 'rollback'
                ? ' 回滚目标由人工统一指定一个，不由台账推导，不产生新版本。'
                : ' 旧版本一律走回滚入口，升级目标只能选比当前更新的版本。'}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border">
            <div className="border-b bg-muted/30 px-3 py-2 text-xs font-medium">
              已选 {snapshot.length} 台（只读快照）
            </div>
            <div className="max-h-56 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>服务器 IP</TableHead>
                    <TableHead>节点名称</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>当前版本</TableHead>
                    <TableHead>上次成功</TableHead>
                    {step === 2 && <TableHead>校验结果</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.map((n, i) => {
                    const d = deployments[i]
                    const row = evaluation.rows[i]
                    return (
                      <TableRow key={n.nodeId}>
                        <TableCell className="font-mono text-xs">{n.ip}</TableCell>
                        <TableCell>{n.name || '-'}</TableCell>
                        <TableCell>{SERVICE_TYPE_LABEL[d.node_type] ?? d.node_type}</TableCell>
                        <TableCell>{n.current || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{d.last_success_version || '—'}</TableCell>
                        {step === 2 && (
                          <TableCell>
                            <Badge variant={toneVariant(row.tone)}>{row.verdict}</Badge>
                            {row.reason && <div className="mt-1 max-w-xs text-xs text-muted-foreground">{row.reason}</div>}
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {step === 1 ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="wiz-target">
                  {mode === 'rollback' ? '统一目标版本（必选）' : '升级目标版本（必选）'}
                </Label>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger id="wiz-target">
                    <SelectValue placeholder="请选择版本" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidateVersions.map((v) => (
                      <SelectItem key={v.version_id} value={v.version_label}>
                        {v.version_label} · {v.change_note || '无变更说明'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {candidateVersions.length === 0 && (
                  <p className="text-xs text-destructive">
                    没有比所有已选节点都新的版本，请先「新建版本」。
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="wiz-concurrency">分批并发（台）</Label>
                <Input
                  id="wiz-concurrency"
                  type="number"
                  min={1}
                  max={10}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                  className="w-28"
                />
              </div>
              {mode === 'rollback' && (
                <p className="col-span-2 text-xs text-muted-foreground">
                  目标高于任一节点当前版本即整批硬阻断；等于当前的节点自动跳过；跨版本降级只做软警告。
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/40 p-3 text-sm">
                <div>目标版本：<span className="font-semibold">{target}</span></div>
                <div>执行 {evaluation.executable} 台 · 跳过 {evaluation.rows.filter((r) => r.tone === 'gray').length} 台 · 并发 {concurrency}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  写入路径与 install 完全一致（纯模板原文，身份由应用自读本机文件），回滚不产生新版本、不整包备份。
                </div>
              </div>
              {evaluation.hasCrossVersion && (
                <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
                  存在跨版本降级：请确认目标版本的配置与制品兼容当前现场，失败不会自动回滚。
                </div>
              )}
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span>
                  停服重启会断开现有用户连接。健康检查失败不自动回滚，台账会如实记为目标版本 + status=failed，
                  由你到「已部署节点」人工判断并发起下一次回滚。
                </span>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={confirmRisk}
                  onChange={(e) => setConfirmRisk(e.target.checked)}
                />
                我已确认影响，提交 {MODE_LABEL[mode]} 批次
              </label>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={step === 1 ? onClose : () => setStep(1)} disabled={deploy.submitting}>
              {step === 1 ? '取消' : '上一步'}
            </Button>
            {step === 1 ? (
              <Button onClick={goNext} disabled={!target || !!evaluation.blocked}>
                下一步
              </Button>
            ) : (
              <Button onClick={onSubmit} disabled={!confirmRisk || deploy.submitting}>
                {deploy.submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                确认提交
              </Button>
            )}
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
