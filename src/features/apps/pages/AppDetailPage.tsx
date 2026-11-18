// 应用详情 /apps/:appId：版本列表 / 已部署节点 / 发布任务 / 应用设置 四个 tab。
// 选择只在「已部署节点」列表页发生一次；升级与回滚向导接收只读快照，不再提供勾选。
// 版本列表操作列只有「部署」「查看配置」，不放升级按钮（避免目标版本歧义）。

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Eye, Plus, RefreshCw, Rocket, RotateCcw, UploadCloud } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getAppDefinition,
  listAppVersions,
  listAppDeployments,
  listDeployBatches,
} from '../api/apps'
import { AppFormDialog } from '../components/AppFormDialog'
import { VersionFormDialog } from '../components/VersionFormDialog'
import { ConfigViewDialog } from '../components/ConfigViewDialog'
import { DeployDialog } from '../components/DeployDialog'
import { DeployWizard } from '../components/DeployWizard'
import { TaskDetailDialog } from '../components/TaskDetailDialog'
import type {
  AppDefinition,
  AppDeployment,
  AppVersion,
  DeployBatch,
  DeployMode,
} from '@/lib/xrpc/deployer-contract'
import {
  BATCH_STATUS_LABEL,
  DEPLOY_STATUS_LABEL,
  MODE_LABEL,
  MODE_TONE,
  NODE_IDENTITY_PATH,
  SERVICE_TYPE_LABEL,
  formatShortTime,
  isBatchTerminal,
  shortSha,
  taskTone,
  versionNo,
} from '../lib/model'
import { formatBytes } from '@/lib/format'

type Tab = 'versions' | 'deployments' | 'tasks' | 'settings'
const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'versions', label: '版本列表', hint: '版本号自增，制品与模板不可变' },
  { key: 'deployments', label: '已部署节点', hint: '升级 / 回滚的唯一入口' },
  { key: 'tasks', label: '发布任务', hint: '批次进度与节点明细' },
  { key: 'settings', label: '应用设置', hint: '启动命令与可选证书可编辑' },
]

function isTab(v: string | null): v is Tab {
  return v === 'versions' || v === 'deployments' || v === 'tasks' || v === 'settings'
}

