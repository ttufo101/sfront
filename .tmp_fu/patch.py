import re, sys

ok = True

def edit(path, replacements):
    global ok
    with open(path, 'r', encoding='utf-8') as f:
        c = f.read()
    for name, (old, new, is_re) in replacements.items():
        before = c
        if is_re:
            c, n = re.subn(old, new, c, count=1)
            applied = (n == 1)
        else:
            cnt = c.count(old)
            if cnt != 1:
                print("FAIL %s [%s]: expected 1 occurrence, found %d" % (path, name, cnt))
                ok = False
                continue
            c = c.replace(old, new, 1)
            applied = (c != before)
        if not applied:
            print("FAIL %s [%s]: no change applied" % (path, name))
            ok = False
        else:
            print("OK   %s [%s]" % (path, name))
    with open(path, 'w', encoding='utf-8') as f:
        f.write(c)

base = "/root/fileupload"

# ---- config.go ----
edit(base + "/internal/config/config.go", {
    "struct": (r'(\n\tShutdownTimeout\s+time\.Duration\n)', r'\1\tServiceToken          string\n', True),
    "load": ('\tif cfg.ShutdownTimeout, err = durationEnv("SHUTDOWN_TIMEOUT", cfg.ShutdownTimeout); err != nil {\n\t\treturn Config{}, err\n\t}\n\n\tif cfg.AllowInsecureAuth',
             '\tif cfg.ShutdownTimeout, err = durationEnv("SHUTDOWN_TIMEOUT", cfg.ShutdownTimeout); err != nil {\n\t\treturn Config{}, err\n\t}\n\tcfg.ServiceToken = env("SERVICE_TOKEN", "")\n\n\tif cfg.AllowInsecureAuth', False),
})

# ---- handler/file.go ----
edit(base + "/internal/handler/file.go", {
    "import": (r'(\t"context"\n)', r'\1\t"crypto/subtle"\n', True),
    "struct": (r'(\n\t\tlogger\s+\*slog\.Logger\n)', r'\1\t\tserviceToken       string\n\t\tallowServiceBypass bool\n', True),
    "newfh_sig": ('func NewFileHandler(fileService *service.FileService, policy service.UploadPolicy, logger *slog.Logger) *FileHandler {',
                  'func NewFileHandler(fileService *service.FileService, policy service.UploadPolicy, logger *slog.Logger, serviceToken string, allowServiceBypass bool) *FileHandler {', False),
    "newfh_ret": ('\treturn &FileHandler{service: fileService, policy: policy, logger: logger}',
                  '\treturn &FileHandler{service: fileService, policy: policy, logger: logger, serviceToken: serviceToken, allowServiceBypass: allowServiceBypass}', False),
    "download": ('\tif ownerRestricted {\n\t\tprincipal, ok := appmiddleware.PrincipalFrom(c)\n\t\tif !ok || service.OwnerUID(info) != principal.UserID {\n\t\t\t// 不区分不存在与跨用户访问，避免利用 file_id 枚举其他用户文件。\n\t\t\twriteError(c, h.logger, apperror.New(http.StatusNotFound, "FILE_NOT_FOUND", "file not found"))\n\t\t\treturn\n\t\t}\n\t}',
                  '\tif ownerRestricted && !h.serviceTokenBypassesOwner(c) {\n\t\tprincipal, ok := appmiddleware.PrincipalFrom(c)\n\t\tif !ok || service.OwnerUID(info) != principal.UserID {\n\t\t\t// 不区分不存在与跨用户访问，避免利用 file_id 枚举其他用户文件。\n\t\t\twriteError(c, h.logger, apperror.New(http.StatusNotFound, "FILE_NOT_FOUND", "file not found"))\n\t\t\treturn\n\t\t}\n\t}', False),
    "method": ('func setObjectHeaders(c *gin.Context, size int64, contentType, etag string, modified time.Time, filename string) {',
               '// serviceTokenBypassesOwner 仅在 handler 显式开启（目前仅反馈图片）且请求携带与服务端一致的\n// SERVICE_TOKEN（X-Service-Token 头）时返回 true，允许跨 owner 读取。日志与安装包下载的 handler\n// 未开启该开关，因此仍保持 owner 隔离，避免权限扩大。\nfunc (h *FileHandler) serviceTokenBypassesOwner(c *gin.Context) bool {\n\tif !h.allowServiceBypass || h.serviceToken == "" {\n\t\treturn false\n\t}\n\tprovided := c.GetHeader("X-Service-Token")\n\tif provided == "" {\n\t\treturn false\n\t}\n\treturn subtle.ConstantTimeCompare([]byte(provided), []byte(h.serviceToken)) == 1\n}\n\nfunc setObjectHeaders(c *gin.Context, size int64, contentType, etag string, modified time.Time, filename string) {', False),
})

