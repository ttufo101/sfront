import { useEffect, useState } from 'react'
import { Download, ImageOff, Loader2, RefreshCw, ZoomIn } from 'lucide-react'
import { formatBytes } from '@/lib/format'
import type { FeedbackAttachment } from '@/lib/xrpc/admin-contract'
import { fetchFeedbackImageBlob } from '@/lib/upload/fileApi'

type ImgState = 'loading' | 'loaded' | 'error'

/**
 * 缩略图：用 file_id 走相对路径 + 管理员 token 取 blob 渲染。
 * feedback-files GET 当前要求鉴权（无 token 401），故不能裸用 <img src=url>，必须 fetch 带 token。
 */
function Thumbnail({
  att,
  onZoom,
}: {
  att: FeedbackAttachment
  onZoom: (a: FeedbackAttachment) => void
}) {
  const [state, setState] = useState<ImgState>('loading')
  const [src, setSrc] = useState('')
  const [nonce, setNonce] = useState(0) // 重试计数

  useEffect(() => {
    let revoked = false
    let objectUrl = ''
    setState('loading')
    setSrc('')
    fetchFeedbackImageBlob(att.file_id)
      .then((url) => {
        if (revoked) {
          URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setSrc(url)
        setState('loaded')
      })
      .catch(() => {
        if (!revoked) setState('error')
      })
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [att.file_id, nonce])

  const retry = () => setNonce((n) => n + 1)

  return (
    <div className="group relative aspect-square overflow-hidden rounded-md border bg-muted/40">
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/60">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {state === 'loaded' && src && (
        <img
          src={src}
          alt={att.file_name}
          className="h-full w-full cursor-zoom-in object-cover"
          onClick={() => onZoom(att)}
        />
      )}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted/80 px-2 text-center text-xs text-muted-foreground">
          <ImageOff className="h-5 w-5" />
          <span>图片加载失败</span>
          <button
            type="button"
            onClick={retry}
            className="mt-1 inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
          >
            <RefreshCw className="h-3 w-3" /> 重试
          </button>
        </div>
      )}
      {state === 'loaded' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
          <ZoomIn className="h-6 w-6 text-white" />
        </div>
      )}
    </div>
  )
}

export function AttachmentGallery({
  attachments,
  onZoom,
}: {
  attachments?: FeedbackAttachment[]
  onZoom?: (a: FeedbackAttachment) => void
}) {
  if (!attachments || attachments.length === 0) return null
  const missingId = attachments.some((a) => !a.file_id)

  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <p className="font-medium">图片附件（{attachments.length}）</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {attachments.map((att) =>
          att.file_id ? (
            <div key={att.file_id} className="space-y-1">
              <Thumbnail att={att} onZoom={onZoom ?? (() => {})} />
              <p className="truncate text-xs" title={att.file_name}>
                {att.file_name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {att.mime_type} · {att.width || '-'}×{att.height || '-'} ·{' '}
                {formatBytes(att.size_bytes)}
              </p>
            </div>
          ) : (
            <div
              key={att.sha256 || att.file_name || Math.random()}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground"
            >
              <ImageOff className="h-5 w-5" />
              <span>缺少 file_id</span>
            </div>
          ),
        )}
      </div>
      {missingId && (
        <p className="text-xs text-muted-foreground">
          提示：部分附件缺少 file_id，无法定位图片源，已以占位显示。
        </p>
      )}
    </div>
  )
}

export function Lightbox({
  att,
  onClose,
}: {
  att: FeedbackAttachment | null
  onClose: () => void
}) {
  const [state, setState] = useState<ImgState>('loading')
  const [src, setSrc] = useState('')

  useEffect(() => {
    if (!att) return
    let revoked = false
    let objectUrl = ''
    setState('loading')
    setSrc('')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)

    fetchFeedbackImageBlob(att.file_id)
      .then((url) => {
        if (revoked) {
          URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setSrc(url)
        setState('loaded')
      })
      .catch(() => {
        if (!revoked) setState('error')
      })

    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      window.removeEventListener('keydown', onKey)
    }
  }, [att, onClose])

  if (!att) return null

  const download = () => {
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    a.download = att.file_name || att.file_id
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        {state === 'loading' && (
          <div className="flex h-64 w-96 items-center justify-center rounded-lg bg-neutral-900">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-300" />
          </div>
        )}
        {state === 'loaded' && src && (
          <img
            src={src}
            alt={att.file_name}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          />
        )}
        {state === 'error' && (
          <div className="flex h-64 w-96 flex-col items-center justify-center gap-2 rounded-lg bg-neutral-900 text-sm text-neutral-300">
            <ImageOff className="h-6 w-6" />
            图片加载失败（请确认管理员已登录且网络可访问文件服务）
          </div>
        )}
        <div className="mt-2 text-center text-xs text-neutral-300">
          {att.file_name} · {att.mime_type} · {att.width || '-'}×{att.height || '-'} ·{' '}
          {formatBytes(att.size_bytes)}
        </div>
        <div className="mt-2 flex justify-center gap-3">
          <button
            type="button"
            onClick={download}
            disabled={state !== 'loaded'}
            className="inline-flex items-center gap-1 rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> 下载原图
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
