// 上传辅助：计算 SHA-256（文件服务要求必填 64 位十六进制）。
// 优先用 Web Crypto（快），在 HTTP 等非安全上下文回退到纯 JS 实现。

import { uuidV4 } from '@/lib/utils'

export { uuidV4 }

/** 计算文件的 SHA-256，返回 64 位小写十六进制字符串。 */
export async function computeSha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const subtle = (globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', buf)
    return toHex(digest)
  }
  // 非安全上下文（如 HTTP）crypto.subtle 不可用，回退到纯 JS
  return toHex(sha256Fallback(buf))
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

/** 纯 JS SHA-256（RFC 6234），用于非安全上下文。 */
function sha256Fallback(data: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(data)
  const bitLen = BigInt(bytes.length) * 8n

  // Padding: 0x80 + zeros + 64-bit bit length
  const padStart = bytes.length + 1
  const padLen = (64 - ((padStart + 8) % 64)) % 64
  const totalLen = padStart + padLen + 8
  const msg = new Uint8Array(totalLen)
  msg.set(bytes)
  msg[bytes.length] = 0x80
  const view = new DataView(msg.buffer)
  view.setUint32(totalLen - 8, Number(bitLen >> 32n), false)
  view.setUint32(totalLen - 4, Number(bitLen & 0xffffffffn), false)

  // Initial hash values
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])

  // Round constants
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ])

  for (let i = 0; i < totalLen; i += 64) {
    const w = new Uint32Array(64)
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(i + t * 4, false)
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0
    }

    let a = H[0], b = H[1], c = H[2], d = H[3]
    let e = H[4], f = H[5], g = H[6], h = H[7]

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0

      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    H[0] = (H[0] + a) >>> 0
    H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0
    H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0
    H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0
    H[7] = (H[7] + h) >>> 0
  }

  const out = new ArrayBuffer(32)
  const outView = new DataView(out)
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, H[i], false)
  }
  return out
}
