package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"fileupload/internal/apperror"
	appmiddleware "fileupload/internal/middleware"
	"fileupload/internal/model"
	"fileupload/internal/service"
)

const multipartOverheadAllowance = 1 << 20

type FileHandler struct {
	service *service.FileService
	policy  service.UploadPolicy
	logger  *slog.Logger
}

func NewFileHandler(fileService *service.FileService, policy service.UploadPolicy, logger *slog.Logger) *FileHandler {
	return &FileHandler{service: fileService, policy: policy, logger: logger}
}

func (h *FileHandler) Upload(c *gin.Context) {
	principal, ok := appmiddleware.PrincipalFrom(c)
	if !ok {
		writeError(c, h.logger, apperror.New(http.StatusUnauthorized, "AUTH_TOKEN_INVALID", "access token is invalid"))
		return
	}
	idempotencyKey := c.GetHeader("Idempotency-Key")
	parsedKey, err := uuid.Parse(idempotencyKey)
	if err != nil || parsedKey.Version() != 4 {
		writeError(c, h.logger, apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "Idempotency-Key must be a UUID v4"))
		return
	}

	declaredSize, err := strconv.ParseInt(c.GetHeader("X-File-Size"), 10, 64)
	if err != nil || declaredSize <= 0 {
		writeError(c, h.logger, apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "X-File-Size must be a positive integer"))
		return
	}
	if declaredSize > h.policy.MaxFileSize {
		writeError(c, h.logger, apperror.New(http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "uploaded file exceeds the allowed size"))
		return
	}

	// 先限制整个 multipart 请求，再把文件 Part 流直接交给 MinIO，避免大文件落本地临时盘。
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.policy.MaxFileSize+multipartOverheadAllowance)
	multipartReader, err := c.Request.MultipartReader()
	if err != nil {
		writeError(c, h.logger, apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "request must be multipart/form-data"))
		return
	}

	platform, packageType := "", ""
	type pendingRelease struct {
		response  model.UploadResponse
		policy    service.UploadPolicy
		input     service.UploadInput
		replay    bool
		committed bool
	}
	var pending *pendingRelease
	defer func() {
		if pending != nil && !pending.committed && !pending.replay {
			ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 5*time.Second)
			defer cancel()
			h.service.DiscardUpload(ctx, pending.policy, pending.input, pending.response.FileID)
		}
	}()
	for {
		part, nextErr := multipartReader.NextPart()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			var maxBytesErr *http.MaxBytesError
			if errors.As(nextErr, &maxBytesErr) {
				writeError(c, h.logger, apperror.New(http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "uploaded file exceeds the allowed size"))
			} else {
				writeError(c, h.logger, apperror.Wrap(http.StatusBadRequest, "INVALID_REQUEST", "invalid multipart request", nextErr))
			}
			return
		}
		if part.FileName() == "" {
			value, readErr := io.ReadAll(io.LimitReader(part, 65))
			_ = part.Close()
			if readErr != nil || len(value) > 64 {
				writeError(c, h.logger, apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "multipart text field is invalid"))
				return
			}
			switch part.FormName() {
			case "platform":
				platform = string(value)
			case "package_type":
				packageType = string(value)
			}
			continue
		}
		if part.FormName() != "file" {
			_ = part.Close()
			continue
		}
		if pending != nil {
			_ = part.Close()
			writeError(c, h.logger, apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "multipart request must contain exactly one file"))
			return
		}

		policy := h.policy
		if policy.Kind == model.FileKindAppRelease {
			if platform != "" && packageType != "" {
				policy, err = service.AppReleasePlatformPolicy(h.policy.MaxFileSize, platform, packageType)
			} else {
				// 文件字段在前时先从扩展名推断流式存储目标，读完后再与表单声明交叉校验。
				policy, err = service.InferAppReleasePolicy(h.policy.MaxFileSize, part.FileName())
			}
			if err != nil {
				_ = part.Close()
				writeError(c, h.logger, err)
				return
			}
		}

		input := service.UploadInput{
			OwnerUID:       principal.UserID,
			IdempotencyKey: idempotencyKey,
			Filename:       part.FileName(),
			ContentType:    part.Header.Get("Content-Type"),
			DeclaredSize:   declaredSize,
			ExpectedSHA256: strings.TrimSpace(c.GetHeader("X-File-SHA256")),
			Reader:         part,
		}
		response, replay, uploadErr := h.service.Upload(c.Request.Context(), policy, input)
		_ = part.Close()
		if uploadErr != nil {
			writeError(c, h.logger, uploadErr)
			return
		}
		if policy.Kind == model.FileKindAppRelease {
			pending = &pendingRelease{response: response, policy: policy, input: input, replay: replay}
			continue
		}
		response.RequestID = appmiddleware.RequestIDFrom(c)
		c.Header("Location", policy.ResourcePath+"/"+response.FileID)
		status := http.StatusCreated
		if replay {
			status = http.StatusOK
		}
		c.JSON(status, response)
		return
	}
	if pending != nil {
		declaredPolicy, policyErr := service.AppReleasePlatformPolicy(h.policy.MaxFileSize, platform, packageType)
		if policyErr != nil || declaredPolicy.Platform != pending.policy.Platform || declaredPolicy.PackageType != pending.policy.PackageType {
			if policyErr == nil {
				policyErr = apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "file does not match platform and package_type")
			}
			writeError(c, h.logger, policyErr)
			return
		}
		pending.response.RequestID = appmiddleware.RequestIDFrom(c)
		c.Header("Location", pending.policy.ResourcePath+"/"+pending.response.FileID)
		status := http.StatusCreated
		if pending.replay {
			status = http.StatusOK
		}
		pending.committed = true
		c.JSON(status, pending.response)
		return
	}

	writeError(c, h.logger, apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "multipart field file is required"))
}

