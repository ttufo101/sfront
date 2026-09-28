import { createContext, useContext, useState, type ReactNode } from 'react'
import { login as loginApi, refreshTokenApi, toSession } from './api/login'
import {
  clearSession,
  getSession,
  isAdmin as sessionIsAdmin,
  saveSession,
  setRefreshHandler,
  type SessionTokens,
} from '@/lib/auth/session'

// 注册 token 刷新实现：后续 getValidAccessToken() 在过期时自动调 Login.RefreshToken 换新。
setRefreshHandler(async (refreshToken: string) => {
  const res = await refreshTokenApi(refreshToken)
  return toSession(res)
})

interface AuthContextValue {
  authed: boolean
  admin: boolean
  uid: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionTokens | null>(() => getSession())

  const login = async (email: string, password: string) => {
    const res = await loginApi(email, password)
    const s: SessionTokens = {
      uid: res.uid,
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      accessExpireAt: Number(res.access_expire_at),
      refreshExpireAt: Number(res.refresh_expire_at),
    }
    saveSession(s)
    setSession(s)
  }

  const logout = () => {
    clearSession()
    setSession(null)
  }

  const value: AuthContextValue = {
    authed: !!session,
    admin: session ? sessionIsAdmin(session.accessToken) : false,
    uid: session?.uid ?? null,
    login,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
