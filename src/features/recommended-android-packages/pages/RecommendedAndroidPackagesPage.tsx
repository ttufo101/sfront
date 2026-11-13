// Android 应用访问控制（VPN 排除）推荐包名配置页（/recommended-android-packages）。
// 读取 / 整体替换一份包名列表；与客户端读接口共用同一份 DB 配置，保存后客户端即时生效。
// 顺序即客户端下发顺序；前端校验规则与后端一致（见 validateRecommendedPackages）。

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Plus, Smartphone, Trash2 } from 'lucide-react'
import { useXrpcQuery, useXrpcMutation } from '@/lib/xrpc/hooks'
import {
  getRecommendedAndroidPackagesConfig,
  updateRecommendedAndroidPackagesConfig,
} from '../api/recommendedAndroidPackages'
import {
  MAX_RECOMMENDED_PACKAGES,
  validateRecommendedPackages,
} from '../lib/validateRecommendedPackages'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export function RecommendedAndroidPackagesPage() {
  const { data, loading, error, refetch } = useXrpcQuery('GetRecommendedAndroidPackagesConfig', {})
  const updateMut = useXrpcMutation('UpdateRecommendedAndroidPackagesConfig')

  const [rows, setRows] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pasteText, setPasteText] = useState('')

  useEffect(() => {
    if (data) {
      setRows(Array.isArray(data.packages) ? [...data.packages] : [])
      setDirty(false)
    }
  }, [data])

  const validation = useMemo(() => validateRecommendedPackages(rows), [rows])
  const hasError = !validation.ok

  const setRowsDirty = (next: string[]) => {
    setRows(next)
    setDirty(true)
  }

  const updateRow = (i: number, value: string) =>
    setRowsDirty(rows.map((r, idx) => (idx === i ? value : r)))
  const removeRow = (i: number) => setRowsDirty(rows.filter((_, idx) => idx !== i))
  const addRow = () => setRowsDirty([...rows, ''])
  const moveRow = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    setRowsDirty(next)
  }

  // 批量粘贴：按换行/逗号/分号/空白切分，追加到列表末尾
  const addPasted = () => {
    const items = pasteText
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s !== '')
    if (items.length === 0) {
      toast.error('没有可添加的包名')
      return
    }
    setRowsDirty([...rows, ...items])
    setPasteText('')
    toast.success(`已追加 ${items.length} 项`)
  }

  const save = async () => {
    const check = validateRecommendedPackages(rows)
    if (!check.ok) {
      toast.error(`校验未通过：${check.errors[0] ?? '请检查包名格式'}`)
      return
    }
    setSaving(true)
    try {
      await updateRecommendedAndroidPackagesConfig({ packages: check.normalized })
      setDirty(false)
      toast.success('推荐包名配置已保存，客户端即时生效')
      // 重新拉取，确保本地与服务端规范化结果（trim/去重）一致
      await refetch()
    } catch (e) {
      toast.error((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Android VPN 排除应用"
        description="配置安卓端排除在 VPN 之外的推荐应用包名。客户端通过认证接口读取本列表，顺序即下发顺序。"
        actions={
          <>
            {dirty && !hasError && <Badge variant="warning">未保存</Badge>}
            {hasError && <Badge variant="destructive">校验未通过</Badge>}
            <Button variant="outline" onClick={() => refetch()} disabled={loading || saving}>
              重新加载
            </Button>
            <Button onClick={save} disabled={!dirty || hasError || saving || loading}>
              保存
            </Button>
          </>
        }
      />

      {loading ? (
        <Skeleton className="h-[360px] w-full" />
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 p-6 text-sm text-destructive">
          {error.message}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <Smartphone className="h-4 w-4 shrink-0" />
            <span>
              当前共 {validation.normalized.length} 个有效包名（上限 {MAX_RECOMMENDED_PACKAGES}）。
              保存时会自动去除首尾空白与重复项；清空列表表示不向客户端下发任何推荐排除项。
            </span>
          </div>

          {rows.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              暂无配置，点击下方「添加包名」或用批量粘贴开始维护。
            </div>
          )}

          <div className="space-y-2">
            {rows.map((row, i) => {
              const rowErr = validation.rowErrors[i]
              const isDup = rowErr?.startsWith('重复')
              return (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-2 w-6 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                  <div className="flex-1 space-y-1">
                    <Input
                      value={row}
                      onChange={(e) => updateRow(i, e.target.value)}
                      placeholder="如 com.android.chrome"
                      spellCheck={false}
                      className={rowErr && !isDup ? 'border-destructive' : ''}
                    />
                    {rowErr && (
                      <p className={`text-xs ${isDup ? 'text-amber-600' : 'text-destructive'}`}>{rowErr}</p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => moveRow(i, -1)} disabled={i === 0} title="上移">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1} title="下移">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeRow(i)} title="删除">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={addRow} disabled={rows.length >= MAX_RECOMMENDED_PACKAGES}>
              <Plus className="h-4 w-4" />
              添加包名
            </Button>
          </div>

          <div className="rounded-lg border p-4 space-y-2">
            <div className="text-sm font-medium">批量粘贴</div>
            <p className="text-xs text-muted-foreground">
              一次粘贴多个包名，用换行、逗号、分号或空格分隔，追加到列表末尾。
            </p>
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'com.android.chrome\ncom.google.android.youtube\norg.telegram.messenger'}
              spellCheck={false}
              className="h-24 font-mono text-xs"
            />
            <Button variant="outline" size="sm" onClick={addPasted} disabled={!pasteText.trim()}>
              解析并追加
            </Button>
          </div>

          {validation.errors.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <p className="mb-1 font-medium">校验未通过（保存已禁用）：</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {validation.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            说明：包名需符合 Android 应用 ID 规则（至少两段、每段字母开头，仅含字母/数字/下划线，如
            <code className="mx-1 rounded bg-muted px-1">com.google.android.youtube</code>）。
            配置整体替换，无并发版本保护；本页由管理员单人维护。
          </p>
        </div>
      )}
    </div>
  )
}
