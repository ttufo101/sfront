// 查看统一配置模板：版本里只存一份零凭据的纯业务模板。
// 身份由应用自读 /etc/starland/node-identity，发布中心不再做任何「模板 + identity」合成，
// 因此不再展示「合成后」视图（见 release-center.md §13.4）。

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getAppVersionConfig } from '../api/apps'
import { XrpcError } from '@/lib/xrpc/types'

interface Props {
  open: boolean
  appId: string
  versionLabel: string
  onClose: () => void
}

export function ConfigViewDialog({ open, appId, versionLabel, onClose }: Props) {
  const [template, setTemplate] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getAppVersionConfig({ app_id: appId, version_label: versionLabel })
      .then((r) => setTemplate(r.template || '（该版本未登记配置模板）'))
      .catch((e) => toast.error(e instanceof XrpcError ? e.message : '加载配置失败'))
      .finally(() => setLoading(false))
  }, [open, appId, versionLabel])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>查看配置 · {versionLabel}</DialogTitle>
          <DialogDescription>
            版本里只存一份统一业务配置模板，零凭据。节点身份由应用启动时自读本机文件，
            发布中心不合成、不追加；install / upgrade / rollback 写入的是同一份模板原文。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          统一模板（原文）
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>

        <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-4 text-xs leading-relaxed">
          {template}
        </pre>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
