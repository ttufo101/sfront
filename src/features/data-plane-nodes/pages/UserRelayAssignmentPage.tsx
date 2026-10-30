// 用户中转节点分配页（/users/relay/:uid）。
// 对齐 admin.md §12.6 与 plan.md §14.3/§14.4：读取用户当前固定分配，支持
// 「自动分配」与「固定到指定节点 + 是否允许回退」两种互斥模式。
// 节点下拉列出全部节点（不可用仍展示并提示风险，不能只列在线，否则已固定但离线的节点会消失）；
// 严格固定到不可用节点前明确提示；保存后重新查询确认，并提示 15 秒内同步到 Starcore。

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { XrpcError } from '@/lib/xrpc/types'
import { DataPlaneNode } from '@/lib/xrpc/admin-contract'
import { toNumberSafe } from '@/lib/format'
import {
  getUserRelayAssignment,
  setUserRelayAssignment,
} from '../api/relay-assignment'
import { listDataPlaneNodes as listAllNodes } from '../api/nodes'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

const HEALTH_GRACE_SECONDS = 5 * 60

function runtimeLabel(status: string): string {
  if (status === 'online') return '在线'
  if (status === 'offline') return '离线'
  return '从未连接'
}

function schedulingLabel(status: string): string {
  switch (status) {
    case 'active':
      return '参与调度'
    case 'draining':
      return '排空'
    case 'isolated':
      return '已隔离'
    default:
      return '已禁用'
  }
}

// 节点是否当前可用于分配（与节点页派生"可分配"口径一致，但不写入服务端）。
function nodeUsable(n: DataPlaneNode): boolean {
  const host = (n.advertise_host ?? '').trim()
  const hb = toNumberSafe(n.heartbeat_at)
  const fresh = hb > 0 && Date.now() / 1000 - hb < HEALTH_GRACE_SECONDS
  return n.enabled && n.runtime_status === 'online' && n.scheduling_status === 'active' && host !== '' && fresh
}

