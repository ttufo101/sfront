// 数据面中转节点管理页（/data-plane-nodes）。
// 对齐 admin.md §12 与 plan.md §14：运行状态与调度状态双列独立展示（不前端自推），
// 15 秒静默轮询（不覆盖编辑表单、失败保留旧数据+顶部非阻塞错误），新增隔离/恢复操作，
// 编辑含 advertise_host 与 scheduling_status，只读派生"可分配"提示。
// 创建与轮换密码成功后，明文密码仅在响应返回一次，必须通过弹窗立即展示并提示保存，关闭后不可再查。

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { XrpcError } from '@/lib/xrpc/types'
import { DataPlaneNode, UpdateDataPlaneNodeRequest } from '@/lib/xrpc/admin-contract'
import { formatTimestamp, toNumberSafe } from '@/lib/format'
import {
  listDataPlaneNodes,
  createDataPlaneNode,
  updateDataPlaneNode,
  rotateDataPlaneNodePassword,
} from '../api/nodes'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

// 心跳健康阈值（秒）：超过该时间视为心跳失效，用于派生"可分配"判断（后端以 runtime_status 为准）。
const HEALTH_GRACE_SECONDS = 5 * 60
const POLL_INTERVAL_MS = 15_000

interface EditState {
  node: DataPlaneNode | null
  display_name: string
  enabled: boolean
  advertise_host: string
  scheduling_status: string
}

interface PasswordState {
  open: boolean
  password: string
  nodeLabel: string
}

interface ConfirmState {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  danger: boolean
  onConfirm: () => void
}

