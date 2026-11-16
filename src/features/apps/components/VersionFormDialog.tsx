// 新建版本弹窗：可执行程序 + 统一配置模板分别上传到 deployer-artifacts/ 前缀，
// 取回 file_id / filename / size / sha256 后一次性登记版本；版本号由后端自增且创建后不可变。
// 用户直传二进制、无需打包；服务端按 ELF magic 校验，下发时直写 + mv -f 原子替换。
// 两个文件都必须上传成功才允许提交，避免产生「版本存在但制品缺失」的坏数据。

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  deployerArtifactAccept,
  uploadDeployerArtifact,
  validateDeployerArtifactName,
  type DeployerArtifactKind,
  type DeployerArtifactUploadResult,
} from '@/lib/upload/fileApi'
import { uuidV4 } from '@/lib/upload/sha256'
import { formatBytes } from '@/lib/format'
import { createAppVersion } from '../api/apps'
import type { AppDefinition, AppVersion } from '@/lib/xrpc/deployer-contract'
import { XrpcError } from '@/lib/xrpc/types'

interface Props {
  app: AppDefinition
  open: boolean
  nextVersionNo: number
  onClose: () => void
  onCreated: (v: AppVersion) => void
}

interface UploadState {
  file: File | null
  result: DeployerArtifactUploadResult | null
  progress: number | null
  uploading: boolean
  key: string
}

const EMPTY: UploadState = { file: null, result: null, progress: null, uploading: false, key: '' }

export function VersionFormDialog({ app, open, nextVersionNo, onClose, onCreated }: Props) {
  const [bin, setBin] = useState<UploadState>(EMPTY)
  const [cfg, setCfg] = useState<UploadState>(EMPTY)
  const [changeNote, setChangeNote] = useState('')
  const [isStable, setIsStable] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const pick = async (
    kind: DeployerArtifactKind,
    setter: (s: UploadState) => void,
    file: File | undefined,
  ) => {
    if (!file) return
    const err = validateDeployerArtifactName(file.name, kind)
    if (err) {
      toast.error(err)
      return
    }
    setter({ file, result: null, progress: null, uploading: false, key: uuidV4() })
  }

  const upload = async (
    kind: DeployerArtifactKind,
    state: UploadState,
    setter: (s: UploadState) => void,
  ) => {
    if (!state.file) {
      toast.error('请先选择文件')
      return
    }
    setter({ ...state, uploading: true, progress: 0 })
    try {
      const res = await uploadDeployerArtifact(state.file, kind, {
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
    if (!bin.result || !cfg.result) {
      toast.error('可执行程序与统一配置模板都必须上传完成')
      return
    }
    setSubmitting(true)
    try {
      const res = await createAppVersion({
        app_id: app.app_id,
        bin_file_id: bin.result.file_id,
        bin_filename: bin.result.filename,
        bin_sha256: bin.result.sha256,
        bin_size: String(bin.result.size),
        config_file_id: cfg.result.file_id,
        config_filename: cfg.result.filename,
        config_sha256: cfg.result.sha256,
        change_note: changeNote.trim(),
        is_stable: isStable,
      })
      toast.success(`已创建 ${res.version.version_label}`)
      onCreated(res.version)
      onClose()
      setBin(EMPTY)
      setCfg(EMPTY)
      setChangeNote('')
    } catch (e) {
      toast.error(e instanceof XrpcError ? `登记失败：${e.message}` : '登记失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const field = (
    kind: DeployerArtifactKind,
    id: string,
    label: string,
    hint: string,
    state: UploadState,
    setter: (s: UploadState) => void,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="file"
          accept={deployerArtifactAccept(kind)}
          disabled={state.uploading || submitting}
          onChange={(e) => void pick(kind, setter, e.target.files?.[0])}
          className="flex-1"
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!state.file || state.uploading || !!state.result || submitting}
          onClick={() => void upload(kind, state, setter)}
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
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建版本 · {app.display_name}</DialogTitle>
          <DialogDescription>
            本次将创建 <span className="font-semibold text-foreground">v{nextVersionNo}</span>。版本号由后端
            UNIQUE(app_id, version_no) 行锁自增；创建后制品与模板不可覆盖。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {field(
            'binary',
            'ver-bin',
            '可执行程序（直接上传，无需打包）',
            '上传编译好的二进制即可，不需要先压成 zip / tar.gz；服务端按 ELF 文件头校验。按 file_id + sha256 固化，下发时直写到 /opt/<app>/<app> 并原子替换，供升级/回滚复用。',
            bin,
            setBin,
          )}
          {field(
            'config',
            'ver-cfg',
            '统一配置模板（YAML / 文本）',
            '只含业务参数、零凭据，不要写 node-id / node-password / gateway-url。节点身份由应用自读 /etc/starland/node-identity，发布中心不合成、不追加、不覆盖。',
            cfg,
            setCfg,
          )}
          <div className="space-y-2">
            <Label htmlFor="ver-note">变更说明</Label>
            <Textarea
              id="ver-note"
              rows={3}
              placeholder="本次变更内容"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              disabled={submitting}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={isStable}
              onChange={(e) => setIsStable(e.target.checked)}
              disabled={submitting}
            />
            设为稳定版
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={onSubmit} disabled={!bin.result || !cfg.result || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <UploadCloud className="mr-2 h-4 w-4" />
            登记版本
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
