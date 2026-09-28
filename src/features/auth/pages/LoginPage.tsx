import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../auth-context'
import {
  clearRememberedEmail,
  getRememberedEmail,
  setRememberedEmail,
} from '@/lib/auth/remember'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function LoginPage() {
  const { login, authed } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState(() => getRememberedEmail() ?? '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(() => !!getRememberedEmail())
  const [loading, setLoading] = useState(false)

  if (authed) {
    navigate('/users', { replace: true })
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
      if (remember) setRememberedEmail(email)
      else clearRememberedEmail()
      toast.success('登录成功')
      navigate('/users', { replace: true })
    } catch (err) {
      toast.error((err as Error).message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-xl">Starland 管理后台</CardTitle>
          <p className="text-center text-sm text-muted-foreground">请使用管理员账号登录</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="remember"
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="remember" className="cursor-pointer text-sm font-normal text-muted-foreground">
                记住账号
              </Label>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '登录中…' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
