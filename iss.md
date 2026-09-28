# Starland 管理后台 — 生产部署配置记录

> 记录日期：2026-09-22
> 范围：前端构建/部署、openresty、admin、fileupload、MinIO 的当前线上配置与链路。

## 1. 机器拓扑

| 主机别名 | IP | 跑的服务 |
| --- | --- | --- |
| develop-hy | 47.120.10.73 | 网关 :12001 / login :8010 / admin :8050 / MySQL(starlandbd) :3136 |
| develop-tg | 106.52.77.108 | 文件服务 fileupload :8080（openresty 前置 :80）/ MinIO :9000（bucket=fileupload） |

- admin 仅内网可达：网关路由 `starland.admin.com → 127.0.0.1:8050`；网关对外 `0.0.0.0:12001` 接收 `/startlandapi`。
- 文件服务与 MinIO 在 develop-tg；下载链路已改为 openresty 直连 MinIO，不再经过 fileupload 服务。

## 2. 前端构建与部署

- 构建：`VITE_API_BASE` **置空** → 前端走相对路径 `/startlandapi`，由 openresty 反代到网关（避免生产跨域）。
- `VITE_USE_MOCK=false`（mock 已清理，不再走浏览器端假数据）。
- 产物 `dist` 部署到 develop-tg：`/opt/starland-admin-web`。
- 前端访问入口：`http://106.52.77.108/`（80 端口，暂无证书）。
- 修复记录（此前）：
  - `PublishAppVersion` 补齐 `file_name` / `package_size_bytes` / `package_sha256` / `package_type` 四字段。
  - `ListAppVersions` 的 `include_disabled` 修正为 `include_history`。
  - 下载地址列改用 `getAppReleaseDownloadUrl(file_id)`（http 地址），绕过 admin 强写 `https://106.52.77.108` 的 `update_url`（443 未开，前端无法用）。

## 3. openresty（develop-tg，/usr/local/openresty/nginx/conf/nginx.conf）

- 站点根：`root /opt/starland-admin-web;`
- SPA fallback：`location / { try_files $uri $uri/ /index.html; }`
- 网关代理（替代 Vite dev proxy，避免 CORS）：
  ```nginx
  location = /startlandapi  { proxy_pass http://47.120.10.73:12001; }
  location /startlandapi/   { proxy_pass http://47.120.10.73:12001; }
  ```
- 下载直连 MinIO（对象 key = `app-releases/{file_id}`）：
  ```nginx
  location ^~ /api/v1/app-releases/ { proxy_pass http://127.0.0.1:9000/fileupload/app-releases/; }
  ```
- 日志上传/下载（代理到 fileupload，需用户 token）：
  ```nginx
  location = /api/v1/log-files {                                          # POST 上传
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Authorization $http_authorization;
  }
  location ^~ /api/v1/log-files/ {                                        # GET 下载
    limit_except GET { deny all; }                                        # HEAD 已被禁用
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Authorization $http_authorization;
  }
  ```
- 监听 80；443 暂未开（无证书）。

## 4. admin（develop-hy，/opt/admin/conf/config.yaml）

- `app_release.public_base_url = https://106.52.77.108`（admin 强制要求 HTTPS origin，填 http 会启动失败；443 待证书就绪后开启）。

## 5. fileupload（develop-tg，/root/fileupload）

当前路由（全部在 `/api/v1` 鉴权组内，需 access token）：

```text
POST /log-files           (logs:upload)
GET  /log-files/:file_id  (logs:download)
POST /app-releases        (app-releases:upload)
```

- 已清理：`app-releases` 的 `GET/HEAD` 下载路由（下载改为 openresty 直连 MinIO）。
- 已清理（2026-09-22）：日志的 `HEAD /log-files/:file_id` 路由及其 `handler/file.go` 的 `Head` 方法已删除并重编译重启。依据 api.md §5、feedback.proto、token.md——Feedback 不再回查文件服务、也不校验日志存在性，HEAD 无调用方。验证：直连 `HEAD /api/v1/log-files/{id}` 返回 404。
- 重编译产物：`/opt/fileupload/bin/fileupload`，`systemctl restart fileupload`。

## 6. MinIO（develop-tg :9000，bucket=fileupload）

- bucket policy：`app-releases/*` 前缀匿名 `s3:GetObject`（供 openresty 直连下载）；`logs/` 前缀保持私有。
- object key：`app-releases/{file_id}`。
- 凭据：admin / Liu*2024（仅服务端使用，前端不接触）。

## 7. 最终链路

下载（安装包）：
```text
浏览器 → openresty /api/v1/app-releases/{file_id}
       → MinIO 127.0.0.1:9000/fileupload/app-releases/{file_id}（匿名读，不经过 fileupload）
```

下载（诊断日志）：
```text
浏览器 → openresty ^~ /api/v1/log-files/ (limit_except GET; Authorization 透传)
       → fileupload 127.0.0.1:8080/api/v1/log-files/{file_id}（需用户 token，走鉴权组）
```
注：日志下载**不经 MinIO**，仍由 fileupload 鉴权返回（logs/ 前缀保持私有）。openresty 仅代理 GET，HEAD 已被 `limit_except` 拒绝（返回 404）。文件上传 `POST /api/v1/log-files` 由精确 location `= /api/v1/log-files` 代理。

发布（两段独立）：
```text
① 上传：浏览器 → openresty /api/v1/app-releases (POST, 带用户 token) → fileupload → MinIO
② 登记：浏览器 → openresty /startlandapi → 网关 → admin.PublishAppVersion
```

## 8. 已知事项 / 待办

- 发布白名单仅 `ygliu_csdn@163.com`（token.md），非白名单账号发布会被后端拒绝，前端不可控。
- admin `update_url` 仍写 `https://106.52.77.108/...`（443 未开）；前端已改用 http 的 `getAppReleaseDownloadUrl` 展示，二者一致可用。
- 443 / HTTPS：待证书就绪后开启，并同步把 admin `public_base_url`、前端下载地址切到 https。
- 腾讯云安全组需放通 develop-tg 的 80 入站，外部才能访问前端。
- `HEAD /log-files/:file_id` 清理已完成（router.go 路由 + file.go Head 方法删除，重编译重启，openresty 增加日志下载 location 并 reload）。
- HTTP 非安全上下文兼容：前端 `uuidV4()` 与 `computeSha256()` 均已加纯 JS 回退，避免 `crypto.randomUUID` / `crypto.subtle` 在 HTTP 部署下不可用。登录页 `crypto.randomUUID is not a function` 已修复；版本发布上传在 HTTP 下也能计算 SHA-256。长期仍建议启用 HTTPS。文件位置：`src/lib/utils.ts`、`src/lib/xrpc/transport.ts`、`src/lib/upload/sha256.ts`。
