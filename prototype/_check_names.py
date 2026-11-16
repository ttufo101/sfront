import re, io
a = io.open('/root/sproj/proto/starland/admin.proto', encoding='utf-8').read()
d = io.open('/root/sproj/proto/starland/deployer.proto', encoding='utf-8').read()
am = set(re.findall(r'^message\s+(\w+)', a, re.M))
dm = set(re.findall(r'^message\s+(\w+)', d, re.M))
print('ADMIN_MESSAGES', len(am), 'DEPLOYER_MESSAGES', len(dm))
print('COLLISIONS', sorted(am & dm))
