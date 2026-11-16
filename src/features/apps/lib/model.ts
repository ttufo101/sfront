// 应用发布中心展示常量与提交前校验。
// 路径与命令由后端按 service_type 白名单推导，前端只展示、不提交（release-center.md §13）。
// 节点身份由各应用自读 /etc/starland/node-identity，发布中心不签发、不探测、不合成。

import type { DeployMode } from '@/lib/xrpc/deployer-contract'

export const SERVICE_TYPE_LABEL: Record<string, string> = {
  relay: '中转 relay',
  landing: '落地 landing',
}

/** 后端按 service_type 推导的应用目录名（前端只读展示，绝不提交路径）。 */
export const APP_DIR_BY_TYPE: Record<string, string> = {
  relay: 'mihomo',
  landing: 'hysteria',
}

/** 本机身份文件：跨应用、0600 root、由应用自读，发布中心永不写入或覆盖。 */
export const NODE_IDENTITY_PATH = '/etc/starland/node-identity'

/** 统一生命周期命令：所有 service_type 同一形态，接口固定 start|stop|restart|status。 */
export function lifecycleScript(appDir: string): string {
  return `script:/opt/${appDir}/setup.sh`
}

export const MODE_LABEL: Record<string, string> = {
  install: '部署',
  upgrade: '升级',
  rollback: '回滚',
}

export const MODE_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'warning'> = {
  install: 'default',
  upgrade: 'secondary',
  rollback: 'warning',
}

export const DEPLOY_STATUS_LABEL: Record<string, string> = {
  healthy: '正常',
  failed: '失败',
}

export const TASK_STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '进行中',
  succeeded: '成功',
  failed: '失败',
  skipped: '无需变更',
}

export const BATCH_STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '进行中',
  succeeded: '已完成',
  partial: '部分失败',
  failed: '失败',
  canceled: '已取消',
}

// 唯一实现在契约层，此处 re-export 保持页面原有 import 路径不变（features -> lib 方向合法）。
export { isBatchTerminal } from '@/lib/xrpc/deployer-contract'

export function taskTone(status: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'destructive'
  if (status === 'running' || status === 'queued') return 'warning'
  return 'secondary'
}

/** vN -> N；无版本（未安装）视为 0。 */
export function versionNo(label: string | undefined | null): number {
  if (!label) return 0
  const m = /^v(\d+)$/.exec(label.trim())
  return m ? Number(m[1]) : 0
}

export type Verdict = '无需变更 · 自动跳过' | '硬阻断' | '跨版本降级 · 需确认' | '正常执行'

export interface TargetRow {
  nodeId: string
  ip: string
  name: string
  current: string
  diff: number
  verdict: Verdict
  tone: 'green' | 'gray' | 'red' | 'orange'
  reason: string
}

export interface TargetEvaluation {
  rows: TargetRow[]
  blocked: string
  executable: number
  hasCrossVersion: boolean
}

export interface TargetNode {
  nodeId: string
  ip: string
  name: string
  current: string
}

/**
 * 提交前逐节点校验，与后端 StartDeploy 的判定保持同口径：
 * - rollback 目标高于当前 = 升级，硬阻断整批；
 * - upgrade 目标不高于当前 = 旧版请走回滚，硬阻断整批；
 * - 目标等于当前 = 跳过（全跳过则后端直接拒绝）；
 * - install 不做版本比较（首次安装 / 重复部署由界面标注）；
 * - 回滚跨版本降级只做软警告，不阻断。
 */
export function evaluateTargets(
  mode: DeployMode,
  target: string,
  nodes: TargetNode[],
): TargetEvaluation {
  const targetNo = versionNo(target)
  const rows: TargetRow[] = nodes.map((n) => {
    const cur = n.current || ''
    const diff = targetNo - versionNo(cur)
    let verdict: Verdict = '正常执行'
    let tone: TargetRow['tone'] = 'green'
    let reason = ''
    if (mode === 'rollback' && diff > 0) {
      verdict = '硬阻断'
      tone = 'red'
      reason = `目标 ${target} 高于 ${n.ip} 当前 ${cur || '未安装'}：这是升级，请走升级入口`
    } else if (mode === 'upgrade' && diff <= 0) {
      verdict = '硬阻断'
      tone = 'red'
      reason = `升级目标必须高于 ${n.ip} 当前 ${cur || '未安装'}；旧版请走回滚入口`
    } else if (diff === 0 && mode !== 'install') {
      verdict = '无需变更 · 自动跳过'
      tone = 'gray'
      reason = '已在目标版本，不会下发变更'
    } else if (mode === 'rollback' && Math.abs(diff) > 1) {
      verdict = '跨版本降级 · 需确认'
      tone = 'orange'
      reason = `从 ${cur} 一次降到 ${target}，请确认中间版本无依赖`
    }
    return { nodeId: n.nodeId, ip: n.ip, name: n.name, current: cur, diff, verdict, tone, reason }
  })
  const blocked = rows.find((r) => r.tone === 'red')?.reason ?? ''
  const executable = rows.filter((r) => r.tone !== 'red' && r.tone !== 'gray').length
  return {
    rows,
    blocked,
    executable,
    hasCrossVersion: rows.some((r) => r.tone === 'orange'),
  }
}

export function formatShortTime(v: string | undefined): string {
  if (!v) return '-'
  // 后端用 DATE_FORMAT 返回 'YYYY-MM-DD HH:mm:ss'，直接展示；ISO 也做兜底。
  return v.replace('T', ' ').slice(0, 19)
}

export function shortSha(v: string | undefined): string {
  if (!v) return '-'
  return v.length <= 14 ? v : `${v.slice(0, 8)}…${v.slice(-4)}`
}

