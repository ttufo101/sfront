package service

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	_ "golang.org/x/image/webp"

	"fileupload/internal/apperror"
	"fileupload/internal/idempotency"
	"fileupload/internal/model"
	"fileupload/internal/storage"
)

type UploadPolicy struct {
	Kind             model.FileKind
	ObjectPrefix     string
	ResourcePath     string
	MaxFileSize      int64
	ChecksumRequired bool
	Platform         string
	PackageType      string
}

func LogUploadPolicy(maxFileSize int64) UploadPolicy {
	return UploadPolicy{Kind: model.FileKindLog, ObjectPrefix: "logs", ResourcePath: "/api/v1/log-files", MaxFileSize: maxFileSize}
}

func AppReleaseUploadPolicy(maxFileSize int64) UploadPolicy {
	return UploadPolicy{
		Kind:             model.FileKindAppRelease,
		ObjectPrefix:     "app-releases",
		ResourcePath:     "/api/v1/app-releases",
		MaxFileSize:      maxFileSize,
		ChecksumRequired: true,
	}
}

func AppReleasePlatformPolicy(maxFileSize int64, platform, packageType string) (UploadPolicy, error) {
	platform = strings.ToLower(strings.TrimSpace(platform))
	packageType = strings.ToLower(strings.TrimSpace(packageType))
	valid := map[string]map[string]bool{
		"android": {"apk": true},
		"ios":     {"ipa": true},
		"windows": {"exe": true},
		"mac":     {"dmg": true, "pkg": true},
	}
	if !valid[platform][packageType] {
		return UploadPolicy{}, apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "platform and package_type combination is invalid")
	}
	policy := AppReleaseUploadPolicy(maxFileSize)
	policy.ObjectPrefix += "/" + platform
	policy.Platform = platform
	policy.PackageType = packageType
	return policy, nil
}

func InferAppReleasePolicy(maxFileSize int64, filename string) (UploadPolicy, error) {
	lower := strings.ToLower(sanitizeFilename(filename))
	for suffix, pair := range map[string][2]string{
		".apk": {"android", "apk"},
		".ipa": {"ios", "ipa"},
		".exe": {"windows", "exe"},
		".dmg": {"mac", "dmg"},
		".pkg": {"mac", "pkg"},
	} {
		if strings.HasSuffix(lower, suffix) {
			return AppReleasePlatformPolicy(maxFileSize, pair[0], pair[1])
		}
	}
	return UploadPolicy{}, apperror.New(http.StatusUnsupportedMediaType, "UNSUPPORTED_FILE_TYPE", "file extension is not a supported package_type")
}

func FeedbackUploadPolicy(maxFileSize int64) UploadPolicy {
	return UploadPolicy{
		Kind:             model.FileKindFeedback,
		ObjectPrefix:     "feedback-files",
		ResourcePath:     "/api/v1/feedback-files",
		MaxFileSize:      maxFileSize,
		ChecksumRequired: true,
	}
}

type UploadInput struct {
	OwnerUID       string
	IdempotencyKey string
	Filename       string
	ContentType    string
	DeclaredSize   int64
	ExpectedSHA256 string
	Reader         io.Reader
}

type FileService struct {
	storage     storage.ObjectStorage
	idempotency *idempotency.MemoryStore
	now         func() time.Time
}

func NewFileService(objectStorage storage.ObjectStorage, store *idempotency.MemoryStore) *FileService {
	return &FileService{storage: objectStorage, idempotency: store, now: time.Now}
}

