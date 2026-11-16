import io, sys

def patch(path, old, new, tag):
    s = io.open(path, encoding='utf-8').read()
    if tag in s:
        print('SKIP', path, tag); return
    if s.count(old) != 1:
        print('ANCHOR_COUNT', path, s.count(old)); sys.exit(1)
    io.open(path, 'w', encoding='utf-8', newline='').write(s.replace(old, new, 1))
    print('OK', path, tag)

ROOT = '/root/sproj/starland/apps/deployer'

patch(ROOT + '/internal/conf/conf.go',
'''	LogDir            string `json:"log_dir" yaml:"log_dir"`
}''',
'''	LogDir            string `json:"log_dir" yaml:"log_dir"`
	// 发布中心制品通道：文件服务在 develop-tg，deployer 在 develop-hy，
	// 地址必须用可达的跨机地址，不能写 127.0.0.1（admin 回查踩过同样的坑）。
	ArtifactServiceBaseURL string `json:"artifact_service_base_url" yaml:"artifact_service_base_url"`
	ArtifactServiceToken   string `json:"artifact_service_token" yaml:"artifact_service_token"`
	// 节点身份文件中的 gateway-url；初始化时写入目标机 identity 文件。
	GatewayURL             string `json:"gateway_url" yaml:"gateway_url"`
	// 制品下载缓存目录，仅作临时落盘，事实源是 MinIO。
	ArtifactCacheDir       string `json:"artifact_cache_dir" yaml:"artifact_cache_dir"`
}''', 'ArtifactServiceBaseURL')

patch(ROOT + '/internal/service/common.go',
'''	exec   *executor.SSHExecutor
	worker *executor.Worker
}''',
'''	exec         *executor.SSHExecutor
	worker       *executor.Worker
	deployWorker *executor.DeployWorker
}''', 'deployWorker field')

patch(ROOT + '/internal/service/common.go',
'''func NewDeployerService(cfg *conf.Config, store *data.Data, exec *executor.SSHExecutor, worker *executor.Worker) *DeployerService {
	return &DeployerService{cfg: cfg, store: store, exec: exec, worker: worker}
}''',
'''func NewDeployerService(cfg *conf.Config, store *data.Data, exec *executor.SSHExecutor, worker *executor.Worker, deployWorker *executor.DeployWorker) *DeployerService {
	return &DeployerService{cfg: cfg, store: store, exec: exec, worker: worker, deployWorker: deployWorker}
}''', 'NewDeployerService signature')

patch(ROOT + '/cmd/main.go',
'''	worker := executor.NewWorker(store, exec, &cfg)
	svc := service.NewDeployerService(&cfg, store, exec, worker)''',
'''	worker := executor.NewWorker(store, exec, &cfg)
	deployWorker := executor.NewDeployWorker(store, exec, &cfg)
	svc := service.NewDeployerService(&cfg, store, exec, worker, deployWorker)''', 'main deployWorker')

print('S3_WIRING_OK')
