// 剪贴板复制：优先使用浏览器 Clipboard API；非安全上下文（HTTP）失败时提示手动复制。

import { toast } from 'sonner'

export async function copyText(text: string): Promise<void> {
  if (!text) {
    toast.error('没有可复制的内容')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制到剪贴板')
  } catch {
    toast.error('浏览器拒绝了剪贴板访问，请手动选中文本复制')
  }
}
