/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_USE_MOCK?: string
  readonly VITE_APP_VERSION?: string
  readonly VITE_DEV_TYPE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
