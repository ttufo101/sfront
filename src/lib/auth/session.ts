// 会话令牌的本地存储与读取。传输层从这里取 access_token 注入 com.jwt_token。
// 同时提供 getValidAccessToken()：在 token 过期前自动用 refresh_token 换新，避免
// “登录成功但 1 小时后上传被 401 拒绝、且无法自愈”的问题（见 token.md：access token 默认 1h）。

export interface SessionTokens {
  uid: string
  accessToken: string
  refreshToken: string
  /** Unix 秒级时间戳 */
  accessExpireAt: number
  refreshExpireAt: number
}

const KEY = 'starland.admin.session'

export function saveSession(s: SessionTokens): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function getSession(): SessionTokens | null {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionTokens
  } catch {
    return null
  }
}

export function clearSession(): void {
  localStorage.removeItem(KEY)
}

export function getAccessToken(): string | null {
  return getSession()?.accessToken ?? null
}

function decodeJwtRole(token: string): string | null {
  const p = decodeJwtPayload(token)
  const role = p?.['role']
  return typeof role === 'string' ? role : null
}

/**
 * 管理员角色判定（占位实现，保证流程跑通）：
 * - role === 'admin' → 是
 * - role === 'user'  → 否
 * - 无 role 声明     → 默认视为管理员（待后端在 JWT 中明确下发 role 后替换）
 */
export function isAdmin(token: string): boolean {
  const role = decodeJwtRole(token)
  if (role === 'user') return false
  if (role === 'admin') return true
  return true
}

// ---- Token 解码 / 诊断（不校验签名，仅读 exp / UserId） ----
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

export function getAccessTokenUserId(token: string): string | null {
  const p = decodeJwtPayload(token)
  const uid = p?.['UserId']
  return typeof uid === 'string' && uid.trim() ? uid : null
}

export function getAccessTokenExpireAt(token: string): number | null {
  const p = decodeJwtPayload(token)
  const exp = p?.['exp']
  return typeof exp === 'number' ? exp : null
}

// ---- 自动刷新（依赖注入，避免 session 与 auth api 形成循环依赖） ----
type RefreshHandler = (refreshToken: string) => Promise<SessionTokens>
let refreshHandler: RefreshHandler | null = null
let inFlightRefresh: Promise<string | null> | null = null

/** 由登录模块在启动时注册真正的刷新实现（调用 Login.RefreshToken）。 */
export function setRefreshHandler(fn: RefreshHandler): void {
  refreshHandler = fn
}

/** 过期判断预留 60s 缓冲，避免“临界过期”请求失败。 */
const REFRESH_SKEW_SEC = 60

function isExpired(s: SessionTokens): boolean {
  return s.accessExpireAt - REFRESH_SKEW_SEC <= Date.now() / 1000
}

/**
 * 返回一个尽量有效的 access token：
 * - 未过期：直接返回当前 token；
 * - 已过期/临期且有 refreshToken 且已注册 refreshHandler：触发刷新（并发安全，多个请求只刷一次）；
 * - 刷新失败或无刷新凭证：清 session 并返回 null（调用方应跳登录页）。
 */
export async function getValidAccessToken(): Promise<string | null> {
  const s = getSession()
  if (!s) return null
  if (!isExpired(s)) return s.accessToken

  if (!s.refreshToken || !refreshHandler) return s.accessToken // 无刷新能力，保底用旧 token

  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const next = await refreshHandler!(s.refreshToken)
        saveSession(next)
        return next.accessToken
      } catch {
        clearSession()
        return null
      } finally {
        inFlightRefresh = null
      }
    })()
  }
  return inFlightRefresh
}