func (s *FileService) Upload(ctx context.Context, policy UploadPolicy, input UploadInput) (model.UploadResponse, bool, error) {
	ownerUID := strings.TrimSpace(input.OwnerUID)
	if ownerUID == "" {
		return model.UploadResponse{}, false, apperror.New(http.StatusUnauthorized, "AUTH_TOKEN_INVALID", "access token is invalid")
	}
	filename := sanitizeFilename(input.Filename)
	if filename == "" {
		return model.UploadResponse{}, false, apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "invalid filename")
	}
	if input.DeclaredSize <= 0 {
		return model.UploadResponse{}, false, apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "X-File-Size must be positive")
	}
	if input.DeclaredSize > policy.MaxFileSize {
		return model.UploadResponse{}, false, apperror.New(http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "uploaded file exceeds the allowed size")
	}
	if policy.ChecksumRequired && input.ExpectedSHA256 == "" {
		return model.UploadResponse{}, false, apperror.New(http.StatusBadRequest, "CHECKSUM_REQUIRED", "X-File-SHA256 is required")
	}
	if err := validateChecksum(input.ExpectedSHA256); err != nil {
		return model.UploadResponse{}, false, err
	}

	// 用户与文件类型共同参与幂等作用域，避免不同用户复用同一 UUID 时互相重放。
	idempotencyKey := ownerUID + "\x00" + string(policy.Kind) + "\x00" + input.IdempotencyKey
	fingerprint := requestFingerprint(policy, filename, input.ContentType, input.DeclaredSize, input.ExpectedSHA256)
	decision, previous := s.idempotency.Begin(idempotencyKey, fingerprint)
	switch decision {
	case idempotency.Replay:
		return previous, true, nil
	case idempotency.InProgress:
		return model.UploadResponse{}, false, apperror.New(http.StatusConflict, "UPLOAD_IN_PROGRESS", "an upload with this idempotency key is in progress")
	case idempotency.Conflict:
		return model.UploadResponse{}, false, apperror.New(http.StatusConflict, "IDEMPOTENCY_CONFLICT", "idempotency key was already used for a different file")
	case idempotency.Full:
		return model.UploadResponse{}, false, apperror.New(http.StatusServiceUnavailable, "IDEMPOTENCY_CAPACITY_EXCEEDED", "upload service is temporarily at capacity")
	}

	// 只有完整写入并通过大小、摘要校验后才提交幂等结果；任何失败都允许客户端原键重试。
	completed := false
	defer func() {
		if !completed {
			s.idempotency.Fail(idempotencyKey, fingerprint)
		}
	}()

	if policy.Kind == model.FileKindFeedback && input.ExpectedSHA256 != strings.ToLower(input.ExpectedSHA256) {
		return model.UploadResponse{}, false, apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "X-File-SHA256 must use lowercase hexadecimal")
	}

	buffered := bufio.NewReader(input.Reader)
	detectedType, err := validateFileType(policy, filename, buffered)
	if err != nil {
		return model.UploadResponse{}, false, err
	}

	fileID := uuid.NewString()
	objectKey := objectKey(policy, fileID)
	hasher := sha256.New()
	var uploadReader io.Reader = buffered
	var dmgTail *tailBufferReader
	if policy.Kind == model.FileKindAppRelease && policy.PackageType == "dmg" {
		dmgTail = &tailBufferReader{reader: uploadReader, limit: 512}
		uploadReader = dmgTail
	}
	counter := &countingReader{reader: io.TeeReader(uploadReader, hasher)}
	createdAt := s.now().UTC()
	metadata := map[string]string{
		"File-Kind":             string(policy.Kind),
		"Owner-Uid":             ownerUID,
		"Original-Filename-B64": base64.RawURLEncoding.EncodeToString([]byte(filename)),
		"Uploaded-At":           createdAt.Format(time.RFC3339Nano),
	}
	if policy.Platform != "" {
		metadata["Platform"] = policy.Platform
		metadata["Package-Type"] = policy.PackageType
	}

	if policy.Kind == model.FileKindFeedback {
		return s.uploadFeedback(ctx, policy, input, filename, idempotencyKey, fingerprint, buffered, metadata, createdAt, fileID)
	}
	if input.ExpectedSHA256 != "" {
		metadata["SHA256"] = strings.ToLower(input.ExpectedSHA256)
	}

	putErr := s.storage.Put(ctx, objectKey, counter, input.DeclaredSize, storage.PutOptions{
		ContentType: detectedType,
		Metadata:    metadata,
	})
	if putErr != nil {
		// MinIO 通常不会暴露未完成对象，但仍主动删除，避免兼容存储留下半成品。
		s.deleteInvalidObject(ctx, objectKey)
		if counter.count != input.DeclaredSize {
			return model.UploadResponse{}, false, apperror.Wrap(http.StatusUnprocessableEntity, "FILE_SIZE_MISMATCH", "actual file size differs from X-File-Size", putErr)
		}
		return model.UploadResponse{}, false, apperror.Wrap(http.StatusServiceUnavailable, "STORAGE_UNAVAILABLE", "failed to store file", putErr)
	}

	// PutObject 按声明大小读取；再探测一个字节，防止客户端少报文件大小并截断上传。
	one := make([]byte, 1)
	extra, readErr := buffered.Read(one)
	if counter.count != input.DeclaredSize || extra != 0 || (readErr != nil && !errors.Is(readErr, io.EOF)) {
		s.deleteInvalidObject(ctx, objectKey)
		return model.UploadResponse{}, false, apperror.New(http.StatusUnprocessableEntity, "FILE_SIZE_MISMATCH", "actual file size differs from X-File-Size")
	}
	if dmgTail != nil && (len(dmgTail.tail) != 512 || string(dmgTail.tail[:4]) != "koly") {
		s.deleteInvalidObject(ctx, objectKey)
		return model.UploadResponse{}, false, unsupportedFileType(model.FileKindAppRelease)
	}

	digest := hex.EncodeToString(hasher.Sum(nil))
	if input.ExpectedSHA256 != "" && !strings.EqualFold(input.ExpectedSHA256, digest) {
		s.deleteInvalidObject(ctx, objectKey)
		return model.UploadResponse{}, false, apperror.New(http.StatusUnprocessableEntity, "CHECKSUM_MISMATCH", "file SHA-256 does not match X-File-SHA256")
	}

	response := model.UploadResponse{
		FileID: fileID, FileKind: policy.Kind, Platform: policy.Platform, PackageType: policy.PackageType,
		Filename: filename, Size: input.DeclaredSize, SHA256: digest, CreatedAt: createdAt,
	}
	s.idempotency.Complete(idempotencyKey, fingerprint, response)
	completed = true
	return response, false, nil
}

