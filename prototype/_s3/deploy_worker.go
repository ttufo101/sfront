package executor

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"deployer/internal/conf"
	"deployer/internal/data"
	"github.com/ttufo101/kit/log"
)

// DeployWorker 执行发布批次：三入口（install / upgrade / rollback）汇聚的同一条异步通道。
// 关键点：install / upgrade / rollback 走完全相同的「统一模板 + 本机 identity 合成」路径，
// 代码里没有 first_install 分支，因为读的是 identity 文件而不是旧 config.yaml。
type DeployWorker struct {
	store     *data.Data
	exec      *SSHExecutor
	cfg       *conf.Config
	artifacts *ArtifactClient
	locks     sync.Map
}

func NewDeployWorker(store *data.Data, exec *SSHExecutor, cfg *conf.Config) *DeployWorker {
	return &DeployWorker{store: store, exec: exec, cfg: cfg, artifacts: NewArtifactClient(cfg)}
}

// Start 只写任务表后立即返回，全部动作在后台执行（网关 15s 超时）。
func (w *DeployWorker) Start(batchID string) { go w.run(batchID) }

func (w *DeployWorker) run(batchID string) {
	ctx := context.Background()
	appID, target, mode, concurrency, err := w.store.DeployBatchContext(ctx, batchID)
	if err != nil {
		log.Errorf("deployer: load deploy batch %s context failed: %v", batchID, err)
		return
	}
	app, err := w.store.GetAppDefinition(ctx, appID)
	if err != nil {
		log.Errorf("deployer: load app definition %s failed: %v", appID, err)
		return
	}
	ver, err := w.store.GetAppVersion(ctx, appID, target)
	if err != nil {
		log.Errorf("deployer: load app version %s/%s failed: %v", appID, target, err)
		return
	}
	_, items, err := w.store.GetDeployBatch(ctx, batchID)
	if err != nil {
		log.Errorf("deployer: load deploy items %s failed: %v", batchID, err)
		return
	}
	if concurrency < 1 {
		concurrency = 1
	}
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for _, it := range items {
		if it.Status != "queued" {
			continue
		}
		wg.Add(1)
		go func(it *data.DeployItemRow) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			w.runItem(ctx, batchID, appID, app, ver, it, mode)
		}(it)
	}
	wg.Wait()
	if err := w.store.RecomputeBatch(ctx, batchID); err != nil {
		log.Errorf("deployer: recompute deploy batch %s failed: %v", batchID, err)
	}
}

func (w *DeployWorker) runItem(ctx context.Context, batchID, appID string,
	app *data.AppDefinition, ver *data.AppVersion, it *data.DeployItemRow, mode string) {
	v, _ := w.locks.LoadOrStore(it.NodeID, &sync.Mutex{})
	mu := v.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	status, health, errMsg := "failed", "skipped", ""
	node, err := w.store.GetNode(ctx, it.NodeID)
	if err != nil {
		errMsg = "load node: " + err.Error()
	} else {
		if err := w.store.StartDeployTask(ctx, it.TaskID); err != nil {
			log.Errorf("deployer: start task %s failed: %v", it.TaskID, err)
			return
		}
		status, health, errMsg = w.deployOne(ctx, app, ver, *node, it.TaskID, it.ToVersion, mode)
	}
	if err := w.store.FinishDeployItem(ctx, it.TaskID, batchID, appID, it.NodeID,
		it.ToVersion, status, health, errMsg); err != nil {
		log.Errorf("deployer: finish deploy task %s failed: %v", it.TaskID, err)
	}
}

