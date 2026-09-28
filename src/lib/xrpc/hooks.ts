// 轻量数据获取 hooks（自研，无 TanStack Query 等额外依赖）。
// 支持并发取消：组件卸载或参数变化会 abort 旧请求；错误归一为 XrpcError。

import { useCallback, useEffect, useState } from 'react'
import { adminCall } from './transport'
import { AdminContract, AdminMethod } from './admin-contract'
import { XrpcError } from './types'

export interface QueryState<T> {
  data: T | null
  loading: boolean
  error: XrpcError | null
}

export function useXrpcQuery<K extends AdminMethod>(
  method: K,
  params: AdminContract[K]['req'],
  deps: unknown[] = [],
) {
  const [state, setState] = useState<QueryState<AdminContract[K]['res']>>({
    data: null,
    loading: true,
    error: null,
  })
  const [tick, setTick] = useState(0)
  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    adminCall(method, params, { signal: ctrl.signal })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((e: XrpcError) => {
        if (e.code === -2) return // 取消/卸载，忽略
        setState({ data: null, loading: false, error: e })
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, tick, ...deps])

  return { ...state, refetch }
}

export function useXrpcMutation<K extends AdminMethod>(method: K) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<XrpcError | null>(null)

  const mutateAsync = useCallback(
    async (params: AdminContract[K]['req']) => {
      setLoading(true)
      setError(null)
      try {
        return await adminCall(method, params)
      } catch (e) {
        const err = e as XrpcError
        setError(err)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [method],
  )

  const mutate = useCallback(
    (params: AdminContract[K]['req'], onDone?: (d: AdminContract[K]['res']) => void, onError?: (e: XrpcError) => void) => {
      mutateAsync(params)
        .then((d) => onDone?.(d))
        .catch((e: XrpcError) => onError?.(e))
    },
    [mutateAsync],
  )

  return { mutate, mutateAsync, loading, error }
}
