// 服务器台账 tab（统一「节点管理」/nodes?tab=assets 下）：中转/落地机器主数据 + 带外公钥纳管 + 白名单批量 SSH 操作。
// 上下架由「中转接入」与「落地出口」tab 负责，这里只展示 listing_status；台账零凭据：不录入密码、不上传私钥。
// deployer 用带外预置的公钥连接，主机指纹人工确认后固定；下架机器不再作为批量操作目标。
// 删除是下架之后的第二步：仅落地 listing_status=delisted / 中转 scheduling_status=isolated 可删，
// 由 admin.DeleteNodeAsset 单事务软删台账 + 硬删出口/接入/固定分配，弹窗二次确认且不可恢复。
// 本期不采集资源指标，CPU/内存等监控数据后续从外部系统读取。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Copy, KeyRound, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Wifi } from 'lucide-react'
import { Link } from 'react-router-dom'
import { XrpcError } from '@/lib/xrpc/types'
import type { GetPublicKeyResponse, NodeAsset } from '@/lib/xrpc/deployer-contract'
import {
  getPublicKey,
  listNodeAssets,
  testConnection,
} from '../api/assets'
import { copyText } from '../lib/clipboard'
import { listDataPlaneNodes } from '@/features/data-plane-nodes/api/nodes'
import { deleteNodeAsset } from '@/features/nodes/api/servers'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { NodeFormDialog } from '../components/NodeFormDialog'
import { BootstrapDialog } from '../components/BootstrapDialog'
import { OperationPanel } from '../components/OperationPanel'

interface AppliedFilter {
  node_type: string
  keyword: string
  listing_status: string
}

const EMPTY_FILTER: AppliedFilter = { node_type: '', keyword: '', listing_status: '' }
const REFRESH_INTERVAL_MS = 30_000

function authVariant(status: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (status) {
    case 'ready':
      return 'success'
    case 'failed':
      return 'destructive'
    case 'pending':
      return 'warning'
    default:
      return 'secondary'
  }
}

const AUTH_LABEL: Record<string, string> = {
  ready: '已纳管',
  pending: '待纳管',
  failed: '验证失败',
}

