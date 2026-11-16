// 本机身份说明页（只读）：身份机制已整体外置，见 release-center.md §13.4。
// 本页不调用任何 RPC、不探测节点、不签发身份 —— 那套机制已退役。
// 保留页面的原因是身份文件成为 fail-closed 单点后，运维需要一个明确的排障入口。

import { APP_DIR_BY_TYPE, NODE_IDENTITY_PATH, SERVICE_TYPE_LABEL } from '../lib/model'

const POINTS = [
  {
    title: '谁写入',
    body: '节点纳管流程（裸机最先发生）经已有 ed25519 SSH 通道写入，所有节点写同一份文件；此时机器上还没有安装任何应用，也没有 conf/config.yaml。',
  },
  {
    title: '谁读取',
    body: '应用进程启动时自读并覆盖内存配置。身份文件不属于任何应用目录，因此发布中心覆盖二进制与 conf/config.yaml 时永远碰不到它。',
  },
  {
    title: '凭据内容',
    body: 'node_id 沿用台账现有随机值（不用 host key 指纹——指纹是公开哈希，只能做名字）；node_password 由纳管 ConfirmBootstrap 首次确认时在内存生成 32B 随机值、bcrypt 入库，明文只经 SSH 写入本机文件，绝不回显或落库；gateway_url 取自 deployer.gateway_url 单值配置，配置缺失即拒绝签发，按节点覆盖仍是 P2。',
  },
  {
    title: '失败即关闭',
    body: '文件缺失、格式错、权限不是 0600 时应用拒绝启动，日志只写原因不写值。恢复路径是重新纳管，不是「初始化节点身份」。',
  },
  {
    title: '发布中心边界',
    body: '不签发、不探测、不合成、不覆盖、不回显任何凭据；install / upgrade / rollback 走完全同一条路径，无 service_type 分流。',
  },
]

export function NodeIdentityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">本机身份</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          节点身份由纳管流程写入本机、由应用自读，发布中心不参与。本页只说明约定与排障路径。
        </p>
      </div>

      <div className="rounded-md border p-5 text-sm">
        <div className="font-medium">身份文件</div>
        <div className="mt-2 break-all font-mono text-xs">{NODE_IDENTITY_PATH}</div>
        <div className="mt-1 text-xs text-muted-foreground">0600 root · YAML · 跨应用共用 · 不进版本、不进数据库、不进日志</div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {POINTS.map((p) => (
          <div key={p.title} className="rounded-md border p-4">
            <div className="text-sm font-medium">{p.title}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </div>

      <div className="rounded-md border p-5 text-sm">
        <div className="font-medium">统一应用布局（后端按 service_type 推导）</div>
        <div className="mt-3 space-y-1 font-mono text-xs">
          {Object.entries(APP_DIR_BY_TYPE).map(([type, dir]) => (
            <div key={type} className="flex flex-wrap gap-x-3">
              <span className="w-24 shrink-0 text-muted-foreground">{SERVICE_TYPE_LABEL[type] ?? type}</span>
              <span className="break-all">/opt/{dir}/{'{'}{dir}, conf/config.yaml, setup.sh{'}'}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          conf/ 下除 config.yaml 外的一切、log/、pid、证书都属于本机状态。发布中心只覆盖可执行程序与纯业务模板两个文件。
        </p>
      </div>

      <div className="rounded-md border border-warning/40 bg-warning/5 p-4 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">排障：</span>
        应用重启后心跳 401 或进程反复退出，先确认 {NODE_IDENTITY_PATH} 存在且权限为 0600；
        机器重装或文件误删时重新纳管即可。轮换 node_password 后必须同步更新文件并重启应用，
        否则在线节点会立即失效。切勿把身份内容写进 conf/config.yaml —— 该文件会被发布批次覆盖。
      </div>
    </div>
  )
}
