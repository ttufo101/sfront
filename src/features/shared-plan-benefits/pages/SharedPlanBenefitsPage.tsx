// 套餐共享权益配置页（/shared-plan-benefits）：读取并整体维护「连接性能 + 地区 → 地点」共享权益配置。
// 替代原网络覆盖配置页。整体替换 + 乐观锁 expected_revision。

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
} from '../api/sharedPlanBenefits'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

// 与后端 service/shared_plan_benefits.go 校验规则对齐
const COVERAGE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/
const MAX_DISPLAY_NAME = 32
const MAX_REGIONS = 20
const MAX_LOCATIONS = 50

function runeLen(s: string): number {
  return [...s].length
}

type BenefitErrors = string[]

function validateBenefits(
  speedLimitMbps: number,
  maxDevices: number,
  regions: SharedPlanBenefitRegion[],
): BenefitErrors {
  const errors: BenefitErrors = []
  if (!Number.isInteger(speedLimitMbps) || speedLimitMbps < 0) {
    errors.push('最高连接速度（Mbps）必须为非负整数')
  }
  if (!Number.isInteger(maxDevices) || maxDevices < 0) {
    errors.push('支持设备数必须为非负整数')
  }
  if (regions.length > MAX_REGIONS) {
    errors.push(`地区数量不能超过 ${MAX_REGIONS} 个`)
  }
  const regionCodes = new Set<string>()
  for (const r of regions) {
    const rLabel = r.display_name || r.code || '未命名地区'
    if (!r.code) errors.push(`地区 code 不能为空（${rLabel}）`)
    else if (!COVERAGE_CODE_PATTERN.test(r.code))
      errors.push(
        `地区 code「${r.code}」格式无效：需小写字母开头，仅含小写字母/数字/下划线，最长 32`,
      )
    else if (regionCodes.has(r.code)) errors.push(`地区 code「${r.code}」重复`)
    regionCodes.add(r.code)

    if (!r.display_name) errors.push(`地区「${rLabel}」名称不能为空`)
    else if (runeLen(r.display_name) > MAX_DISPLAY_NAME)
      errors.push(`地区「${rLabel}」名称不超过 ${MAX_DISPLAY_NAME} 字`)

    if (r.locations.length === 0) errors.push(`地区「${rLabel}」至少需要 1 个地点`)
    if (r.locations.length > MAX_LOCATIONS)
      errors.push(`地区「${rLabel}」地点数量不能超过 ${MAX_LOCATIONS}`)

    const locCodes = new Set<string>()
    for (const l of r.locations) {
      const lLabel = l.display_name || l.code || '未命名地点'
      if (!l.code) errors.push(`地点 code 不能为空（${rLabel} / ${lLabel}）`)
      else if (!COVERAGE_CODE_PATTERN.test(l.code))
        errors.push(`地点 code「${l.code}」格式无效（${rLabel}）`)
      else if (locCodes.has(l.code)) errors.push(`地点 code「${l.code}」在地区「${rLabel}」中重复`)
      locCodes.add(l.code)

      if (!l.display_name) errors.push(`地点「${lLabel}」名称不能为空（${rLabel}）`)
      else if (runeLen(l.display_name) > MAX_DISPLAY_NAME)
        errors.push(`地点「${lLabel}」名称不超过 ${MAX_DISPLAY_NAME} 字（${rLabel}）`)

      if (!Number.isInteger(l.connection_point_count) || l.connection_point_count < 0) {
        errors.push(`地点「${lLabel}」连接地点数量必须为非负整数（${rLabel}）`)
      }
    }
  }
  return errors
}

function fmtTs(v: string | number | undefined): string {
  if (v === undefined || v === null || v === '') return '-'
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n)) return '-'
  return new Date(n * 1000).toLocaleString('zh-CN', { hour12: false })
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