func (w *DeployWorker) deployOne(ctx context.Context, app *data.AppDefinition,
	ver *data.AppVersion, node data.NodeAsset, taskID, targetVersion, mode string) (string, string, string) {
	itemCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	short := 10 * time.Second
	long := 60 * time.Second

	// 1) identity 前置：文件缺失直接拒绝，绝不生成或猜测节点密码。
	if err := ValidateRemotePath(app.IdentityPath); err != nil {
		return "failed", "skipped", "invalid identity path: " + err.Error()
	}
	ok, err := w.exec.FileExists(itemCtx, node, app.IdentityPath, short)
	if err != nil {
		return "failed", "skipped", "probe identity: " + err.Error()
	}
	if !ok {
		return "failed", "skipped", "node identity is missing; initialize node identity first"
	}

	// 2) 从 MinIO 拉制品与统一配置模板，逐项校验 sha256。
	bin, err := w.artifacts.Fetch(itemCtx, ver.BinFileID, ver.BinSHA256)
	if err != nil {
		return "failed", "skipped", "download artifact: " + err.Error()
	}
	var merged []byte
	if ver.ConfigFileID != "" {
		tpl, err := w.artifacts.Fetch(itemCtx, ver.ConfigFileID, ver.ConfigSHA256)
		if err != nil {
			return "failed", "skipped", "download config template: " + err.Error()
		}
		identity, err := w.exec.ReadIdentity(itemCtx, node, app.IdentityPath, short)
		if err != nil {
			return "failed", "skipped", "read node identity: " + err.Error()
		}
		merged = append([]byte{}, tpl...)
		if !strings.HasSuffix(string(merged), "\n") {
			merged = append(merged, '\n')
		}
		merged = append(merged, []byte("\n# ---- node identity (managed locally, never overwritten) ----\n")...)
		merged = append(merged, []byte(identity)...)
		merged = append(merged, '\n')
	}

	// 3) 写制品到临时文件；命令只含校验过的路径。
	suffix := ".tgz"
	if strings.HasSuffix(strings.ToLower(ver.BinFilename), ".zip") {
		suffix = ".zip"
	}
	tmp := "/tmp/starland-deploy-" + taskID + suffix
	if err := w.exec.WriteFile(itemCtx, node, tmp, bin, "0600", long); err != nil {
		return "failed", "skipped", err.Error()
	}
	defer func() {
		_, _, _ = w.exec.Run(ctx, node, "rm -f "+shellQuote(tmp), short, 1024)
	}()

	// 4) 合成配置并写回（身份段来自本机文件，升级/回滚永不覆盖）。
	if merged != nil {
		if err := ValidateRemotePath(app.ConfigTargetPath); err != nil {
			return "failed", "skipped", "invalid config path: " + err.Error()
		}
		if err := w.exec.WriteFile(itemCtx, node, app.ConfigTargetPath, merged, "0644", long); err != nil {
			return "failed", "skipped", err.Error()
		}
	}

	// 5) 解压制品到目标目录。
	if err := ValidateRemotePath(app.BinTargetPath); err != nil {
		return "failed", "skipped", "invalid bin path: " + err.Error()
	}
	extract := "mkdir -p " + shellQuote(app.BinTargetPath) + " && "
	if suffix == ".zip" {
		extract += "unzip -oq " + shellQuote(tmp) + " -d " + shellQuote(app.BinTargetPath)
	} else {
		extract += "tar -xzf " + shellQuote(tmp) + " -C " + shellQuote(app.BinTargetPath)
	}
	code, out, err := w.exec.Run(itemCtx, node, extract, long, 8192)
	if err != nil {
		return "failed", "skipped", "extract artifact: " + err.Error()
	}
	if code != 0 {
		return "failed", "skipped", fmt.Sprintf("extract artifact exited %d: %s", code, strings.TrimSpace(out))
	}

	// 6) 重启（枚举映射固定命令）。
	restart, err := LifecycleCommand(app.RestartCmd, "restart")
	if err != nil {
		return "failed", "skipped", err.Error()
	}
	code, out, err = w.exec.Run(itemCtx, node, restart, long, 8192)
	if err != nil {
		return "failed", "skipped", "restart: " + err.Error()
	}
	if code != 0 {
		return "failed", "skipped", fmt.Sprintf("restart exited %d: %s", code, strings.TrimSpace(out))
	}

	// 7) 健康检查；失败不自动回滚，台账如实记录实况版本。
	health := "skipped"
	if app.HealthCheck != "" && app.HealthCheck != "none" {
		hc, err := LifecycleCommand(app.HealthCheck, "health")
		if err != nil {
			return "failed", "skipped", err.Error()
		}
		code, out, err = w.exec.Run(itemCtx, node, hc, short, 4096)
		if err != nil {
			return "failed", "failed", "health check: " + err.Error()
		}
		if code != 0 {
			return "failed", "failed", fmt.Sprintf("health check failed: %s", strings.TrimSpace(out))
		}
		health = "passed"
	}
	_ = targetVersion
	_ = mode
	return "succeeded", health, ""
}
