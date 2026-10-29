import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { LogOut, Users, Package, Gift, Network, Megaphone, Server, UploadCloud, MessageSquare, Globe, ServerCog, SlidersHorizontal, Receipt, UserCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/auth-context'
import { Button } from '@/components/ui/button'

const NAV = [
  { to: '/users', label: '用户管理', icon: Users },
  { to: '/plans', label: '套餐管理', icon: Package },
  { to: '/subscriptions', label: '用户权益', icon: Gift },
  { to: '/orders', label: '订单管理', icon: Receipt },
  { to: '/orders?payment_status=manual_review', label: '人工审核', icon: UserCheck },
  { to: '/proxy', label: '代理配置', icon: Server },
  { to: '/data-plane-nodes', label: '节点管理', icon: ServerCog },
  { to: '/shared-benefits', label: '共享权益', icon: SlidersHorizontal },
  { to: '/releases', label: '版本发布', icon: UploadCloud },
  { to: '/feedback', label: '用户反馈', icon: MessageSquare },
  { to: '/announcements', label: '公告管理', icon: Megaphone },
  { to: '/network-coverage', label: '网络覆盖', icon: Globe },
]

export function AdminLayout() {
  const { logout, uid } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const onLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-muted/20">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-background">
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <Network className="h-5 w-5 text-primary" />
          <span className="text-base font-semibold">Starland 后台</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const [path, search] = item.to.split('?')
            const active =
              path === location.pathname &&
              (!search ? location.search === '' || location.search === '?' : location.search.includes(search))
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            )
          })}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 truncate px-2 text-xs text-muted-foreground">账号：{uid}</div>
          <Button variant="outline" className="w-full" size="sm" onClick={onLogout}>
            <LogOut className="h-4 w-4" />
            退出登录
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-8 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
