package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Environment           string
	AllowInsecureAuth     bool
	JWTIssuer             string
	JWTSecret             string
	HTTPAddr              string
	InternalHTTPAddr      string
	MinIOEndpoint         string
	MinIOAccessKey        string
	MinIOSecretKey        string
	MinIOUseSSL           bool
	MinIOBucket           string
	MinIORegion           string
	MaxLogFileSize        int64
	MaxReleaseFileSize    int64
	MaxFeedbackFileSize   int64
	IdempotencyTTL        time.Duration
	IdempotencyMaxEntries int
	ReadHeaderTimeout     time.Duration
	IdleTimeout           time.Duration
	ShutdownTimeout       time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Environment:           env("APP_ENV", "development"),
		HTTPAddr:              env("HTTP_ADDR", "127.0.0.1:8080"),
		InternalHTTPAddr:      env("INTERNAL_HTTP_ADDR", "127.0.0.1:8081"),
		JWTIssuer:             env("JWT_ISSUER", "starland"),
		JWTSecret:             os.Getenv("JWT_SECRET"),
		MinIOEndpoint:         env("MINIO_ENDPOINT", "127.0.0.1:9000"),
		MinIOAccessKey:        os.Getenv("MINIO_ACCESS_KEY"),
		MinIOSecretKey:        os.Getenv("MINIO_SECRET_KEY"),
		MinIOBucket:           env("MINIO_BUCKET", "fileupload"),
		MinIORegion:           os.Getenv("MINIO_REGION"),
		MaxLogFileSize:        100 << 20,
		MaxReleaseFileSize:    500 << 20,
		MaxFeedbackFileSize:   10 << 20,
		IdempotencyTTL:        24 * time.Hour,
		IdempotencyMaxEntries: 10_000,
		ReadHeaderTimeout:     10 * time.Second,
		IdleTimeout:           2 * time.Minute,
		ShutdownTimeout:       10 * time.Second,
	}

	var err error
	if cfg.AllowInsecureAuth, err = boolEnv("ALLOW_INSECURE_AUTH", false); err != nil {
		return Config{}, err
	}
	if cfg.MinIOUseSSL, err = boolEnv("MINIO_USE_SSL", false); err != nil {
		return Config{}, err
	}
	if cfg.MaxLogFileSize, err = int64Env("MAX_LOG_FILE_SIZE", cfg.MaxLogFileSize); err != nil {
		return Config{}, err
	}
	if cfg.MaxReleaseFileSize, err = int64Env("MAX_RELEASE_FILE_SIZE", cfg.MaxReleaseFileSize); err != nil {
		return Config{}, err
	}
	if cfg.MaxFeedbackFileSize, err = int64Env("MAX_FEEDBACK_FILE_SIZE", cfg.MaxFeedbackFileSize); err != nil {
		return Config{}, err
	}
	if cfg.IdempotencyTTL, err = durationEnv("IDEMPOTENCY_TTL", cfg.IdempotencyTTL); err != nil {
		return Config{}, err
	}
	if cfg.IdempotencyMaxEntries, err = intEnv("IDEMPOTENCY_MAX_ENTRIES", cfg.IdempotencyMaxEntries); err != nil {
		return Config{}, err
	}
	if cfg.ReadHeaderTimeout, err = durationEnv("READ_HEADER_TIMEOUT", cfg.ReadHeaderTimeout); err != nil {
		return Config{}, err
	}
	if cfg.IdleTimeout, err = durationEnv("IDLE_TIMEOUT", cfg.IdleTimeout); err != nil {
		return Config{}, err
	}
	if cfg.ShutdownTimeout, err = durationEnv("SHUTDOWN_TIMEOUT", cfg.ShutdownTimeout); err != nil {
		return Config{}, err
	}

	if cfg.AllowInsecureAuth && cfg.Environment != "development" {
		return Config{}, errors.New("insecure authentication bypass is allowed only when APP_ENV=development")
	}
	if !cfg.AllowInsecureAuth && (cfg.JWTIssuer == "" || cfg.JWTSecret == "") {
		return Config{}, errors.New("JWT_ISSUER and JWT_SECRET are required when authentication bypass is disabled")
	}
	if cfg.MinIOAccessKey == "" || cfg.MinIOSecretKey == "" {
		return Config{}, errors.New("MINIO_ACCESS_KEY and MINIO_SECRET_KEY are required")
	}
	if err := validateInternalAddress(cfg.InternalHTTPAddr); err != nil {
		return Config{}, err
	}
	if cfg.MaxLogFileSize <= 0 || cfg.MaxReleaseFileSize <= 0 || cfg.MaxFeedbackFileSize <= 0 || cfg.IdempotencyTTL <= 0 || cfg.IdempotencyMaxEntries <= 0 {
		return Config{}, errors.New("size, TTL, and entry limits must be positive")
	}
	if cfg.MaxFeedbackFileSize > 10<<20 {
		return Config{}, errors.New("MAX_FEEDBACK_FILE_SIZE must not exceed 10485760 bytes")
	}
	return cfg, nil
}

func validateInternalAddress(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("parse INTERNAL_HTTP_ADDR: %w", err)
	}
	if host == "localhost" {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return errors.New("INTERNAL_HTTP_ADDR must use a loopback address while internal authentication is disabled")
	}
	return nil
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func boolEnv(key string, fallback bool) (bool, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("parse %s: %w", key, err)
	}
	return parsed, nil
}

func int64Env(key string, fallback int64) (int64, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", key, err)
	}
	return parsed, nil
}

func intEnv(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", key, err)
	}
	return parsed, nil
}

func durationEnv(key string, fallback time.Duration) (time.Duration, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", key, err)
	}
	return parsed, nil
}