# ---- server/router.go ----
edit(base + "/internal/server/router.go", {
    "sig": ('func NewRouter(fileService *service.FileService, verifier auth.Verifier, allowInsecureAuth bool, maxLogFileSize, maxReleaseFileSize, maxFeedbackFileSize int64, logger *slog.Logger) *gin.Engine {',
            'func NewRouter(fileService *service.FileService, verifier auth.Verifier, allowInsecureAuth bool, maxLogFileSize, maxReleaseFileSize, maxFeedbackFileSize int64, serviceToken string, logger *slog.Logger) *gin.Engine {', False),
    "handlers": ('\tlogs := handler.NewFileHandler(fileService, service.LogUploadPolicy(maxLogFileSize), logger)\n\treleases := handler.NewFileHandler(fileService, service.AppReleaseUploadPolicy(maxReleaseFileSize), logger)\n\tfeedback := handler.NewFileHandler(fileService, service.FeedbackUploadPolicy(maxFeedbackFileSize), logger)',
                 '\tlogs := handler.NewFileHandler(fileService, service.LogUploadPolicy(maxLogFileSize), logger, "", false)\n\treleases := handler.NewFileHandler(fileService, service.AppReleaseUploadPolicy(maxReleaseFileSize), logger, "", false)\n\tfeedback := handler.NewFileHandler(fileService, service.FeedbackUploadPolicy(maxFeedbackFileSize), logger, serviceToken, true)', False),
    "internal_handlers": ('\tlogs := handler.NewFileHandler(fileService, service.LogUploadPolicy(maxLogFileSize), logger)\n\tfeedback := handler.NewFileHandler(fileService, service.FeedbackUploadPolicy(maxFeedbackFileSize), logger)\n\t// 当前迭代按约定暂不校验服务凭据；配置层强制该监听地址只能绑定回环接口。',
                          '\tlogs := handler.NewFileHandler(fileService, service.LogUploadPolicy(maxLogFileSize), logger, "", false)\n\tfeedback := handler.NewFileHandler(fileService, service.FeedbackUploadPolicy(maxFeedbackFileSize), logger, "", false)\n\t// 当前迭代按约定暂不校验服务凭据；配置层强制该监听地址只能绑定回环接口。', False),
})

# ---- cmd/server/main.go ----
edit(base + "/cmd/server/main.go", {
    "call": ('\t\tHandler:           server.NewRouter(fileService, tokenVerifier, cfg.AllowInsecureAuth, cfg.MaxLogFileSize, cfg.MaxReleaseFileSize, cfg.MaxFeedbackFileSize, logger),',
             '\t\tHandler:           server.NewRouter(fileService, tokenVerifier, cfg.AllowInsecureAuth, cfg.MaxLogFileSize, cfg.MaxReleaseFileSize, cfg.MaxFeedbackFileSize, cfg.ServiceToken, logger),', False),
})

print("DONE" if ok else "HAD_FAILURES")
sys.exit(0 if ok else 1)
