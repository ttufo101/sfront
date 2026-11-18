// 客户端「基础模板」校验：只管 YAML 语法与骨架结构。
// 出口（proxies[]）与策略组引用由 proxyrender 每次渲染注入，因此基础模板里
// proxies 应为空、不再要求 AnyTLS 节点，也不再强校验 ANYTLS_PASSWORD / RELAY_HOST 占位符。

import yaml from 'js-yaml'

export interface ValidationResult {
  ok: boolean
  errors: string[] // 阻塞保存
  warnings: string[] // 非阻塞提示
}

/** 校验基础模板：合法 YAML 映射 + proxies 序列（可空）+ proxy-groups 骨架。 */
export function validateProxyConfig(text: string): ValidationResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, errors: ['配置内容不能为空'], warnings: [] }
  }
  let doc: unknown
  try {
    doc = yaml.load(trimmed)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, errors: [message], warnings: [] }
  }
  const errors: string[] = []
  const warnings: string[] = []
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: ['配置根节点必须是 YAML 映射'], warnings: [] }
  }
  const root = doc as Record<string, unknown>
  if (!Array.isArray(root.proxies)) {
    errors.push('基础模板必须包含 proxies 序列（留空写 proxies: []，由系统每次渲染注入）')
  } else if (root.proxies.length > 0) {
    warnings.push('proxies 应留空：出口由落地出口声明生成，模板里手写的节点会被覆盖。')
  }
  if (!Array.isArray(root['proxy-groups']) || root['proxy-groups'].length === 0) {
    errors.push('基础模板必须包含 proxy-groups 骨架（select / url-test / fallback 三类策略组）')
  } else {
    // 只校验骨架「类型」，不校验分组「名字」：显示名是订阅数据、可由运营改成任意语言，
    // 硬编码名字会让多语言模板误报。proxyrender 也是按类型无关的 YAML 结构保形注入。
    const groups = root['proxy-groups'] as Record<string, unknown>[]
    const names = groups.map((g) => String(g?.name ?? ''))
    const types = groups.map((g) => String(g?.type ?? ''))
    for (const [type, label] of [
      ['select', '手动选择'],
      ['url-test', '自动选择（延迟优先）'],
      ['fallback', '故障转移'],
    ]) {
      if (!types.includes(type)) {
        warnings.push(`缺少 ${type} 类型策略组（${label}），客户端可能没有对应分组。`)
      }
    }
    const seen = new Set<string>()
    for (const name of names) {
      if (!name) {
        warnings.push('存在未命名策略组，客户端可能无法解析。')
      } else if (seen.has(name)) {
        warnings.push(`策略组名称「${name}」重复，Clash 要求 name 唯一。`)
      }
      seen.add(name)
    }
    // 基础模板里的静态引用应当指向另一个策略组或内置目标；出口名由渲染器注入，不写在模板里。
    const builtin = new Set(['DIRECT', 'REJECT', 'PASS', 'REJECT-DROP'])
    for (const group of groups) {
      const refs = Array.isArray(group?.proxies) ? (group.proxies as unknown[]).map(String) : []
      for (const ref of refs) {
        if (ref && !builtin.has(ref) && !seen.has(ref)) {
          warnings.push(`策略组「${String(group?.name ?? '')}」引用了未定义的分组「${ref}」。`)
        }
      }
    }
  }
  if (!('rules' in root)) {
    warnings.push('未检测到 rules 段，客户端可能没有分流规则。')
  }
  return { ok: errors.length === 0, errors, warnings }
}
