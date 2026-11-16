// 带外纳管弹窗：展示「一键预置公钥」命令 → 粘贴结构化回执 → 人工核对主机指纹 → 固化并纯公钥重连验证。
// 安全要点：命令内只有公钥；不做 TOFU，指纹必须经带外可信渠道核对并由管理员再次输入；
// 整个过程不收集、不传输、不保存任何节点密码。

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Loader2, ShieldCheck } from 'lucide-react'
import { XrpcError } from '@/lib/xrpc/types'
import type { GetBootstrapCommandResponse, NodeAsset } from '@/lib/xrpc/deployer-contract'
import { confirmBootstrap, getBootstrapCommand } from '../api/assets'
import { copyText } from '../lib/clipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

export function BootstrapDialog({
  node,
  onClose,
  onConfirmed,
}: {
  node: NodeAsset | null
  onClose: () => void
  onConfirmed: () => void
}) {
  const [cmd, setCmd] = useState<GetBootstrapCommandResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState('')
  const [confirmedFp, setConfirmedFp] = useState('')
  const [checked, setChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ connected: boolean; message: string } | null>(null)

  useEffect(() => {
    if (!node) return
    let cancelled = false
    setCmd(null)
    setReceipt('')
    setConfirmedFp('')
    setChecked(false)
    setResult(null)
    setLoadError(null)
    setLoading(true)
    getBootstrapCommand({ node_id: node.node_id })
      .then((res) => {
        if (!cancelled) setCmd(res)
      })
      .catch((e: XrpcError) => {
        if (!cancelled) setLoadError(e.message || '生成纳管命令失败（请确认 deployer 密钥已导入）')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [node])

  const parsed = useMemo(() => {
    const parts = receipt.trim().split('|')
    const prefix = cmd?.receipt_prefix || 'STARLAND_RECEIPT'
    const ok = parts.length === 3 && parts[0] === prefix && parts[2].trim().startsWith('SHA256:')
    return {
      ok,
      hostname: parts.length === 3 ? parts[1] : '',
      fingerprint: parts.length === 3 ? parts[2].trim() : '',
      prefix,
    }
  }, [receipt, cmd])

  const confirm = async () => {
    if (!node) return
    if (!parsed.ok) {
      toast.error('回执格式不正确，应形如 STARLAND_RECEIPT|hostname|SHA256:...')
      return
    }
    if (!checked) {
      toast.error('请先勾选已通过带外渠道核对指纹')
      return
    }
    if (confirmedFp.trim() !== parsed.fingerprint) {
      toast.error('输入的指纹与回执不一致，请重新核对')
      return
    }
    setSubmitting(true)
    try {
      const res = await confirmBootstrap({
        node_id: node.node_id,
        receipt: receipt.trim(),
        confirmed_fingerprint: confirmedFp.trim(),
      })
      setResult({ connected: res.connected, message: res.message })
      if (res.connected) toast.success('纳管完成：纯公钥连接验证通过')
      else toast.error(`指纹已固定，但连接验证失败：${res.message}`)
      onConfirmed()
    } catch (e) {
      toast.error((e as XrpcError).message || '确认纳管失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!node} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>公钥纳管 · {node?.node_id}</DialogTitle>
          <DialogDescription>
            由管理员通过已有带外通道在目标节点上执行下面的命令，再把回执贴回此处核对指纹。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在生成一键命令…
            </div>
          )}
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}

          {cmd && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>① 在节点 {node?.ssh_user}@{node?.ssh_host}:{node?.ssh_port} 上执行</Label>
                  <Button variant="outline" size="sm" onClick={() => void copyText(cmd.command)}>
                    <Copy className="h-4 w-4" />
                    复制命令
                  </Button>
                </div>
                <Textarea readOnly rows={6} className="font-mono text-xs" value={cmd.command} />
                <p className="text-xs text-muted-foreground">
                  命令幂等，仅向 ~/.ssh/authorized_keys 追加 deployer 公钥并输出回执，不含任何私钥或密码，也不会修改 sshd 配置。
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>② 粘贴命令输出的结构化回执</Label>
                  <span className="font-mono text-xs text-muted-foreground">{parsed.prefix}|hostname|SHA256:...</span>
                </div>
                <Textarea
                  rows={2}
                  className="font-mono text-xs"
                  value={receipt}
                  onChange={(e) => setReceipt(e.target.value)}
                  placeholder="STARLAND_RECEIPT|relay-hk-01|SHA256:xxxxxxxx"
                />
              </div>

              {receipt.trim() && (
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4" />
                    ③ 人工核对主机公钥指纹
                  </div>
                  {parsed.ok ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">回执主机名：</span>
                        <span className="font-mono">{parsed.hostname}</span>
                        <span className="ml-2 text-muted-foreground">主机指纹：</span>
                        <span className="break-all font-mono">{parsed.fingerprint}</span>
                        <Badge variant="success">格式有效</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        请通过独立可信渠道（云控制台 / 首次登录时记录）核对该指纹，确认不是中间人冒充。系统不会自动信任首次见到的指纹。
                      </p>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={checked}
                          onChange={(e) => setChecked(e.target.checked)}
                        />
                        我已通过带外渠道核对上述指纹
                      </label>
                      <div className="space-y-1.5">
                        <Label>手动重新输入指纹以确认 *</Label>
                        <Input
                          className="font-mono text-xs"
                          value={confirmedFp}
                          onChange={(e) => setConfirmedFp(e.target.value)}
                          placeholder="SHA256:..."
                        />
                      </div>
                      <Button onClick={() => void confirm()} disabled={submitting || !checked || !confirmedFp.trim()}>
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        确认并验证连接
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-destructive">
                      回执无效：需为 3 段、前缀为 {parsed.prefix}、且第 3 段是以 SHA256: 开头的主机公钥指纹。
                    </p>
                  )}
                </div>
              )}

              {result && (
                <div className="rounded-lg border p-3 text-sm">
                  <Badge variant={result.connected ? 'success' : 'destructive'}>
                    {result.connected ? '连接验证通过' : '连接验证失败'}
                  </Badge>
                  <p className="mt-2 break-all text-xs text-muted-foreground">{result.message}</p>
                  {!result.connected && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      指纹已固定。请确认公钥已写入正确用户的 authorized_keys、sshd 允许公钥认证，再用「测试连接」复查。
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
