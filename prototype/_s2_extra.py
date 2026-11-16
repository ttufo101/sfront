import subprocess, sys
MYSQL = ['mysql', '-h127.0.0.1', '-P3136', '-ustarland', '-pStarland*Ttufo101',
         '-D', 'starlandbd', '-N', '-B', '-e']

def q(sql):
    p = subprocess.Popen(MYSQL + [sql], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         universal_newlines=True)
    out, err = p.communicate()
    if p.returncode != 0:
        print('MYSQL_ERR', err.strip()[:300]); sys.exit(1)
    return out.strip()

for col, ddl in [
    ('app_id', "ALTER TABLE t_operation_batch ADD COLUMN app_id varchar(64) NOT NULL DEFAULT '' AFTER operation_id"),
    ('target_version', "ALTER TABLE t_operation_batch ADD COLUMN target_version varchar(16) NOT NULL DEFAULT '' AFTER app_id"),
]:
    n = q('SELECT COUNT(*) FROM information_schema.columns WHERE table_schema="starlandbd" '
          'AND table_name="t_operation_batch" AND column_name="' + col + '"')
    if n == '1':
        print('SKIP exists', col)
    else:
        q(ddl)
        print('OK added', col)
print(q('SELECT GROUP_CONCAT(column_name ORDER BY ordinal_position) FROM information_schema.columns '
        'WHERE table_schema="starlandbd" AND table_name="t_operation_batch"'))
print('S2_EXTRA_COLUMNS_OK')
