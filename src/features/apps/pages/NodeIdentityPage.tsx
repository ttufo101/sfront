// 本机身份说明页（只读）：身份机制已整体外置，见 release-center.md §13.4。
// 本页不调用任何 RPC、不探测节点、不签发身份 —— 那套机制已退役。
// 保留页面的原因是身份文件成为 fail-closed 单点后，运维需要一个明确的排障入口。

import { NODE_IDENTITY_PATH } from '../lib/model'

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
    body: '对节点身份不签发、不探测、不合成、不覆盖、不回显任何凭据；install / upgrade / rollback 走完全同一条路径，无 service_type 分流。',
  },
  {
    title: '证书不是身份',
    body: 'TLS 证书对（conf/server.crt 与 conf/server.key）是应用级可选资产，由发布中心在部署时按 sha256 校验后下发；身份文件 /etc/starland/node-identity 仍由纳管写入且发布中心永不触碰，两者不要混放。',
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
        <div className="font-medium">统一应用布局（按应用 key 推导）</div>
        <div className="mt-3 space-y-1 font-mono text-xs">
          <div className="break-all">/opt/&lt;app_key&gt;/{'{'}&lt;app_key&gt;, conf/config.yaml, conf/server.crt, conf/server.key, setup.sh{'}'}</div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          部署时发布中心写入可执行程序、纯业务模板，并按应用定义渲染出该应用专属的 setup.sh（0755）。
          脚本模板由 deployer 内置，启动命令在创建应用时填写、随时可改。TLS 证书对是应用级可选资产，配了才由
          worker 下发到 conf/server.crt（0644）与 conf/server.key（0600）并在每次部署覆盖；没配就不碰本机文件。
          conf/ 下其它文件、log/、pid 仍属于本机状态。
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
