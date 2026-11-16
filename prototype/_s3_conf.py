import base64, io, shutil, time

TOKEN = base64.b64decode('__TOKEN_B64__').decode('utf-8').strip()
FILES = ['/opt/deployer/conf/config.yaml',
         '/root/sproj/starland/apps/deployer/conf/config.yaml']
ANCHOR = '  log_dir: "/opt/deployer/logs"'
BLOCK = '''  log_dir: "/opt/deployer/logs"
  # 发布中心制品通道：文件服务在 develop-tg，必须用可达的跨机地址，不能写 127.0.0.1。
  artifact_service_base_url: "http://106.52.77.108"
  artifact_service_token: "__TOKEN__"
  gateway_url: "http://47.120.10.73:12001/startlandapi"
  artifact_cache_dir: "/opt/deployer/artifacts"'''

if not TOKEN:
    raise SystemExit('SERVICE_TOKEN is empty')
for p in FILES:
    s = io.open(p, encoding='utf-8').read()
    if 'artifact_service_base_url' in s:
        print('SKIP already configured', p)
        continue
    if s.count(ANCHOR) != 1:
        print('ANCHOR_COUNT', p, s.count(ANCHOR))
        raise SystemExit(1)
    bak = p + '.bak-' + time.strftime('%Y%m%d%H%M%S')
    shutil.copy2(p, bak)
    io.open(p, 'w', encoding='utf-8', newline='').write(
        s.replace(ANCHOR, BLOCK.replace('__TOKEN__', TOKEN), 1))
    print('OK', p, 'backup', bak)
print('S3_CONFIG_OK token_len', len(TOKEN))
