// 统一 xrpc transport：组装信封、注入 com、POST 到网关、解包 {code,msg,data}。
// 页面/组件禁止直接使用 fetch；统一走 xrpcAdminCall（后台）与 xrpcLoginCall（鉴权）。

import { config } from '@/config'
import { getAccessToken, getValidAccessToken } from '@/lib/auth/session'
import { uuidV4 } from '@/lib/utils'
import { ADMIN_MODULE, LOGIN_MODULE, AdminContract, AdminMethod } from './admin-contract'
import { XrpcCom, XrpcEnvelope, XrpcError, XrpcResponseEnvelope } from './types'

export interface CallOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

const DEV_ID_KEY = 'starland.admin.dev_id'

function getDevId(): string {
  let id = localStorage.getItem(DEV_ID_KEY)
  if (!id) {
    id = uuidV4()
    localStorage.setItem(DEV_ID_KEY, id)
  }
  return id
}

function buildCom(jwtToken: string): XrpcCom {
  return {
    dev_id: getDevId(),
    dev_type: config.devType,
    app_ver: config.appVersion,
    os_ver: 'web',
    jwt_token: jwtToken,
  }
}

function resolveUrl(path: string): string {
  // 开发环境统一走相对路径，由 Vite dev proxy 转发到真实后端，规避浏览器跨域(CORS)
  if (import.meta.env.DEV) return path
  // 生产构建：配置了 apiBase 走绝对地址，否则同源（由网关反代 /startlandapi）
  return config.apiBase ? config.apiBase + path : path
}

async function postJson<T>(path: string, envelope: XrpcEnvelope, opts?: CallOptions): Promise<T> {
  const controller = new AbortController()
  const timer = opts?.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  try {
    const res = await fetch(resolveUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    })
    if (!res.ok) {
      // 网关会把后端业务错误以非 2xx 状态码返回，响应体通常仍是 {code,msg} 信封。
      // 先尝试读出业务消息，读不到再退回 HTTP 状态码，避免只看到干巴巴的 "HTTP 409"。
      let msg = `HTTP ${res.status}`
      try {
        const errBody = (await res.json()) as XrpcResponseEnvelope<unknown>
        if (errBody?.msg) msg = errBody.msg
      } catch {
        // 响应体非 JSON，保持 HTTP 状态码提示
      }
      throw new XrpcError(-1, msg)
    }
    const body = (await res.json()) as XrpcResponseEnvelope<T>
    // 处理顺序：传输成功 → 业务信封 → code != 0 转业务错误 → 取 data
    if (body.code !== 0) throw new XrpcError(body.code, body.msg || '业务错误')
    return body.data
  } catch (e) {
    if (e instanceof XrpcError) throw e
    const err = e as Error
    if (err.name === 'AbortError') {
      throw new XrpcError(-2, '请求已取消或超时', 'cancel')
    }
    throw new XrpcError(-3, err.message || '网络错误', 'network')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function xrpcCall<T = unknown>(
  module: string,
  method: string,
  params: Record<string, unknown>,
  opts?: CallOptions,
): Promise<T> {
  // 后台受保护调用：自动保证 token 有效（过期则触发刷新）
  const jwt = (await getValidAccessToken()) ?? ''
  const envelope: XrpcEnvelope = {
    com: buildCom(jwt),
    req: { module, method, params },
  }
  return postJson<T>(config.adminEndpoint, envelope, opts)
}

/** 后台管理调用（统一网关 /startlandapi，module 固定 starland.admin.com） */
export function xrpcAdminCall<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  opts?: CallOptions,
): Promise<T> {
  return xrpcCall<T>(ADMIN_MODULE, method, params, opts)
}

/**
 * 登录调用（module 固定 starland.login.com）。
 * 注意：登录/刷新本身不需要（也不应等待）access token 刷新，故用同步 getAccessToken，
 * 避免 RefreshToken 请求递归触发 getValidAccessToken → 再次调用自身。
 */
export function xrpcLoginCall<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  opts?: CallOptions,
): Promise<T> {
  const envelope: XrpcEnvelope = {
    com: buildCom(getAccessToken() ?? ''),
    req: { module: LOGIN_MODULE, method, params },
  }
  return postJson<T>(config.adminEndpoint, envelope, opts)
}

/** 类型安全的后台调用：请求/响应与 admin-contract 契约对齐，禁止 any */
export function adminCall<K extends AdminMethod>(
  method: K,
  params: AdminContract[K]['req'],
  opts?: CallOptions,
): Promise<AdminContract[K]['res']> {
  return xrpcAdminCall<AdminContract[K]['res']>(method, params as Record<string, unknown>, opts)
}
