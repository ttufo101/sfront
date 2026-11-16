import io, sys

p = '/root/sproj/proto/starland/deployer.proto'
s = io.open(p, encoding='utf-8').read()
pairs = [
    ('rpc ListAppVersions (ListAppVersionsRequest) returns (ListAppVersionsResponse);',
     'rpc ListAppVersions (ListDeployVersionsRequest) returns (ListDeployVersionsResponse);'),
    ('message ListAppVersionsRequest {', 'message ListDeployVersionsRequest {'),
    ('message ListAppVersionsResponse {', 'message ListDeployVersionsResponse {'),
]
for old, new in pairs:
    if s.count(old) != 1:
        print('PROTO_COUNT', old, s.count(old)); sys.exit(1)
    s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('PROTO_RENAME_OK')

g = '/root/sproj/starland/apps/deployer/internal/service/release.go'
t = io.open(g, encoding='utf-8').read()
for old, new in [('pb.ListAppVersionsRequest', 'pb.ListDeployVersionsRequest'),
                 ('pb.ListAppVersionsResponse', 'pb.ListDeployVersionsResponse')]:
    if old not in t:
        print('GO_MISSING', old); sys.exit(1)
    t = t.replace(old, new)
io.open(g, 'w', encoding='utf-8', newline='').write(t)
print('GO_RENAME_OK')
