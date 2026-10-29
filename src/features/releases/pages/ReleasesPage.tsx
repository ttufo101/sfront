// 客户端版本发布列表页（/releases）：列表展示、平台筛选、包含停用、停用操作、公开下载链接。

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useXrpcMutation, useXrpcQuery } from '@/lib/xrpc/hooks'
import { XrpcError } from '@/lib/xrpc/types'
import { formatBytes, formatTimestamp } from '@/lib/format'
import { getAppReleaseDownloadUrl } from '@/lib/upload/fileApi'
import type { AppVersionRelease } from '@/lib/xrpc/admin-contract'

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge variant="success">生效中</Badge>
  if (status === 'disabled') return <Badge variant="secondary">已停用</Badge>
  if (status === 'superseded') return <Badge variant="warning">已被取代</Badge>
  return <Badge variant="outline">{status}</Badge>
}

const PLATFORM_LABEL: Record<string, string> = {
  android: 'Android',
  ios: 'iOS',
  windows: 'Windows',
  mac: 'macOS',
}

export function ReleasesPage() {
  const navigate = useNavigate()
  const [platform, setPlatform] = useState('all')
  const [includeHistory, setIncludeHistory] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const params = {
    platform: platform === 'all' ? '' : platform,
    include_history: includeHistory,
    page,
    page_size: pageSize,
  }
  const { data, loading, error, refetch } = useXrpcQuery('ListAppVersions', params, [
    platform,
    includeHistory,
    page,
    pageSize,
  ])
  const disableMut = useXrpcMutation('DisableAppVersion')

  const onDisable = async (rel: AppVersionRelease) => {
    if (!window.confirm(`确认停用 ${rel.platform} 平台的当前生效版本 ${rel.latest_version}？`)) return
    try {
      await disableMut.mutateAsync({ platform: rel.platform, expected_release_id: rel.release_id })
      toast.success('已停用该版本')
      refetch()
    } catch (e) {
      const err = e as XrpcError
      toast.error(`停用失败：${err.message}`)
    }
  }

  // 下载/升级地址：统一用文件服务公开下载链接（http://106.52.77.108:80；
  // admin 的 update_url 因强制 HTTPS 与当前 80 端口冲突暂不可用，故前端以真实可达地址为准）
  const resolveDownloadUrl = (rel: AppVersionRelease) => getAppReleaseDownloadUrl(rel.file_id)

  const handleCopyUrl = async (rel: AppVersionRelease) => {
    const url = resolveDownloadUrl(rel)
    try {
      await navigator.clipboard.writeText(url)
      toast.success('已复制下载地址')
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  const releases = data?.releases ?? []
  // 未勾选历史时，后端只返回生效记录；用 total 推算还有多少条历史被隐藏，避免误以为"只有一条数据"
  const total = data?.total != null ? Number(data.total) : null
  const totalPages =
    total != null && Number.isFinite(total) && total > 0 ? Math.max(Math.ceil(total / pageSize), 1) : 1
  const hiddenCount =
    !includeHistory && total != null && Number.isFinite(total) ? Math.max(total - releases.length, 0) : 0

  return (
    <>
      <PageHeader
        title="版本发布"
        description="管理客户端安装包的版本发布与停用。上传在文件服务完成，发布与生效态由 Admin 控制。"
        actions={
          <Button onClick={() => navigate('/releases/new')}>发布新版本</Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={platform} onValueChange={(v) => { setPlatform(v); setPage(1) }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="全部平台" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部平台</SelectItem>
            <SelectItem value="android">Android</SelectItem>
            <SelectItem value="ios">iOS</SelectItem>
            <SelectItem value="windows">Windows</SelectItem>
            <SelectItem value="mac">macOS</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeHistory}
            onChange={(e) => { setIncludeHistory(e.target.checked); setPage(1) }}
          />
          显示历史版本
          <span className="text-xs text-muted-foreground">（含已被取代 / 已停用）</span>
        </label>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          刷新
        </Button>
      </div>

      {!includeHistory && (
        <p className="mb-4 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>
            当前仅展示各平台生效中的版本
            {total != null && Number.isFinite(total) ? `（共 ${total} 条记录，已展示 ${releases.length} 条）` : ''}
            {hiddenCount > 0 ? `，另有 ${hiddenCount} 条历史记录未显示。` : '。'}
          </span>
          {hiddenCount > 0 && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => setIncludeHistory(true)}
            >
              查看全部记录
            </Button>
          )}
        </p>
      )}

      {loading ? (
        <StateBlock title="加载中…" />
      ) : error ? (
        <StateBlock title="加载失败" description={`${error.message}（${error.code}）`} />
      ) : releases.length === 0 ? (
        <StateBlock title="暂无版本发布记录" description="点击右上角“发布新版本”上传并发布一个安装包。" />
      ) : (
        <>
        <div className="rounded-lg border bg-background">
          {/* table-fixed + 百分比列宽：固定布局下 max-w/truncate 才真正生效，长 URL 不再撑宽整表 */}
          <Table className="table-fixed">
            <colgroup>
              <col className="w-[7%]" />
              <col className="w-[7%]" />
              <col className="w-[6%]" />
              <col className="w-[7%]" />
              <col className="w-[12%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[12%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>平台</TableHead>
                <TableHead>版本</TableHead>
                <TableHead>构建号</TableHead>
                <TableHead>包类型</TableHead>
                <TableHead>文件名</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>发布时间</TableHead>
                <TableHead>更新标题</TableHead>
                <TableHead>下载地址</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {releases.map((rel) => (
                <TableRow
                  key={rel.release_id}
                  className={rel.status === 'active' ? 'bg-muted/40' : undefined}
                >
                  <TableCell className="whitespace-nowrap font-medium">
                    {PLATFORM_LABEL[rel.platform] ?? rel.platform}
                  </TableCell>
                  <TableCell>{rel.latest_version}</TableCell>
                  <TableCell>{rel.build_number}</TableCell>
                  <TableCell>{rel.package_type}</TableCell>
                  <TableCell className="truncate" title={rel.file_name}>
                    {rel.file_name}
                  </TableCell>
                  <TableCell className="truncate">{formatBytes(rel.package_size_bytes)}</TableCell>
                  <TableCell>
                    <StatusBadge status={rel.status} />
                  </TableCell>
                  <TableCell className="truncate">{formatTimestamp(rel.published_at)}</TableCell>
                  <TableCell className="truncate" title={rel.update_title}>
                    {rel.update_title || '-'}
                  </TableCell>
                  <TableCell className="text-center">
                    <a
                      href={resolveDownloadUrl(rel)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline"
                      title={resolveDownloadUrl(rel)}
                    >
                      下载
                    </a>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="link" size="sm" onClick={() => handleCopyUrl(rel)}>
                        复制
                      </Button>
                      {rel.status === 'active' && (
                        <Button
                          variant="link"
                          size="sm"
                          className="text-destructive"
                          disabled={disableMut.loading}
                          onClick={() => onDisable(rel)}
                        >
                          停用
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {total != null && Number.isFinite(total)
              ? `共 ${total} 条记录，每页 ${pageSize} 条${releases.length < pageSize && total > pageSize ? '（已到末页）' : ''}`
              : '—'}
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20 条/页</SelectItem>
                <SelectItem value="50">50 条/页</SelectItem>
                <SelectItem value="100">100 条/页</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <span className="min-w-[72px] text-center text-xs text-muted-foreground">
              {total != null && Number.isFinite(total) ? `第 ${page} / ${totalPages} 页` : `第 ${page} 页`}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
        </>
      )}
    </>
  )
}