func (s *FileService) uploadFeedback(
	ctx context.Context,
	policy UploadPolicy,
	input UploadInput,
	filename, idempotencyKey, fingerprint string,
	reader io.Reader,
	metadata map[string]string,
	createdAt time.Time,
	fileID string,
) (model.UploadResponse, bool, error) {
	// 图片上限固定为 10 MiB，可安全在内存中完成完整解码后再写对象存储，避免保存畸形图片。
	data, err := io.ReadAll(io.LimitReader(reader, input.DeclaredSize+1))
	if err != nil || int64(len(data)) != input.DeclaredSize {
		return model.UploadResponse{}, false, apperror.Wrap(http.StatusUnprocessableEntity, "FILE_SIZE_MISMATCH", "actual file size differs from X-File-Size", err)
	}
	digest := sha256.Sum256(data)
	digestHex := hex.EncodeToString(digest[:])
	if input.ExpectedSHA256 != digestHex {
		return model.UploadResponse{}, false, apperror.New(http.StatusUnprocessableEntity, "CHECKSUM_MISMATCH", "file SHA-256 does not match X-File-SHA256")
	}
	mimeType, width, height, err := validateFeedbackImage(filename, data)
	if err != nil {
		return model.UploadResponse{}, false, err
	}
	metadata["SHA256"] = digestHex
	metadata["MIME-Type"] = mimeType
	metadata["Image-Width"] = strconv.Itoa(width)
	metadata["Image-Height"] = strconv.Itoa(height)
	metadata["Status"] = "pending"
	key := objectKey(policy, fileID)
	if err = s.storage.Put(ctx, key, bytes.NewReader(data), int64(len(data)), storage.PutOptions{ContentType: mimeType, Metadata: metadata}); err != nil {
		s.deleteInvalidObject(ctx, key)
		return model.UploadResponse{}, false, apperror.Wrap(http.StatusServiceUnavailable, "STORAGE_UNAVAILABLE", "failed to store file", err)
	}
	response := model.UploadResponse{
		FileID: fileID, FileKind: policy.Kind, Filename: filename, Size: input.DeclaredSize,
		SHA256: digestHex, MIMEType: mimeType, Width: width, Height: height, CreatedAt: createdAt,
	}
	s.idempotency.Complete(idempotencyKey, fingerprint, response)
	return response, false, nil
}

