// 落地出口（声明式）：端口是唯一主键，一个端口就是一条「客户端 → 中转 → 落地」链路。
// 编辑都在本地草稿里；点「预览变更」只做渲染 + dry-run + diff，确认前不写库、不建版本、不发批次。
// 确认发布后才落库 + 建 config_only 版本 + 发批次，随后轮询终态，最后单独上架新出口。
// 落地机下拉统一只显示 public_ip（node_id 过长会撑破容器），完整 ID 由 title 提供；选中值仍是 node_id。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, Plus, Trash2, Eye, Rocket, Settings2 } from 'lucide-react'
import { XrpcError } from '@/lib/xrpc/types'
import type {
  ListProxyOutletsResponse,
  PreviewProxyChangeResponse,
  ProxyBatch,
  ProxyOutletSpec,
  ProxyRuntimeConfig,
} from '@/lib/xrpc/admin-contract'
import {
  getProxyRuntimeConfig,
  listProxyOutlets,
  previewProxyChange,
  publishProxyChange,
  setOutletListing,
  updateProxyRuntimeConfig,
} from '../api/outlets'
import { getDeployBatch } from '@/features/apps/api/apps'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

const genId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

// 统一简洁展示：只显示公网 IP，长度可控且天然唯一；完整 node_id 放在下拉项 title 里。
const landingLabel = (n: { node_id: string; public_ip: string }) => n.public_ip || n.node_id

type BatchState = { status: string; total: number; succeeded: number; failed: number; health: string }

