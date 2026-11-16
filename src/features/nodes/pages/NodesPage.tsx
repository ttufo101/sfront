// 统一「节点管理」壳：/nodes?tab=relay|outlets|assets|history。
// 四个 tab 复用既有页面 + 新增出口/历史页，不再保留 /data-plane-nodes 与 /node-assets 两个独立菜单。
// 注意：React Router 只改 query 时不会重挂载组件，tab 必须用 useEffect 与 searchParams 同步，
// 否则通过浏览器前进/后退或直接改地址栏时，高亮与内容会不一致。

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DataPlaneNodesPage } from '@/features/data-plane-nodes/pages/DataPlaneNodesPage'
import { NodeAssetsPage } from '@/features/node-assets/pages/NodeAssetsPage'
import { ProxyOutletsPage } from './ProxyOutletsPage'
import { HistoryServersPage } from './HistoryServersPage'

type Tab = 'relay' | 'outlets' | 'assets' | 'history'

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'relay', label: '中转接入', hint: '心跳状态与下架接入' },
  { key: 'outlets', label: '落地出口', hint: '按机器上下架与归属绑定' },
  { key: 'assets', label: '服务器台账', hint: '公钥纳管、批量运维与删除' },
  { key: 'history', label: '历史服务器', hint: '已删除服务器只读留档' },
]

function isTab(v: string | null): v is Tab {
  return v === 'relay' || v === 'outlets' || v === 'assets' || v === 'history'
}

export function NodesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const v = searchParams.get('tab')
    return isTab(v) ? v : 'relay'
  })

  useEffect(() => {
    const v = searchParams.get('tab')
    setTab(isTab(v) ? v : 'relay')
  }, [searchParams])

  const switchTab = (next: Tab) => {
    setTab(next)
    setSearchParams({ tab: next })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
            className={
              tab === t.key
                ? 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                : 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground'
            }
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{TABS.find((t) => t.key === tab)?.hint}</span>
      </div>

      {/* 故障节点仍展示；只有人工下架才会让客户端列表不再出现对应节点/出口 */}
      {tab === 'relay' && <DataPlaneNodesPage />}
      {tab === 'outlets' && <ProxyOutletsPage />}
      {tab === 'assets' && <NodeAssetsPage />}
      {tab === 'history' && <HistoryServersPage />}
    </div>
  )
}