func validateFeedbackImage(filename string, data []byte) (string, int, int, error) {
	lower := strings.ToLower(filename)
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || config.Width > 2048 || config.Height > 2048 {
		return "", 0, 0, unsupportedFileType(model.FileKindFeedback)
	}
	mimeType := ""
	switch format {
	case "jpeg":
		if !strings.HasSuffix(lower, ".jpg") && !strings.HasSuffix(lower, ".jpeg") {
			return "", 0, 0, unsupportedFileType(model.FileKindFeedback)
		}
		mimeType = "image/jpeg"
	case "png":
		if !strings.HasSuffix(lower, ".png") || animatedPNG(data) {
			return "", 0, 0, unsupportedFileType(model.FileKindFeedback)
		}
		mimeType = "image/png"
	case "webp":
		if !strings.HasSuffix(lower, ".webp") || animatedWebP(data) {
			return "", 0, 0, unsupportedFileType(model.FileKindFeedback)
		}
		mimeType = "image/webp"
	default:
		return "", 0, 0, unsupportedFileType(model.FileKindFeedback)
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil || decoded.Bounds().Dx() != config.Width || decoded.Bounds().Dy() != config.Height {
		return "", 0, 0, unsupportedFileType(model.FileKindFeedback)
	}
	return mimeType, config.Width, config.Height, nil
}

func animatedPNG(data []byte) bool {
	pngSignature := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	if len(data) < len(pngSignature) || !bytes.Equal(data[:8], pngSignature) {
		return false
	}
	for offset := 8; offset+12 <= len(data); {
		chunkSize := int(binary.BigEndian.Uint32(data[offset : offset+4]))
		if chunkSize < 0 || offset+12+chunkSize > len(data) {
			return true
		}
		if string(data[offset+4:offset+8]) == "acTL" {
			return true
		}
		offset += 12 + chunkSize
	}
	return false
}

func animatedWebP(data []byte) bool {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return false
	}
	for offset := 12; offset+8 <= len(data); {
		chunkType := string(data[offset : offset+4])
		chunkSize := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		payload := offset + 8
		if chunkSize < 0 || payload+chunkSize > len(data) {
			return true
		}
		if chunkType == "ANIM" || chunkType == "ANMF" || (chunkType == "VP8X" && chunkSize > 0 && data[payload]&0x02 != 0) {
			return true
		}
		offset = payload + chunkSize + chunkSize%2
	}
	return false
}

func (s *FileService) Stat(ctx context.Context, policy UploadPolicy, fileID string) (storage.ObjectInfo, error) {
	if _, err := uuid.Parse(fileID); err != nil {
		return storage.ObjectInfo{}, apperror.New(http.StatusBadRequest, "INVALID_FILE_ID", "file_id must be a UUID")
	}
	if policy.Kind == model.FileKindAppRelease && policy.Platform == "" {
		for _, platform := range []string{"android", "ios", "windows", "mac"} {
			candidate := policy
			candidate.ObjectPrefix += "/" + platform
			info, err := s.storage.Stat(ctx, objectKey(candidate, fileID))
			if err == nil {
				return info, nil
			}
			if !errors.Is(err, storage.ErrNotFound) {
				return storage.ObjectInfo{}, apperror.Wrap(http.StatusServiceUnavailable, "STORAGE_UNAVAILABLE", "failed to inspect file", err)
			}
		}
		return storage.ObjectInfo{}, apperror.New(http.StatusNotFound, "FILE_NOT_FOUND", "file not found")
	}
	info, err := s.storage.Stat(ctx, objectKey(policy, fileID))
	if errors.Is(err, storage.ErrNotFound) {
		return storage.ObjectInfo{}, apperror.New(http.StatusNotFound, "FILE_NOT_FOUND", "file not found")
	}
	if err != nil {
		return storage.ObjectInfo{}, apperror.Wrap(http.StatusServiceUnavailable, "STORAGE_UNAVAILABLE", "failed to inspect file", err)
	}
	return info, nil
}

func (s *FileService) Open(ctx context.Context, objectKey string, start, end int64) (io.ReadCloser, error) {
	reader, err := s.storage.Open(ctx, objectKey, start, end)
	if err != nil {
		return nil, apperror.Wrap(http.StatusServiceUnavailable, "STORAGE_UNAVAILABLE", "failed to read file", err)
	}
	return reader, nil
}

func (s *FileService) Ready(ctx context.Context) error { return s.storage.Ready(ctx) }

func (s *FileService) DiscardUpload(ctx context.Context, policy UploadPolicy, input UploadInput, fileID string) {
	_ = s.storage.Delete(ctx, objectKey(policy, fileID))
	ownerUID := strings.TrimSpace(input.OwnerUID)
	key := ownerUID + "\x00" + string(policy.Kind) + "\x00" + input.IdempotencyKey
	fingerprint := requestFingerprint(policy, sanitizeFilename(input.Filename), input.ContentType, input.DeclaredSize, input.ExpectedSHA256)
	s.idempotency.Forget(key, fingerprint)
}

func (s *FileService) deleteInvalidObject(parent context.Context, key string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), 5*time.Second)
	defer cancel()
	_ = s.storage.Delete(ctx, key)
}

func OriginalFilename(info storage.ObjectInfo) string {
	encoded := info.Metadata["original-filename-b64"]
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(decoded) == 0 {
		return path.Base(info.Key)
	}
	return sanitizeFilename(string(decoded))
}

func OwnerUID(info storage.ObjectInfo) string {
	return strings.TrimSpace(info.Metadata["owner-uid"])
}

func objectKey(policy UploadPolicy, fileID string) string { return policy.ObjectPrefix + "/" + fileID }

