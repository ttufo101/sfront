import { xrpcLoginCall } from '@/lib/xrpc/transport'
import { LoginResponse } from '@/lib/xrpc/admin-contract'
import type { SessionTokens } from '@/lib/auth/session'

export function login(email: string, password: string): Promise<LoginResponse> {
  return xrpcLoginCall<LoginResponse>('Login', { email, password })
}

/** 长 token 换长短 token（starland.login.com / RefreshToken）。 */
export function refreshTokenApi(refreshToken: string): Promise<LoginResponse> {
  return xrpcLoginCall<LoginResponse>('RefreshToken', { refresh_token: refreshToken })
}

/** LoginResponse → 本地会话令牌。 */
export function toSession(res: LoginResponse): SessionTokens {
  return {
    uid: res.uid,
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    accessExpireAt: Number(res.access_expire_at),
    refreshExpireAt: Number(res.refresh_expire_at),
  }
}
