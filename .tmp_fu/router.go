package server

import (
	"log/slog"

	"github.com/gin-gonic/gin"

	"fileupload/internal/auth"
	"fileupload/internal/handler"
	appmiddleware "fileupload/internal/middleware"
	"fileupload/internal/service"
)

func NewRouter(fileService *service.FileService, verifier auth.Verifier, allowInsecureAuth bool, maxLogFileSize, maxReleaseFileSize, maxFeedbackFileSize int64, logger *slog.Logger) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(
		appmiddleware.RequestID(),
		appmiddleware.Logger(logger),
		appmiddleware.Recovery(logger),
	)

	logs := handler.NewFileHandler(fileService, service.LogUploadPolicy(maxLogFileSize), logger)
	releases := handler.NewFileHandler(fileService, service.AppReleaseUploadPolicy(maxReleaseFileSize), logger)
	feedback := handler.NewFileHandler(fileService, service.FeedbackUploadPolicy(maxFeedbackFileSize), logger)
	health := handler.NewHealthHandler(fileService)

	router.GET("/health/live", health.Live)
	router.GET("/health/ready", health.Ready)

	authenticate := appmiddleware.AccessToken(verifier)
	if allowInsecureAuth {
		// 绕过仅由配置层允许在开发环境启用，生产环境必须始终执行真实验签。
		authenticate = appmiddleware.DevelopmentPrincipal()
	}
	api := router.Group("/api/v1")
	users := api.Group("", authenticate)
	users.POST("/log-files", appmiddleware.RequirePermission("logs:upload"), logs.Upload)
	users.GET("/log-files/:file_id", appmiddleware.RequirePermission("logs:download"), logs.Download)
	users.POST("/feedback-files", appmiddleware.RequirePermission("feedback-files:upload"), feedback.Upload)
	users.GET("/feedback-files/:file_id", appmiddleware.RequirePermission("feedback-files:download"), feedback.Download)
	users.POST("/app-releases", appmiddleware.RequirePermission("app-releases:upload"), releases.Upload)
	// 客户端升级可能发生在未登录或 Token 已过期时，安装包下载必须保持公开。
	api.GET("/app-releases/:file_id", releases.Download)
	return router
}

func NewInternalRouter(fileService *service.FileService, maxLogFileSize, maxFeedbackFileSize int64, logger *slog.Logger) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(appmiddleware.RequestID(), appmiddleware.Logger(logger), appmiddleware.Recovery(logger))
	logs := handler.NewFileHandler(fileService, service.LogUploadPolicy(maxLogFileSize), logger)
	feedback := handler.NewFileHandler(fileService, service.FeedbackUploadPolicy(maxFeedbackFileSize), logger)
	// 当前迭代按约定暂不校验服务凭据；配置层强制该监听地址只能绑定回环接口。
	internal := router.Group("/internal")
	internal.GET("/log-files/:file_id", logs.InternalDownload)
	internal.GET("/feedback-files/:file_id", feedback.InternalDownload)
	return router
}
