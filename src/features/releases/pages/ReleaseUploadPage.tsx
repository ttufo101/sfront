// 发布新版本页（/releases/new）：选择平台 → 选择安装包 → 计算 SHA-256/大小 → 填写版本元数据 → 上传(进度) → 调 Admin 发布。

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { computeSha256, uuidV4 } from '@/lib/upload/sha256'
import { FileUploadError, uploadAppRelease } from '@/lib/upload/fileApi'
import { publishAppVersion, listAppVersions } from '@/features/releases/api/releases'
import { XrpcError } from '@/lib/xrpc/types'
import { formatBytes } from '@/lib/format'

// 平台 -> 支持的安装包扩展名列表（macOS 同时支持 dmg/pkg）
const PLATFORM_PACKAGE: Record<string, string[]> = {
  android: ['apk'],
  ios: ['ipa'],
  windows: ['exe'],
  mac: ['dmg', 'pkg'],
}

function getPackageType(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return (dot < 0 ? '' : fileName.slice(dot + 1)).toLowerCase()
}

function packageTypeLabel(types: string[]): string {
  return types.map((t) => t.toUpperCase()).join('/')
}

export function ReleaseUploadPage() {
  const navigate = useNavigate()
  const [platform, setPlatform] = useState('android')
  const allowedTypes = PLATFORM_PACKAGE[platform]
  const fileAccept = allowedTypes.map((t) => `.${t}`).join(',')
  const fileLabel = packageTypeLabel(allowedTypes)

  const [file, setFile] = useState<File | null>(null)
  const [sha256, setSha256] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')

  const [latestVersion, setLatestVersion] = useState('')
  const [buildNumber, setBuildNumber] = useState('')
  const [minimumVersion, setMinimumVersion] = useState('')
  const [updateTitle, setUpdateTitle] = useState('')
  const [updateDescription, setUpdateDescription] = useState('')

  const [progress, setProgress] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const ext = getPackageType(f.name)
    if (!allowedTypes.includes(ext)) {
      toast.error(`文件扩展名应为 .${allowedTypes.join(' 或 .')}`)
      e.target.value = ''
      return
    }
    const hash = await computeSha256(f)
    setFile(f)
    setSha256(hash)
    setIdempotencyKey(uuidV4())
    setProgress(null)
  }

  const onPlatformChange = (p: string) => {
    setPlatform(p)
    // 平台切换后扩展名要求变化，已选文件可能不再匹配，提示重新选择
    const nextAllowed = PLATFORM_PACKAGE[p]
    if (file && !nextAllowed.includes(getPackageType(file.name))) {
      toast.warning('平台已切换，请重新选择对应安装包')
      setFile(null)
      setSha256('')
      setIdempotencyKey('')
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) {
      toast.error('请先选择安装包文件')
      return
    }
    const actualPackageType = getPackageType(file.name)
    if (!PLATFORM_PACKAGE[platform].includes(actualPackageType)) {
      toast.error('安装包扩展名与所选平台不匹配')
      return
    }
    if (!/^\d+\.\d+\.\d+$/.test(latestVersion.trim())) {
      toast.error('版本号格式应为 major.minor.patch，例如 1.2.3')
      return
    }
    const bn = Number(buildNumber)
    if (!Number.isInteger(bn) || bn <= 0) {
      toast.error('构建号必须为正整数')
      return
    }
    setSubmitting(true)
    setProgress(0)
    try {
      // 乐观锁：admin 要求 expected_release_id 与该平台当前生效版本一致，否则 409。
      // 首发该平台时无生效版本，留空即可。
      const current = await listAppVersions({ platform, include_history: false })
      const expectedReleaseId =
        current.releases.find((r) => r.status === 'active')?.release_id ?? ''

      const upload = await uploadAppRelease(file, {
        platform,
        packageType: actualPackageType,
        idempotencyKey,
        onProgress: setProgress,
      })
      const res = await publishAppVersion({
        file_id: upload.file_id,
        platform,
        latest_version: latestVersion.trim(),
        build_number: String(bn),
        minimum_version: minimumVersion.trim(),
        update_title: updateTitle.trim(),
        update_description: updateDescription.trim(),
        client_request_id: uuidV4(),
        expected_release_id: expectedReleaseId,
        // 文件服务不再回查，以下元信息须由前端从上传结果转发给 admin。
        // 注意：文件服务实际响应不含 package_type，须用实际文件扩展名推导。
        file_name: upload.filename,
        package_size_bytes: String(upload.size),
        package_sha256: upload.sha256,
        package_type: actualPackageType,
      })
      toast.success(`已发布 ${res.release.latest_version}（${res.release.platform}）`)
      navigate('/releases')
    } catch (err) {
      if (err instanceof FileUploadError) {
        // 联调诊断：把 HTTP 状态码 / 请求 URL / 后端原始响应全打到 toast，便于贴给后端
        const parts: string[] = [`code=${err.code}`]
        if (err.status != null) parts.push(`HTTP ${err.status}`)
        if (err.url) parts.push(`URL: ${err.url}`)
        // token 诊断：直接判断“是否过期 / 剩余时长”，一眼确认是不是 token 问题
        if (err.tokenExpireAt != null) {
          const remainSec = err.tokenExpireAt - Math.floor(Date.now() / 1000)
          const tag =
            remainSec > 0
              ? `剩余 ${Math.floor(remainSec / 60)}分${remainSec % 60}秒`
              : `已过期 ${-Math.floor(remainSec / 60)}分`
          parts.push(`Token:${tag}`)
        } else {
          parts.push('Token:无')
        }
        if (err.tokenUserId) parts.push(`UID:${err.tokenUserId}`)
        const raw = err.responseText?.trim()
        if (raw) parts.push(`响应: ${raw.length > 240 ? raw.slice(0, 240) + '…' : raw}`)
        if (err.requestId) parts.push(`reqId: ${err.requestId}`)
        toast.error(`上传失败：${err.message}`, { description: parts.join('  ·  ') })
      } else if (err instanceof XrpcError) {
        toast.error(`发布失败：${err.message}`)
      } else {
        toast.error('操作失败，请重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="发布新版本"
        description="上传客户端安装包到文件服务，并在 Admin 登记版本号/构建号/发布说明后发布为生效版本。"
        actions={
          <Button variant="outline" onClick={() => navigate('/releases')}>
            返回
          </Button>
        }
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>安装包信息</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>平台 / 包类型</Label>
            <Select value={platform} onValueChange={onPlatformChange} disabled={submitting}>
              <SelectTrigger>
                <SelectValue placeholder="选择平台" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="android">Android（apk）</SelectItem>
                <SelectItem value="ios">iOS（ipa）</SelectItem>
                <SelectItem value="windows">Windows（exe）</SelectItem>
                <SelectItem value="mac">macOS（dmg/pkg）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="release-file">安装包文件（{fileLabel}）</Label>
            <Input id="release-file" type="file" accept={fileAccept} onChange={onFileChange} disabled={submitting} />
            {file && (
              <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                <div>文件名：{file.name}</div>
                <div>大小：{formatBytes(file.size)}</div>
                <div className="break-all">SHA-256：{sha256 || '计算中…'}</div>
                <div className="break-all">幂等键：{idempotencyKey}</div>
              </div>
            )}
            {progress !== null && progress < 100 && (
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
            {progress === 100 && <div className="text-xs text-success">上传完成</div>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="version">版本号（major.minor.patch）</Label>
              <Input
                id="version"
                placeholder="1.2.3"
                value={latestVersion}
                onChange={(e) => setLatestVersion(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="build">构建号（同平台严格递增）</Label>
              <Input
                id="build"
                type="number"
                min={1}
                placeholder="1042"
                value={buildNumber}
                onChange={(e) => setBuildNumber(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="minVersion">最低版本（低于此版本强制升级，可选）</Label>
            <Input
              id="minVersion"
              placeholder="1.0.0"
              value={minimumVersion}
              onChange={(e) => setMinimumVersion(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">更新标题</Label>
            <Input
              id="title"
              placeholder="例如：稳定性与性能优化"
              value={updateTitle}
              onChange={(e) => setUpdateTitle(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">更新说明</Label>
            <Textarea
              id="desc"
              placeholder="本次更新的主要内容…"
              value={updateDescription}
              onChange={(e) => setUpdateDescription(e.target.value)}
              disabled={submitting}
              rows={4}
            />
          </div>

          <Button type="submit" className="w-full" disabled={submitting || !file}>
            {submitting ? '上传并发布中…' : '上传并发布'}
          </Button>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
