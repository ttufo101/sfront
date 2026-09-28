import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useXrpcQuery } from '@/lib/xrpc/hooks'
import { formatTimestamp } from '@/lib/format'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

export function DevicesPage() {
  const { email } = useParams<{ email: string }>()
  const navigate = useNavigate()
  const decodedEmail = email ? decodeURIComponent(email) : ''

  const { data, loading, error, refetch } = useXrpcQuery('ListUserDevices', { email: decodedEmail }, [decodedEmail])

  return (
    <div>
      <PageHeader
        title="用户设备"
        description={`邮箱：${decodedEmail}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('/users')}>
            <ArrowLeft className="h-4 w-4" />
            返回用户
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <StateBlock title="加载失败" description={error.message} action={<Button onClick={() => refetch()}>重试</Button>} />
      ) : !data || data.devices.length === 0 ? (
        <StateBlock title="该用户暂无绑定设备" />
      ) : (
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
      )}
    </div>
  )
}
