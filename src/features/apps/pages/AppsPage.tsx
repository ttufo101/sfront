// 应用定义列表 /apps：名称、服务类型、版本数、已部署节点数、最新稳定版、最近发布时间。
// 与「控制面服务」「客户端安装包」在菜单与表上完全分离；点击进入应用详情 4 个 tab。

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { Boxes, Plus, RefreshCw } from 'lucide-react'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
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
  listAppDefinitions,
  listAppVersions,
  listAppDeployments,
} from '../api/apps'
import { AppFormDialog } from '../components/AppFormDialog'
import type { AppDefinition } from '@/lib/xrpc/deployer-contract'
import { SERVICE_TYPE_LABEL, formatShortTime } from '../lib/model'

interface AppRow {
  app: AppDefinition
  versions: number
  deployed: number
  stable: string
  last: string
}

export function AppsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<AppRow[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listAppDefinitions()
      const apps = res.apps ?? []
      const detail = await Promise.all(
        apps.map(async (app) => {
          const [vers, deps] = await Promise.all([
            listAppVersions(app.app_id).catch(() => ({ versions: [] })),
            listAppDeployments(app.app_id).catch(() => ({ deployments: [] })),
          ])
          const versions = vers.versions ?? []
          const stable = versions.find((v) => v.is_stable) ?? versions[0]
          const last = versions.reduce((acc, v) => (v.created_at > acc ? v.created_at : acc), '')
          return {
            app,
            versions: versions.length,
            deployed: (deps.deployments ?? []).length,
            stable: stable?.version_label ?? '—',
            last,
          } satisfies AppRow
        }),
      )
      setRows(detail)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载应用列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <PageHeader
        title="应用发布中心"
        description="应用定义 → 版本 → 部署台账三层模型。部署/升级/回滚都汇聚为同一个异步批次，页面只负责发起与查看。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="mr-1 h-4 w-4" /> 刷新
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> 新建应用
            </Button>
          </>
        }
      />

      <Card>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>应用名称</TableHead>
                <TableHead>应用 key</TableHead>
                <TableHead>服务类型</TableHead>
                <TableHead>版本数</TableHead>
                <TableHead>已部署节点</TableHead>
                <TableHead>最新稳定版</TableHead>
                <TableHead>最近发布</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.app.app_id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate(`/apps/${r.app.app_id}`)}
                >
                  <TableCell className="font-medium">{r.app.display_name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.app.app_key}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{SERVICE_TYPE_LABEL[r.app.service_type] ?? r.app.service_type}</Badge>
                  </TableCell>
                  <TableCell>{r.versions}</TableCell>
                  <TableCell>{r.deployed}</TableCell>
                  <TableCell>{r.stable}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatShortTime(r.last)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/apps/${r.app.app_id}`)
                      }}
                    >
                      查看详情
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {!loading && rows.length === 0 && (
          <StateBlock
            title="还没有应用定义"
            description="先新建应用（填应用 key、名称、服务类型与启动命令；目录、二进制名与生命周期脚本由后端按应用 key 推导；TLS 证书对可选、在应用上配置一次即可），再创建版本并部署到服务器。"
            action={
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Boxes className="mr-1 h-4 w-4" /> 新建应用
              </Button>
            }
          />
        )}
        {loading && (
          <div className="py-14 text-center text-sm text-muted-foreground">加载中…</div>
        )}
      </Card>

      <AppFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={(app) => {
          void load()
          navigate(`/apps/${app.app_id}`)
        }}
      />
    </>
  )
}
