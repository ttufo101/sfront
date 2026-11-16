// 历史服务器 tab（/nodes?tab=history）：只列出台账里已软删除的服务器，只读、不可恢复。
// 删除是「下架」之后的第二步：台账保留 deleted_at 供追溯，中转节点 / 落地出口行已被硬删，
// 因此这些机器不会再出现在中转接入、落地出口或服务器台账 tab 中。

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { XrpcError } from '@/lib/xrpc/types'
import type { NodeAsset } from '@/lib/xrpc/deployer-contract'
import { listNodeAssets } from '@/features/node-assets/api/assets'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function HistoryServersPage() {
  const [rows, setRows] = useState<NodeAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState<string | null>(null)

  // include_deleted=true 会返回在用 + 已删，历史页只保留 deleted_at 非空的记录。
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listNodeAssets({ include_deleted: true })
      setRows((res.nodes ?? []).filter((n) => !!n.deleted_at))
      setBanner(null)
    } catch (e) {
      setBanner((e as XrpcError).message || '加载历史服务器失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <PageHeader
        title="历史服务器"
        description="已删除的服务器主数据留档，只读且不可恢复；其出口与接入记录已一并移除。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        }
      />

      {banner && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {banner}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <StateBlock title="正在加载历史服务器" />
          ) : rows.length === 0 ? (
            <StateBlock title="暂无已删除服务器" description="在「服务器台账」中先下架再删除的机器会出现在这里。" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>节点 ID</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>公网 IP</TableHead>
                    <TableHead>删除时状态</TableHead>
                    <TableHead>删除时间</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((n) => (
                    <TableRow key={n.node_id}>
                      <TableCell className="font-mono text-xs font-medium">{n.node_id}</TableCell>
                      <TableCell className="text-xs">{n.display_name || '-'}</TableCell>
                      <TableCell className="text-xs">
                        {n.node_type === 'relay' ? '中转' : n.node_type === 'landing' ? '落地' : n.node_type}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {n.public_ip || n.private_ip || '-'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {n.node_type === 'relay' ? '已下架接入' : n.listing_status === 'listed' ? '已上架' : '已下架'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{n.deleted_at}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">已删除</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
