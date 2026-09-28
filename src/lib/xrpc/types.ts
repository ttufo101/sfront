// xrpc 信封与错误类型。前端只引用冻结契约里的 module/method，不直接拼 URL。

export interface XrpcCom {
  dev_id: string
  dev_type: string
  app_ver: string
  os_ver: string
  jwt_token: string
  uid?: string
}

export interface XrpcReq {
  module: string
  method: string
  params: Record<string, unknown>
}

export interface XrpcEnvelope {
  com: XrpcCom
  req: XrpcReq
}

export interface XrpcResponseEnvelope<T = unknown> {
  code: number
  msg: string
  data: T
}

export type XrpcErrorKind = 'business' | 'network' | 'timeout' | 'cancel' | 'shape'

export class XrpcError extends Error {
  code: number
  kind: XrpcErrorKind
  constructor(code: number, msg: string, kind: XrpcErrorKind = 'business') {
    super(msg)
    this.name = 'XrpcError'
    this.code = code
    this.kind = kind
  }
}
