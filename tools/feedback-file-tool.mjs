#!/usr/bin/env node
// Starland 文件接口工具 —— 按 api.md 实现的 feedback-files（用户侧公网接口）客户端与探测。
//
// 用途：联调文件服务、验证幂等、回归探测线上接口是否就绪（用户侧公网链路）。
// 约束（来自 api.md §3 / §5）：
//   - 上传头：Authorization: Bearer <access-token>、Idempotency-Key(UUID v4)、X-File-Size、X-File-SHA256(必填)
//   - 反馈图片：POST /api/v1/feedback-files，仅 JPEG/PNG/WebP，单张 <=10MiB，最长边 <=2048px
//   - 下载：GET /api/v1/feedback-files/{file_id}，需有效 access token 且 token.UserId == owner_uid
//   - 幂等作用域：用户ID + 资源类型 + Idempotency-Key
// 说明：api.md §6 的内部接口 GET /internal/feedback-files/{file_id} 仅供 Admin 服务经独立回环地址调用，
//       不通过公网 OpenResty；verify / claim 按当前迭代要求暂不实现。故本工具仅覆盖公网链路，
//       不实现任何内部接口（也不要用它去打 /internal/*）。
//
// 用法：
//   node feedback-file-tool.mjs smoke
//   node feedback-file-tool.mjs upload   --file a.jpg [--token JWT] [--idempotency UUID]
//   node feedback-file-tool.mjs download --file-id ID [--token JWT] [--out out.bin]
//
// 环境变量：FILE_API_BASE（默认 http://106.52.77.108，可改 https://...）

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import process from 'node:process'

const BASE_URL = (process.env.FILE_API_BASE || 'http://106.52.77.108').replace(/\/$/, '')
const UA = 'starland-file-tool/1.0'

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}
function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
function authHeader(token, scheme = 'Bearer') {
  return token ? `${scheme} ${token}` : ''
}

// ---- 对外 REST（C 端用户，带 access token）----

async function upload({ file, token, idempotency }) {
  const buf = readFileSync(file)
  const headers = {
    Authorization: authHeader(token),
    'Idempotency-Key': idempotency || randomUUID(),
    'X-File-Size': String(buf.length),
    'X-File-SHA256': sha256Hex(buf),
    'User-Agent': UA,
  }
  const form = new FormData()
  form.append('file', new Blob([buf]), file.split(/[\\/]/).pop())
  const res = await fetch(`${BASE_URL}/api/v1/feedback-files`, { method: 'POST', headers, body: form })
  return { status: res.status, body: safeJson(await res.text()) }
}

async function download({ fileId, token, out }) {
  const res = await fetch(`${BASE_URL}/api/v1/feedback-files/${fileId}`, {
    headers: { Authorization: authHeader(token), 'User-Agent': UA },
  })
  if (!res.ok) return { status: res.status, body: safeJson(await res.text()) }
  const buf = Buffer.from(await res.arrayBuffer())
  if (out) writeFileSync(out, buf)
  return { status: res.status, bytes: buf.length, savedTo: out }
}

// ---- 探测：公网接口是否就绪（无 token，期望 401 / 200）----

async function smoke() {
  const probes = [
    ['GET /health/live', 'GET', '/health/live', {}],
    [
      'POST /api/v1/feedback-files (no token)',
      'POST',
      '/api/v1/feedback-files',
      { headers: { 'Idempotency-Key': randomUUID(), 'X-File-Size': '0', 'X-File-SHA256': 'deadbeef' }, body: new FormData() },
    ],
    ['GET /api/v1/feedback-files/test (no token)', 'GET', '/api/v1/feedback-files/test', {}],
  ]
  for (const [name, method, path, init] of probes) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        ...init,
        headers: { 'User-Agent': UA, ...(init.headers || {}) },
      })
      console.log(`- ${name}: HTTP ${res.status}`)
    } catch (e) {
      console.log(`- ${name}: ERROR ${e.message}`)
    }
  }
}

// ---- CLI ----

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const args = Object.fromEntries(
    rest
      .filter((a) => a.startsWith('--'))
      .map((a) => [a.slice(2).split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : true]),
  )
  const flag = (k) => (typeof args[k] === 'string' ? args[k] : undefined)
  try {
    let result
    switch (cmd) {
      case 'smoke':
        result = await smoke()
        break
      case 'upload':
        result = await upload({
          file: flag('file'),
          token: flag('token'),
          idempotency: flag('idempotency'),
        })
        break
      case 'download':
        result = await download({ fileId: flag('file-id'), token: flag('token'), out: flag('out') })
        break
      default:
        console.log('Usage: node feedback-file-tool.mjs <smoke|upload|download> [options]')
        console.log('Examples:')
        console.log('  node feedback-file-tool.mjs smoke')
        console.log('  node feedback-file-tool.mjs upload --file a.jpg --token <JWT> [--idempotency <UUID>]')
        console.log('  node feedback-file-tool.mjs download --file-id <ID> --token <JWT> [--out out.bin]')
        process.exit(cmd ? 1 : 0)
    }
    if (result !== undefined) console.log(JSON.stringify(result, null, 2))
  } catch (e) {
    console.error('FAILED:', e.message)
    process.exit(1)
  }
}
main()