export function AppDetailPage() {
  const { appId = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const v = searchParams.get('tab')
    return isTab(v) ? v : 'versions'
  })

  useEffect(() => {
    const v = searchParams.get('tab')
    setTab(isTab(v) ? v : 'versions')
  }, [searchParams])

  const switchTab = (next: Tab) => {
    setTab(next)
    setSelected(new Set())
    setSearchParams({ tab: next })
  }

  const [app, setApp] = useState<AppDefinition | null>(null)
  const [versions, setVersions] = useState<AppVersion[]>([])
  const [deployments, setDeployments] = useState<AppDeployment[]>([])
  const [batches, setBatches] = useState<DeployBatch[]>([])
  const [loading, setLoading] = useState(true)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [versionDialog, setVersionDialog] = useState(false)
  const [configTarget, setConfigTarget] = useState<{ label: string } | null>(null)
  const [deployTarget, setDeployTarget] = useState<string | null>(null)
  const [wizard, setWizard] = useState<Exclude<DeployMode, 'install'> | null>(null)
  const [taskBatch, setTaskBatch] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, v, d, b] = await Promise.all([
        getAppDefinition(appId),
        listAppVersions(appId).catch(() => ({ versions: [] })),
        listAppDeployments(appId).catch(() => ({ deployments: [] })),
        listDeployBatches({ app_id: appId, limit: 50 }).catch(() => ({ batches: [] })),
      ])
      setApp(a.app)
      setVersions(v.versions ?? [])
      setDeployments(d.deployments ?? [])
      setBatches(b.batches ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载应用详情失败')
    } finally {
      setLoading(false)
    }
  }, [appId])

  useEffect(() => {
    void load()
  }, [load])

  // 有进行中批次时轮询，到全部终态停止。
  useEffect(() => {
    if (tab !== 'tasks') return
    const hasActive = batches.some((b) => !isBatchTerminal(b.status))
    if (!hasActive) return
    const timer = setInterval(() => {
      listDeployBatches({ app_id: appId, limit: 50 })
        .then((r) => setBatches(r.batches ?? []))
        .catch(() => clearInterval(timer))
    }, 3000)
    return () => clearInterval(timer)
  }, [tab, batches, appId])

  const nextVersionNo = Math.max(0, ...versions.map((v) => versionNo(v.version_label))) + 1
  const maxVersion = Math.max(0, ...versions.map((v) => versionNo(v.version_label)))
  const selectedDeployments = deployments.filter((d) => selected.has(d.node_id))
  const latestCurrent = Math.max(0, ...selectedDeployments.map((d) => versionNo(d.current_version)))
  const canUpgrade = selectedDeployments.length > 0 && maxVersion > latestCurrent

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = deployments.length > 0 && selected.size === deployments.length
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(deployments.map((d) => d.node_id)))
  }

  if (!app && !loading) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate('/apps')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> 返回应用列表
        </Button>
        <Card className="py-16 text-center text-sm text-muted-foreground">应用不存在或已删除</Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={app?.display_name ?? '应用详情'}
        description={`${SERVICE_TYPE_LABEL[app?.service_type ?? ''] ?? '—'} · ${app?.app_key ?? ''} · 版本与部署台账是升级/回滚的唯一事实源`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/apps')}>
              <ArrowLeft className="mr-1 h-4 w-4" /> 返回
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="mr-1 h-4 w-4" /> 刷新
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
            className={
              tab === t.key
                ? 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                : 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground'
            }
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{TABS.find((t) => t.key === tab)?.hint}</span>
      </div>

      {/* ---------------- 版本列表 ---------------- */}
      {tab === 'versions' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setVersionDialog(true)} disabled={!app}>
              <Plus className="mr-1 h-4 w-4" /> 新建版本
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>版本</TableHead>
                  <TableHead>制品 / sha256 / 大小</TableHead>
                  <TableHead>配置模板</TableHead>
                  <TableHead>稳定版</TableHead>
                  <TableHead>变更说明</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                      还没有版本。新建版本时上传可执行程序与统一配置模板，版本号由后端自增。
                    </TableCell>
                  </TableRow>
                )}
                {versions.map((v) => (
                  <TableRow key={v.version_id}>
                    <TableCell className="font-semibold">{v.version_label}</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-mono">{v.bin_filename}</div>
                      <div className="text-muted-foreground">{shortSha(v.bin_sha256)} · {formatBytes(v.bin_size)}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{v.config_filename || '—'}</TableCell>
                    <TableCell>{v.is_stable ? <Badge variant="success">稳定</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{v.change_note || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatShortTime(v.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => setDeployTarget(v.version_label)} disabled={!app}>
                          <UploadCloud className="mr-1 h-3.5 w-3.5" /> 部署
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfigTarget({ label: v.version_label })}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> 查看配置
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <p className="text-xs text-muted-foreground">
            版本列表不放升级按钮：升级与回滚都由「已部署节点」tab 发起，避免目标版本歧义。
          </p>
        </div>
      )}

      {/* ---------------- 已部署节点（升级/回滚唯一入口） ---------------- */}
      {tab === 'deployments' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setWizard('upgrade')}
              disabled={!canUpgrade}
              title={!canUpgrade ? '请先勾选节点，且需存在比当前更新的版本' : ''}
            >
              <Rocket className="mr-1 h-4 w-4" /> 升级
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setWizard('rollback')}
              disabled={selectedDeployments.length === 0 || versions.length === 0}
            >
              <RotateCcw className="mr-1 h-4 w-4" /> 回滚
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              已选 {selectedDeployments.length} 台 · 目标版本在向导中人工统一指定
            </span>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input type="checkbox" className="h-4 w-4" checked={allSelected} onChange={toggleAll} />
                  </TableHead>
                  <TableHead>服务器 IP</TableHead>
                  <TableHead>节点名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>当前版本（实况）</TableHead>
                  <TableHead>上次成功</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近部署</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                      还没有已部署节点。请到「版本列表」选择一个版本点「部署」。
                    </TableCell>
                  </TableRow>
                )}
                {deployments.map((d) => (
                  <TableRow key={d.node_id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.has(d.node_id)}
                        onChange={() => toggle(d.node_id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.public_ip}</TableCell>
                    <TableCell>{d.display_name || '-'}</TableCell>
                    <TableCell>{SERVICE_TYPE_LABEL[d.node_type] ?? d.node_type}</TableCell>
                    <TableCell className="font-medium">{d.current_version || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{d.last_success_version || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === 'failed' ? 'destructive' : 'success'}>
                        {DEPLOY_STATUS_LABEL[d.status] ?? d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatShortTime(d.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <p className="text-xs text-muted-foreground">
            current_version 是实况版本：健康检查失败也记本次目标版本 + status=failed，不假装还在旧版。
            不做 failed 状态门禁，异常节点可直接发新批次，请留意确认页「将覆盖现场」提示。
          </p>
        </div>
      )}

      {/* ---------------- 发布任务 ---------------- */}
      {tab === 'tasks' && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>批次</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>目标版本</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>成功 / 失败 / 跳过</TableHead>
                <TableHead>并发</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                    还没有发布批次
                  </TableCell>
                </TableRow>
              )}
              {batches.map((b) => (
                <TableRow key={b.batch_id}>
                  <TableCell className="font-mono text-xs">{b.batch_id}</TableCell>
                  <TableCell>
                    <Badge variant={MODE_TONE[b.mode] ?? 'secondary'}>{MODE_LABEL[b.mode] ?? b.mode}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{b.target_version}</TableCell>
                  <TableCell>
                    <Badge variant={taskTone(b.status === 'running' ? 'running' : b.status === 'succeeded' ? 'succeeded' : b.status)}>
                      {BATCH_STATUS_LABEL[b.status] ?? b.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{b.succeeded} / {b.failed} / {b.skipped}</TableCell>
                  <TableCell className="text-xs">{b.concurrency}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatShortTime(b.created_at)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setTaskBatch(b.batch_id)}>
                      查看明细
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* ---------------- 应用设置 ---------------- */}
      {tab === 'settings' && app && (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-medium">应用属性</div>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              编辑应用
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
            {[
              ['应用 key', app.app_key],
              ['显示名称', app.display_name],
              ['服务类型', SERVICE_TYPE_LABEL[app.service_type] ?? app.service_type],
              ['启动命令', app.start_command],
              ['需要本机身份', app.requires_identity ? '是' : '否'],
              ['配置文件名', app.config_filename],
              ['配置目标路径', app.config_target_path],
              ['可执行程序路径', app.bin_target_path],
              ['生命周期脚本', app.restart_cmd],
              ['健康检查', app.health_check],
              ['TLS 证书 conf/server.crt', app.tls_cert ? shortSha(app.tls_cert.cert_sha256) : '未配置'],
              ['TLS 私钥 conf/server.key', app.tls_cert ? shortSha(app.tls_cert.key_sha256) : '未配置'],
              ['证书下发目录', `/opt/${app.app_key}/conf`],
              ['本机身份文件（应用自读）', NODE_IDENTITY_PATH],
              ['创建人', app.created_by],
              ['创建时间', formatShortTime(app.created_at)],
              ['更新时间', formatShortTime(app.updated_at)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 break-all font-mono text-xs">{v || '—'}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 space-y-1 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            <p>
              启动命令、显示名称、服务类型、身份要求与 TLS 证书对可随时编辑；改动会在下一次部署渲染该应用专属
              setup.sh 时生效。app_key 一经创建不可修改，它同时是安装目录名与二进制名。节点身份由应用自读
              /etc/starland/node-identity，发布中心不签发、不合成、不覆盖。
            </p>
            <p>
              证书属于应用定义而非版本：配置后每次部署按 sha256 校验并覆盖 conf/server.crt（0644）与
              conf/server.key（0600），轮换无需发新版本；这里只显示指纹，页面无从读取私钥内容。
              未配置或移除后不再下发，也不会删除目标机已有文件。
            </p>
          </div>
        </Card>
      )}

      {app && (
        <>
          <AppFormDialog
            open={editOpen}
            app={app}
            onClose={() => setEditOpen(false)}
            onCreated={() => void load()}
          />
          <VersionFormDialog
            app={app}
            open={versionDialog}
            nextVersionNo={nextVersionNo}
            onClose={() => setVersionDialog(false)}
            onCreated={() => void load()}
          />
          <ConfigViewDialog
            open={!!configTarget}
            appId={app.app_id}
            versionLabel={configTarget?.label ?? ''}
            onClose={() => setConfigTarget(null)}
          />
          <DeployDialog
            open={!!deployTarget}
            app={app}
            versionLabel={deployTarget ?? ''}
            onClose={() => setDeployTarget(null)}
            onSubmitted={(batchId) => {
              setDeployTarget(null)
              void load()
              setTaskBatch(batchId)
            }}
          />
          <DeployWizard
            open={!!wizard}
            mode={wizard ?? 'upgrade'}
            app={app}
            deployments={selectedDeployments}
            versions={versions}
            onClose={() => setWizard(null)}
            onSubmitted={(batchId) => {
              setWizard(null)
              setSelected(new Set())
              void load()
              setTaskBatch(batchId)
            }}
          />
        </>
      )}
      {taskBatch && <TaskDetailDialog batchId={taskBatch} onClose={() => setTaskBatch(null)} />}
    </div>
  )
}
