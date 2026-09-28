import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useXrpcQuery } from '@/lib/xrpc/hooks'
import { formatTimestamp, formatBytes } from '@/lib/format'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminSubscription } from '@/lib/xrpc/admin-contract'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  )
}

function SubscriptionCard({ title, sub }: { title: string; sub: AdminSubscription | null | undefined }) {
  if (!sub) {
    return (
      <div className="rounded-xl border p-4">
        <h3 className="mb-2 text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">该用户当前未持有此类套餐</p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {sub.active ? <Badge variant="success">生效中</Badge> : <Badge variant="secondary">已失效</Badge>}
      </div>
      <Row label="套餐名称">{sub.plan_name || '-'}</Row>
      <Row label="套餐 ID">
        <span className="font-mono text-xs">{sub.plan_id || '-'}</span>
      </Row>
      <Row label="带宽限制">{sub.speed_limit_mbps ? `${sub.speed_limit_mbps} Mbps` : '不限速'}</Row>
      <Row label="最大设备数">{sub.max_devices ? `${sub.max_devices} 台` : '-'}</Row>
      {sub.plan_type === 'time' ? (
        <>
          <Row label="有效期(天)">{sub.duration_days || '-'}</Row>
          <Row label="剩余天数">{sub.remaining_days}</Row>
          <Row label="开始时间">{formatTimestamp(sub.starts_at)}</Row>
          <Row label="到期时间">{formatTimestamp(sub.expires_at)}</Row>
        </>
      ) : (
        <>
          <Row label="已用 / 总额">
            {formatBytes(sub.traffic_used_bytes)} / {formatBytes(sub.traffic_total_bytes)}
          </Row>
          <Row label="剩余流量">{formatBytes(sub.remaining_traffic_bytes)}</Row>
        </>
      )}
      <Row label="订阅状态">{sub.status}</Row>
    </div>
  )
}

export function UserSubscriptionsPage() {
  const { email } = useParams<{ email: string }>()
  const navigate = useNavigate()
  const decodedEmail = email ? decodeURIComponent(email) : ''

  const { data, loading, error, refetch } = useXrpcQuery(
    'GetUserSubscriptions',
    { email: decodedEmail },
    [decodedEmail],
  )

  const timeSub = data?.time_subscription
  const trafficSub = data?.traffic_subscription

  return (
    <div>
      <PageHeader
        title="用户套餐"
        description={`邮箱：${decodedEmail}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('/users')}>
            <ArrowLeft className="h-4 w-4" />
            返回用户
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <StateBlock title="加载失败" description={error.message} action={<Button onClick={() => refetch()}>重试</Button>} />
      ) : !timeSub && !trafficSub ? (
        <StateBlock title="该用户暂无生效的套餐订阅" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <SubscriptionCard title="时间套餐" sub={timeSub} />
          <SubscriptionCard title="流量套餐" sub={trafficSub} />
        </div>
      )}
    </div>
  )
}
