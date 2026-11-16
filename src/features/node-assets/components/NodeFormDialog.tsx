// 节点台账录入/编辑弹窗。
// 刻意零凭据字段：不收集密码、私钥或密钥文件；SSH 认证只用带外预置的 deployer 公钥。

import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { XrpcError } from '@/lib/xrpc/types'
import type { NodeAsset, NodeAssetInput } from '@/lib/xrpc/deployer-contract'
import { createNodeAsset, updateNodeAsset } from '../api/assets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface Draft {
  node_id: string
  node_type: string
  display_name: string
  region: string
  idc: string
  isp: string
  public_ip: string
  private_ip: string
  ssh_host: string
  ssh_port: string
  ssh_user: string
  remark: string
}

function emptyDraft(): Draft {
  return {
    node_id: '',
    node_type: 'relay',
    display_name: '',
    region: '',
    idc: '',
    isp: '',
    public_ip: '',
    private_ip: '',
    ssh_host: '',
    ssh_port: '22',
    ssh_user: 'root',
    remark: '',
  }
}

function draftFromNode(n: NodeAsset): Draft {
  return {
    node_id: n.node_id,
    node_type: n.node_type || 'relay',
    display_name: n.display_name ?? '',
    region: n.region ?? '',
    idc: n.idc ?? '',
    isp: n.isp ?? '',
    public_ip: n.public_ip ?? '',
    private_ip: n.private_ip ?? '',
    ssh_host: n.ssh_host ?? '',
    ssh_port: String(n.ssh_port || 22),
    ssh_user: n.ssh_user ?? '',
    remark: n.remark ?? '',
  }
}

const NODE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function NodeFormDialog({
  open,
  mode,
  node,
  onClose,
  onSaved,
}: {
  open: boolean
  mode: 'create' | 'edit'
  node: NodeAsset | null
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(mode === 'edit' && node ? draftFromNode(node) : emptyDraft())
  }, [open, mode, node])

  const set = (key: keyof Draft, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  const validate = (): string | null => {
    if (!NODE_ID_RE.test(draft.node_id.trim())) return '节点 ID 仅允许 1~64 位字母、数字、下划线或连字符'
    if (draft.node_type !== 'relay' && draft.node_type !== 'landing') return '请选择节点类型'
    if (!draft.ssh_host.trim()) return 'SSH 地址不能为空'
    if (!draft.ssh_user.trim()) return 'SSH 用户不能为空'
    const port = Number(draft.ssh_port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'SSH 端口须为 1~65535'
    return null
  }

  const save = async () => {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    const input: NodeAssetInput = {
      node_id: draft.node_id.trim(),
      node_type: draft.node_type,
      display_name: draft.display_name.trim(),
      region: draft.region.trim(),
      idc: draft.idc.trim(),
      isp: draft.isp.trim(),
      public_ip: draft.public_ip.trim(),
      private_ip: draft.private_ip.trim(),
      ssh_host: draft.ssh_host.trim(),
      ssh_port: Number(draft.ssh_port),
      ssh_user: draft.ssh_user.trim(),
      remark: draft.remark.trim(),
    }
    setSaving(true)
    try {
      if (mode === 'create') await createNodeAsset(input)
      else await updateNodeAsset(input)
      toast.success(mode === 'create' ? '节点已录入，请继续完成公钥纳管' : '节点信息已更新')
      onSaved()
      onClose()
    } catch (e) {
      toast.error((e as XrpcError).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[86vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '录入节点' : `编辑节点 · ${node?.node_id ?? ''}`}</DialogTitle>
          <DialogDescription>
            仅登记身份、位置与 SSH 连接参数。系统不保存任何密码或私钥，认证依赖节点上预置的 deployer 公钥。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 md:grid-cols-2">
          <Field label="节点 ID *">
            <Input
              value={draft.node_id}
              onChange={(e) => set('node_id', e.target.value)}
              placeholder="如 relay-hk-01"
              disabled={mode === 'edit'}
            />
          </Field>
          <Field label="节点类型 *">
            <Select value={draft.node_type} onValueChange={(v) => set('node_type', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="relay">中转节点（relay）</SelectItem>
                <SelectItem value="landing">落地节点（landing）</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="展示名称">
            <Input value={draft.display_name} onChange={(e) => set('display_name', e.target.value)} placeholder="便于识别的名称" />
          </Field>
          <Field label="地域">
            <Input value={draft.region} onChange={(e) => set('region', e.target.value)} placeholder="如 中国香港" />
          </Field>
          <Field label="机房">
            <Input value={draft.idc} onChange={(e) => set('idc', e.target.value)} placeholder="IDC / 可用区" />
          </Field>
          <Field label="运营商">
            <Input value={draft.isp} onChange={(e) => set('isp', e.target.value)} placeholder="如 CN2 / BGP" />
          </Field>
          <Field label="公网 IP">
            <Input value={draft.public_ip} onChange={(e) => set('public_ip', e.target.value)} placeholder="仅登记，不用于连接" />
          </Field>
          <Field label="内网 IP">
            <Input value={draft.private_ip} onChange={(e) => set('private_ip', e.target.value)} />
          </Field>
          <Field label="SSH 地址 *">
            <Input value={draft.ssh_host} onChange={(e) => set('ssh_host', e.target.value)} placeholder="IP 或域名" />
          </Field>
          <Field label="SSH 端口 *">
            <Input type="number" min={1} max={65535} value={draft.ssh_port} onChange={(e) => set('ssh_port', e.target.value)} />
          </Field>
          <Field label="SSH 用户 *">
            <Input value={draft.ssh_user} onChange={(e) => set('ssh_user', e.target.value)} placeholder="如 root" />
          </Field>
          <div className="md:col-span-2">
            <Field label="备注">
              <Textarea rows={2} value={draft.remark} onChange={(e) => set('remark', e.target.value)} placeholder="用途、变更窗口等说明" />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'create' ? '录入' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
