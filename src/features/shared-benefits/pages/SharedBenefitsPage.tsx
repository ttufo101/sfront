// 套餐共享权益配置页（/shared-benefits）：维护所有套餐共享的连接性能（带宽/设备数）与覆盖权益（地区→地点）。
// 整体替换 + 乐观锁 expected_revision。保存套餐时 admin 读取此配置写入套餐快照。
// 注意：这与「网络覆盖」（仅地区→地点展示名）是两套不同配置，请勿混淆。

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useXrpcQuery, useXrpcMutation } from '@/lib/xrpc/hooks'
import { XrpcError } from '@/lib/xrpc/types'
import {
  SharedPlanBenefitRegion,
  SharedPlanBenefitLocation,
} from '@/lib/xrpc/admin-contract'
import {
  getSharedPlanBenefitsConfig,
  updateSharedPlanBenefitsConfig,
} from '../api/benefits'
import { formatTimestamp, toNumberSafe } from '@/lib/format'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const MAX_REGIONS = 20
const MAX_LOCATIONS = 50

type BenefitErrors = string[]

function validate(
  speed_limit_mbps: number,
  max_devices: number,
  regions: SharedPlanBenefitRegion[],
): BenefitErrors {
  const errors: BenefitErrors = []
  if (!Number.isFinite(speed_limit_mbps) || speed_limit_mbps < 0)
    errors.push('全局带宽必须为非负整数（0 表示不限速）')
  if (!Number.isFinite(max_devices) || max_devices < 0)
    errors.push('全局设备数必须为非负整数')

  if (regions.length > MAX_REGIONS) errors.push(`地区数量不能超过 ${MAX_REGIONS} 个`)
  const regionCodes = new Set<string>()
  for (const r of regions) {
    const rLabel = r.display_name || r.code || '未命名地区'
    if (!r.code) errors.push(`地区 code 不能为空（${rLabel}）`)
    else if (regionCodes.has(r.code)) errors.push(`地区 code「${r.code}」重复`)
    regionCodes.add(r.code)
    if (!r.display_name) errors.push(`地区「${rLabel}」名称不能为空`)

    if (r.locations.length === 0) errors.push(`地区「${rLabel}」至少需要 1 个地点`)
    if (r.locations.length > MAX_LOCATIONS)
      errors.push(`地区「${rLabel}」地点数量不能超过 ${MAX_LOCATIONS}`)

    const locCodes = new Set<string>()
    for (const l of r.locations) {
      const lLabel = l.display_name || l.code || '未命名地点'
      if (!l.code) errors.push(`地点 code 不能为空（${rLabel} / ${lLabel}）`)
      else if (locCodes.has(l.code)) errors.push(`地点 code「${l.code}」在地区「${rLabel}」中重复`)
      locCodes.add(l.code)
      if (!l.display_name) errors.push(`地点「${lLabel}」名称不能为空（${rLabel}）`)
      if (!Number.isFinite(l.connection_point_count) || l.connection_point_count < 0)
        errors.push(`地点「${lLabel}」连接点数量必须为非负整数（${rLabel}）`)
    }
  }
  return errors
}

function cloneRegions(regions: SharedPlanBenefitRegion[]): SharedPlanBenefitRegion[] {
  return regions.map((r) => ({
    code: r.code,
    display_name: r.display_name,
    locations: r.locations.map((l: SharedPlanBenefitLocation) => ({
      code: l.code,
      display_name: l.display_name,
      connection_point_count: l.connection_point_count,
    })),
  }))
}

