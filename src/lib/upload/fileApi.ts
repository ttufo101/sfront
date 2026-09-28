// 文件服务客户端（独立 REST，不复用 xrpc transport）：上传客户端安装包到 /api/v1/app-releases。
// 与 Admin 网关不同：这里是 multipart/form-data + 独立错误体 {code,message,request_id}。
// 鉴权按用户决策复用管理员 JWT（Bearer 转发）；开发环境走相对路径由 Vite 反代规避 CORS。

import { config } from '@/config'
import {
  getAccessTokenExpireAt,
  getAccessTokenUserId,
  getValidAccessToken,
} from '@/lib/auth/session'
import { computeSha256 } from './sha256'

/** 上传成功后的返回结构（对齐 api.md §4） */
export interface AppReleaseUploadResult {
  file_id: string
  file_kind: string
  filename: string
  size: number
  sha256: string
  created_at: string
  request_id: string
}

export interface UploadAppReleaseOptions {
  platform: string
  packageType: string
  /** 调用方生成的 UUID v4 幂等键（api.md §1/§2） */
  idempotencyKey: string
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

/** 文件服务错误：归一为 {code, message, requestId}，并附带联调诊断字段。 */
export class FileUploadError extends Error {
  code: string
  requestId?: string
  /** HTTP 状态码（网络层失败时通常无） */
  status?: number
  /** 后端原始响应体（便于联调时贴给后端看） */
  responseText?: string
  /** 实际请求的 URL（开发环境为相对路径，经 Vite 反代） */
  url?: string
  /** 实际用于本次上传的 token 的 UserId（取自 JWT） */
  tokenUserId?: string | null
  /** 实际用于本次上传的 token 的过期时间（Unix 秒；用于判断“是否过期”） */
  tokenExpireAt?: number | null
  constructor(
    code: string,
    message: string,
    requestId?: string,
    extra?: {
      status?: number
      responseText?: string
      url?: string
      tokenUserId?: string | null
      tokenExpireAt?: number | null
    },
  ) {
    super(message)
    this.name = 'FileUploadError'
    this.code = code
    this.requestId = requestId
    this.status = extra?.status
    this.responseText = extra?.responseText
    this.url = extra?.url
    this.tokenUserId = extra?.tokenUserId
    this.tokenExpireAt = extra?.tokenExpireAt
  }
}

function resolveFileUrl(path: string): string {
  // 开发环境：相对路径，由 Vite dev proxy 把 /api/v1 反代到 VITE_FILE_API_BASE，规避 CORS
  if (import.meta.env.DEV) return path
  // 生产构建：配置了 fileApiBase 走绝对地址，否则同源（由网关反代 /api/v1）
  return config.fileApiBase ? config.fileApiBase + path : path
}

/** 安装包公开下载链接（api.md §5：GET /api/v1/app-releases/{file_id} 为公开接口）。 */
export function getAppReleaseDownloadUrl(fileId: string): string {
  return resolveFileUrl(`/api/v1/app-releases/${fileId}`)
}

export async function uploadAppRelease(
  file: File,
  opts: UploadAppReleaseOptions,
): Promise<AppReleaseUploadResult> {
  const url = resolveFileUrl('/api/v1/app-releases')
  const sha256 = await computeSha256(file)
  const token = await getValidAccessToken()
  const tokenDiag = token
    ? { userId: getAccessTokenUserId(token), expireAt: getAccessTokenExpireAt(token) }
    : null

  return new Promise<AppReleaseUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)
    xhr.setRequestHeader('Idempotency-Key', opts.idempotencyKey)
    xhr.setRequestHeader('X-File-Size', String(file.size))
    xhr.setRequestHeader('X-File-SHA256', sha256)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onProgress) {
        opts.onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as AppReleaseUploadResult)
        } catch {
          // 2xx 但响应体非 JSON：仍把原始响应带出，便于排查
            reject(
              new FileUploadError('INVALID_RESPONSE', '响应解析失败', undefined, {
                status: xhr.status,
                responseText: xhr.responseText,
                url,
                tokenUserId: tokenDiag?.userId ?? null,
                tokenExpireAt: tokenDiag?.expireAt ?? null,
              }),
            )
        }
      } else {
        reject(parseError(xhr, url, tokenDiag))
      }
    }
    // 网络层失败（如网关 connection: close 断连、CORS、代理未命中）：附上请求 URL 便于定位
    xhr.onerror = () =>
      reject(
        new FileUploadError('NETWORK_ERROR', '网络错误，上传失败', undefined, {
          url,
          tokenUserId: tokenDiag?.userId ?? null,
          tokenExpireAt: tokenDiag?.expireAt ?? null,
        }),
      )
    xhr.onabort = () =>
      reject(
        new FileUploadError('ABORTED', '上传已取消', undefined, {
          url,
          tokenUserId: tokenDiag?.userId ?? null,
          tokenExpireAt: tokenDiag?.expireAt ?? null,
        }),
      )
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    const form = new FormData()
    form.append('file', file)
    form.append('platform', opts.platform)
    form.append('package_type', opts.packageType)
    xhr.send(form)
  })
}

function parseError(
  xhr: XMLHttpRequest,
  url?: string,
  tokenDiag?: { userId: string | null; expireAt: number | null } | null,
): FileUploadError {
  let code = `HTTP_${xhr.status}`
  let message = xhr.statusText || '上传失败'
  let requestId: string | undefined
  try {
    const body = JSON.parse(xhr.responseText) as {
      code?: string
      message?: string
      request_id?: string
    }
    if (body.code) code = body.code
    if (body.message) message = body.message
    if (body.request_id) requestId = body.request_id
  } catch {
    // 非 JSON 响应体，保留默认 code/message
  }
  return new FileUploadError(code, message, requestId, {
    status: xhr.status,
    responseText: xhr.responseText,
    url,
    tokenUserId: tokenDiag?.userId ?? null,
    tokenExpireAt: tokenDiag?.expireAt ?? null,
  })
}

