import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useXrpcQuery } from '@/lib/xrpc/hooks'
import { formatTimestamp, toNumberSafe } from '@/lib/format'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

const PAGE_SIZE = 20

export function UsersPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword), 300)
    return () => clearTimeout(t)
  }, [keyword])

  const { data, loading, error, refetch } = useXrpcQuery('ListUsers', { page, page_size: PAGE_SIZE, keyword: debounced }, [page, debounced])

  const total = data ? toNumberSafe(data.total) : 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <PageHeader title="用户管理" description="分页查询注册用户，支持按邮箱或 UID 搜索" />

      <div className="mb-4 flex items-center gap-3">
        <Input
          placeholder="搜索邮箱或 UID"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value)
            setPage(1)
          }}
          className="max-w-sm"
        />
        <Button variant="outline" onClick={() => refetch()}>
          刷新
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <StateBlock title="加载失败" description={error.message} action={<Button onClick={() => refetch()}>重试</Button>} />
      ) : !data || data.users.length === 0 ? (
        <StateBlock title="没有匹配的用户" description={debounced ? `未找到与“${debounced}”相关的用户` : '当前还没有注册用户'} />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>邮箱</TableHead>
                  <TableHead>UID</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>设备数</TableHead>
                  <TableHead>注册时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map((u) => (
                  <TableRow key={u.uid}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{u.uid}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.status === 1 ? (
                        <Badge variant="success">正常</Badge>
                      ) : (
                        <Badge variant="destructive">禁用</Badge>
                      )}
                    </TableCell>
                    <TableCell>{u.bound_device_count}</TableCell>
                    <TableCell className="text-muted-foreground">{formatTimestamp(u.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="link" size="sm" onClick={() => navigate(`/users/${encodeURIComponent(u.email)}/devices`)}>
                        查看设备
                      </Button>
                      <Button variant="link" size="sm" onClick={() => navigate(`/users/${encodeURIComponent(u.email)}/subscriptions`)}>
                        查看套餐
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              共 {total} 条 · 第 {page}/{totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                上一页
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                下一页
              </Button>
            </div>
          </div>
        </>
      )}

      {data && data.users.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">提示：点击“查看设备”可查看该用户绑定的设备列表，点击“查看套餐”可查看其时间与流量订阅。</p>
      )}
    </div>
  )
}
