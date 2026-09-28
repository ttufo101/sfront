// 代理配置 YAML 语法校验（仅语法层，按需求不做结构校验）。
// 用 js-yaml 解析：合法 YAML 返回 ok；语法错误返回可读错误信息（含行列）。

import yaml from 'js-yaml'

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

/** 校验 proxy.yaml 文本是否为合法 YAML。空内容视为错误。 */
export function validateProxyConfig(text: string): ValidationResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, errors: ['配置内容不能为空'] }
  }
  try {
    // load（非 loadAll/safeLoad）：允许任意合法 YAML 文档（映射/数组/标量均可）
    yaml.load(trimmed)
    return { ok: true, errors: [] }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, errors: [message] }
  }
}
