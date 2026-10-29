package middleware

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"fileupload/internal/auth"
)

const RequestIDKey = "request_id"
const PrincipalKey = "principal"

func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" || len(requestID) > 128 {
			requestID = uuid.NewString()
		}
		c.Set(RequestIDKey, requestID)
		c.Header("X-Request-ID", requestID)
		c.Next()
	}
}

func Logger(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		c.Next()
		logger.Info("http request",
			"request_id", RequestIDFrom(c),
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"bytes", c.Writer.Size(),
			"duration_ms", time.Since(started).Milliseconds(),
		)
	}
}

func Recovery(logger *slog.Logger) gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered any) {
		logger.Error("panic recovered", "request_id", RequestIDFrom(c), "panic", recovered)
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
			"code":       "INTERNAL_ERROR",
			"message":    "internal server error",
			"request_id": RequestIDFrom(c),
		})
	})
}

func DevelopmentPrincipal() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(PrincipalKey, auth.Principal{UserID: "development"})
		c.Next()
	}
}

func AccessToken(verifier auth.Verifier) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 只接受唯一的 Authorization Bearer 头，不从 query、Cookie 或表单读取 Token。
		values := c.Request.Header.Values("Authorization")
		if len(values) == 0 {
			writeAuthError(c, "AUTH_TOKEN_MISSING", "access token is required")
			return
		}
		fields := strings.Fields(values[0])
		if len(values) != 1 || len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") || fields[1] == "" {
			writeAuthError(c, "AUTH_TOKEN_INVALID", "access token is invalid")
			return
		}

		principal, err := verifier.Verify(fields[1])
		if err != nil {
			if errors.Is(err, auth.ErrTokenExpired) {
				writeAuthError(c, "AUTH_TOKEN_EXPIRED", "access token is expired")
				return
			}
			writeAuthError(c, "AUTH_TOKEN_INVALID", "access token is invalid")
			return
		}
		c.Set(PrincipalKey, principal)
		c.Next()
	}
}

func PrincipalFrom(c *gin.Context) (auth.Principal, bool) {
	value, ok := c.Get(PrincipalKey)
	if !ok {
		return auth.Principal{}, false
	}
	principal, ok := value.(auth.Principal)
	return principal, ok && principal.UserID != ""
}

func writeAuthError(c *gin.Context, code, message string) {
	c.Header("WWW-Authenticate", "Bearer")
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
		"code":       code,
		"message":    message,
		"request_id": RequestIDFrom(c),
	})
}

func RequirePermission(permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Access Token 当前没有角色或 scope；这里只保留权限标识，管理员授权由可信入口控制。
		c.Set("required_permission", permission)
		c.Next()
	}
}

func RequestIDFrom(c *gin.Context) string {
	value, _ := c.Get(RequestIDKey)
	requestID, _ := value.(string)
	return requestID
}
