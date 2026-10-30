import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useXrpcQuery, useXrpcMutation } from '@/lib/xrpc/hooks'
import { formatTimestamp, formatBytes, toNumberSafe } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import type { UserInfo } from '@/lib/xrpc/admin-contract'
import { UserRelayAssignmentPanel } from '@/features/data-plane-nodes/pages/UserRelayAssignmentPage'

const PAGE_SIZE = 20

export function UsersPage() {
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')
  // 选中的目标用户：左侧列表点击即选中，右侧展示其详情与权益操作（主从结构）。
  const [selected, setSelected] = useState<UserInfo | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword.trim()), 300)
    return () => clearTimeout(t)
  }, [keyword])

  const usersQ = useXrpcQuery('ListUsers', { page, page_size: PAGE_SIZE, keyword: debounced }, [page, debounced])

  const total = usersQ.data ? toNumberSafe(usersQ.data.total) : 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <PageHeader
        title="用户管理"
        description="查询注册用户；选中用户后可查看其权益快照、设备与中转节点，并直接发放 / 修改 / 撤销权益"
      />

      <div className="grid gap-6 md:grid-cols-[340px_1fr]">
        {/* 左侧：用户列表（同时承担“选人”职责，避免与用户权益页重复搜索） */}
        <div className="space-y-3">
          <Input
            placeholder="搜索邮箱或 UID"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
              setPage(1)
            }}
          />
          <div className="max-h-[72vh] overflow-auto rounded-xl border divide-y">
            {usersQ.loading ? (
              Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
            ) : usersQ.error ? (
              <div className="p-4 text-sm text-destructive">加载失败：{usersQ.error.message}</div>
            ) : !usersQ.data || usersQ.data.users.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                {debounced ? `未找到与“${debounced}”相关的用户` : '当前还没有注册用户'}
              </div>
            ) : (
              usersQ.data.users.map((u) => (
                <button
                  key={u.uid}
                  type="button"
                  onClick={() => setSelected(u)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-accent',
                    selected?.uid === u.uid && 'bg-primary/10',
                  )}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-medium">{u.email}</span>
                    {u.status === 1 ? (
                      <Badge variant="success" className="shrink-0">正常</Badge>
                    ) : (
                      <Badge variant="destructive" className="shrink-0">禁用</Badge>
                    )}
                  </span>
                  <span className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate font-mono">{u.uid}</span>
                    <Badge variant="secondary">{u.role}</Badge>
                  </span>
                </button>
              ))
            )}
          </div>

          {!usersQ.loading && usersQ.data && usersQ.data.users.length > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>共 {total} 条 · 第 {page}/{totalPages} 页</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  上一页
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  下一页
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 右侧：选中用户的详情（按 uid 作 key，切换用户时重置内部状态） */}
        <div>
          {selected ? (
            <UserDetail key={selected.uid} user={selected} />
          ) : (
            <div className="flex h-full min-h-[60vh] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              从左侧选择一位用户，查看其权益、设备与中转节点，并直接进行权益操作
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// 用户详情：资料头 + Tab（权益 / 设备 / 中转节点）。
function UserDetail({ user }: { user: UserInfo }) {
  const [tab, setTab] = useState<'entitlement' | 'devices' | 'relay'>('entitlement')

  return (
    <div className="space-y-4">
      {/* 资料头：一眼看清用户身份与基础状态 */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 py-4 text-sm sm:grid-cols-3">
          <Field label="邮箱" value={user.email} />
          <Field label="UID" value={user.uid} mono />
          <Field label="角色" value={user.role} />
          <Field
            label="状态"
            value={user.status === 1 ? '正常' : '禁用'}
            badge={user.status === 1 ? <Badge variant="success">正常</Badge> : <Badge variant="destructive">禁用</Badge>}
          />
          <Field label="绑定设备数" value={String(user.bound_device_count)} />
          <Field label="注册时间" value={formatTimestamp(user.created_at)} />
        </CardContent>
      </Card>

      {/* Tab 切换（无 shadcn Tabs 组件，用按钮分段控件实现） */}
      <div className="flex gap-1 border-b">
        <TabButton active={tab === 'entitlement'} onClick={() => setTab('entitlement')}>权益</TabButton>
        <TabButton active={tab === 'devices'} onClick={() => setTab('devices')}>设备</TabButton>
        <TabButton active={tab === 'relay'} onClick={() => setTab('relay')}>中转节点</TabButton>
      </div>

      {tab === 'entitlement' && <EntitlementPanel user={user} />}
      {tab === 'devices' && <DevicesTable email={user.email} />}
      {tab === 'relay' && <UserRelayAssignmentPanel uid={user.uid} />}
    </div>
  )
}

// 权益 Tab：当前权益快照 + 发放/修改/撤销 三张操作卡 + 该用户人工订单。
// 复用既有契约（GetUserSubscriptions / GrantUserPlan / UpdateUserSubscription / RevokeUserPlan / ListOrders）。
function EntitlementPanel({ user }: { user: UserInfo }) {
  const plansQ = useXrpcQuery('ListPlans', {})
  const grantMut = useXrpcMutation('GrantUserPlan')
  const updateMut = useXrpcMutation('UpdateUserSubscription')
  const revokeMut = useXrpcMutation('RevokeUserPlan')

  // 操作默认作用于当前选中用户（邮箱由详情带入），管理员仍可手动修改。
  const [grantEmail, setGrantEmail] = useState(user.email)
  const [grantPlan, setGrantPlan] = useState('')
  const [updEmail, setUpdEmail] = useState(user.email)
  const [updType, setUpdType] = useState('time')
  const [updExpires, setUpdExpires] = useState('')
  const [updTrafficGb, setUpdTrafficGb] = useState('')
  const [revokeNo, setRevokeNo] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [updReason, setUpdReason] = useState('')
  const [revokeReason, setRevokeReason] = useState('')

  // 当前权益快照
  const subsQ = useXrpcQuery('GetUserSubscriptions', { email: user.email }, [user.email])
  // 该用户的人工订单（order_source=manual）：用于撤销时一键填入订单号。
  const ordersQ = useXrpcQuery(
    'ListOrders',
    { email: user.email, order_source: 'manual', page: 1, page_size: 20 },
    [user.email],
  )

  // 生成稳定幂等键：优先用原生 crypto.randomUUID，降级用随机串
  const genId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)

  const planOptions = plansQ.data?.plans ?? []

  const doGrant = async () => {
    if (!grantEmail || !grantPlan) return toast.error('请填写邮箱并选择套餐')
    if (!grantReason) return toast.error('请填写发放原因')
    try {
      const r = await grantMut.mutateAsync({
        email: grantEmail,
        plan_id: grantPlan,
        client_request_id: genId(),
        operation_reason: grantReason,
      })
      toast.success(`已发放，订单号 ${r.order_no}`)
      setGrantEmail('')
      setGrantPlan('')
      setGrantReason('')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const doUpdate = async () => {
    if (!updEmail) return toast.error('请填写邮箱')
    if (!updReason) return toast.error('请填写调整原因')
    const payload: { email: string; plan_type: string; expires_at?: string; traffic_total_bytes?: string } = {
      email: updEmail,
      plan_type: updType,
    }
    if (updType === 'time') {
      if (!updExpires) return toast.error('请选择新的到期时间')
      payload.expires_at = String(Math.floor(new Date(updExpires).getTime() / 1000))
    } else {
      if (!updTrafficGb) return toast.error('请填写新的流量额度')
      payload.traffic_total_bytes = String(Math.round(Number(updTrafficGb) * 1e9))
    }
    try {
      await updateMut.mutateAsync({
        ...payload,
        client_request_id: genId(),
        operation_reason: updReason,
      })
      toast.success('订阅已更新')
      setUpdReason('')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const doRevoke = async () => {
    if (!revokeNo) return toast.error('请填写订单号')
    if (!revokeReason) return toast.error('请填写撤销原因')
    try {
      const r = await revokeMut.mutateAsync({
        order_no: revokeNo,
        client_request_id: genId(),
        operation_reason: revokeReason,
      })
      toast.success(r.already_revoked ? '该权益此前已撤销' : '已撤销权益')
      setRevokeNo('')
      setRevokeReason('')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const s = subsQ.data

  return (
    <div className="space-y-6">
      {/* 当前权益快照 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">当前权益快照</CardTitle>
          <p className="text-sm text-muted-foreground">{user.email} 的时间与流量订阅现状</p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {subsQ.loading ? (
            <p className="text-muted-foreground">加载中…</p>
          ) : subsQ.error ? (
            <p className="text-destructive">加载失败：{subsQ.error.message}</p>
          ) : (
            <>
              <SubRow label="时间订阅">
                {s?.time_subscription ? (
                  <span>
                    {s.time_subscription.plan_name}
                    {s.time_subscription.active ? (
                      <Badge variant="success" className="ml-2">有效</Badge>
                    ) : (
                      <Badge variant="secondary" className="ml-2">已过期</Badge>
                    )}
                    <span className="ml-2 text-muted-foreground">
                      到期 {formatTimestamp(s.time_subscription.expires_at)} · 剩 {s.time_subscription.remaining_days} 天
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">无</span>
                )}
              </SubRow>
              <SubRow label="流量订阅">
                {s?.traffic_subscription ? (
                  <span>
                    {s.traffic_subscription.plan_name}
                    {s.traffic_subscription.active ? (
                      <Badge variant="success" className="ml-2">有效</Badge>
                    ) : (
                      <Badge variant="secondary" className="ml-2">已失效</Badge>
                    )}
                    <span className="ml-2 text-muted-foreground">
                      剩 {formatBytes(s.traffic_subscription.remaining_traffic_bytes)}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">无</span>
                )}
              </SubRow>
            </>
          )}
        </CardContent>
      </Card>

      {/* 三张操作卡 */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>发放套餐</CardTitle>
            <p className="text-sm text-muted-foreground">按邮箱给用户发放套餐权益（生成人工订单）</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>用户邮箱</Label>
              <Input placeholder="user@example.com" value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>套餐</Label>
              <Select value={grantPlan} onValueChange={setGrantPlan} disabled={!plansQ.data}>
                <SelectTrigger>
                  <SelectValue placeholder={plansQ.loading ? '加载中…' : '选择套餐'} />
                </SelectTrigger>
                <SelectContent>
                  {planOptions.map((p) => (
                    <SelectItem key={p.plan_id} value={p.plan_id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>发放原因 <span className="text-destructive">*</span></Label>
              <Input placeholder="如：客服补偿" value={grantReason} onChange={(e) => setGrantReason(e.target.value)} />
            </div>
            <Button className="w-full" onClick={doGrant} disabled={grantMut.loading}>
              发放
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>修改订阅</CardTitle>
            <p className="text-sm text-muted-foreground">直接修改用户现有订阅的到期时间或流量额度</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>用户邮箱</Label>
              <Input placeholder="user@example.com" value={updEmail} onChange={(e) => setUpdEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>权益类型</Label>
              <Select value={updType} onValueChange={setUpdType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="time">时长（修改到期时间）</SelectItem>
                  <SelectItem value="traffic">流量（修改流量额度）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {updType === 'time' ? (
              <div className="space-y-2">
                <Label>新到期时间</Label>
                <Input type="datetime-local" value={updExpires} onChange={(e) => setUpdExpires(e.target.value)} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>新流量额度 (GB)</Label>
                <Input type="number" value={updTrafficGb} onChange={(e) => setUpdTrafficGb(e.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label>调整原因 <span className="text-destructive">*</span></Label>
              <Input placeholder="如：延长有效期" value={updReason} onChange={(e) => setUpdReason(e.target.value)} />
            </div>
            <Button className="w-full" onClick={doUpdate} disabled={updateMut.loading}>
              保存修改
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>撤销权益</CardTitle>
            <p className="text-sm text-muted-foreground">按发放时生成的人工订单号撤销权益（幂等）</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>订单号</Label>
              <Input placeholder="MANUAL-XXXX" value={revokeNo} onChange={(e) => setRevokeNo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>撤销原因 <span className="text-destructive">*</span></Label>
              <Input placeholder="如：误发放" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
            </div>
            <Button className="w-full" variant="destructive" onClick={doRevoke} disabled={revokeMut.loading}>
              撤销
            </Button>
            <p className="text-xs text-muted-foreground">
              <Badge variant="warning">危险操作</Badge> 撤销后用户将失去对应权益，操作不可恢复。
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 该用户的人工订单：点击“填入撤销”将订单号回填到上面的撤销表单 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">该用户的人工订单</CardTitle>
          <p className="text-sm text-muted-foreground">点击“填入撤销”可将订单号带入上方撤销表单</p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {ordersQ.loading ? (
            <p className="text-muted-foreground">加载中…</p>
          ) : ordersQ.error ? (
            <p className="text-destructive">加载失败：{ordersQ.error.message}</p>
          ) : ordersQ.data && ordersQ.data.orders.length > 0 ? (
            <div className="rounded-lg border divide-y">
              {ordersQ.data.orders.map((o) => (
                <div key={o.order.order_no} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex flex-col">
                    <span className="font-mono text-xs">{o.order.order_no}</span>
                    <span className="text-xs text-muted-foreground">
                      业务 {o.order.status} · 支付 {o.payment_status} · 更新 {formatTimestamp(o.updated_at)}
                    </span>
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setRevokeNo(o.order.order_no)}>
                    填入撤销
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">该用户暂无人工订单</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// 设备 Tab：该用户绑定设备列表。
function DevicesTable({ email }: { email: string }) {
  const { data, loading, error, refetch } = useXrpcQuery('ListUserDevices', { email }, [email])

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }
  if (error) {
    return <StateBlock title="加载失败" description={error.message} action={<Button onClick={refetch}>重试</Button>} />
  }
  if (!data || data.devices.length === 0) {
    return <StateBlock title="该用户暂无绑定设备" />
  }
  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>设备 ID</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>绑定时间</TableHead>
            <TableHead>最近登录</TableHead>
            <TableHead>状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.devices.map((d) => (
            <TableRow key={d.device_id}>
              <TableCell className="font-mono text-xs">{d.device_id}</TableCell>
              <TableCell>
                <Badge variant="secondary">{d.device_type}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{formatTimestamp(d.bound_at)}</TableCell>
              <TableCell className="text-muted-foreground">{formatTimestamp(d.last_login_at)}</TableCell>
              <TableCell>
                {d.status === 1 ? <Badge variant="success">已绑定</Badge> : <Badge variant="warning">已剔除</Badge>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ===== 小组件 =====

function Field({ label, value, mono, badge }: { label: string; value?: string; mono?: boolean; badge?: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('font-medium', mono && 'font-mono text-xs')}>{badge ?? value ?? '-'}</div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
        active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function SubRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-2 last:border-0 last:pb-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}