// 可嵌入的「用户中转节点分配」面板：接受 uid 与可选的 onBack，便于在用户详情中直接内嵌。
// 路由页 UserRelayAssignmentPage 仅做参数读取与返回按钮的薄包装。
export function UserRelayAssignmentPanel({ uid, onBack }: { uid: string; onBack?: () => void }) {
  const [nodes, setNodes] = useState<DataPlaneNode[]>([])
  const [assigned, setAssigned] = useState<{ node_id: string; allow_fallback: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [mode, setMode] = useState<'auto' | 'fixed'>('auto')
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [allowFallback, setAllowFallback] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmWarn, setConfirmWarn] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const loadAll = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [nodeRes, assignRes] = await Promise.all([
        listAllNodes({}),
        getUserRelayAssignment({ uid }),
      ])
      setNodes(nodeRes.nodes ?? [])
      if (assignRes.assigned && assignRes.node_id) {
        setMode('fixed')
        setSelectedNodeId(assignRes.node_id)
        setAllowFallback(assignRes.allow_fallback)
        setAssigned({ node_id: assignRes.node_id, allow_fallback: assignRes.allow_fallback })
      } else {
        setMode('auto')
        setSelectedNodeId('')
        setAllowFallback(true)
        setAssigned(null)
      }
    } catch (e) {
      setLoadError((e as XrpcError).message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (uid) loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  const selectedNode = useMemo(
    () => nodes.find((n) => n.node_id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )
  const selectedUnusable = selectedNode ? !nodeUsable(selectedNode) : false

  const attemptSave = () => {
    if (mode === 'fixed' && !selectedNodeId) {
      toast.error('请先选择要固定的节点')
      return
    }
    // 严格固定（不允许回退）到不可用节点：必须明确提示风险。
    if (mode === 'fixed' && !allowFallback && selectedUnusable) {
      setConfirmOpen(true)
      return
    }
    doSave()
  }

  const doSave = async () => {
    setSaving(true)
    try {
      const res = await setUserRelayAssignment({
        uid,
        node_id: mode === 'auto' ? '' : selectedNodeId,
        allow_fallback: mode === 'fixed' ? allowFallback : false,
      })
      if (res.success) {
        toast.success(mode === 'auto' ? '已清除固定分配，恢复自动分配' : '已保存固定节点')
        await loadAll()
        toast.info('配置通常 15 秒内同步到 Starcore；客户端下一次 GetLinks 时生效。')
      } else {
        toast.error('保存失败')
      }
    } catch (e) {
      toast.error((e as XrpcError).message)
    } finally {
      setSaving(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="中转节点分配"
        description={`为用户 ${uid} 配置固定中转节点。自动分配按 HRW 在健康节点中选择；固定节点优先使用，不可用时按「允许回退」决定行为。`}
        actions={
          onBack ? (
            <Button variant="outline" onClick={onBack}>
              返回用户列表
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : loadError ? (
        <StateBlock title="加载失败" description={loadError} action={<Button onClick={loadAll}>重试</Button>} />
      ) : (
        <div className="max-w-2xl space-y-6 rounded-xl border p-6">
          {/* 模式选择 */}
          <div className="space-y-2">
            <Label>分配模式</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === 'auto' ? 'default' : 'outline'}
                onClick={() => {
                  setMode('auto')
                  setSelectedNodeId('')
                }}
              >
                自动分配
              </Button>
              <Button
                type="button"
                variant={mode === 'fixed' ? 'default' : 'outline'}
                onClick={() => setMode('fixed')}
              >
                固定到指定节点
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              自动分配：清除固定关系，由系统按 HRW 在健康节点中分配。固定节点：用户优先使用该节点。
            </p>
          </div>

          {mode === 'fixed' && (
            <>
              <div className="space-y-2">
                <Label>固定节点</Label>
                <Select value={selectedNodeId} onValueChange={setSelectedNodeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择节点（全部节点均可选）" />
                  </SelectTrigger>
                  <SelectContent>
                    {nodes.map((n) => {
                      const usable = nodeUsable(n)
                      const tag = usable ? '' : '（当前不可用）'
                      return (
                        <SelectItem key={n.node_id} value={n.node_id}>
                          {n.display_name}（{n.node_id}）· {n.advertise_host || '无地址'} ·{' '}
                          {runtimeLabel(n.runtime_status)}/{schedulingLabel(n.scheduling_status)}
                          {tag}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  下拉列出全部节点，包括当前离线/隔离的节点；不可用节点仍可保存（后端允许），但需注意下方风险提示。
                </p>
                {selectedUnusable && (
                  <p className="text-xs text-destructive">
                    ⚠ 所选节点当前不可用（未在线 / 未参与调度 / 无公网地址）。固定后该用户可能无法获得代理链接，请确认。
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label>节点不可用时允许自动回退</Label>
                  <p className="text-xs text-muted-foreground">
                    开启：固定节点不可用时由 HRW 在其他健康节点中选择。关闭：严格固定，不可用时用户暂无可用节点。
                  </p>
                </div>
                <Switch checked={allowFallback} onCheckedChange={setAllowFallback} />
              </div>
            </>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={attemptSave} disabled={saving}>
              保存
            </Button>
            {assigned && (
              <span className="text-xs text-muted-foreground">
                当前已固定：{assigned.node_id || '（无）'}
                {assigned.node_id ? ` · 允许回退：${assigned.allow_fallback ? '是' : '否'}` : ''}
              </span>
            )}
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            说明：保存或清除后系统会重新查询以确认最终值。分配变更通常 15 秒内同步到 Starcore，但不会影响已下发到客户端的旧代理配置；新规则在客户端下一次调用 GetLinks 时生效。
          </div>
        </div>
      )}

      {/* 严格固定到不可用节点的风险提示 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认严格固定到不可用节点</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">
            你选择了「不允许回退」且目标节点当前不可用（{selectedNode?.display_name} · {selectedNode?.node_id}）。
            保存后，该用户将<strong>严格固定</strong>到此节点；当节点不可用时，GetLinks 会返回暂无可用节点，用户将无法获得代理链接，直到节点恢复或你修改固定关系。是否继续？
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={doSave} disabled={saving}>
              仍要保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// 路由薄包装：从 URL 读取 uid，渲染可嵌入面板并附带返回按钮（保留旧深链 /users/relay/:uid 可用）。
export function UserRelayAssignmentPage() {
  const { uid = '' } = useParams()
  const navigate = useNavigate()
  return <UserRelayAssignmentPanel uid={uid} onBack={() => navigate('/users')} />
}