export function NodeAssetsPage() {
  const [nodes, setNodes] = useState<NodeAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState<string | null>(null)

  const [publicKey, setPublicKey] = useState<GetPublicKeyResponse | null>(null)
  const [pkError, setPkError] = useState<string | null>(null)

  const [typeDraft, setTypeDraft] = useState('all')
  const [keywordDraft, setKeywordDraft] = useState('')
  const [listingDraft, setListingDraft] = useState('all')
  const [applied, setApplied] = useState<AppliedFilter>(EMPTY_FILTER)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [formNode, setFormNode] = useState<NodeAsset | null>(null)
  const [bootstrapNode, setBootstrapNode] = useState<NodeAsset | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  // 中转「下架接入」写在 t_dataplane_node.scheduling_status（台账 relay 永远 listed），单独拉取用于删除闸门。
  const [relayScheduling, setRelayScheduling] = useState<Record<string, string>>({})
  const [deleteTarget, setDeleteTarget] = useState<NodeAsset | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [blockedUids, setBlockedUids] = useState<string[] | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const [res, relayRes] = await Promise.all([
          listNodeAssets(applied),
          listDataPlaneNodes().catch(() => null),
        ])
        setNodes(res.nodes ?? [])
        if (relayRes) {
          const map: Record<string, string> = {}
          for (const n of relayRes.nodes ?? []) map[n.node_id] = n.scheduling_status
          setRelayScheduling(map)
        }
        setBanner(null)
      } catch (e) {
        // 静默刷新失败保留最后一次成功数据，只做非阻塞顶部提示。
        setBanner((e as XrpcError).message || '加载节点清单失败')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [applied],
  )

  const loadPublicKey = useCallback(async () => {
    try {
      const res = await getPublicKey()
      setPublicKey(res)
      setPkError(null)
    } catch (e) {
      setPkError((e as XrpcError).message || '读取 deployer 公钥失败（密钥可能尚未导入）')
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  useEffect(() => {
    void loadPublicKey()
  }, [loadPublicKey])

  // 30 秒静默刷新：纳管确认、测试连接由其他管理员触发时也能看到状态变化。
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const selectedNodes = useMemo(
    () => nodes.filter((n) => selectedIds.includes(n.node_id)),
    [nodes, selectedIds],
  )
  const allSelected = nodes.length > 0 && nodes.every((n) => selectedIds.includes(n.node_id))

  // 删除闸门与后端单事务校验保持一致：落地看台账 listing_status，中转看 isolated。
  const isDelisted = (n: NodeAsset) =>
    n.node_type === 'relay'
      ? relayScheduling[n.node_id] === 'isolated'
      : n.listing_status === 'delisted'

  const listingLabel = (n: NodeAsset) =>
    n.node_type === 'relay'
      ? relayScheduling[n.node_id] === 'isolated'
        ? '已下架接入'
        : '已上架接入'
      : n.listing_status === 'listed'
        ? '已上架'
        : '已下架'

  const onDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await deleteNodeAsset({ node_id: deleteTarget.node_id })
      if (res.blocked_uids?.length) {
        setBlockedUids(res.blocked_uids)
        setDeleteTarget(null)
        return
      }
      toast.success(
        `已删除 ${deleteTarget.node_id}：出口 ${res.deleted_outlets} 个、固定分配 ${res.deleted_assignments} 条`,
      )
      setSelectedIds((ids) => ids.filter((id) => id !== deleteTarget.node_id))
      setDeleteTarget(null)
      await load(true)
    } catch (e) {
      toast.error((e as XrpcError).message || '删除失败（请先在所属 tab 下架该服务器）')
    } finally {
      setDeleting(false)
    }
  }

  const onSearch = () => {
    setApplied({
      node_type: typeDraft === 'all' ? '' : typeDraft,
      keyword: keywordDraft.trim(),
      listing_status: listingDraft === 'all' ? '' : listingDraft,
    })
    setSelectedIds([])
  }

  const onReset = () => {
    setTypeDraft('all')
    setKeywordDraft('')
    setListingDraft('all')
    setApplied(EMPTY_FILTER)
    setSelectedIds([])
  }

  const openCreate = () => {
    setFormMode('create')
    setFormNode(null)
    setFormOpen(true)
  }

  const openEdit = (n: NodeAsset) => {
    setFormMode('edit')
    setFormNode(n)
    setFormOpen(true)
  }

  const onTest = async (n: NodeAsset) => {
    setTestingId(n.node_id)
    try {
      const res = await testConnection({ node_id: n.node_id })
      if (res.connected) toast.success(`${n.node_id}：公钥连接正常`)
      else toast.error(`${n.node_id}：连接失败 - ${res.message}`)
      await load(true)
    } catch (e) {
      toast.error((e as XrpcError).message || '测试连接失败')
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="节点运维台"
        description="中转 / 落地节点台账、带外公钥纳管与白名单批量运维操作；仅已下架服务器可删除，删除后进入历史服务器页。"
        actions={
          <>
            <Button variant="outline" onClick={() => void load(false)} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              录入节点
            </Button>
          </>
        }
      />

      {banner && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {banner}
        </div>
      )}

      {/* deployer 认证公钥：只读展示，供带外预置使用；接口永不返回私钥。 */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            Deployer 认证公钥
            {publicKey && <Badge variant="secondary">key_version {publicKey.key_version}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pkError ? (
            <p className="text-sm text-destructive">{pkError}</p>
          ) : publicKey ? (
            <>
              <div className="flex items-start gap-2">
                <Textarea readOnly rows={2} className="font-mono text-xs" value={publicKey.public_key} />
                <Button variant="outline" size="sm" onClick={() => void copyText(publicKey.public_key)}>
                  <Copy className="h-4 w-4" />
                  复制
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                该公钥需带外写入每台目标节点对应 SSH 用户的 authorized_keys（可在下方「纳管」中一键生成命令）。
                私钥由管理员用 ssh-keygen 生成后导入 deployer，AES-256-GCM 加密落库，绝不下发到浏览器。
              </p>
            </>
          ) : (
            <Skeleton className="h-12 w-full" />
          )}
        </CardContent>
      </Card>

      {/* 筛选 */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-[160px] space-y-1.5">
          <Label>节点类型</Label>
          <Select value={typeDraft} onValueChange={setTypeDraft}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="relay">中转节点</SelectItem>
              <SelectItem value="landing">落地节点</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[140px] space-y-1.5">
          <Label>上下架</Label>
          <Select value={listingDraft} onValueChange={setListingDraft}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="listed">已上架</SelectItem>
              <SelectItem value="delisted">已下架</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Label>关键词（节点 ID / 名称 / IP）</Label>
          <Input
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="输入后点查询或回车"
          />
        </div>
        <Button onClick={onSearch}>查询</Button>
        <Button variant="outline" onClick={onReset}>重置</Button>
      </div>

      {/* 节点清单 */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : nodes.length === 0 ? (
            <StateBlock
              title="暂无节点"
              description="点击右上角「录入节点」登记第一台中转或落地节点，随后完成公钥纳管。"
              action={
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  录入节点
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={allSelected}
                        onChange={() => setSelectedIds(allSelected ? [] : nodes.map((n) => n.node_id))}
                        aria-label="全选"
                      />
                    </TableHead>
                    <TableHead>节点</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>位置</TableHead>
                    <TableHead>SSH 连接</TableHead>
                    <TableHead>主机指纹</TableHead>
                    <TableHead>纳管状态</TableHead>
                    <TableHead>上下架</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((n) => (
                    <TableRow key={n.node_id} className={selectedIds.includes(n.node_id) ? 'bg-primary/5' : undefined}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={selectedIds.includes(n.node_id)}
                          onChange={() =>
                            setSelectedIds((ids) =>
                              ids.includes(n.node_id) ? ids.filter((id) => id !== n.node_id) : [...ids, n.node_id],
                            )
                          }
                          aria-label={`选择 ${n.node_id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs font-medium">{n.node_id}</div>
                        <div className="text-xs text-muted-foreground">{n.display_name || '-'}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {n.node_type === 'relay' ? '中转' : n.node_type === 'landing' ? '落地' : n.node_type}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[n.region, n.idc, n.isp].filter(Boolean).join(' / ') || '-'}
                        <div className="font-mono">{n.public_ip || n.private_ip || '-'}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {n.ssh_user}@{n.ssh_host}:{n.ssh_port}
                        {n.last_probe_at && (
                          <div className="text-[11px] text-muted-foreground">最近探测 {n.last_probe_at}</div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate font-mono text-[11px] text-muted-foreground" title={n.host_key_fingerprint}>
                        {n.host_key_fingerprint || '未固定'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={authVariant(n.auth_status)}>
                          {AUTH_LABEL[n.auth_status] ?? n.auth_status ?? '未知'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            (n.node_type === 'relay'
                              ? relayScheduling[n.node_id] === 'active'
                              : n.listing_status === 'listed')
                              ? 'success'
                              : 'secondary'
                          }
                        >
                          {listingLabel(n)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" onClick={() => setBootstrapNode(n)}>
                            <ShieldCheck className="h-3.5 w-3.5" />
                            纳管
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => void onTest(n)} disabled={testingId === n.node_id}>
                            {testingId === n.node_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                            测试
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(n)}>
                            <Pencil className="h-3.5 w-3.5" />
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={!isDelisted(n)}
                            title={
                              isDelisted(n)
                                ? '删除该服务器（不可恢复）'
                                : n.node_type === 'relay'
                                  ? '请先在「中转接入」下架接入，再删除'
                                  : '请先在「落地出口」下架该机器，再删除'
                            }
                            onClick={() => setDeleteTarget(n)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <OperationPanel selected={selectedNodes} onClearSelection={() => setSelectedIds([])} />

      <NodeFormDialog
        open={formOpen}
        mode={formMode}
        node={formNode}
        onClose={() => setFormOpen(false)}
        onSaved={() => void load(true)}
      />
      <BootstrapDialog
        node={bootstrapNode}
        onClose={() => setBootstrapNode(null)}
        onConfirmed={() => void load(true)}
      />

      {/* 删除确认：仅已下架服务器可点，后端仍按类型做二次校验 */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除服务器 {deleteTarget?.node_id}？</DialogTitle>
            <DialogDescription>
              删除后这台服务器会进入「历史服务器」只读列表，并从「中转接入」「落地出口」「服务器台账」中移除；
              其名下出口、接入记录与用户固定分配会一并清除，操作不可撤销。客户端下一次 GetLinks 起不再下发这些出口。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={() => void onDeleteConfirm()} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 严格固定用户阻断：需先在用户详情页迁移，不做自动迁移 */}
      <Dialog open={!!blockedUids} onOpenChange={(v) => !v && setBlockedUids(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>请先迁移严格固定用户</DialogTitle>
            <DialogDescription>
              这些用户被严格固定在该中转节点（不允许回退），删除后将无法获得代理链接。请逐个修改其固定分配，完成后再执行删除；本次未做任何变更。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded border p-2">
            {blockedUids?.map((uid) => (
              <Link key={uid} to={`/users/relay/${uid}`} className="block font-mono text-xs text-primary underline">
                {uid}
              </Link>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setBlockedUids(null)}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