func (h *FileHandler) Download(c *gin.Context) {
	h.download(c, h.policy.Kind != model.FileKindAppRelease)
}

func (h *FileHandler) InternalDownload(c *gin.Context) {
	h.download(c, false)
}

func (h *FileHandler) download(c *gin.Context, ownerRestricted bool) {
	fileID := c.Param("file_id")
	info, err := h.service.Stat(c.Request.Context(), h.policy, fileID)
	if err != nil {
		writeError(c, h.logger, err)
		return
	}
	if ownerRestricted {
		principal, ok := appmiddleware.PrincipalFrom(c)
		if !ok || service.OwnerUID(info) != principal.UserID {
			// 不区分不存在与跨用户访问，避免利用 file_id 枚举其他用户文件。
			writeError(c, h.logger, apperror.New(http.StatusNotFound, "FILE_NOT_FOUND", "file not found"))
			return
		}
	}
	setObjectHeaders(c, info.Size, info.ContentType, info.ETag, info.LastModified, service.OriginalFilename(info))

	start, end := int64(-1), int64(-1)
	status := http.StatusOK
	contentLength := info.Size
	if rangeHeader := c.GetHeader("Range"); rangeHeader != "" {
		requested, rangeErr := parseRange(rangeHeader, info.Size)
		if rangeErr != nil {
			c.Header("Content-Range", fmt.Sprintf("bytes */%d", info.Size))
			writeError(c, h.logger, apperror.New(http.StatusRequestedRangeNotSatisfiable, "INVALID_RANGE", "requested range is not satisfiable"))
			return
		}
		start, end = requested.start, requested.end
		contentLength = end - start + 1
		status = http.StatusPartialContent
		c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, info.Size))
	}
	c.Header("Content-Length", strconv.FormatInt(contentLength, 10))

	reader, err := h.service.Open(c.Request.Context(), info.Key, start, end)
	if err != nil {
		writeError(c, h.logger, err)
		return
	}
	defer reader.Close()

	c.Status(status)
	if contentLength == 0 {
		return
	}
	if _, err = io.CopyN(c.Writer, reader, contentLength); err != nil && !errors.Is(err, context.Canceled) {
		h.logger.Warn("download interrupted", "request_id", appmiddleware.RequestIDFrom(c), "file_id", fileID, "error", err)
	}
}

func setObjectHeaders(c *gin.Context, size int64, contentType, etag string, modified time.Time, filename string) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Header("Content-Type", contentType)
	c.Header("Content-Length", strconv.FormatInt(size, 10))
	c.Header("Content-Disposition", service.ContentDisposition(filename))
	c.Header("Accept-Ranges", "bytes")
	if etag != "" {
		c.Header("ETag", `"`+strings.Trim(etag, `"`)+`"`)
	}
	if !modified.IsZero() {
		c.Header("Last-Modified", modified.UTC().Format(http.TimeFormat))
	}
}