export function ProxyOutletsPage() {
  const [data, setData] = useState<ListProxyOutletsResponse | null>(null)
  const [runtime, setRuntime] = useState<ProxyRuntimeConfig | null>(null)
  const [draft, setDraft] = useState<ProxyOutletSpec[]>([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewProxyChangeResponse | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [changeNote, setChangeNote] = useState('')
  const [reason, setReason] = useState('')
  const [batches, setBatches] = useState<ProxyBatch[]>([])
  const [batchStates, setBatchStates] = useState<Record<string, BatchState>>({})
  const [runtimeOpen, setRuntimeOpen] = useState(false)

  // 新增出口的本地表单
  const [newPort, setNewPort] = useState('')
  const [newNode, setNewNode] = useState('')
  const [newRegion, setNewRegion] = useState('')
  const [newSni, setNewSni] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, rt] = await Promise.all([listProxyOutlets(), getProxyRuntimeConfig()])
      setData(list)
      setRuntime(rt.config)
      setDraft(
        (list.outlets ?? []).map((o) => ({
          port: o.port, node_id: o.node_id, region: o.region,
          sni: o.sni, listing_status: o.listing_status,
        })),
      )
      setNewNode(list.landing_nodes?.[0]?.node_id ?? '')
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

  // 批次轮询：发布后每 3s 拉一次终态，全部结束自动停。
  useEffect(() => {
    if (batches.length === 0) return
    const allDone = batches.every((b) => {
      const s = batchStates[b.batch_id]?.status
      return s && s !== 'running' && s !== 'queued' && s !== 'unknown'
    })
    if (allDone) return
    const timer = window.setInterval(async () => {
      const next: Record<string, BatchState> = {}
      await Promise.all(
        batches.map(async (b) => {
          try {
            const res = await getDeployBatch(b.batch_id)
            const batch = res.batch
            const items = batch?.items ?? []
            const health = items.every((i) => i.health_result === 'passed') ? 'passed' : 'partial'
            next[b.batch_id] = {
              status: batch?.status ?? 'unknown',
              total: batch?.total ?? 0,
              succeeded: batch?.succeeded ?? 0,
              failed: batch?.failed ?? 0,
              health,
            }
          } catch {
            next[b.batch_id] = { status: 'unknown', total: 0, succeeded: 0, failed: 0, health: 'unknown' }
          }
        }),
      )
      setBatchStates((prev) => ({ ...prev, ...next }))
    }, 3000)
    return () => window.clearInterval(timer)
  }, [batches, batchStates])

  const dirty = useMemo(() => {
    if (!data) return false
    const base = (data.outlets ?? []).map((o) => ({
      port: o.port, node_id: o.node_id, region: o.region,
      sni: o.sni, listing_status: o.listing_status,
    }))
    return JSON.stringify(base) !== JSON.stringify(draft)
  }, [data, draft])

  const pool = useMemo(() => {
    if (!data) return [] as number[]
    const out: number[] = []
    for (let p = data.pool_start; p <= data.pool_end; p++) out.push(p)
    return out
  }, [data])

  // 中转配置只由「端口集合 + 每个端口的 node_id」决定；落地配置完全不含出口声明。
  // 因此只改展示名 / SNI / 上下架状态时，两份配置摘要不变，确认发布后不会创建配置批次。
  const configAffecting = useMemo(() => {
    if (!data) return false
    const base = new Map((data.outlets ?? []).map((o) => [o.port, o]))
    const next = new Map(draft.map((o) => [o.port, o]))
    if (base.size !== next.size) return true
    for (const [port, o] of next) {
      const b = base.get(port)
      if (!b || b.node_id !== o.node_id) return true
    }
    return false
  }, [data, draft])

  const usedPorts = useMemo(() => new Set(draft.map((o) => o.port)), [draft])
  const freePorts = useMemo(() => pool.filter((p) => !usedPorts.has(p)), [pool, usedPorts])
  const allTerminal = batches.length > 0 && batches.every((b) => {
    const s = batchStates[b.batch_id]?.status
    return s && s !== 'running' && s !== 'queued'
  })
  const allHealthy = batches.length > 0 && batches.every(
    (b) => batchStates[b.batch_id]?.status === 'succeeded' && batchStates[b.batch_id]?.health === 'passed',
  )

  const updateRow = (port: number, patch: Partial<ProxyOutletSpec>) =>
    setDraft((rows) => rows.map((r) => (r.port === port ? { ...r, ...patch } : r)))

  const addOutlet = () => {
    const port = Number(newPort)
    if (!Number.isInteger(port) || port < (data?.pool_start ?? 0) || port > (data?.pool_end ?? 0)) {
      toast.error(`端口必须在 ${data?.pool_start}-${data?.pool_end} 内`)
      return
    }
    if (usedPorts.has(port)) {
      toast.error(`端口 ${port} 已被占用`)
      return
    }
    if (!newNode) return toast.error('请选择归属落地机')
    if (!newRegion.trim()) return toast.error('请填写展示名（如 SG:Singapore）')
    if (!newSni.trim()) return toast.error('请填写 SNI')
    setDraft((rows) => [
      ...rows,
      { port, node_id: newNode, region: newRegion.trim(), sni: newSni.trim(), listing_status: 'delisted' },
    ])
    setNewPort('')
    setNewRegion('')
    setNewSni('')
  }

  const doPreview = async () => {
    setPreviewing(true)
    setPreview(null)
    try {
      const res = await previewProxyChange({ outlets: draft })
      setPreview(res)
      setPreviewOpen(true)
      if (!res.ok) toast.error(res.errors?.[0] || 'dry-run 未通过')
    } catch (e) {
      toast.error((e as XrpcError).message || '预览失败')
    } finally {
      setPreviewing(false)
    }
  }

  const doPublish = async () => {
    if (!preview?.ok || !preview.digest) return
    if (!reason.trim()) return toast.error('请填写操作原因')
    setPublishing(true)
    try {
      const res = await publishProxyChange({
        outlets: draft,
        expected_digest: preview.digest,
        change_note: changeNote.trim(),
        client_request_id: genId(),
        operation_reason: reason.trim(),
      })
      setBatches(res.batches ?? [])
      setBatchStates({})
      setPreviewOpen(false)
      setPreview(null)
      toast.success(
        res.batches?.length
          ? `已创建 ${res.batches.length} 个纯配置批次`
          : '声明已保存，客户端新订阅立即生效（本次无配置批次）',
      )
      await load()
    } catch (e) {
      toast.error((e as XrpcError).message || '发布失败')
    } finally {
      setPublishing(false)
    }
  }

  const toggleListing = async (o: ProxyOutletSpec) => {
    const next = o.listing_status === 'listed' ? 'delisted' : 'listed'
    try {
      await setOutletListing({ port: o.port, listing_status: next })
      toast.success(`端口 ${o.port} 已${next === 'listed' ? '上架' : '下架'}`)
      await load()
    } catch (e) {
      toast.error((e as XrpcError).message || '操作失败')
    }
  }

  const saveRuntime = async (form: FormData) => {
    if (!runtime) return
    try {
      await updateProxyRuntimeConfig({
        port_pool_start: Number(form.get('pool_start')),
        port_pool_end: Number(form.get('pool_end')),
        landing_port: Number(form.get('landing_port')),
        landing_password: String(form.get('password') ?? ''),
        relay_base: String(form.get('relay_base') ?? ''),
        expected_revision: runtime.revision,
        client_request_id: genId(),
        operation_reason: String(form.get('reason') ?? ''),
      })
      toast.success('运行参数已保存；下次变更会按新参数渲染')
      setRuntimeOpen(false)
      await load()
    } catch (e) {
      toast.error((e as XrpcError).message || '保存失败')
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="落地出口"
        description="端口即出口。编辑只改本地草稿；预览通过 dry-run 后才可确认发布。中转→落地固定复用 26019，未分配端口自动 REJECT，防火墙请人工维护。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setRuntimeOpen(true)} disabled={!runtime}>
              <Settings2 className="h-4 w-4" /> 运行参数
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-4 w-4" /> 刷新
            </Button>
          </>
        }
      />

      {banner && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{banner}</div>
      )}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">端口池 {data?.pool_start}-{data?.pool_end}</Badge>
            <Badge variant="outline">已声明 {draft.length}</Badge>
            <Badge variant="outline">空闲 {freePorts.length}</Badge>
            <Badge variant={dirty ? 'warning' : 'secondary'}>{dirty ? '有未发布改动' : '与线上一致'}</Badge>
            <span className="text-xs text-muted-foreground">落地固定端口 {data?.landing_port} · 明文口令不回传</span>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <div className="w-[110px] space-y-1">
              <Label className="text-xs">端口</Label>
              <Input className="h-8" placeholder={String(freePorts[0] ?? '')} value={newPort} onChange={(e) => setNewPort(e.target.value)} />
            </div>
            <div className="w-[210px] space-y-1">
              <Label className="text-xs">归属落地机（IP）</Label>
              <Select value={newNode} onValueChange={setNewNode}>
                <SelectTrigger className="h-8 w-full"><SelectValue className="min-w-0 truncate" placeholder="选择落地机" /></SelectTrigger>
                <SelectContent>
                  {(data?.landing_nodes ?? []).map((n) => (
                    <SelectItem key={n.node_id} value={n.node_id} title={`${n.node_id} · ${n.public_ip}`}>
                      {landingLabel(n)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[180px] space-y-1">
              <Label className="text-xs">展示名</Label>
              <Input className="h-8" placeholder="SG:Singapore" value={newRegion} onChange={(e) => setNewRegion(e.target.value)} />
            </div>
            <div className="w-[220px] space-y-1">
              <Label className="text-xs">SNI</Label>
              <Input className="h-8" placeholder="www.example.com" value={newSni} onChange={(e) => setNewSni(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" onClick={addOutlet}><Plus className="h-4 w-4" /> 加入草稿</Button>
            <span className="text-xs text-muted-foreground">新增默认「已下架」，发布成功后需单独上架。</span>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => void doPreview()} disabled={previewing || loading}>
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              预览变更（dry-run + diff）
            </Button>
            <Button variant="outline" onClick={() => { setDraft((data?.outlets ?? []).map((o) => ({
              port: o.port, node_id: o.node_id, region: o.region, sni: o.sni, listing_status: o.listing_status,
            }))) }} disabled={!dirty}>
              放弃草稿
            </Button>
            <span className="text-xs text-muted-foreground">
              预览只做内存渲染，不写库、不建版本、不发批次。
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-2 text-xs text-muted-foreground">
            已上架出口的展示名可直接编辑：改名只影响客户端节点名，不需重新上架、不会下发配置批次，发布后新订阅立即生效。归属落地机统一显示公网 IP，完整节点 ID 可悬停下拉项查看。
          </div>
          {loading ? (
            <StateBlock title="正在加载出口声明" />
          ) : draft.length === 0 ? (
            <StateBlock title="暂无出口声明" description="从端口池里新增一个出口开始。" />
          ) : (
            <div className="overflow-x-auto">
              <Table className="table-fixed min-w-[1000px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">端口</TableHead>
                    <TableHead className="w-[230px]">展示名（客户端节点名）</TableHead>
                    <TableHead className="w-[190px]">落地机 IP</TableHead>
                    <TableHead className="w-[250px]">SNI</TableHead>
                    <TableHead className="w-[80px]">状态</TableHead>
                    <TableHead className="w-[170px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...draft].sort((a, b) => a.port - b.port).map((o) => (
                    <TableRow key={o.port}>
                      <TableCell className="font-mono text-xs font-medium">{o.port}</TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-full"
                          value={o.region}
                          title={o.listing_status === 'listed'
                            ? '已上架出口可直接改名：只影响客户端节点名，不需重新上架、不会下发配置批次'
                            : '客户端订阅里显示的节点名'}
                          onChange={(e) => updateRow(o.port, { region: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Select value={o.node_id} onValueChange={(v) => updateRow(o.port, { node_id: v })}>
                          <SelectTrigger className="h-8 w-[170px]"><SelectValue className="min-w-0 truncate" /></SelectTrigger>
                          <SelectContent>
                            {(data?.landing_nodes ?? []).map((n) => (
                              <SelectItem key={n.node_id} value={n.node_id} title={`${n.node_id} · ${n.public_ip}`}>
                                {landingLabel(n)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input className="h-8" value={o.sni} onChange={(e) => updateRow(o.port, { sni: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Badge className="whitespace-nowrap" variant={o.listing_status === 'listed' ? 'success' : 'secondary'}>
                          {o.listing_status === 'listed' ? '已上架' : '已下架'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => void toggleListing(o)} disabled={dirty}>
                            {o.listing_status === 'listed' ? '下架' : '上架'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDraft((rows) => rows.filter((r) => r.port !== o.port))}>
                            <Trash2 className="h-4 w-4 text-destructive" />
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

      {batches.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <div className="text-sm font-medium">本次发布批次</div>
            {batches.map((b) => {
              const s = batchStates[b.batch_id]
              return (
                <div key={b.batch_id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono">{b.app_key} {b.version_label}</span>
                  <span className="font-mono text-muted-foreground">{b.batch_id}</span>
                  <Badge variant={s?.status === 'succeeded' ? 'success' : s?.status === 'failed' ? 'destructive' : 'secondary'}>
                    {s?.status ?? '查询中'}
                  </Badge>
                  <span className="text-muted-foreground">
                    {s ? `${s.succeeded}/${s.total} 成功 · 失败 ${s.failed} · 健康检查 ${s.health}` : ''}
                  </span>
                </div>
              )
            })}
            {allTerminal && (
              <p className={`text-xs ${allHealthy ? 'text-emerald-600' : 'text-destructive'}`}>
                {allHealthy
                  ? '全部批次成功且健康检查通过。新增出口默认下架，确认无异常后可在上表逐个「上架」。'
                  : '存在未成功批次，请先到发布中心查看任务详情或回滚上一版，不要上架新出口。'}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* diff 预览：唯一的人工确认点 */}
      <Dialog open={previewOpen} onOpenChange={(v) => !v && setPreviewOpen(false)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>变更预览（确认后才写库并发批次）</DialogTitle>
            <DialogDescription>
              {preview?.ok
                ? `dry-run 通过 · digest ${preview.digest.slice(0, 16)}… · 三份配置已生成`
                : 'dry-run 未通过，发布已禁用'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto">
            {preview?.errors?.length ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                {preview.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            ) : null}
            {preview?.ok && !configAffecting && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs">
                本次仅涉及展示名 / SNI / 上下架状态（或声明无变化），中转与落地配置摘要预计不变：<strong>不会创建配置批次</strong>。
                确认发布后客户端新订阅立即生效，已上架状态保持不变，无需重新上架。
              </div>
            )}
            {preview?.ok && configAffecting && (
              <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                本次涉及端口增删或归属落地机变更，中转配置会重新渲染；确认发布后将创建纯配置批次并下发到全部中继。
              </div>
            )}
            <div>
              <Label className="text-xs">声明差异（+ 新增 / - 删除 / ~ 修改）</Label>
              <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{preview?.diff || '（无变化）'}</pre>
            </div>
            <div>
              <Label className="text-xs">中转 mihomo 配置（渲染产物）</Label>
              <pre className="mt-1 max-h-52 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{preview?.relay_config}</pre>
            </div>
            <div>
              <Label className="text-xs">落地 hysteria 配置</Label>
              <pre className="mt-1 max-h-28 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{preview?.landing_config}</pre>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">变更说明</Label>
                <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="如：新增 26025 出口" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">操作原因 <span className="text-destructive">*</span></Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="必填，写入审计" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>返回修改</Button>
            <Button onClick={() => void doPublish()} disabled={!preview?.ok || publishing || !reason.trim()}>
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              确认发布
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 运行参数 */}
      <Dialog open={runtimeOpen} onOpenChange={(v) => !v && setRuntimeOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>出口渲染运行参数</DialogTitle>
            <DialogDescription>端口池、落地固定端口、共享口令与中转基础模板。修改后下一次变更按新参数渲染。</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); void saveRuntime(new FormData(e.currentTarget)) }}
            className="space-y-3"
          >
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1"><Label className="text-xs">端口池起</Label><Input name="pool_start" defaultValue={runtime?.port_pool_start} /></div>
              <div className="space-y-1"><Label className="text-xs">端口池止</Label><Input name="pool_end" defaultValue={runtime?.port_pool_end} /></div>
              <div className="space-y-1"><Label className="text-xs">落地端口</Label><Input name="landing_port" defaultValue={runtime?.landing_port} /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">落地共享口令（留空保持不变；当前{runtime?.landing_password_set ? '已设置' : '未设置'}）</Label>
              <Input name="password" type="password" placeholder="留空 = 不修改" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">中转基础模板（静态段，勿写 proxies / listeners / rules）</Label>
              <Textarea name="relay_base" defaultValue={runtime?.relay_base} className="h-40 font-mono text-xs" spellCheck={false} />
            </div>
            <div className="space-y-1"><Label className="text-xs">操作原因 <span className="text-destructive">*</span></Label><Input name="reason" placeholder="必填" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRuntimeOpen(false)}>取消</Button>
              <Button type="submit">保存</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
