package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"fileupload/internal/auth"
	"fileupload/internal/config"
	"fileupload/internal/idempotency"
	"fileupload/internal/server"
	"fileupload/internal/service"
	"fileupload/internal/storage"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	objectStorage, err := storage.NewMinIO(storage.MinIOConfig{
		Endpoint:  cfg.MinIOEndpoint,
		AccessKey: cfg.MinIOAccessKey,
		SecretKey: cfg.MinIOSecretKey,
		UseSSL:    cfg.MinIOUseSSL,
		Bucket:    cfg.MinIOBucket,
		Region:    cfg.MinIORegion,
	})
	if err != nil {
		return err
	}
	startupCtx, startupCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer startupCancel()
	if err = objectStorage.EnsureBucket(startupCtx); err != nil {
		return err
	}

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	idempotencyStore := idempotency.NewMemoryStore(cfg.IdempotencyTTL, cfg.IdempotencyMaxEntries)
	go idempotencyStore.RunCleanup(rootCtx.Done())
	fileService := service.NewFileService(objectStorage, idempotencyStore)
	var tokenVerifier auth.Verifier
	if !cfg.AllowInsecureAuth {
		tokenVerifier, err = auth.NewJWTVerifier(cfg.JWTIssuer, cfg.JWTSecret)
		if err != nil {
			return err
		}
	}

	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           server.NewRouter(fileService, tokenVerifier, cfg.AllowInsecureAuth, cfg.MaxLogFileSize, cfg.MaxReleaseFileSize, cfg.MaxFeedbackFileSize, logger),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		MaxHeaderBytes:    1 << 20,
	}
	internalServer := &http.Server{
		Addr:              cfg.InternalHTTPAddr,
		Handler:           server.NewInternalRouter(fileService, cfg.MaxLogFileSize, cfg.MaxFeedbackFileSize, logger),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		MaxHeaderBytes:    1 << 20,
	}

	serverErrors := make(chan error, 2)
	go func() {
		logger.Info("public server listening", "address", cfg.HTTPAddr, "bucket", cfg.MinIOBucket)
		serverErrors <- httpServer.ListenAndServe()
	}()
	go func() {
		logger.Info("internal server listening", "address", cfg.InternalHTTPAddr)
		serverErrors <- internalServer.ListenAndServe()
	}()

	var serveErr error
	select {
	case <-rootCtx.Done():
	case serveErr = <-serverErrors:
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	publicErr := httpServer.Shutdown(shutdownCtx)
	internalErr := internalServer.Shutdown(shutdownCtx)
	if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
		return serveErr
	}
	return errors.Join(publicErr, internalErr)
}
