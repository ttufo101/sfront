import { useState } from 'react'
import { toast } from 'sonner'
import { useXrpcQuery, useXrpcMutation } from '@/lib/xrpc/hooks'
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

export function SubscriptionsPage() {
  const plansQ = useXrpcQuery('ListPlans', {})
  const grantMut = useXrpcMutation('GrantUserPlan')
  const updateMut = useXrpcMutation('UpdateUserSubscription')
  const revokeMut = useXrpcMutation('RevokeUserPlan')

  const [grantEmail, setGrantEmail] = useState('')
  const [grantPlan, setGrantPlan] = useState('')
  const [updEmail, setUpdEmail] = useState('')
  const [updType, setUpdType] = useState('time')
  const [updExpires, setUpdExpires] = useState('')
  const [updTrafficGb, setUpdTrafficGb] = useState('')
  const [revokeNo, setRevokeNo] = useState('')

  const planOptions = plansQ.data?.plans ?? []

  const doGrant = async () => {
    if (!grantEmail || !grantPlan) return toast.error('请填写邮箱并选择套餐')
    try {
      const r = await grantMut.mutateAsync({ email: grantEmail, plan_id: grantPlan })
      toast.success(`已发放，订单号 ${r.order_no}`)
      setGrantEmail('')
      setGrantPlan('')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const doUpdate = async () => {
    if (!updEmail) return toast.error('请填写邮箱')
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
      await updateMut.mutateAsync(payload)
      toast.success('订阅已更新')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const doRevoke = async () => {
    if (!revokeNo) return toast.error('请填写订单号')
    try {
      const r = await revokeMut.mutateAsync({ order_no: revokeNo })
      toast.success(r.already_revoked ? '该权益此前已撤销' : '已撤销权益')
      setRevokeNo('')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div>
      <PageHeader title="用户权益" description="向用户发放套餐、修改现有订阅、按订单号撤销权益" />

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
            <Button className="w-full" variant="destructive" onClick={doRevoke} disabled={revokeMut.loading}>
              撤销
            </Button>
            <p className="text-xs text-muted-foreground">
              <Badge variant="warning">危险操作</Badge> 撤销后用户将失去对应权益，操作不可恢复。
            </p>
          </CardContent>
        </Card>
      </div>

      {plansQ.error && <StateBlock title="套餐列表加载失败" description={plansQ.error.message} />}
    </div>
  )
}
