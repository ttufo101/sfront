import io, sys, time, shutil

FILES = ['/opt/gateway/conf/config.yaml',
         '/root/sproj/starland/apps/gateway/conf/config.yaml']
ANCHOR = '    - "GetTaskLog"\n'
NEW = [
    'ListAppDefinitions', 'GetAppDefinition', 'CreateAppDefinition',
    'CreateAppVersion', 'ListAppVersions', 'GetAppVersionConfig',
    'ListAppDeployments', 'ListDeployableNodes', 'InitNodeIdentity',
    'StartDeploy', 'ListDeployBatches', 'GetDeployBatch', 'RetryDeployItem',
]

for p in FILES:
    s = io.open(p, encoding='utf-8').read()
    if s.count(ANCHOR) != 1:
        print('ANCHOR_COUNT', p, s.count(ANCHOR)); sys.exit(1)
    if '    - "StartDeploy"\n' in s:
        print('SKIP already patched', p); continue
    bak = p + '.bak-' + time.strftime('%Y%m%d%H%M%S')
    shutil.copy2(p, bak)
    block = ''.join('    - "' + m + '"\n' for m in NEW)
    io.open(p, 'w', encoding='utf-8', newline='').write(s.replace(ANCHOR, ANCHOR + block, 1))
    print('OK', p, 'added', len(NEW), 'methods; backup', bak)
print('S2_GATEWAY_OK')
