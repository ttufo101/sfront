// 代理配置 YAML 校验（语法层 + 结构预校验）。
// 语法：用 js-yaml 解析，合法 YAML 返回 ok；语法错误返回可读错误信息（含行列）。
// 结构：后端 UpdateProxyConfig 要求至少 1 个 AnyTLS 节点，且所有 AnyTLS 节点密码必须为占位符
//       ANYTLS_PASSWORD（下发时由 Starcore 替换为当前用户固定密码，禁止写入真实/静态共享密码）。
//       —— 这些规则服务端会硬校验，此处仅做前端预校验以减少往返；类型字符串按 /anytls/i 宽松匹配。

import yaml from 'js-yaml'

export interface ValidationResult {
  ok: boolean
  errors: string[] // 阻塞保存
  warnings: string[] // 非阻塞提示（如未检测到 AnyTLS 节点，可能因配置结构不同）
}

const PLACEHOLDER = 'ANYTLS_PASSWORD'

/** 校验 proxy.yaml 文本：语法合法性 + AnyTLS 密码占位符结构。空内容视为错误。 */
export function validateProxyConfig(text: string): ValidationResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, errors: ['配置内容不能为空'], warnings: [] }
  }
  let doc: unknown
  try {
    // load（非 loadAll/safeLoad）：允许任意合法 YAML 文档（映射/数组/标量均可）
    doc = yaml.load(trimmed)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, errors: [message], warnings: [] }
  }

  const errors: string[] = []
  const warnings: string[] = []

  // 结构预校验：遍历 proxies，检查 AnyTLS 节点密码占位符
  const proxies =
    doc && typeof doc === 'object' && Array.isArray((doc as { proxies?: unknown }).proxies)
      ? ((doc as { proxies: unknown[] }).proxies as Record<string, unknown>[])
      : []
  if (Array.isArray(proxies)) {
    const anytlsNodes = proxies.filter(
      (p) => p && typeof p === 'object' && /anytls/i.test(String(p.type ?? '')),
    )
    if (anytlsNodes.length === 0) {
      warnings.push(
        '未检测到 AnyTLS 类型节点（type 含 anytls）。后端要求至少存在 1 个 AnyTLS 节点，请确认配置结构与节点类型名称。',
      )
    } else {
      for (const p of anytlsNodes) {
        const name = String(p.name ?? p.tag ?? '未命名')
        if (p.password !== PLACEHOLDER) {
          errors.push(
            `AnyTLS 节点「${name}」的密码必须为占位符 ${PLACEHOLDER}，禁止写入真实密码或静态共享密码（下发时由系统替换为当前用户固定密码）。`,
          )
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}
