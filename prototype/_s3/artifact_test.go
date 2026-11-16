package executor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"deployer/internal/conf"
)

func TestValidateRemotePath(t *testing.T) {
	good := []string{"/opt/mihomo/conf/config.yaml", "/opt/hysteria/conf/node-identity.yaml", "/tmp/a-b_1.tgz"}
	bad := []string{"", "relative/path", "/opt/../etc/passwd", "/opt/a;rm -rf /", "/opt/$(id)", "/opt/a b"}
	for _, p := range good {
		if err := ValidateRemotePath(p); err != nil {
			t.Errorf("expected %q valid, got %v", p, err)
		}
	}
	for _, p := range bad {
		if err := ValidateRemotePath(p); err == nil {
			t.Errorf("expected %q rejected", p)
		}
	}
}

func TestLifecycleCommandWhitelist(t *testing.T) {
	got, err := LifecycleCommand("systemd:starland-mihomo", "restart")
	if err != nil || got != "systemctl restart starland-mihomo" {
		t.Fatalf("unexpected restart command: %q err=%v", got, err)
	}
	got, err = LifecycleCommand("systemd:hysteria-server", "health")
	if err != nil || got != "systemctl is-active hysteria-server" {
		t.Fatalf("unexpected health command: %q err=%v", got, err)
	}
	bad := []string{"systemd:unit;rm -rf /", "bash:anything", "systemd:", ":unit", "systemd:unit name"}
	for _, spec := range bad {
		if _, err := LifecycleCommand(spec, "restart"); err == nil {
			t.Errorf("expected %q rejected", spec)
		}
	}
}

func TestArtifactFetchChecksSHA256(t *testing.T) {
	body := []byte("artifact-bytes")
	sum := sha256.Sum256(body)
	sha := hex.EncodeToString(sum[:])
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/deployer-artifacts/f1" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if r.Header.Get("X-Service-Token") != "svc-token" {
			t.Errorf("service token header missing")
		}
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	c := NewArtifactClient(&conf.Config{Deployer: &conf.Deployer{
		ArtifactServiceBaseURL: srv.URL,
		ArtifactServiceToken:   "svc-token",
	}})
	got, err := c.Fetch(context.Background(), "f1", sha)
	if err != nil || string(got) != string(body) {
		t.Fatalf("fetch failed: %v", err)
	}
	if _, err := c.Fetch(context.Background(), "f1", strings.Repeat("0", 64)); err == nil {
		t.Fatal("expected sha256 mismatch to be rejected")
	}
}

func TestArtifactFetchRejectsAnonymousDownload(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Service-Token") != "svc-token" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	c := NewArtifactClient(&conf.Config{Deployer: &conf.Deployer{
		ArtifactServiceBaseURL: srv.URL,
		ArtifactServiceToken:   "",
	}})
	if _, err := c.Fetch(context.Background(), "f1", ""); err == nil {
		t.Fatal("expected download without service token to fail")
	}
}
