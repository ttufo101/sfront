import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useXrpcQuery, useXrpcMutation } from '@/lib/xrpc/hooks'
import { PlanInfo } from '@/lib/xrpc/admin-contract'
import { formatBytes, formatPrice, toNumberSafe } from '@/lib/format'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

interface FormState {
  plan_id: string
  name: string
  plan_type: string
  duration_days: string
  traffic_gb: string
  speed_limit_mbps: string
  max_devices: string
  price_yuan: string
  currency: string
  description: string
  recommended: boolean
  status: number
}

const emptyForm = (): FormState => ({
  plan_id: '',
  name: '',
  plan_type: 'time',
  duration_days: '30',
  traffic_gb: '0',
  speed_limit_mbps: '0',
  max_devices: '3',
  price_yuan: '0',
  currency: 'CNY',
  description: '',
  recommended: false,
  status: 1,
})

function planToForm(p: PlanInfo): FormState {
  return {
    plan_id: p.plan_id,
    name: p.name,
    plan_type: p.plan_type,
    duration_days: String(p.duration_days),
    traffic_gb: String(toNumberSafe(p.traffic_bytes) / 1e9),
    speed_limit_mbps: String(p.speed_limit_mbps),
    max_devices: String(p.max_devices),
    price_yuan: String(toNumberSafe(p.price_amount) / 100),
    currency: p.currency,
    description: p.description,
    recommended: p.recommended,
    status: p.status,
  }
}

export function PlansPage() {
  const { data, loading, error, refetch } = useXrpcQuery('ListPlans', {})
  const createMut = useXrpcMutation('CreatePlan')
  const updateMut = useXrpcMutation('UpdatePlan')

  const [editing, setEditing] = useState<PlanInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setOpen(true)
  }
  const openEdit = (p: PlanInfo) => {
    setEditing(p)
    setForm(planToForm(p))
    setOpen(true)
  }

  const submit = async () => {
    const payload = {
      plan_id: form.plan_id,
      name: form.name,
      plan_type: form.plan_type,
      duration_days: toNumberSafe(form.duration_days),
      traffic_bytes: String(Math.round(toNumberSafe(form.traffic_gb) * 1e9)),
      speed_limit_mbps: toNumberSafe(form.speed_limit_mbps),
      max_devices: toNumberSafe(form.max_devices),
      description: form.description,
      price_amount: String(Math.round(toNumberSafe(form.price_yuan) * 100)),
      currency: form.currency,
      recommended: form.recommended,
      ...(editing ? { status: form.status } : {}),
    }
    try {
      if (editing) {
        await updateMut.mutateAsync(payload as never)
        toast.success('套餐已更新')
      } else {
        await createMut.mutateAsync(payload as never)
        toast.success('套餐已创建')
      }
      setOpen(false)
      refetch()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const toggleStatus = async (p: PlanInfo) => {
    const next = p.status === 1 ? 2 : 1
    try {
      await updateMut.mutateAsync({
        plan_id: p.plan_id,
        name: p.name,
        plan_type: p.plan_type,
        duration_days: p.duration_days,
        traffic_bytes: p.traffic_bytes,
        speed_limit_mbps: p.speed_limit_mbps,
        max_devices: p.max_devices,
        description: p.description,
        price_amount: p.price_amount,
        currency: p.currency,
        recommended: p.recommended,
        status: next,
        sort: p.sort,
      })
      toast.success(next === 1 ? '已启用' : '已停用')
      refetch()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="套餐管理"
        description="管理 VPN 套餐（含已停用），支持新增、编辑与启用/停用"
        actions={<Button onClick={openCreate}>新增套餐</Button>}
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <StateBlock title="加载失败" description={error.message} action={<Button onClick={() => refetch()}>重试</Button>} />
      ) : !data || data.plans.length === 0 ? (
        <StateBlock title="暂无套餐" />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>时长/流量</TableHead>
                <TableHead>带宽</TableHead>
                <TableHead>设备数</TableHead>
                <TableHead>价格</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.plans.map((p) => (
                <TableRow key={p.plan_id}>
                  <TableCell className="font-medium">
                    {p.name}
                    {p.recommended && <Badge variant="default" className="ml-2">推荐</Badge>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{p.plan_type === 'time' ? '时长' : '流量'}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.plan_type === 'time' ? `${p.duration_days} 天` : formatBytes(p.traffic_bytes)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.speed_limit_mbps ? `${p.speed_limit_mbps} Mbps` : '不限'}</TableCell>
                  <TableCell>{p.max_devices}</TableCell>
                  <TableCell>{formatPrice(p.price_amount, p.currency)}</TableCell>
                  <TableCell>
                    {p.status === 1 ? <Badge variant="success">启用</Badge> : <Badge variant="warning">停用</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="link" size="sm" onClick={() => openEdit(p)}>
                      编辑
                    </Button>
                    <Button variant="link" size="sm" onClick={() => toggleStatus(p)}>
                      {p.status === 1 ? '停用' : '启用'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑套餐' : '新增套餐'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <Field label="套餐 ID">
                <Input value={form.plan_id} disabled={!!editing} onChange={(e) => setForm({ ...form, plan_id: e.target.value })} />
              </Field>
              <Field label="名称">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
            </div>
            <Field label="类型">
              <Select value={form.plan_type} onValueChange={(v) => setForm({ ...form, plan_type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="time">时长套餐</SelectItem>
                  <SelectItem value="traffic">流量套餐</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              {form.plan_type === 'time' ? (
                <Field label="有效天数">
                  <Input type="number" value={form.duration_days} onChange={(e) => setForm({ ...form, duration_days: e.target.value })} />
                </Field>
              ) : (
                <Field label="流量 (GB)">
                  <Input type="number" value={form.traffic_gb} onChange={(e) => setForm({ ...form, traffic_gb: e.target.value })} />
                </Field>
              )}
              <Field label="带宽 (Mbps, 0=不限)">
                <Input type="number" value={form.speed_limit_mbps} onChange={(e) => setForm({ ...form, speed_limit_mbps: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="最大设备数">
                <Input type="number" value={form.max_devices} onChange={(e) => setForm({ ...form, max_devices: e.target.value })} />
              </Field>
              <Field label="价格 (元)">
                <Input type="number" value={form.price_yuan} onChange={(e) => setForm({ ...form, price_yuan: e.target.value })} />
              </Field>
            </div>
            <Field label="描述">
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div className="flex items-center justify-between">
              <Label>设为推荐套餐</Label>
              <Switch checked={form.recommended} onCheckedChange={(v) => setForm({ ...form, recommended: v })} />
            </div>
            {editing && (
              <div className="flex items-center justify-between">
                <Label>启用</Label>
                <Switch checked={form.status === 1} onCheckedChange={(v) => setForm({ ...form, status: v ? 1 : 2 })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={submit} disabled={createMut.loading || updateMut.loading}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
