// 漂移确认与硬阻断提示：三入口共用，避免 deploy / upgrade / rollback 各写一套。

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function DriftConfirmDialog({
  nodes,
  submitting,
  onConfirm,
  onCancel,
}: {
  nodes: string[]
  submitting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>检测到节点版本漂移</DialogTitle>
          <DialogDescription>
            勾选时的版本快照与台账当前值不一致，说明期间有其他批次改动了这些节点。
            不做强制乐观锁，由你决定是否仍按本次目标版本继续。
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-48 space-y-1 overflow-auto rounded-md bg-muted/50 p-3 text-sm">
          {nodes.map((n) => (
            <li key={n} className="font-mono text-xs">{n}</li>
          ))}
        </ul>
        <p className="text-xs text-warning">继续将直接覆盖这些节点的现场版本。</p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            返回检查
          </Button>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting ? '提交中…' : '确认继续'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BlockedReasonsDialog({
  reasons,
  onClose,
}: {
  reasons: string[]
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批次未创建 · 目标校验未通过</DialogTitle>
          <DialogDescription>
            只要有任一节点触发硬阻断，整批都不会下发。请调整目标版本或改用正确入口后重试。
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 space-y-2 overflow-auto">
          {reasons.map((r, i) => (
            <li key={i} className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm">
              {r}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
