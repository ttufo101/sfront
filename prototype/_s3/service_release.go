// Package service · 应用发布中心的 13 个 RPC。
// 设计约束见 release-center.md：三入口汇聚一个 StartDeploy；回滚目标人工指定；
// 失败不自动回滚、台账如实记实况；明文凭据不进网关/日志/任务表。
package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	stderrors "errors"
	"strings"
	"sync"
	"time"

	"deployer/internal/data"
	"deployer/internal/executor"
	pb "github.com/ttufo101/api/starland"
	"github.com/ttufo101/xrpc/errors"
	"golang.org/x/crypto/bcrypt"
)

var appKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,63}$`)

func versionNo(label string) int32 {
	var n int32
	if _, err := fmt.Sscanf(label, "v%d", &n); err != nil {
		return 0
	}
	return n
}

func toPBApp(a *data.AppDefinition) *pb.AppDefinition {
	if a == nil {
		return nil
	}
	return &pb.AppDefinition{
		AppId: a.AppID, AppKey: a.AppKey, DisplayName: a.DisplayName, ServiceType: a.ServiceType,
		ConfigFilename: a.ConfigFilename, ConfigTargetPath: a.ConfigTargetPath,
		BinTargetPath: a.BinTargetPath, IdentityPath: a.IdentityPath,
		StartCmd: a.StartCmd, StopCmd: a.StopCmd, RestartCmd: a.RestartCmd,
		HealthCheck: a.HealthCheck, CreatedBy: a.CreatedBy,
		CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt,
	}
}

func toPBVersion(v *data.AppVersion) *pb.AppVersion {
	if v == nil {
		return nil
	}
	return &pb.AppVersion{
		VersionId: v.VersionID, AppId: v.AppID, VersionNo: v.VersionNo, VersionLabel: v.Label(),
		BinFileId: v.BinFileID, BinFilename: v.BinFilename, BinSha256: v.BinSHA256, BinSize: v.BinSize,
		ConfigFileId: v.ConfigFileID, ConfigFilename: v.ConfigFilename, ConfigSha256: v.ConfigSHA256,
		ChangeNote: v.ChangeNote, IsStable: v.IsStable, CreatedBy: v.CreatedBy, CreatedAt: v.CreatedAt,
	}
}

func toPBBatch(b *data.DeployBatchRow, items []*data.DeployItemRow) *pb.DeployBatch {
	out := &pb.DeployBatch{
		BatchId: b.BatchID, AppId: b.AppID, Mode: b.Mode, TargetVersion: b.TargetVersion,
		Operator: b.Operator, Status: b.Status, Total: b.Total, Succeeded: b.Succeeded,
		Failed: b.Failed, Concurrency: b.Concurrency, CreatedAt: b.CreatedAt, FinishedAt: b.FinishedAt,
	}
	for _, it := range items {
		out.Items = append(out.Items, &pb.DeployItem{
			TaskId: it.TaskID, BatchId: it.BatchID, NodeId: it.NodeID, PublicIp: it.PublicIP,
			FromVersion: it.FromVersion, ToVersion: it.ToVersion, Status: it.Status,
			HealthResult: it.HealthResult, Error: it.ErrMsg,
			StartedAt: it.StartedAt, FinishedAt: it.FinishedAt,
		})
		if it.Status == "skipped" {
			out.Skipped++
		}
	}
	return out
}

// ---------- 应用定义 ----------

func (s *DeployerService) ListAppDefinitions(ctx context.Context, _ *pb.ListAppDefinitionsRequest) (*pb.ListAppDefinitionsResponse, error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	list, err := s.store.ListAppDefinitions(ctx)
	if err != nil {
		return nil, err
	}
	resp := &pb.ListAppDefinitionsResponse{}
	for _, a := range list {
		resp.Apps = append(resp.Apps, toPBApp(a))
	}
	return resp, nil
}

func (s *DeployerService) GetAppDefinition(ctx context.Context, req *pb.GetAppDefinitionRequest) (*pb.GetAppDefinitionResponse, error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	a, err := s.store.GetAppDefinition(ctx, req.GetAppId())
	if err != nil {
		return nil, err
	}
	return &pb.GetAppDefinitionResponse{App: toPBApp(a)}, nil
}

func (s *DeployerService) CreateAppDefinition(ctx context.Context, req *pb.CreateAppDefinitionRequest) (*pb.CreateAppDefinitionResponse, error) {
	uid, err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	key := strings.TrimSpace(req.GetAppKey())
	if !appKeyPattern.MatchString(key) {
		return nil, errors.BadRequest("app_key must be 2-64 lowercase letters, digits or -")
	}
	if req.GetServiceType() != "relay" && req.GetServiceType() != "landing" {
		return nil, errors.BadRequest("service_type must be relay or landing")
	}
	for _, p := range []string{req.GetConfigTargetPath(), req.GetBinTargetPath(), req.GetIdentityPath()} {
		if err := executor.ValidateRemotePath(p); err != nil {
			return nil, errors.BadRequest(err.Error())
		}
	}
	// 命令字段只接受后端白名单可映射的枚举，拒绝任何自由文本命令。
	for _, spec := range []string{req.GetStartCmd(), req.GetStopCmd(), req.GetRestartCmd(), req.GetHealthCheck()} {
		if spec == "none" || spec == "" {
			continue
		}
		if _, err := executor.LifecycleCommand(spec, "restart"); err != nil {
			return nil, errors.BadRequest("invalid lifecycle enum: " + err.Error())
		}
	}
	a := &data.AppDefinition{
		AppID: newID("app"), AppKey: key, DisplayName: strings.TrimSpace(req.GetDisplayName()),
		ServiceType: req.GetServiceType(), ConfigFilename: req.GetConfigFilename(),
		ConfigTargetPath: req.GetConfigTargetPath(), BinTargetPath: req.GetBinTargetPath(),
		IdentityPath: req.GetIdentityPath(), StartCmd: req.GetStartCmd(), StopCmd: req.GetStopCmd(),
		RestartCmd: req.GetRestartCmd(), HealthCheck: req.GetHealthCheck(), CreatedBy: uid,
	}
	if err := s.store.CreateAppDefinition(ctx, a); err != nil {
		return nil, err
	}
	s.audit(ctx, uid, "create_app_definition", "app", a.AppID, "app_key="+key)
	stored, err := s.store.GetAppDefinition(ctx, a.AppID)
	if err != nil {
		return nil, err
	}
	return &pb.CreateAppDefinitionResponse{App: toPBApp(stored)}, nil
}

// ---------- 版本 ----------

func (s *DeployerService) ListAppVersions(ctx context.Context, req *pb.ListAppVersionsRequest) (*pb.ListAppVersionsResponse, error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	list, err := s.store.ListAppVersions(ctx, req.GetAppId())
	if err != nil {
		return nil, err
	}
	resp := &pb.ListAppVersionsResponse{}
	for _, v := range list {
		resp.Versions = append(resp.Versions, toPBVersion(v))
	}
	return resp, nil
}

func (s *DeployerService) CreateAppVersion(ctx context.Context, req *pb.CreateAppVersionRequest) (*pb.CreateAppVersionResponse, error) {
	uid, err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.store.GetAppDefinition(ctx, req.GetAppId()); err != nil {
		return nil, errors.BadRequest("app definition not found")
	}
	if req.GetBinFileId() == "" || len(req.GetBinSha256()) != 64 {
		return nil, errors.BadRequest("bin_file_id and a 64-char bin_sha256 are required")
	}
	v := &data.AppVersion{
		VersionID: newID("ver"), AppID: req.GetAppId(),
		BinFileID: req.GetBinFileId(), BinFilename: req.GetBinFilename(),
		BinSHA256: strings.ToLower(req.GetBinSha256()), BinSize: req.GetBinSize(),
		ConfigFileID: req.GetConfigFileId(), ConfigFilename: req.GetConfigFilename(),
		ConfigSHA256: strings.ToLower(req.GetConfigSha256()), ChangeNote: req.GetChangeNote(),
		IsStable: req.GetIsStable(), CreatedBy: uid,
	}
	if err := s.store.CreateAppVersion(ctx, v); err != nil {
		return nil, err
	}
	s.audit(ctx, uid, "create_app_version", "app_version", v.VersionID, req.GetAppId()+" "+v.Label())
	return &pb.CreateAppVersionResponse{Version: toPBVersion(v)}, nil
}

func (s *DeployerService) GetAppVersionConfig(ctx context.Context, req *pb.GetAppVersionConfigRequest) (*pb.GetAppVersionConfigResponse, error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	v, err := s.store.GetAppVersion(ctx, req.GetAppId(), req.GetVersionLabel())
	if err != nil {
		return nil, err
	}
	client := executor.NewArtifactClient(s.cfg)
	tpl, err := client.Fetch(ctx, v.ConfigFileID, v.ConfigSHA256)
	if err != nil {
		return nil, err
	}
	resp := &pb.GetAppVersionConfigResponse{VersionLabel: v.Label(), Template: string(tpl)}
	if req.GetNodeId() != "" {
		// 只给脱敏示意，绝不读取真机 identity 或把任何凭据经网关返回。
		resp.Merged = string(tpl) + "\n# ---- node identity (managed locally) ----\n" +
			"starland-dataplane:\n  gateway-url: <from node-identity.yaml>\n" +
			"  node-id: " + req.GetNodeId() + "\n  node-password: ******\n"
	}
	return resp, nil
}

// ---------- 部署台账与可选节点 ----------

func (s *DeployerService) ListAppDeployments(ctx context.Context, req *pb.ListAppDeploymentsRequest) (*pb.ListAppDeploymentsResponse, error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	list, err := s.store.ListAppDeployments(ctx, req.GetAppId())
	if err != nil {
		return nil, err
	}
	resp := &pb.ListAppDeploymentsResponse{}
	for _, d := range list {
		resp.Deployments = append(resp.Deployments, &pb.AppDeployment{
			AppId: d.AppID, NodeId: d.NodeID, PublicIp: d.PublicIP, DisplayName: d.DisplayName,
			NodeType: d.NodeType, CurrentVersion: d.CurrentVersion,
			LastSuccessVersion: d.LastSuccessVersion, PreviousVersion: d.PreviousVersion,
			Status: d.Status, LastBatchId: d.LastBatchID, UpdatedAt: d.UpdatedAt,
		})
	}
	return resp, nil
}

func (s *DeployerService) ListDeployableNodes(ctx context.Context, req *pb.ListDeployableNodesRequest) (*pb.ListDeployableNodesResponse, error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	nodes, err := s.store.ListDeployableNodes(ctx, req.GetServiceType())
	if err != nil {
		return nil, err
	}
	appID := req.GetAppId()
	identityPath := ""
	if appID != "" {
		if a, e := s.store.GetAppDefinition(ctx, appID); e == nil {
			identityPath = a.IdentityPath
		}
	}
	// identity 不建表：并发探测目标机文件，单台 4s 超时，整体不超过网关 10s。
	out := make([]*pb.DeployableNode, len(nodes))
	var wg sync.WaitGroup
	for i, n := range nodes {
		wg.Add(1)
		go func(i int, n *data.NodeAsset) {
			defer wg.Done()
			ready := false
			if identityPath != "" {
				probeCtx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
				ok, e := s.exec.FileExists(probeCtx, *n, identityPath, 4*time.Second)
				cancel()
				ready = e == nil && ok
			}
			cur, _ := s.store.DeploymentVersion(context.Background(), appID, n.NodeID)
			out[i] = &pb.DeployableNode{
				NodeId: n.NodeID, PublicIp: n.PublicIP, DisplayName: n.DisplayName,
				NodeType: n.NodeType, IdentityReady: ready, CurrentVersion: cur,
				ListingStatus: n.ListingStatus,
			}
		}(i, n)
	}
	wg.Wait()
	return &pb.ListDeployableNodesResponse{Nodes: out}, nil
}

// ---------- 一次性节点身份初始化 ----------

func nodeIdentityPath(nodeType string) (string, error) {
	switch nodeType {
	case "relay":
		return "/opt/mihomo/conf/node-identity.yaml", nil
	case "landing":
		return "/opt/hysteria/conf/node-identity.yaml", nil
	}
	return "", fmt.Errorf("unsupported node_type %q", nodeType)
}

func (s *DeployerService) InitNodeIdentity(ctx context.Context, req *pb.InitNodeIdentityRequest) (*pb.InitNodeIdentityResponse, error) {
	uid, err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	nodeID := strings.TrimSpace(req.GetNodeId())
	dpID := strings.TrimSpace(req.GetDataplaneNodeId())
	if dpID == "" {
		return nil, errors.BadRequest("dataplane_node_id must be explicitly confirmed")
	}
	node, err := s.store.GetNode(ctx, nodeID)
	if err != nil {
		return nil, errors.BadRequest("node not found or deleted")
	}
	path, err := nodeIdentityPath(node.NodeType)
	if err != nil {
		return nil, errors.BadRequest(err.Error())
	}
	exists, err := s.store.DataPlaneNodeExists(ctx, dpID)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, errors.BadRequest("node identity already initialized")
	}
	probeCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	fileExists, err := s.exec.FileExists(probeCtx, *node, path, 8*time.Second)
	cancel()
	if err != nil {
		return nil, err
	}
	if fileExists {
		return nil, errors.BadRequest("identity file already exists on target host")
	}

	// 与 admin.newDataPlaneNodePassword 规则完全一致：32 字节随机 + base64url + bcrypt。
	// 各 app 为独立 Go module，抽公共包需给 proto module 引入 bcrypt 依赖并重编译 admin；
	// P0 保持这段 20 行规则一致的实现，不做跨 module 重构。
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	password := base64.RawURLEncoding.EncodeToString(raw)
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	if err := s.store.InsertDataPlaneNode(ctx, dpID, node.DisplayName, node.PublicIP, string(hash)); err != nil {
		return nil, err
	}
	gatewayURL := strings.TrimSpace(s.cfg.Deployer.GatewayURL)
	if gatewayURL == "" {
		gatewayURL = "http://47.120.10.73:12001/startlandapi"
	}
	identity := fmt.Sprintf("starland-dataplane:\n  gateway-url: %s\n  node-id: %s\n  node-password: %s\n",
		gatewayURL, dpID, password)
	writeCtx, cancel2 := context.WithTimeout(ctx, 15*time.Second)
	err = s.exec.WriteFile(writeCtx, *node, path, []byte(identity), "0600", 15*time.Second)
	cancel2()
	if err != nil {
		// 写文件失败必须补偿刚写入的注册表行，避免留下永不心跳的孤儿节点。
		_ = s.store.RollbackDataPlaneNode(context.Background(), dpID)
		return nil, err
	}
	s.audit(ctx, uid, "init_node_identity", "node", nodeID, "dataplane_node_id="+dpID)
	return &pb.InitNodeIdentityResponse{
		Success: true,
		Message: "node identity initialized; plaintext is never returned or persisted",
	}, nil
}

// ---------- 统一发布动作 ----------

func (s *DeployerService) StartDeploy(ctx context.Context, req *pb.StartDeployRequest) (*pb.StartDeployResponse, error) {
	uid, err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	mode := req.GetMode()
	if mode != "install" && mode != "upgrade" && mode != "rollback" {
		return nil, errors.BadRequest("mode must be install, upgrade or rollback")
	}
	app, err := s.store.GetAppDefinition(ctx, req.GetAppId())
	if err != nil {
		return nil, errors.BadRequest("app definition not found")
	}
	target := req.GetTargetVersion()
	if _, err := s.store.GetAppVersion(ctx, app.AppID, target); err != nil {
		return nil, errors.BadRequest("target version not found: " + target)
	}
	ids := req.GetNodeIds()
	if len(ids) == 0 {
		return nil, errors.BadRequest("node_ids is required")
	}
	seen := map[string]bool{}
	var blocked []string
	specs := make([]data.DeployItemSpec, 0, len(ids))
	targetNo := versionNo(target)
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		node, err := s.store.GetNode(ctx, id)
		if err != nil {
			blocked = append(blocked, id+": node not found or deleted")
			continue
		}
		if node.NodeType != app.ServiceType {
			blocked = append(blocked, id+": service_type mismatch")
			continue
		}
		if node.ListingStatus != "listed" {
			blocked = append(blocked, id+": node is delisted")
			continue
		}
		cur, _ := s.store.DeploymentVersion(ctx, app.AppID, id)
		cmp := targetNo - versionNo(cur)
		switch mode {
		case "upgrade":
			if cmp <= 0 {
				blocked = append(blocked, fmt.Sprintf("%s: target %s is not newer than %s; use rollback", id, target, cur))
				continue
			}
		case "rollback":
			if cmp > 0 {
				blocked = append(blocked, fmt.Sprintf("%s: target %s is newer than %s; use upgrade", id, target, cur))
				continue
			}
		}
		status := "queued"
		if cmp == 0 && mode != "install" {
			status = "skipped"
		}
		specs = append(specs, data.DeployItemSpec{
			TaskID: newID("task"), NodeID: id, FromVersion: cur,
			ToVersion: target, Status: status,
		})
	}
	if len(blocked) > 0 {
		return &pb.StartDeployResponse{Success: false, BlockedReasons: blocked,
			Message: "target validation failed"}, nil
	}
	queued := 0
	for _, it := range specs {
		if it.Status == "queued" {
			queued++
		}
	}
	if queued == 0 {
		return &pb.StartDeployResponse{Success: false,
			BlockedReasons: []string{"all selected nodes are already on the target version"}}, nil
	}

	// 漂移轻量提示：只提示不强制锁；人工置 confirm_drift 后二次提交。
	if !req.GetConfirmDrift() {
		var drifted []string
		for _, snap := range req.GetSnapshots() {
			cur, _ := s.store.DeploymentVersion(ctx, app.AppID, snap.GetNodeId())
			if cur != snap.GetCurrentVersion() {
				drifted = append(drifted, snap.GetNodeId())
			}
		}
		if len(drifted) > 0 {
			return &pb.StartDeployResponse{Success: false, ConfirmRequired: true,
				DriftedNodes: drifted, Message: "node version drift detected; confirm to continue"}, nil
		}
	}

	concurrency := req.GetConcurrency()
	if concurrency < 1 {
		concurrency = 1
	}
	params, _ := json.Marshal(map[string]any{"concurrency": concurrency})
	batchID := newID("B")
	b := &data.DeployBatchRow{
		BatchID: batchID, AppID: app.AppID, Mode: mode, TargetVersion: target,
		Operator: uid, Status: "running", Total: int32(len(specs)), Concurrency: concurrency,
	}
	if err := s.store.CreateDeployBatch(ctx, b, specs, req.GetClientRequestId(), string(params)); err != nil {
		return nil, err
	}
	s.audit(ctx, uid, "start_deploy_"+mode, "app", app.AppID,
		"batch="+batchID+" target="+target+" nodes="+fmt.Sprint(len(specs)))
	s.deployWorker.Start(batchID)
	return &pb.StartDeployResponse{Success: true, BatchID: batchID,
		Message: "deploy batch accepted"}, nil
}

func (s *DeployerService) ListDeployBatches(ctx context.Context, req *pb.ListDeployBatchesRequest) (*pb.ListDeployBatchesResponse, error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	list, err := s.store.ListDeployBatches(ctx, req.GetAppId(), req.GetMode(), req.GetLimit())
	if err != nil {
		return nil, err
	}
	resp := &pb.ListDeployBatchesResponse{}
	for _, b := range list {
		resp.Batches = append(resp.Batches, toPBBatch(b, nil))
	}
	return resp, nil
}

func (s *DeployerService) GetDeployBatch(ctx context.Context, req *pb.GetDeployBatchRequest) (*pb.GetDeployBatchResponse, error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	b, items, err := s.store.GetDeployBatch(ctx, req.GetBatchId())
	if err != nil {
		if stderrors.Is(err, data.ErrNotFound) {
			return nil, errors.BadRequest("deploy batch not found")
		}
		return nil, err
	}
	return &pb.GetDeployBatchResponse{Batch: toPBBatch(b, items)}, nil
}

func (s *DeployerService) RetryDeployItem(ctx context.Context, req *pb.RetryDeployItemRequest) (*pb.RetryDeployItemResponse, error) {
	uid, err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.store.RetryDeployItem(ctx, req.GetBatchId(), req.GetNodeId()); err != nil {
		return nil, errors.BadRequest("only failed items in this batch can be retried")
	}
	s.audit(ctx, uid, "retry_deploy_item", "deploy_batch", req.GetBatchId(), "node="+req.GetNodeId())
	s.deployWorker.Start(req.GetBatchId())
	return &pb.RetryDeployItemResponse{Success: true, Message: "item re-queued in the same batch"}, nil
}
