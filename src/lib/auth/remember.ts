// 「记住账号」：仅持久化邮箱（不存密码，避免明文凭据落盘）。
// 与会话令牌（session.ts）相互独立——即使登出，记住的邮箱仍保留，下次登录自动回填。

const KEY = 'starland.admin.remembered-email'

export function getRememberedEmail(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setRememberedEmail(email: string): void {
  try {
    if (email.trim()) localStorage.setItem(KEY, email.trim())
    else localStorage.removeItem(KEY)
  } catch {
    // localStorage 不可用时静默忽略（隐私模式等）
  }
}

export function clearRememberedEmail(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 同上
  }
}
