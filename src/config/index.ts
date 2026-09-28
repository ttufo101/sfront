interface AppConfig {
  /** 后端网关基址，留空表示同源（由网关把 /startlandapi 反代到后端） */
  apiBase: string
  /** 文件服务基址（APK/日志上传与下载，独立 REST 服务，协议不同于网关） */
  fileApiBase: string
  /** 应用版本号，写入 xrpc 信封 com.app_ver */
  appVersion: string
  /** 设备类型，管理后台固定 pc */
  devType: string
  /** 后台管理调用路径（统一网关） */
  adminEndpoint: string
}

const env = import.meta.env

export const config: AppConfig = {
  apiBase: (env.VITE_API_BASE ?? '').replace(/\/$/, ''),
  // 文件服务地址（用户给定）：106.52.77.108:80，路径前缀 /api/v1
  fileApiBase: (env.VITE_FILE_API_BASE ?? '').replace(/\/$/, ''),
  appVersion: env.VITE_APP_VERSION ?? 'v0.1.0',
  devType: env.VITE_DEV_TYPE ?? 'pc',
  // 用户决策：统一网关由 /tools/adminapi 改为 /startlandapi
  adminEndpoint: '/startlandapi',
}
