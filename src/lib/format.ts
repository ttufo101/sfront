// 数值/时间格式化工具。注意：proto 的 int64/uint64 在线上为十进制字符串，
// 这里统一接收 string | number 并安全转换，避免 JS 精度丢失。

export function toNumberSafe(v: string | number | undefined | null): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function formatTimestamp(sec: string | number | undefined | null): string {
  const n = toNumberSafe(sec)
  if (!n) return '-'
  const d = new Date(n * 1000)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatBytes(bytes: string | number | undefined | null): string {
  const n = toNumberSafe(bytes)
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function formatPrice(amount: string | number | undefined | null, currency = 'CNY'): string {
  const n = toNumberSafe(amount)
  const sym = currency === 'CNY' ? '¥' : `${currency} `
  return `${sym}${(n / 100).toFixed(2)}`
}