export function SharedBenefitsPage() {
  const { data, loading, error, refetch } = useXrpcQuery('GetSharedPlanBenefitsConfig', {})
  const updateMut = useXrpcMutation('UpdateSharedPlanBenefitsConfig')

  const [speedLimit, setSpeedLimit] = useState<number>(0)
  const [maxDevices, setMaxDevices] = useState<number>(0)
  const [regions, setRegions] = useState<SharedPlanBenefitRegion[]>([])
  const [revision, setRevision] = useState<string | number>(0)
  const [updatedAt, setUpdatedAt] = useState<string | number | undefined>(undefined)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) {
      setSpeedLimit(data.speed_limit_mbps)
      setMaxDevices(data.max_devices)
      setRegions(cloneRegions(data.regions ?? []))
      setRevision(data.revision)
      setUpdatedAt(data.updated_at)
      setDirty(false)
    }
  }, [data])

  const errors = useMemo(
    () => validate(speedLimit, maxDevices, regions),
    [speedLimit, maxDevices, regions],
  )
  const hasError = errors.length > 0

  const setRegionsDirty = (next: SharedPlanBenefitRegion[]) => {
    setRegions(next)
    setDirty(true)
  }
  const markDirty = () => setDirty(true)

  const updateRegion = (ri: number, patch: Partial<SharedPlanBenefitRegion>) =>
    setRegionsDirty(regions.map((r, i) => (i === ri ? { ...r, ...patch } : r)))
  const addRegion = () =>
    setRegionsDirty([...regions, { code: '', display_name: '', locations: [] }])
  const removeRegion = (ri: number) => setRegionsDirty(regions.filter((_, i) => i !== ri))

  const updateLocation = (
    ri: number,
    li: number,
    patch: Partial<SharedPlanBenefitLocation>,
  ) =>
    setRegionsDirty(
      regions.map((r, i) =>
        i === ri
          ? { ...r, locations: r.locations.map((l, j) => (j === li ? { ...l, ...patch } : l)) }
          : r,
      ),
    )
  const addLocation = (ri: number) =>
    setRegionsDirty(
      regions.map((r, i) =>
        i === ri
          ? { ...r, locations: [...r.locations, { code: '', display_name: '', connection_point_count: 0 }] }
          : r,
      ),
    )
  const removeLocation = (ri: number, li: number) =>
    setRegionsDirty(
      regions.map((r, i) =>
        i === ri ? { ...r, locations: r.locations.filter((_, j) => j !== li) } : r,
      ),
    )

  const save = async () => {
    const errs = validate(speedLimit, maxDevices, regions)
    if (errs.length) {
      toast.error(`校验未通过：${errs[0]}`)
      return
    }
    setSaving(true)
    try {
      const res = await updateSharedPlanBenefitsConfig({
        speed_limit_mbps: toNumberSafe(speedLimit),
        max_devices: toNumberSafe(maxDevices),
        regions,
        expected_revision: revision,
      })
      setRevision(res.revision)
      setUpdatedAt(res.updated_at)
      setDirty(false)
      toast.success('共享权益配置已保存')
    } catch (e) {
      const xe = e as XrpcError
      const msg = xe.message || '保存失败'
      // 乐观锁冲突：配置已被他人修改，重新加载最新版本后让用户重试
      if (/conflict|reload/i.test(msg) || xe.code === 409) {
        toast.error('配置已被他人修改，已重新加载最新版本，请重试保存')
        refetch()
      } else {
        toast.error(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="套餐共享权益配置"
        description="维护所有套餐共享的连接性能（带宽/设备数）与覆盖权益（地区→地点）。保存套餐时 admin 读取此配置写入套餐快照，确保所有套餐权益一致。"
        actions={
          <>
            {dirty && !hasError && <Badge variant="warning">未保存</Badge>}
            {hasError && <Badge variant="destructive">校验未通过</Badge>}
            <Button variant="outline" onClick={() => refetch()} disabled={loading}>
              重新加载
            </Button>
            <Button onClick={save} disabled={!dirty || hasError || saving || loading}>
              保存
            </Button>
          </>
        }
      />

      {loading ? (
        <Skeleton className="h-[420px] w-full" />
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 p-6 text-sm text-destructive">
          {error.message}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">
            当前修订号 revision：{String(revision)} ｜ 最近更新：{formatTimestamp(updatedAt)}
          </div>

          {/* 全局连接性能 */}
          <Card className="space-y-4 p-4">
            <div className="font-medium">全局连接性能（所有套餐共享）</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>带宽限制 (Mbps，0=不限速)</Label>
                <Input
                  type="number"
                  value={speedLimit}
                  onChange={(e) => { setSpeedLimit(toNumberSafe(e.target.value)); markDirty() }}
                />
              </div>
              <div className="space-y-2">
                <Label>最大设备数（台）</Label>
                <Input
                  type="number"
                  value={maxDevices}
                  onChange={(e) => { setMaxDevices(toNumberSafe(e.target.value)); markDirty() }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              此处的带宽与设备数会写入每个套餐的快照，覆盖套餐自身无法单独设置带宽/设备数。
            </p>
          </Card>

          {/* 覆盖权益：地区 → 地点 */}
          <div className="space-y-2">
            <div className="font-medium">覆盖权益（地区 → 地点）</div>
            {regions.length === 0 && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                暂无地区配置，点击下方「添加地区」开始维护。
              </div>
            )}
            {regions.map((region, ri) => (
              <Card key={ri} className="space-y-3 p-4">
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <Label>地区 Code</Label>
                    <Input
                      value={region.code}
                      onChange={(e) => updateRegion(ri, { code: e.target.value.trim() })}
                      placeholder="如 asia"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label>地区名称</Label>
                    <Input
                      value={region.display_name}
                      onChange={(e) => updateRegion(ri, { display_name: e.target.value })}
                      placeholder="如 亚洲"
                    />
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeRegion(ri)}>
                    删除地区
                  </Button>
                </div>

                <div className="space-y-2 border-l-2 border-muted pl-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">地点（{region.locations.length}）</Label>
                    <Button variant="outline" size="sm" onClick={() => addLocation(ri)} disabled={region.locations.length >= MAX_LOCATIONS}>
                      添加地点
                    </Button>
                  </div>
                  {region.locations.length === 0 && (
                    <p className="text-xs text-muted-foreground">该地区暂未配置地点（保存会校验失败）。</p>
                  )}
                  {region.locations.map((loc, li) => (
                    <div key={li} className="flex items-end gap-3">
                      <Input
                        className="flex-1"
                        value={loc.code}
                        onChange={(e) => updateLocation(ri, li, { code: e.target.value.trim() })}
                        placeholder="如 jp"
                      />
                      <Input
                        className="flex-1"
                        value={loc.display_name}
                        onChange={(e) => updateLocation(ri, li, { display_name: e.target.value })}
                        placeholder="如 日本"
                      />
                      <Input
                        className="w-28"
                        type="number"
                        value={loc.connection_point_count}
                        onChange={(e) =>
                          updateLocation(ri, li, { connection_point_count: toNumberSafe(e.target.value) })
                        }
                        placeholder="连接点"
                      />
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeLocation(ri, li)}>
                        删除
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
            <Button variant="outline" onClick={addRegion} disabled={regions.length >= MAX_REGIONS}>
              添加地区
            </Button>
          </div>
        </div>
      )}

      {hasError && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <p className="mb-1 font-medium">校验未通过（保存已禁用）：</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.map((err, i) => (
              <li key={i} className="break-all">
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        说明：配置整体替换，地区与地点顺序即 C 端展示顺序。保存时携带当前 revision 做乐观锁，若期间被他人修改会提示重新加载。
        地区最多 {MAX_REGIONS} 个，单地区地点最多 {MAX_LOCATIONS} 个；带宽 0 表示不限速。
      </p>
    </div>
  )
}
