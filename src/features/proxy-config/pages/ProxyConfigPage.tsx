import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useXrpcQuery, useXrpcMutation } from '@/lib/xrpc/hooks'
import { validateProxyConfig } from '../lib/validateProxyConfig'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

export function ProxyConfigPage() {
  const { data, loading, error, refetch } = useXrpcQuery('GetProxyConfig', {})
  const updateMut = useXrpcMutation('UpdateProxyConfig')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (data) {
      setContent(data.content)
      setDirty(false)
    }
  }, [data])

  // 语法校验（内容变化即重算，配置体量小，无需 debounce）
  const validation = useMemo(() => validateProxyConfig(content), [content])
  const hasSyntaxError = !validation.ok

  const save = async () => {
    // 兜底再校验一次，防止极端时序下带病保存
    const check = validateProxyConfig(content)
    if (!check.ok) {
      toast.error(`YAML 语法错误，未保存：${check.errors[0]}`)
      return
    }
    try {
      await updateMut.mutateAsync({ content })
      setDirty(false)
      toast.success('代理配置已保存')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="代理节点配置"
        description="编辑完整 proxy.yaml 文本并下发到所有节点"
        actions={
          <>
            {dirty && !hasSyntaxError && <Badge variant="warning">未保存</Badge>}
            {hasSyntaxError && <Badge variant="destructive">YAML 语法错误</Badge>}
            <Button variant="outline" onClick={() => refetch()}>
              重新加载
            </Button>
            <Button onClick={save} disabled={!dirty || hasSyntaxError || updateMut.loading}>
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
          <p className="mb-1 font-medium">YAML 语法错误（保存已禁用）：</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {validation.errors.map((err, i) => (
              <li key={i} className="break-all">
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        说明：此处内容为代理配置文件全文（明文，非 base64）。前端已做 YAML
        语法校验，保存前请确认无误，下发后会影响全部节点。
      </p>
    </div>
  )
}
