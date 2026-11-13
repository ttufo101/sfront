// 与后端 service 校验规则严格对齐：
// - 规则：`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$`（至少两段，每段字母开头，仅字母/数字/下划线）
// - trim 首尾空白；单条 ≤255 字符；总数（去重后）≤100；重复项去除并保留首次出现顺序。
// 前端先校验，服务端仍会兜底校验。

export const ANDROID_PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/
export const MAX_RECOMMENDED_PACKAGES = 100
export const MAX_RECOMMENDED_PACKAGE_LENGTH = 255

export interface PackageValidation {
  ok: boolean
  errors: string[]
  /** 规范化后的列表（trim + 去重 + 保序），保存时提交此结果 */
  normalized: string[]
  /** 每项对应的错误提示（与输入行一一对应，去重/空行不计） */
  rowErrors: (string | null)[]
}

export function validateRecommendedPackages(rows: string[]): PackageValidation {
  const errors: string[] = []
  const rowErrors: (string | null)[] = rows.map(() => null)
  const normalized: string[] = []
  const seen = new Set<string>()

  rows.forEach((raw, i) => {
    const pkg = raw.trim()
    if (pkg === '') {
      rowErrors[i] = '不能为空'
      return
    }
    if (pkg.length > MAX_RECOMMENDED_PACKAGE_LENGTH) {
      rowErrors[i] = `超过 ${MAX_RECOMMENDED_PACKAGE_LENGTH} 字符`
      return
    }
    if (!ANDROID_PACKAGE_PATTERN.test(pkg)) {
      rowErrors[i] = '格式无效：需至少两段、每段字母开头，仅含字母/数字/下划线'
      return
    }
    if (seen.has(pkg)) {
      rowErrors[i] = '重复（保存时会自动去重）'
      return
    }
    seen.add(pkg)
    normalized.push(pkg)
  })

  if (normalized.length > MAX_RECOMMENDED_PACKAGES) {
    errors.push(`包名数量不能超过 ${MAX_RECOMMENDED_PACKAGES} 个`)
  }
  // 逐行错误汇总为一条总体提示
  const invalidRows = rowErrors.filter((e) => e && e !== '重复（保存时会自动去重）')
  if (invalidRows.length > 0 && errors.length === 0) {
    errors.push(`有 ${invalidRows.length} 行格式不合法，请按提示修正`)
  }

  return {
    ok: errors.length === 0 && rowErrors.every((e) => e === null || e.startsWith('重复')),
    errors,
    normalized,
    rowErrors,
  }
}
