import { useState } from 'react'
import { toast } from 'sonner'
import { useXrpcQuery, useXrpcMutation } from '@/lib/xrpc/hooks'
import { Announcement } from '@/lib/xrpc/admin-contract'
import { formatTimestamp } from '@/lib/format'
import { PageHeader, StateBlock } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

const statusVariant = (s: string) =>
  s === 'published' ? 'success' : s === 'draft' ? 'secondary' : 'warning'
const statusText = (s: string) => (s === 'published' ? '已发布' : s === 'draft' ? '草稿' : '已下线')

export function AnnouncementsPage() {
  const { data, loading, error, refetch } = useXrpcQuery('ListAnnouncements', {})
  const createMut = useXrpcMutation('CreateAnnouncement')
  const updateMut = useXrpcMutation('UpdateAnnouncement')
  const publishMut = useXrpcMutation('PublishAnnouncement')
  const unpublishMut = useXrpcMutation('UnpublishAnnouncement')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const openCreate = () => {
    setEditing(null)
    setTitle('')
    setBody('')
    setOpen(true)
  }
  const openEdit = (a: Announcement) => {
    setEditing(a)
    setTitle(a.title)
    setBody(a.content)
    setOpen(true)
  }

  const save = async () => {
    if (!title.trim() || !body.trim()) return toast.error('请填写标题与正文')
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, title, content: body })
        toast.success('公告已更新')
      } else {
        await createMut.mutateAsync({ title, content: body })
        toast.success('公告已创建（草稿）')
      }
      setOpen(false)
      refetch()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const publish = async (a: Announcement) => {
    try {
      await publishMut.mutateAsync({ id: a.id })
      toast.success('已发布')
      refetch()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const unpublish = async (a: Announcement) => {
    try {
      await unpublishMut.mutateAsync({ id: a.id })
      toast.success('已下线')
      refetch()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div>
      <PageHeader title="公告管理" description="创建、编辑、发布与下线站内公告" actions={<Button onClick={openCreate}>新建公告</Button>} />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <StateBlock title="加载失败" description={error.message} action={<Button onClick={() => refetch()}>重试</Button>} />
      ) : !data || data.announcements.length === 0 ? (
        <StateBlock title="暂无公告" />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.announcements.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.title}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(a.status)}>{statusText(a.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatTimestamp(a.created_at)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatTimestamp(a.updated_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="link" size="sm" onClick={() => openEdit(a)}>
                      编辑
                    </Button>
                    {a.status === 'published' ? (
                      <Button variant="link" size="sm" onClick={() => unpublish(a)}>
                        下线
                      </Button>
                    ) : (
                      <Button variant="link" size="sm" onClick={() => publish(a)}>
                        发布
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑公告' : '新建公告'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>标题</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>正文</Label>
              <Textarea className="min-h-[160px]" value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={save} disabled={createMut.loading || updateMut.loading}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
