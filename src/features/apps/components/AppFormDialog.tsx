// 新建应用弹窗：路径与生命周期命令全部由后端按 service_type 白名单推导，
// 前端只提交 app_key / display_name / service_type 三项，绝不提供自由文本路径或命令。
// 见 release-center.md §13.2 / §13.5。

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createAppDefinition } from '../api/apps'
import type { AppDefinition, ServiceType } from '@/lib/xrpc/deployer-contract'
import { APP_DIR_BY_TYPE, NODE_IDENTITY_PATH, lifecycleScript } from '../lib/model'
import { XrpcError } from '@/lib/xrpc/types'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (app: AppDefinition) => void
}

export function AppFormDialog({ open, onClose, onCreated }: Props) {
  const [appKey, setAppKey] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [serviceType, setServiceType] = useState<ServiceType>('relay')
  const [submitting, setSubmitting] = useState(false)

  const appDir = APP_DIR_BY_TYPE[serviceType] ?? 'mihomo'
  const root = `/opt/${appDir}`

  const onSubmit = async () => {
    const key = appKey.trim()
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(key)) {
      toast.error('应用 key 需为 2-64 位小写字母、数字或连字符，且以字母/数字开头')
      return
    }
    if (!displayName.trim()) {
      toast.error('请填写显示名称')
      return
    }
    setSubmitting(true)
    try {
      const res = await createAppDefinition({
        app_key: key,
        display_name: displayName.trim(),
        service_type: serviceType,
      })
      toast.success(`已创建应用 ${res.app.display_name}`)
      onCreated(res.app)
      onClose()
    } catch (e) {
      toast.error(e instanceof XrpcError ? `创建失败：${e.message}` : '创建失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建应用</DialogTitle>
          <DialogDescription>
            应用定义只登记名称与类型；目录、配置路径、启停命令全部由后端按统一约定推导，前端不提交路径或命令。
            版本与部署节点在创建后单独维护。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="app-key">应用 key（唯一）</Label>
            <Input
              id="app-key"
              placeholder="例如 mihomo-relay"
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="app-name">显示名称</Label>
            <Input
              id="app-name"
              placeholder="例如 Mihomo 中转"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="app-type">服务类型</Label>
            <Select
              value={serviceType}
              onValueChange={(v) => setServiceType(v as ServiceType)}
              disabled={submitting}
            >
              <SelectTrigger id="app-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="relay">中转 relay</SelectItem>
                <SelectItem value="landing">落地 landing</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2 rounded-md bg-muted/50 p-3 text-xs">
          <div className="font-medium text-foreground">由后端推导的统一布局（只读）</div>
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-1 font-mono">
            <dt className="text-muted-foreground">可执行程序</dt>
            <dd className="break-all">{root}/{appDir}</dd>
            <dt className="text-muted-foreground">配置模板</dt>
            <dd className="break-all">{root}/conf/config.yaml</dd>
            <dt className="text-muted-foreground">生命周期</dt>
            <dd className="break-all">{lifecycleScript(appDir)} · start|stop|restart|status</dd>
            <dt className="text-muted-foreground">本机身份</dt>
            <dd className="break-all">{NODE_IDENTITY_PATH}（0600，应用自读）</dd>
          </dl>
          <p className="pt-1 leading-relaxed text-muted-foreground">
            版本里上传可执行程序与零凭据的纯业务模板；身份文件由纳管流程写入、由应用启动时读取，
            发布中心不签发、不合成、不覆盖。所有 service_type 走同一条安装/升级/回滚路径。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
