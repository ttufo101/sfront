// 新建 / 编辑应用弹窗：app_key 决定安装目录与二进制名；
// 启动命令由用户填写并可随时调整，路径与生命周期命令由后端推导（release-center.md §13.16）。
// TLS 证书对是应用级可选资产：上传走文件服务独立的 deployer-secrets/ 前缀，
// deployer 只登记 file_id + sha256，证书内容从不进入 RPC 请求或页面回显。

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldCheck } from 'lucide-react'
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
import { createAppDefinition, updateAppDefinition } from '../api/apps'
import type { AppDefinition, TlsCertPair } from '@/lib/xrpc/deployer-contract'
import { NODE_IDENTITY_PATH, lifecycleScript, shortSha } from '../lib/model'
import { XrpcError } from '@/lib/xrpc/types'
import {
  deployerSecretAccept,
  uploadDeployerSecret,
  validateDeployerSecretFile,
  type DeployerSecretRole,
  type DeployerSecretUploadResult,
} from '@/lib/upload/fileApi'
import { uuidV4 } from '@/lib/upload/sha256'
import { formatBytes } from '@/lib/format'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (app: AppDefinition) => void
  /** 传入已有应用时为编辑模式；app_key 不可修改。 */
  app?: AppDefinition | null
}

interface CertState {
  file: File | null
  result: DeployerSecretUploadResult | null
  uploading: boolean
  progress: number | null
  key: string
}

const EMPTY_CERT: CertState = { file: null, result: null, uploading: false, progress: null, key: '' }
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/
const SAFE_COMMAND = /^[A-Za-z0-9._/:=@+,\- ]+$/

