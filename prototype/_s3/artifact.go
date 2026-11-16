package executor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"deployer/internal/conf"
	"deployer/internal/data"
	"golang.org/x/crypto/ssh"
)

var safePathPattern = regexp.MustCompile(`^/[A-Za-z0-9_./-]{1,200}$`)
var safeUnitPattern = regexp.MustCompile(`^[A-Za-z0-9_.@-]{1,128}$`)

func ValidateRemotePath(p string) error {
	if !safePathPattern.MatchString(p) || strings.Contains(p, "..") {
		return fmt.Errorf("unsafe remote path %q", p)
	}
	return nil
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// ArtifactClient 从文件服务鉴权下载制品与统一配置模板。
// 服务端制品不开放匿名 GetObject：必须携带 X-Service-Token。
// 文件服务在 develop-tg、deployer 在 develop-hy，base URL 不能是 127.0.0.1。
type ArtifactClient struct {
	cfg *conf.Config
	hc  *http.Client
}

func NewArtifactClient(cfg *conf.Config) *ArtifactClient {
	return &ArtifactClient{cfg: cfg, hc: &http.Client{Timeout: 60 * time.Second}}
}

func (a *ArtifactClient) Fetch(ctx context.Context, fileID, expectedSHA string) ([]byte, error) {
	if fileID == "" {
		return nil, fmt.Errorf("artifact file_id is empty")
	}
	base := strings.TrimRight(strings.TrimSpace(a.cfg.Deployer.ArtifactServiceBaseURL), "/")
	if base == "" {
		return nil, fmt.Errorf("artifact_service_base_url is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		base+"/api/v1/deployer-artifacts/"+fileID, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Service-Token", a.cfg.Deployer.ArtifactServiceToken)
	resp, err := a.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("artifact download failed: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 512<<20))
	if err != nil {
		return nil, err
	}
	if expectedSHA != "" {
		sum := sha256.Sum256(body)
		if !strings.EqualFold(hex.EncodeToString(sum[:]), expectedSHA) {
			return nil, fmt.Errorf("artifact sha256 mismatch for %s", fileID)
		}
	}
	return body, nil
}

// WriteFile 通过 SSH stdin + base64 写目标机文件，命令只含校验过的路径与固定模式。
// 明文（含节点身份）只在内存与加密通道中出现，绝不写日志、任务表或数据库。
func (e *SSHExecutor) WriteFile(ctx context.Context, node data.NodeAsset, remotePath string, content []byte, mode string, timeout time.Duration) error {
	if err := ValidateRemotePath(remotePath); err != nil {
		return err
	}
	if mode != "0600" && mode != "0644" && mode != "0755" {
		return fmt.Errorf("unsupported file mode")
	}
	cc, err := e.clientConfig(ctx, node, timeout)
	if err != nil {
		return err
	}
	addr := net.JoinHostPort(node.SSHHost, strconv.Itoa(int(node.SSHPort)))
	client, err := ssh.Dial("tcp", addr, cc)
	if err != nil {
		return err
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	session.Stdin = bytes.NewReader([]byte(base64.StdEncoding.EncodeToString(content)))
	cmd := "base64 -d > " + shellQuote(remotePath) + " && chmod " + mode + " " + shellQuote(remotePath)
	out, runErr := session.CombinedOutput(cmd)
	if runErr != nil {
		return fmt.Errorf("write %s: %v: %s", remotePath, runErr, strings.TrimSpace(string(out)))
	}
	return nil
}

// FileExists 用于 identity 前置探测：identity 不建表，靠目标机文件判断。
func (e *SSHExecutor) FileExists(ctx context.Context, node data.NodeAsset, remotePath string, timeout time.Duration) (bool, error) {
	if err := ValidateRemotePath(remotePath); err != nil {
		return false, err
	}
	code, _, err := e.Run(ctx, node, "test -f "+shellQuote(remotePath), timeout, 1024)
	if err != nil {
		return false, err
	}
	return code == 0, nil
}

// ReadIdentity 读取本机身份 3 行。返回内容只用于合成 config.yaml，
// 调用方不得写入日志、任务表或任何响应。
func (e *SSHExecutor) ReadIdentity(ctx context.Context, node data.NodeAsset, remotePath string, timeout time.Duration) (string, error) {
	if err := ValidateRemotePath(remotePath); err != nil {
		return "", err
	}
	code, out, err := e.Run(ctx, node, "cat "+shellQuote(remotePath), timeout, 32<<10)
	if err != nil {
		return "", err
	}
	if code != 0 {
		return "", fmt.Errorf("identity file is not readable")
	}
	return strings.TrimRight(out, "\n"), nil
}

// LifecycleCommand 把应用定义里的枚举映射成固定命令，杜绝命令注入。
func LifecycleCommand(spec, action string) (string, error) {
	parts := strings.SplitN(spec, ":", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid lifecycle spec %q", spec)
	}
	switch parts[0] {
	case "systemd":
		if !safeUnitPattern.MatchString(parts[1]) {
			return "", fmt.Errorf("invalid systemd unit")
		}
		switch action {
		case "restart":
			return "systemctl restart " + parts[1], nil
		case "health":
			return "systemctl is-active " + parts[1], nil
		}
	case "script":
		if err := ValidateRemotePath(parts[1]); err != nil {
			return "", err
		}
		switch action {
		case "restart":
			return shellQuote(parts[1]) + " restart", nil
		case "health":
			return shellQuote(parts[1]) + " status", nil
		}
	}
	return "", fmt.Errorf("unsupported lifecycle action %s for %s", action, parts[0])
}