func requestFingerprint(policy UploadPolicy, filename, contentType string, size int64, checksum string) string {
	value := fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%s\x00%d\x00%s", policy.Kind, policy.Platform, policy.PackageType, filename, strings.ToLower(contentType), size, strings.ToLower(checksum))
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func validateChecksum(value string) error {
	if value == "" {
		return nil
	}
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != sha256.Size {
		return apperror.New(http.StatusBadRequest, "INVALID_REQUEST", "X-File-SHA256 must be a 64-character hexadecimal SHA-256")
	}
	return nil
}

func validateFileType(policy UploadPolicy, filename string, reader *bufio.Reader) (string, error) {
	if policy.Kind == model.FileKindFeedback {
		return "", nil
	}
	header, err := reader.Peek(4)
	if err != nil {
		return "", unsupportedFileType(policy.Kind)
	}
	lower := strings.ToLower(filename)
	zipSignature := header[0] == 0x50 && header[1] == 0x4b &&
		((header[2] == 0x03 && header[3] == 0x04) || (header[2] == 0x05 && header[3] == 0x06) || (header[2] == 0x07 && header[3] == 0x08))

	// 两类文件虽然都可能是 ZIP 容器，但扩展名和最终 Content-Type 必须按业务类型分别约束。
	switch policy.Kind {
	case model.FileKindLog:
		if strings.HasSuffix(lower, ".zip") && zipSignature {
			return "application/zip", nil
		}
		if (strings.HasSuffix(lower, ".gz") || strings.HasSuffix(lower, ".tar.gz")) && header[0] == 0x1f && header[1] == 0x8b {
			return "application/gzip", nil
		}
	case model.FileKindAppRelease:
		// 平台、包类型、扩展名和文件头必须同时匹配，不能只相信前端表单字段。
		switch policy.PackageType {
		case "apk":
			if !strings.HasSuffix(lower, ".apk") || !zipSignature {
				break
			}
			return "application/vnd.android.package-archive", nil
		case "ipa":
			if !strings.HasSuffix(lower, ".ipa") || !zipSignature {
				break
			}
			return "application/octet-stream", nil
		case "exe":
			if !strings.HasSuffix(lower, ".exe") || header[0] != 0x4d || header[1] != 0x5a {
				break
			}
			return "application/octet-stream", nil
		case "dmg":
			if !strings.HasSuffix(lower, ".dmg") {
				break
			}
			// UDIF 的 koly 签名在最后 512 字节中，由流式尾部检查器在上传完成后验证。
			return "application/octet-stream", nil
		case "pkg":
			if !strings.HasSuffix(lower, ".pkg") || string(header) != "xar!" {
				break
			}
			return "application/octet-stream", nil
		}
	}
	return "", unsupportedFileType(policy.Kind)
}

func unsupportedFileType(kind model.FileKind) error {
	message := "file is not a supported ZIP or GZIP archive"
	if kind == model.FileKindAppRelease {
		message = "file does not match the declared platform and package_type"
	} else if kind == model.FileKindFeedback {
		message = "file is not a supported JPEG, PNG, or WebP image"
	}
	return apperror.New(http.StatusUnsupportedMediaType, "UNSUPPORTED_FILE_TYPE", message)
}

func sanitizeFilename(filename string) string {
	filename = strings.ReplaceAll(filename, "\\", "/")
	filename = path.Base(filename)
	filename = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, filename)
	filename = strings.TrimSpace(filename)
	if filename == "." || filename == "" {
		return ""
	}
	if len(filename) > 255 {
		filename = filename[:255]
		for !utf8.ValidString(filename) {
			filename = filename[:len(filename)-1]
		}
	}
	return filename
}

type countingReader struct {
	reader io.Reader
	count  int64
}

type tailBufferReader struct {
	reader io.Reader
	limit  int
	tail   []byte
}

func (r *tailBufferReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n <= 0 {
		return n, err
	}
	if n >= r.limit {
		r.tail = append(r.tail[:0], p[n-r.limit:n]...)
		return n, err
	}
	overflow := len(r.tail) + n - r.limit
	if overflow > 0 {
		copy(r.tail, r.tail[overflow:])
		r.tail = r.tail[:len(r.tail)-overflow]
	}
	r.tail = append(r.tail, p[:n]...)
	return n, err
}

func (r *countingReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.count += int64(n)
	return n, err
}

func ContentDisposition(filename string) string {
	value := mime.FormatMediaType("attachment", map[string]string{"filename": sanitizeFilename(filename)})
	if value == "" {
		return "attachment"
	}
	return value
}
