// 落地出口 tab：按机器粒度上架/下架，并把 YAML 出口绑定到真实落地机。
// 规则：故障节点仍展示；只有人工下架才会从 GetLinks 下发的 YAML 里移除该机器的全部出口。
// GetLinks 按 t_proxy_outlet 的上架白名单裁剪：已下架、随服务器删除被硬删、或从未登记归属的出口都不下发。
// 未绑定归属但状态为 listed 的出口仍会下发，只是不会被任何机器级联下架；绑定是下架生效的前提。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw } from 'lucide-react'
import { XrpcError } from '@/lib/xrpc/types'
import type { ProxyOutlet } from '@/lib/xrpc/admin-contract'
import type { NodeAsset } from '@/lib/xrpc/deployer-contract'
import { listNodeAssets } from '@/features/node-assets/api/assets'
import { listProxyOutlets, setNodeListing } from '../api/outlets'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Pending {
  node_id: string
  status: 'listed' | 'delisted'
  proxy_names?: string[]
  title: string
  description: string
}

export function ProxyOutletsPage() {
  const [outlets, setOutlets] = useState<ProxyOutlet[]>([])
  const [landings, setLandings] = useState<NodeAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState<string | null>(null)
  const [unmapped, setUnmapped] = useState<string[]>([])
  const [stale, setStale] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [bindTarget, setBindTarget] = useState('')
  const [machineTarget, setMachineTarget] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [outletRes, nodeRes] = await Promise.all([
        listProxyOutlets(),
        listNodeAssets({ node_type: 'landing' }),
      ])
      setOutlets(outletRes.outlets ?? [])
      setUnmapped(outletRes.unmapped_proxy_names ?? [])
      setStale(outletRes.stale_proxy_names ?? [])
      setLandings(nodeRes.nodes ?? [])
      setBanner(null)
    } catch (e) {
      setBanner((e as XrpcError).message || '加载出口清单失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const unbound = useMemo(() => outlets.filter((o) => !o.node_id), [outlets])
  const targetOutlets = useMemo(
    () => outlets.filter((o) => o.node_id === machineTarget).length,
    [outlets, machineTarget],
  )
  const nodeLabel = (id: string) => {
    const n = landings.find((x) => x.node_id === id)
    return n ? `${n.node_id}（${n.public_ip || '无公网 IP'}）` : id
  }

  const openMachineListing = (status: 'listed' | 'delisted') => {
    if (!machineTarget) {
      toast.error('请先选择一台落地机')
      return
    }
    const delist = status === 'delisted'
    setPending({
      node_id: machineTarget,
      status,
      title: delist ? '下架该落地机？' : '上架该落地机？',
      description: delist
        ? `将按机器下架 ${nodeLabel(machineTarget)}，其名下 ${targetOutlets} 个出口会从客户端下发的配置中移除（同时清理策略组引用）。${targetOutlets === 0 ? '注意：该机器当前没有绑定任何出口，本次下架不会移除任何客户端节点。' : ''}若所有落地出口都被下架，GetLinks 将返回「暂无可用出口」。下架后营销页展示的数字与地区由人工维护，系统不会自动同步。`
        : `将重新上架 ${nodeLabel(machineTarget)} 及其名下 ${targetOutlets} 个出口，客户端下一次 GetLinks 即可看到。`,
    })
  }

  const openBind = () => {
    if (!bindTarget) {
      toast.error('请选择要绑定到的落地机')
      return
    }
    if (selected.length === 0) {
      toast.error('请先勾选要绑定的出口')
      return
    }
    setPending({
      node_id: bindTarget,
      status: 'listed',
      proxy_names: selected,
      title: '绑定出口并上架？',
      description: `把 ${selected.length} 个出口绑定到 ${nodeLabel(bindTarget)}，并统一置为已上架。之后按机器下架即可一次性移除这些出口。`,
    })
  }

  const confirm = async () => {
    if (!pending) return
    setSubmitting(true)
    try {
      const res = await setNodeListing({
        node_id: pending.node_id,
        listing_status: pending.status,
        ...(pending.proxy_names ? { proxy_names: pending.proxy_names } : {}),
      })
      toast.success(`操作成功，该机器当前关联 ${res.affected_outlets} 个出口`)
      setPending(null)
      setSelected([])
      await load()
    } catch (e) {
      toast.error((e as XrpcError).message || '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="落地出口"
        description="按机器下架会移除该机全部出口；绑定归属后下架才生效。故障节点仍展示，只有人工下架才让客户端列表不再出现。"
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
      {unbound.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
          有 {unbound.length} 个出口尚未绑定落地机：{unbound.map((o) => o.proxy_name).join('、')}。
          未绑定的出口不会被任何机器级联下架，请先在下方绑定。
        </div>
      )}
      {unmapped.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          代理 YAML 中存在但未登记到出口表的出口：{unmapped.join('、')}。白名单裁剪下它们当前不会下发给客户端，请更新代理配置或补录出口表。
        </div>
      )}
      {stale.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          表里登记但当前 YAML 已不存在的出口：{stale.join('、')}。代理配置可能改过出口名，请核对。
        </div>
      )}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[260px] space-y-1.5">
              <Label>绑定到的落地机</Label>
              <Select value={bindTarget} onValueChange={setBindTarget}>
                <SelectTrigger><SelectValue placeholder="选择落地机" /></SelectTrigger>
                <SelectContent>
                  {landings.map((n) => (
                    <SelectItem key={n.node_id} value={n.node_id}>
                      {n.node_id} · {n.public_ip || '无公网 IP'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={openBind} disabled={loading}>
              绑定并上架选中出口（{selected.length}）
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            <div className="w-[260px] space-y-1.5">
              <Label>按机器上下架</Label>
              <Select value={machineTarget} onValueChange={setMachineTarget}>
                <SelectTrigger><SelectValue placeholder="选择落地机" /></SelectTrigger>
                <SelectContent>
                  {landings.map((n) => (
                    <SelectItem key={n.node_id} value={n.node_id}>
                      {n.node_id} · {n.public_ip || '无公网 IP'} · {n.listing_status === 'listed' ? '已上架' : '已下架'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => openMachineListing('listed')} disabled={loading}>
              上架该机器
            </Button>
            <Button variant="destructive" onClick={() => openMachineListing('delisted')} disabled={loading}>
              下架该机器
            </Button>
            <span className="text-xs text-muted-foreground">当前选中机器名下 {targetOutlets} 个出口</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <StateBlock title="正在加载出口清单" />
          ) : outlets.length === 0 ? (
            <StateBlock title="暂无出口" description="代理配置中的 proxies 尚未登记到出口表。" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>出口名（YAML proxies[].name）</TableHead>
                    <TableHead>端口</TableHead>
                    <TableHead>归属落地机</TableHead>
                    <TableHead>公网 IP</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outlets.map((o) => (
                    <TableRow key={o.proxy_name}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={selected.includes(o.proxy_name)}
                          onChange={() =>
                            setSelected((ids) =>
                              ids.includes(o.proxy_name)
                                ? ids.filter((x) => x !== o.proxy_name)
                                : [...ids, o.proxy_name],
                            )
                          }
                          aria-label={`选择 ${o.proxy_name}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">{o.proxy_name}</TableCell>
                      <TableCell className="font-mono text-xs">{o.port || '-'}</TableCell>
                      <TableCell className="font-mono text-xs">{o.node_id || '未绑定'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{o.public_ip || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={o.listing_status === 'listed' ? 'success' : 'secondary'}>
                          {o.listing_status === 'listed' ? '已上架' : '已下架'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            <DialogDescription>{pending?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>取消</Button>
            <Button
              variant={pending?.status === 'delisted' ? 'destructive' : 'default'}
              onClick={() => void confirm()}
              disabled={submitting}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