export function AppFormDialog({ open, onClose, onCreated, app }: Props) {
  const editing = !!app
  const [appKey, setAppKey] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [serviceType, setServiceType] = useState('relay')
  const [startCommand, setStartCommand] = useState('')
  const [requiresIdentity, setRequiresIdentity] = useState(false)
  const [cert, setCert] = useState<CertState>(EMPTY_CERT)
  const [keyFile, setKeyFile] = useState<CertState>(EMPTY_CERT)
  const [clearTls, setClearTls] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (app) {
      setAppKey(app.app_key)
      setDisplayName(app.display_name)
      setServiceType(app.service_type || 'relay')
      setStartCommand(app.start_command || `${app.app_key} `)
      setRequiresIdentity(!!app.requires_identity)
    } else {
      setAppKey('')
      setDisplayName('')
      setServiceType('relay')
      setStartCommand('')
      setRequiresIdentity(false)
    }
    // 弹窗每次打开都从干净状态开始：证书不回读、不留上一次的选择。
    setCert(EMPTY_CERT)
    setKeyFile(EMPTY_CERT)
    setClearTls(false)
  }, [open, app])

  const key = appKey.trim()
  const root = key ? `/opt/${key}` : '/opt/<app_key>'
  const commandPlaceholder = key ? `${key} -d ./conf` : 'mihomo -d ./conf'

  const pickCert = async (
    role: DeployerSecretRole,
    setter: (s: CertState) => void,
    file: File | undefined,
  ) => {
    if (!file) return
    const err = await validateDeployerSecretFile(file, role)
    if (err) {
      toast.error(err)
      return
    }
    setter({ file, result: null, uploading: false, progress: null, key: uuidV4() })
    setClearTls(false)
  }

  const uploadCert = async (
    role: DeployerSecretRole,
    state: CertState,
    setter: (s: CertState) => void,
  ) => {
    if (!state.file) {
      toast.error('请先选择文件')
      return
    }
    setter({ ...state, uploading: true, progress: 0 })
    try {
      const res = await uploadDeployerSecret(state.file, role, {
        idempotencyKey: state.key,
        onProgress: (p) => setter({ ...state, uploading: true, progress: p }),
      })
      setter({ ...state, result: res, uploading: false, progress: 100 })
      toast.success(`${state.file.name} 已上传（sha256 ${res.sha256.slice(0, 8)}…）`)
    } catch (e) {
      setter({ ...state, result: null, uploading: false, progress: null })
      toast.error(e instanceof Error ? e.message : '上传失败')
    }
  }

  const onSubmit = async () => {
    if (!KEY_PATTERN.test(key)) {
      toast.error('应用 key 需为 2-64 位小写字母、数字或连字符，且以字母/数字开头')
      return
    }
    if (!displayName.trim()) {
      toast.error('请填写显示名称')
      return
    }
    if (!serviceType.trim()) {
      toast.error('请填写服务类型')
      return
    }
    const cmd = startCommand.trim()
    if (!cmd || cmd.split(/\s+/)[0] !== key) {
      toast.error(`启动命令必须以应用 key「${key}」开头`)
      return
    }
    if (cmd.length > 512 || !SAFE_COMMAND.test(cmd)) {
      toast.error('启动命令只支持字母数字与 - . / _ : = @ + , 等字符，不可含引号、%、$、管道等符号')
      return
    }
    const certPicked = !!cert.file || !!keyFile.file
    const certReady = !!cert.result && !!keyFile.result
    if (certPicked && !certReady) {
      toast.error('证书与私钥必须成对上传完成，或都不上传')
      return
    }
    if (clearTls && certPicked) {
      toast.error('「移除证书」与新证书上传不能同时选择')
      return
    }
    const pair: TlsCertPair | null = certReady
      ? {
          cert_file_id: cert.result!.file_id,
          cert_sha256: cert.result!.sha256,
          key_file_id: keyFile.result!.file_id,
          key_sha256: keyFile.result!.sha256,
        }
      : null
    const base = {
      display_name: displayName.trim(),
      service_type: serviceType.trim(),
      start_command: cmd,
      requires_identity: requiresIdentity,
    }
    setSubmitting(true)
    try {
      const res = editing
        ? await updateAppDefinition({
            app_id: app!.app_id,
            ...base,
            ...(pair ? { tls_cert: pair } : clearTls ? { clear_tls_cert: true } : {}),
          })
        : await createAppDefinition({
            app_key: key,
            ...base,
            ...(pair ? { tls_cert: pair } : {}),
          })
      toast.success(editing ? `已保存应用 ${res.app.display_name}` : `已创建应用 ${res.app.display_name}`)
      onCreated(res.app)
      onClose()
    } catch (e) {
      toast.error(e instanceof XrpcError ? `${editing ? '保存' : '创建'}失败：${e.message}` : `${editing ? '保存' : '创建'}失败，请重试`)
    } finally {
      setSubmitting(false)
    }
  }

  const certField = (
    role: DeployerSecretRole,
    id: string,
    label: string,
    state: CertState,
    setter: (s: CertState) => void,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="file"
          accept={deployerSecretAccept()}
          disabled={state.uploading || submitting}
          onChange={(e) => void pickCert(role, setter, e.target.files?.[0])}
          className="flex-1"
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!state.file || state.uploading || !!state.result || submitting}
          onClick={() => void uploadCert(role, state, setter)}
        >
          {state.uploading ? '上传中…' : state.result ? '已上传' : '上传'}
        </Button>
      </div>
      {state.file && (
        <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
          <div>{state.file.name} · {formatBytes(state.file.size)}</div>
          {state.result && (
            <div className="mt-1 break-all text-success">
              file_id={state.result.file_id} · sha256={state.result.sha256}
            </div>
          )}
          {state.progress !== null && state.progress < 100 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary" style={{ width: `${state.progress}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑应用' : '新建应用'}</DialogTitle>
          <DialogDescription>
            应用 key 即安装目录名与二进制名；启动命令在这里填写、随时可改，改动于下次部署生成脚本时生效。
            证书对可选、属于应用定义而非版本。版本与部署节点在创建后单独维护。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="app-key">应用 key（唯一）</Label>
            <Input
              id="app-key"
              placeholder="例如 mihomo"
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
              disabled={submitting || editing}
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
            <Input
              id="app-type"
              placeholder="relay / landing / 自定义"
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="app-identity">需要本机身份文件</Label>
            <Select
              value={requiresIdentity ? 'yes' : 'no'}
              onValueChange={(v) => setRequiresIdentity(v === 'yes')}
              disabled={submitting}
            >
              <SelectTrigger id="app-identity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">不需要</SelectItem>
                <SelectItem value="yes">需要（relay 类心跳鉴权）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-2">
            <Label htmlFor="app-command">启动命令</Label>
            <Input
              id="app-command"
              className="font-mono"
              placeholder={commandPlaceholder}
              value={startCommand}
              onChange={(e) => setStartCommand(e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              首段必须与应用 key 一致；相对路径以安装目录为工作目录。例如 {key || 'mihomo'} -d ./conf、
              hysteria server -c conf/config.yaml。命令里不要写密码或 token——渲染后的脚本全局可读。
            </p>
          </div>
        </div>

        {/* ---- 可选 TLS 证书对：应用级资产，不随版本变化 ---- */}
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4" /> TLS 证书对（可选）
            </div>
            <span className="text-xs text-muted-foreground">不随版本变化 · 私钥只走独立机密前缀</span>
          </div>

          {editing && app?.tls_cert && (
            <div className="space-y-2 rounded-md bg-muted/50 p-2 text-xs">
              <div className="font-medium text-foreground">当前已配置（仅显示指纹，不回传内容）</div>
              <div className="break-all font-mono text-muted-foreground">
                server.crt {shortSha(app.tls_cert.cert_sha256)} · server.key {shortSha(app.tls_cert.key_sha256)}
              </div>
              <label className="flex items-center gap-2 text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={clearTls}
                  onChange={(e) => {
                    setClearTls(e.target.checked)
                    if (e.target.checked) {
                      setCert(EMPTY_CERT)
                      setKeyFile(EMPTY_CERT)
                    }
                  }}
                  disabled={submitting}
                />
                移除证书（下次部署起不再下发，也不删除目标机已有文件）
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {certField('cert', 'tls-cert', '证书 server.crt', cert, setCert)}
            {certField('key', 'tls-key', '私钥 server.key', keyFile, setKeyFile)}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            可以留空。上传后两份文件以固定文件名写入 <span className="font-mono">{root}/conf/server.crt</span> 与{' '}
            <span className="font-mono">{root}/conf/server.key</span>（0644 / 0600），每次部署按 sha256
            校验后覆盖；轮换证书在这里替换即可，无需发新版本。未配置时发布中心不下发、也不删除本机文件。
          </p>
        </div>

        <div className="space-y-2 rounded-md bg-muted/50 p-3 text-xs">
          <div className="font-medium text-foreground">由后端推导的统一布局（只读）</div>
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-1 font-mono">
            <dt className="text-muted-foreground">可执行程序</dt>
            <dd className="break-all">{root}/{key || '<app_key>'}</dd>
            <dt className="text-muted-foreground">配置模板</dt>
            <dd className="break-all">{root}/conf/config.yaml</dd>
            <dt className="text-muted-foreground">TLS 证书</dt>
            <dd className="break-all">{root}/conf/server.crt · {root}/conf/server.key（可选）</dd>
            <dt className="text-muted-foreground">生命周期</dt>
            <dd className="break-all">{lifecycleScript(key || '<app_key>')} · start|stop|restart|status</dd>
            <dt className="text-muted-foreground">本机身份</dt>
            <dd className="break-all">
              {requiresIdentity ? `${NODE_IDENTITY_PATH}（0600，应用自读）` : '不需要'}
            </dd>
          </dl>
          <p className="pt-1 leading-relaxed text-muted-foreground">
            部署时发布中心按应用定义渲染出该应用专属的 setup.sh；身份文件由纳管流程写入、由应用启动时读取，
            发布中心不签发、不合成、不覆盖。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? '保存' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