export function SharedPlanBenefitsPage() {
  // 直接走 hook 拉数据；保存时调用封装好的 API（含乐观锁）。
  const { data, loading, error, refetch } = useXrpcQuery('GetSharedPlanBenefitsConfig', {})
  const updateMut = useXrpcMutation('UpdateSharedPlanBenefitsConfig')

  const [speedLimitMbps, setSpeedLimitMbps] = useState<number>(0)
  const [maxDevices, setMaxDevices] = useState<number>(0)
  const [regions, setRegions] = useState<SharedPlanBenefitRegion[]>([])
  const [revision, setRevision] = useState<string | number>(0)
  const [updatedAt, setUpdatedAt] = useState<string | number | undefined>(undefined)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) {
      setSpeedLimitMbps(data.speed_limit_mbps ?? 0)
      setMaxDevices(data.max_devices ?? 0)
      setRegions(cloneRegions(data.regions ?? []))
      setRevision(data.revision)
      setUpdatedAt(data.updated_at)
      setDirty(false)
    }
  }, [data])

  const errors = useMemo(
    () => validateBenefits(speedLimitMbps, maxDevices, regions),
    [speedLimitMbps, maxDevices, regions],
  )
  const hasError = errors.length > 0

  const setRegionsDirty = (next: SharedPlanBenefitRegion[]) => {
    setRegions(next)
    setDirty(true)
  }

  const updateRegion = (ri: number, patch: Partial<SharedPlanBenefitRegion>) =>
    setRegionsDirty(regions.map((r, i) => (i === ri ? { ...r, ...patch } : r)))

  const addRegion = () =>
    setRegionsDirty([...regions, { code: '', display_name: '', locations: [] }])

  const removeRegion = (ri: number) =>
    setRegionsDirty(regions.filter((_, i) => i !== ri))

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
    const errs = validateBenefits(speedLimitMbps, maxDevices, regions)
    if (errs.length) {
      toast.error(`校验未通过：${errs[0]}`)
      return
    }
    setSaving(true)
    try {
      const res = await updateSharedPlanBenefitsConfig({
        speed_limit_mbps: speedLimitMbps,
        max_devices: maxDevices,
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
        description="维护所有套餐共享的连接性能（最高连接速度、支持设备数）与网络覆盖地区/地点。主标语/副标题等由客户端写死，此处不配置。"
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
            当前修订号 revision：{String(revision)} ｜ 最近更新：{fmtTs(updatedAt)}
          </div>

          {/* 连接性能 */}
          <Card className="space-y-3 p-4">
            <div className="text-sm font-medium">连接性能</div>
            <div className="flex flex-wrap gap-4">
              <div className="w-48 space-y-1">
                <Label>最高连接速度（Mbps）</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={speedLimitMbps}
                  onChange={(e) =>
                    setSpeedLimitMbps(e.target.value === '' ? 0 : Number(e.target.value))
                  }
                />
              </div>
              <div className="w-48 space-y-1">
                <Label>支持设备数（台）</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={maxDevices}
                  onChange={(e) =>
                    setMaxDevices(e.target.value === '' ? 0 : Number(e.target.value))
                  }
                />
              </div>
            </div>
          </Card>

          {regions.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              暂无地区配置，点击下方「添加地区」开始维护。
            </div>
          )}

          {regions.map((region, ri) => (
            <Card key={ri} className="space-y-3 p-4">
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-1">
                  <Label>地区 Code（小写字母开头，仅小写字母/数字/下划线）</Label>
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => removeRegion(ri)}
                >
                  删除地区
                </Button>
              </div>

              <div className="space-y-2 border-l-2 border-muted pl-4">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">地点（{region.locations.length}）</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addLocation(ri)}
                    disabled={region.locations.length >= MAX_LOCATIONS}
                  >
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
                      min={0}
                      step={1}
                      value={loc.connection_point_count}
                      onChange={(e) =>
                        updateLocation(ri, li, {
                          connection_point_count: e.target.value === '' ? 0 : Number(e.target.value),
                        })
                      }
                      placeholder="连接点数"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => removeLocation(ri, li)}
                    >
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
        说明：配置整体替换，顺序即 C 端展示顺序。保存时携带当前 revision 做乐观锁，若期间被他人修改会提示重新加载。
        code 规则：小写字母开头，后续仅小写字母/数字/下划线，最长 32；名称最长 32 字；地区最多 {MAX_REGIONS} 个，单地区地点最多 {MAX_LOCATIONS} 个；连接速度与设备数为非负整数。
      </p>
    </div>
  )
}
