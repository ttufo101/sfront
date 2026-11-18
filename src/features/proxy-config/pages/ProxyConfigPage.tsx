import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useXrpcQuery, useXrpcMutation } from '@/lib/xrpc/hooks'
import { validateProxyConfig } from '../lib/validateProxyConfig'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

export function ProxyConfigPage() {
  const { data, loading, error, refetch } = useXrpcQuery('GetProxyConfig', {})
  const updateMut = useXrpcMutation('UpdateProxyConfig')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [revision, setRevision] = useState<string | number>('')
  const [reason, setReason] = useState('')

  const genId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)

  useEffect(() => {
    if (data) {
      setContent(data.content)
      setRevision(data.revision ?? '')
      setDirty(false)
    }
  }, [data])

  // 语法 + 结构预校验（内容变化即重算，配置体量小，无需 debounce）
  const validation = useMemo(() => validateProxyConfig(content), [content])
  const hasSyntaxError = !validation.ok
  const hasWarning = validation.warnings.length > 0

  const save = async () => {
    // 兜底再校验一次，防止极端时序下带病保存
    const check = validateProxyConfig(content)
    if (!check.ok) {
      toast.error(`校验未通过，未保存：${check.errors[0]}`)
      return
    }
    if (!reason.trim()) {
      toast.error('请填写操作原因')
      return
    }
    try {
      await updateMut.mutateAsync({
        content,
        expected_revision: revision,
        client_request_id: genId(),
        operation_reason: reason,
      })
      setDirty(false)
      toast.success('代理配置已保存')
    } catch (e) {
      const msg = (e as Error).message
      // 版本冲突：配置已被其他人修改，重新加载最新版本，避免旧内容覆盖
      if (/conflict|revision|版本|已被|不一致|concurrent/i.test(msg)) {
        toast.error('配置已被其他人修改，已重新加载最新版本，请重新编辑后保存')
        await refetch()
      } else {
        toast.error(msg)
      }
    }
  }

  return (
    <div>
      <PageHeader
        title="客户端基础模板"
        description="只维护静态骨架（DNS / 分流规则 / 策略组）；出口由落地出口声明每次渲染注入"
        actions={
          <>
            {dirty && !hasSyntaxError && <Badge variant="warning">未保存</Badge>}
            {hasSyntaxError && <Badge variant="destructive">校验未通过</Badge>}
            {!hasSyntaxError && hasWarning && <Badge variant="warning">配置提示</Badge>}
            <Button variant="outline" onClick={() => refetch()}>
              重新加载
            </Button>
            <Button onClick={save} disabled={!dirty || hasSyntaxError || !reason.trim() || updateMut.loading}>
              保存
            </Button>
          </>
        }
      />

      {loading ? (
        <Skeleton className="h-[420px] w-full" />
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 p-6 text-sm text-destructive">{error.message}</div>
      ) : (
        <Textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            setDirty(true)
          }}
          spellCheck={false}
          className="h-[420px] font-mono text-xs leading-relaxed"
        />
      )}

      {hasSyntaxError && (
        <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <p className="mb-1 font-medium">校验未通过（保存已禁用）：</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {validation.errors.map((err, i) => (
              <li key={i} className="break-all">
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasSyntaxError && hasWarning && (
        <div className="mt-2 rounded-lg border border-amber-400/40 bg-amber-50 p-3 text-xs text-amber-700">
          <p className="mb-1 font-medium">配置提示（不影响保存，请自行确认）：</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {validation.warnings.map((w, i) => (
              <li key={i} className="break-all">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 max-w-xl space-y-2">
        <Label>操作原因 <span className="text-destructive">*</span></Label>
        <Input
          placeholder="如：新增中转节点"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          本配置已启用并发版本保护：保存时校验当前版本号，若期间被他人修改会被拒绝并自动重新加载最新配置。
        </p>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        说明：此处是客户端订阅的<strong>基础模板</strong>，不是完整 proxy.yaml。
        <code className="mx-1 rounded bg-muted px-1">proxies: []</code>
        必须留空、<code className="mx-1 rounded bg-muted px-1">proxy-groups</code>
        保留 select / url-test / fallback 三类策略组骨架（当前显示名为「自动选择」「故障转移」，名称可直接改）；
        系统每次响应 GetLinks 时按「落地出口」页里已上架的声明注入节点与引用，
        并替换 <code className="rounded bg-muted px-1">ANYTLS_PASSWORD</code> 与{' '}
        <code className="rounded bg-muted px-1">RELAY_HOST</code>。不需要在此手写 AnyTLS 节点，也不需要写真实密码。
      </p>
    </div>
  )
}
