import subprocess, sys

MYSQL = ['mysql', '-h127.0.0.1', '-P3136', '-ustarland', '-pStarland*Ttufo101',
         '--default-character-set=utf8mb4', '-D', 'starlandbd', '-N', '-B', '-e']
SCHEMA = 'starlandbd'

def q(sql):
    p = subprocess.Popen(MYSQL + [sql], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         universal_newlines=True)
    out, err = p.communicate()
    if p.returncode != 0:
        print('MYSQL_ERR', err.strip()[:300])
        sys.exit(1)
    return out.strip()

def has_col(table, col):
    return q('SELECT COUNT(*) FROM information_schema.columns WHERE table_schema="' + SCHEMA +
             '" AND table_name="' + table + '" AND column_name="' + col + '"') == '1'

statements = [
'''CREATE TABLE IF NOT EXISTS t_app_definition (
  app_id varchar(64) NOT NULL,
  app_key varchar(64) NOT NULL,
  display_name varchar(128) NOT NULL DEFAULT '',
  service_type varchar(16) NOT NULL,
  config_filename varchar(128) NOT NULL DEFAULT '',
  config_target_path varchar(256) NOT NULL DEFAULT '',
  bin_target_path varchar(256) NOT NULL DEFAULT '',
  identity_path varchar(256) NOT NULL DEFAULT '',
  start_cmd varchar(32) NOT NULL DEFAULT '',
  stop_cmd varchar(32) NOT NULL DEFAULT '',
  restart_cmd varchar(32) NOT NULL DEFAULT '',
  health_check varchar(32) NOT NULL DEFAULT '',
  created_by varchar(64) NOT NULL DEFAULT '',
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id),
  UNIQUE KEY uk_app_key (app_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='发布中心-应用定义：命令类字段全部枚举，禁止自由文本' ''',

'''CREATE TABLE IF NOT EXISTS t_app_version (
  version_id varchar(64) NOT NULL,
  app_id varchar(64) NOT NULL,
  version_no int NOT NULL,
  bin_file_id varchar(64) NOT NULL,
  bin_filename varchar(255) NOT NULL DEFAULT '',
  bin_sha256 varchar(64) NOT NULL DEFAULT '',
  bin_size varchar(32) NOT NULL DEFAULT '0',
  config_file_id varchar(64) NOT NULL DEFAULT '',
  config_filename varchar(255) NOT NULL DEFAULT '',
  config_sha256 varchar(64) NOT NULL DEFAULT '',
  change_note varchar(512) NOT NULL DEFAULT '',
  is_stable tinyint NOT NULL DEFAULT 0,
  created_by varchar(64) NOT NULL DEFAULT '',
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version_id),
  UNIQUE KEY uk_app_version_no (app_id, version_no),
  KEY idx_app_id (app_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='发布中心-应用版本：制品与统一配置模板创建后不可变' ''',

'''CREATE TABLE IF NOT EXISTS t_app_deployment (
  app_id varchar(64) NOT NULL,
  node_id varchar(64) NOT NULL,
  current_version varchar(16) NOT NULL DEFAULT '',
  last_success_version varchar(16) NOT NULL DEFAULT '',
  previous_version varchar(16) NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'healthy',
  last_batch_id varchar(64) NOT NULL DEFAULT '',
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, node_id),
  KEY idx_node_id (node_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='发布中心-部署台账：current=实况版本，失败时如实记录' ''',
]

for sql in statements:
    q(sql)
    print('OK', sql.split('\n')[0][:70])

alters = [
    ('t_operation_batch', 'mode', "ALTER TABLE t_operation_batch ADD COLUMN mode varchar(16) NOT NULL DEFAULT 'operation' AFTER operation_id"),
    ('t_node_task', 'from_version', "ALTER TABLE t_node_task ADD COLUMN from_version varchar(16) NOT NULL DEFAULT '' AFTER node_id"),
    ('t_node_task', 'to_version', "ALTER TABLE t_node_task ADD COLUMN to_version varchar(16) NOT NULL DEFAULT '' AFTER from_version"),
    ('t_node_task', 'health_result', "ALTER TABLE t_node_task ADD COLUMN health_result varchar(255) NOT NULL DEFAULT '' AFTER to_version"),
]
for table, col, sql in alters:
    if has_col(table, col):
        print('SKIP column exists', table, col)
    else:
        q(sql)
        print('OK added column', table, col)

cols = q('SELECT table_name, GROUP_CONCAT(column_name ORDER BY ordinal_position) FROM information_schema.columns '
         'WHERE table_schema="' + SCHEMA + '" AND table_name IN '
         '("t_app_definition","t_app_version","t_app_deployment","t_operation_batch","t_node_task") GROUP BY table_name')
print('=== VERIFY ===')
print(cols)
print('S2_SQL_OK')