function relativeFromNow(sec: string | number | undefined | null): string {
  const n = toNumberSafe(sec)
  if (!n) return '从未上报'
  const diff = Math.floor(Date.now() / 1000 - n)
  if (diff < 0) return '刚刚'
  if (diff < 60) return `${diff} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

function formatTimestampSec(sec: string | number | undefined | null): string {
  const n = toNumberSafe(sec)
  if (!n) return '-'
  const d = new Date(n * 1000)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function runtimeBadge(status: string): { label: string; variant: 'success' | 'secondary' | 'warning' } {
  switch (status) {
    case 'online':
      return { label: '在线', variant: 'success' }
    case 'offline':
      return { label: '离线', variant: 'secondary' }
    default:
      return { label: '从未连接', variant: 'warning' }
  }
}

function schedulingBadge(status: string): { label: string; variant: 'success' | 'secondary' | 'warning' } {
  switch (status) {
    case 'active':
      return { label: '参与调度', variant: 'success' }
    case 'draining':
      return { label: '排空', variant: 'warning' }
    case 'isolated':
      return { label: '已隔离', variant: 'warning' }
    default:
      return { label: '已禁用', variant: 'secondary' }
  }
}

// 派生"可分配"提示（不单独保存）：启用 + 在线 + 参与调度 + 心跳有效 + 已配置公网地址。
function isAssignable(n: DataPlaneNode): boolean {
  const host = (n.advertise_host ?? '').trim()
  const hb = toNumberSafe(n.heartbeat_at)
  const fresh = hb > 0 && Date.now() / 1000 - hb < HEALTH_GRACE_SECONDS
  return n.enabled && n.runtime_status === 'online' && n.scheduling_status === 'active' && fresh && host !== ''
}

// 校验 advertise_host：仅公网 IP 或域名，不含协议/端口/路径/空格/?/#。
function isValidAdvertiseHost(v: string): boolean {
  const s = v.trim()
  if (!s) return false
  return !/[\s:/\?#]/.test(s)
}

export function DataPlaneNodesPage() {
  const [nodes, setNodes] = useState<DataPlaneNode[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [manualLoading, setManualLoading] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [edit, setEdit] = useState<EditState | null>(null)
  const [editHostError, setEditHostError] = useState<string | null>(null)
  const [pwd, setPwd] = useState<PasswordState>({ open: false, password: '', nodeLabel: '' })
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  const buildUpdate = useCallback(
    (n: DataPlaneNode, patch: Partial<Pick<DataPlaneNode, 'display_name' | 'enabled' | 'advertise_host' | 'scheduling_status'>>): UpdateDataPlaneNodeRequest => ({
      node_id: n.node_id,
      display_name: n.display_name,
      enabled: n.enabled,
      advertise_host: n.advertise_host ?? '',
      scheduling_status: n.scheduling_status ?? 'disabled',
      ...patch,
    }),
    [],
  )

  const fetchNodes = useCallback(async (opts?: { silent?: boolean; manual?: boolean }) => {
    const silent = !!opts?.silent
    const manual = !!opts?.manual
    if (manual) setManualLoading(true)
    try {
      const res = await listDataPlaneNodes({})
      setNodes(res.nodes ?? [])
      setBanner(null)
    } catch (e) {
      // 静默刷新失败：保留最后一次成功数据，仅顶部非阻塞提示。
      setBanner((e as XrpcError).message || '刷新节点列表失败')
    } finally {
      if (!silent) setInitialLoading(false)
      if (manual) setManualLoading(false)
    }
  }, [])

  // 初次加载 + 每 15 秒静默轮询；轮询结果不覆盖正在编辑的表单（编辑态存于本地 state）。
  useEffect(() => {
    fetchNodes()
    const t = setInterval(() => fetchNodes({ silent: true }), POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [fetchNodes])

  // ---- 创建 ----
  const submitCreate = async () => {
    const node_id = newId.trim()
    const display_name = newName.trim()
    if (!node_id) {
      toast.error('节点 ID 不能为空')
      return
    }
    setBusy(true)
    try {
      const res = await createDataPlaneNode({ node_id, display_name })
      toast.success('节点已创建')
      setNewId('')
      setNewName('')
      setCreateOpen(false)
      fetchNodes()
      setPwd({ open: true, password: res.node_password, nodeLabel: `${display_name || node_id}（${node_id}）` })
    } catch (e) {
      toast.error((e as XrpcError).message)
    } finally {
      setBusy(false)
    }
  }

  // ---- 编辑（名称 + 启停 + 公网地址 + 调度状态）----
  const openEdit = (n: DataPlaneNode) =>
    setEdit({
      node: n,
      display_name: n.display_name,
      enabled: n.enabled,
      advertise_host: n.advertise_host ?? '',
      scheduling_status: n.scheduling_status ?? 'disabled',
    })

  const submitEdit = async () => {
    if (!edit?.node) return
    const display_name = edit.display_name.trim()
    if (!display_name) {
      toast.error('节点名称不能为空')
      return
    }
    const host = edit.advertise_host.trim()
    if (edit.scheduling_status === 'active' && !isValidAdvertiseHost(host)) {
      setEditHostError('切到「参与调度」时公网地址必填，且只能为 IP/域名（不含协议/端口/空格/?/#）')
      return
    }
    setEditHostError(null)
    setBusy(true)
    try {
      await updateDataPlaneNode(
        buildUpdate(edit.node, {
          display_name,
          enabled: edit.enabled,
          advertise_host: host,
          scheduling_status: edit.scheduling_status,
        }),
      )
      toast.success('节点已更新')
      setEdit(null)
      fetchNodes()
    } catch (e) {
      toast.error((e as XrpcError).message)
    } finally {
      setBusy(false)
    }
  }

  // ---- 隔离 / 恢复 ----
  const isolateOrRestore = (n: DataPlaneNode) => {
    const restoring = n.scheduling_status === 'isolated'
    setConfirm({
      open: true,
      title: restoring ? '恢复节点调度' : '隔离节点',
      description: restoring
        ? `将「${n.display_name}（${n.node_id}）」恢复为参与调度（active）。`
        : `隔离「${n.display_name}（${n.node_id}）」后，该节点不再参与自动与固定节点选择；固定到它的用户将失去该节点（严格固定时返回暂无可用节点）。`,
      confirmLabel: restoring ? '恢复' : '隔离',
      danger: !restoring,
      onConfirm: async () => {
        setBusy(true)
        try {
          await updateDataPlaneNode(buildUpdate(n, { scheduling_status: restoring ? 'active' : 'isolated' }))
          toast.success(restoring ? '已恢复调度' : '已隔离节点')
          fetchNodes()
        } catch (e) {
          toast.error((e as XrpcError).message)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  // ---- 停用 / 启用 ----
  const disableNode = (n: DataPlaneNode) => {
    setConfirm({
      open: true,
      title: '停用节点',
      description: `确认停用「${n.display_name}（${n.node_id}）」？停用后节点身份被拒绝，不再参与任何调度与分配。`,
      confirmLabel: '停用',
      danger: true,
      onConfirm: async () => {
        setBusy(true)
        try {
          await updateDataPlaneNode(buildUpdate(n, { enabled: false }))
          toast.success('已停用')
          fetchNodes()
        } catch (e) {
          toast.error((e as XrpcError).message)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const enableNode = async (n: DataPlaneNode) => {
    setBusy(true)
    try {
      await updateDataPlaneNode(buildUpdate(n, { enabled: true }))
      toast.success('已启用')
      fetchNodes()
    } catch (e) {
      toast.error((e as XrpcError).message)
    } finally {
      setBusy(false)
    }
  }

  // ---- 轮换密码 ----
  const rotate = (n: DataPlaneNode) => {
    setConfirm({
      open: true,
      title: '轮换节点密码',
      description: `即将轮换「${n.display_name}（${n.node_id}）」的密码。旧密码会立即失效：若未同步更新对应 Mihomo 配置，该节点身份认证将失败并在心跳超时后离线。请先核对节点名称与 ID。`,
      confirmLabel: '继续轮换',
      danger: false,
      onConfirm: async () => {
        setBusy(true)
        try {
          const res = await rotateDataPlaneNodePassword({ node_id: n.node_id })
          toast.success('密码已轮换')
          fetchNodes()
          setPwd({ open: true, password: res.node_password, nodeLabel: `${n.display_name || n.node_id}（${n.node_id}）` })
        } catch (e) {
          toast.error((e as XrpcError).message)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const copyText = async (text: string, ok = '已复制到剪贴板') => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(ok)
    } catch {
      toast.error('复制失败，请手动选择文本复制')
    }
  }

  const rt = (s: string) => runtimeBadge(s)
  const sc = (s: string) => schedulingBadge(s)

  return (
    <div>
      <PageHeader
        title="数据面节点管理"
        description="管理中转节点（Mihomo 经 Gateway 调用的鉴权与计量节点）。节点密码以 bcrypt 哈希存储，明文仅在创建或轮换时返回一次。"
        actions={
          <>
            <Button variant="outline" onClick={() => fetchNodes({ manual: true })} disabled={manualLoading}>
              刷新
            </Button>
            <Button
              onClick={() => {
                setNewId('')
                setNewName('')
                setCreateOpen(true)
              }}
            >
              新增节点
            </Button>
          </>
        }
      />

      {banner && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>节点列表刷新失败：{banner}（已保留上次数据）</span>
          <Button variant="outline" size="sm" onClick={() => fetchNodes({ manual: true })}>
            重试
          </Button>
        </div>
      )}

      {initialLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <StateBlock title="暂无节点" description="点击下方「新增节点」创建一个数据面中转节点。" />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>节点 ID</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>公网地址</TableHead>
                <TableHead>运行状态</TableHead>
                <TableHead>调度状态</TableHead>
                <TableHead>最近心跳</TableHead>
                <TableHead>启动时间</TableHead>
                <TableHead>离线信息</TableHead>
                <TableHead>可分配</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.map((n) => {
                const r = rt(n.runtime_status)
                const s = sc(n.scheduling_status)
                return (
                  <TableRow key={n.node_id}>
                    <TableCell>
                      <button
                        type="button"
                        className="font-mono text-xs text-muted-foreground hover:text-foreground"
                        title="点击复制节点 ID"
                        onClick={() => copyText(n.node_id, '节点 ID 已复制')}
                      >
                        {n.node_id}
                      </button>
                    </TableCell>
                    <TableCell className="font-medium">{n.display_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {(n.advertise_host ?? '').trim() ? (
                        <span className="font-mono text-xs">{n.advertise_host}</span>
                      ) : (
                        <span className="text-warning">未配置</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={r.variant}>{r.label}</Badge>
                        {!n.enabled && <Badge variant="destructive">已停用</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span title={formatTimestampSec(n.heartbeat_at)}>{relativeFromNow(n.heartbeat_at)}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatTimestampSec(n.started_at)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {n.runtime_status === 'offline' ? (
                        <span className="text-xs" title={formatTimestampSec(n.offline_at)}>
                          {relativeFromNow(n.offline_at)}
                          {n.offline_reason ? ` · ${n.offline_reason}` : ''}
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {isAssignable(n) ? (
                        <Badge variant="success">可分配</Badge>
                      ) : (
                        <Badge variant="secondary">不可分配</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatTimestamp(n.created_at)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="link" size="sm" onClick={() => openEdit(n)} disabled={busy}>
                        编辑
                      </Button>
                      <Button variant="link" size="sm" onClick={() => isolateOrRestore(n)} disabled={busy}>
                        {n.scheduling_status === 'isolated' ? '恢复' : '隔离'}
                      </Button>
                      {n.enabled ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="text-destructive"
                          onClick={() => disableNode(n)}
                          disabled={busy}
                        >
                          停用
                        </Button>
                      ) : (
                        <Button variant="link" size="sm" onClick={() => enableNode(n)} disabled={busy}>
                          启用
                        </Button>
                      )}
                      <Button variant="link" size="sm" onClick={() => rotate(n)} disabled={busy}>
                        轮换密码
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 创建节点 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新增数据面节点</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>节点 ID</Label>
              <Input
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="节点唯一标识，建议 relay-<IP>-<序号>"
              />
              <p className="text-xs text-muted-foreground">创建后不可修改，将作为节点部署身份。</p>
            </div>
            <div className="space-y-2">
              <Label>节点名称</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="展示名称，如 东京节点" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={submitCreate} disabled={busy}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑节点 */}
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑节点</DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>节点 ID</Label>
                <Input value={edit.node?.node_id} disabled />
              </div>
              <div className="space-y-2">
                <Label>节点名称</Label>
                <Input
                  value={edit.display_name}
                  onChange={(e) => setEdit({ ...edit, display_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>公网地址（advertise_host）</Label>
                <Input
                  value={edit.advertise_host}
                  onChange={(e) => {
                    setEdit({ ...edit, advertise_host: e.target.value })
                    if (editHostError) setEditHostError(null)
                  }}
                  placeholder="公网 IP 或域名，不含协议/端口/空格/?/#"
                />
                {editHostError && <p className="text-xs text-destructive">{editHostError}</p>}
                <p className="text-xs text-muted-foreground">切到「参与调度」时必填；该地址将作为 GetLinks 返回给用户的中转地址。</p>
              </div>
              <div className="space-y-2">
                <Label>调度状态</Label>
                <div className="flex flex-wrap gap-2">
                  {(['active', 'draining', 'isolated', 'disabled'] as const).map((st) => (
                    <Button
                      key={st}
                      type="button"
                      size="sm"
                      variant={edit.scheduling_status === st ? 'default' : 'outline'}
                      onClick={() => setEdit({ ...edit, scheduling_status: st })}
                    >
                      {schedulingBadge(st).label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  active=参与调度；isolated=管理员隔离；disabled=尚未完成部署；draining=不再分配新用户。
                </p>
              </div>
              <div className="flex items-center justify-between">
                <Label>启用</Label>
                <Switch checked={edit.enabled} onCheckedChange={(v) => setEdit({ ...edit, enabled: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>
              取消
            </Button>
            <Button onClick={submitEdit} disabled={busy}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 影响确认（隔离 / 停用 / 轮换前）*/}
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">{confirm?.description}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              variant={confirm?.danger ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => {
                const fn = confirm?.onConfirm
                setConfirm(null)
                fn?.()
              }}
            >
              {confirm?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 一次性明文密码展示 */}
      <Dialog open={pwd.open} onOpenChange={(v) => !v && setPwd({ ...pwd, open: false })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>节点密码（仅显示一次）</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-destructive font-medium">
              ⚠ 密码仅在此展示一次，服务端不保存明文。请立即复制并安全保存，关闭后将无法再次查看。
            </p>
            <div className="space-y-1">
              <Label>节点</Label>
              <p className="text-sm text-muted-foreground">{pwd.nodeLabel}</p>
            </div>
            <div className="space-y-1">
              <Label>明文密码</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={pwd.password}
                  className="font-mono"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button variant="outline" size="sm" onClick={() => copyText(pwd.password, '密码已复制到剪贴板')}>
                  复制
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setPwd({ ...pwd, open: false })}>我已保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
