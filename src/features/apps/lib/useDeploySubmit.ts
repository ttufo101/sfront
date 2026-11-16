// 统一处理 StartDeploy 的两段式提交：
// - 后端返回 confirm_required → 弹漂移确认，人工确认后带 confirm_drift 二次提交（不做强乐观锁）；
// - 后端返回 blocked_reasons → 整批未创建，逐条展示原因；
// - 成功返回 batch_id → 跳转任务页轮询。

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { startDeploy } from '../api/apps'
import type { StartDeployRequest } from '@/lib/xrpc/deployer-contract'
import { XrpcError } from '@/lib/xrpc/types'

export function useDeploySubmit(onDone: (batchId: string) => void) {
  const [submitting, setSubmitting] = useState(false)
  const [drift, setDrift] = useState<{ nodes: string[]; pending: StartDeployRequest } | null>(null)
  const [blocked, setBlocked] = useState<string[] | null>(null)

  const run = useCallback(
    async (params: StartDeployRequest) => {
      setSubmitting(true)
      setBlocked(null)
      try {
        const res = await startDeploy(params)
        if (res.confirm_required) {
          setDrift({ nodes: res.drifted_nodes ?? [], pending: params })
          return
        }
        if (res.blocked_reasons?.length) {
          setBlocked(res.blocked_reasons)
          return
        }
        if (!res.success || !res.batch_id) {
          toast.error(res.message || '批次提交失败')
          return
        }
        setDrift(null)
        toast.success(`批次 ${res.batch_id} 已提交`)
        onDone(res.batch_id)
      } catch (e) {
        toast.error(e instanceof XrpcError ? `提交失败：${e.message}` : '提交失败，请重试')
      } finally {
        setSubmitting(false)
      }
    },
    [onDone],
  )

  const confirmDrift = useCallback(() => {
    if (!drift) return
    void run({ ...drift.pending, confirm_drift: true })
  }, [drift, run])

  const cancelDrift = useCallback(() => setDrift(null), [])

  return {
    submit: run,
    submitting,
    drift,
    confirmDrift,
    cancelDrift,
    blocked,
    clearBlocked: () => setBlocked(null),
  }
}
