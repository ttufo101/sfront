// Package data · 应用发布中心的数据访问层。
// 事实源：t_app_definition / t_app_version / t_app_deployment，任务复用 t_operation_batch / t_node_task。
package data

import (
	"context"
	"database/sql"
	"encoding/json"
	stderrors "errors"
	"fmt"
)

type AppDefinition struct {
	AppID, AppKey, DisplayName, ServiceType                       string
	ConfigFilename, ConfigTargetPath, BinTargetPath, IdentityPath string
	StartCmd, StopCmd, RestartCmd, HealthCheck                    string
	CreatedBy, CreatedAt, UpdatedAt                               string
}

type AppVersion struct {
	VersionID, AppID                                          string
	VersionNo                                                 int32
	BinFileID, BinFilename, BinSHA256, BinSize                 string
	ConfigFileID, ConfigFilename, ConfigSHA256                 string
	ChangeNote                                                string
	IsStable                                                  bool
	CreatedBy, CreatedAt                                      string
}

func (v *AppVersion) Label() string { return fmt.Sprintf("v%d", v.VersionNo) }

type AppDeployment struct {
	AppID, NodeID, PublicIP, DisplayName, NodeType              string
	CurrentVersion, LastSuccessVersion, PreviousVersion         string
	Status, LastBatchID, UpdatedAt                              string
}

type DeployBatchRow struct {
	BatchID, AppID, Mode, TargetVersion, Operator, Status       string
	Total, Succeeded, Failed, Concurrency                       int32
	CreatedAt, FinishedAt, ParamsJSON                           string
}

type DeployItemRow struct {
	TaskID, BatchID, NodeID, PublicIP                           string
	FromVersion, ToVersion, Status, HealthResult, ErrMsg        string
	StartedAt, FinishedAt                                       string
}

type DeployItemSpec struct {
	TaskID, NodeID, FromVersion, ToVersion, Status              string
}

const appDefColumns = `app_id, app_key, display_name, service_type, config_filename,
 config_target_path, bin_target_path, identity_path, start_cmd, stop_cmd, restart_cmd, health_check,
 created_by, DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s'), DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s')`

func scanAppDef(s interface{ Scan(...any) error }) (*AppDefinition, error) {
	a := &AppDefinition{}
	err := s.Scan(&a.AppID, &a.AppKey, &a.DisplayName, &a.ServiceType, &a.ConfigFilename,
		&a.ConfigTargetPath, &a.BinTargetPath, &a.IdentityPath,
		&a.StartCmd, &a.StopCmd, &a.RestartCmd, &a.HealthCheck,
		&a.CreatedBy, &a.CreatedAt, &a.UpdatedAt)
	return a, err
}

func (d *Data) ListAppDefinitions(ctx context.Context) ([]*AppDefinition, error) {
	rows, err := d.db.QueryContext(ctx, `SELECT `+appDefColumns+` FROM t_app_definition ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*AppDefinition
	for rows.Next() {
		a, err := scanAppDef(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (d *Data) GetAppDefinition(ctx context.Context, appID string) (*AppDefinition, error) {
	a, err := scanAppDef(d.db.QueryRowContext(ctx,
		`SELECT `+appDefColumns+` FROM t_app_definition WHERE app_id=?`, appID))
	if stderrors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

func (d *Data) CreateAppDefinition(ctx context.Context, a *AppDefinition) error {
	_, err := d.db.ExecContext(ctx, `INSERT INTO t_app_definition
 (app_id, app_key, display_name, service_type, config_filename, config_target_path, bin_target_path,
  identity_path, start_cmd, stop_cmd, restart_cmd, health_check, created_by)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		a.AppID, a.AppKey, a.DisplayName, a.ServiceType, a.ConfigFilename, a.ConfigTargetPath,
		a.BinTargetPath, a.IdentityPath, a.StartCmd, a.StopCmd, a.RestartCmd, a.HealthCheck, a.CreatedBy)
	return err
}

const appVerColumns = `version_id, app_id, version_no, bin_file_id, bin_filename, bin_sha256, bin_size,
 config_file_id, config_filename, config_sha256, change_note, is_stable, created_by,
 DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s')`

func scanAppVer(s interface{ Scan(...any) error }) (*AppVersion, error) {
	v := &AppVersion{}
	var stable int32
	err := s.Scan(&v.VersionID, &v.AppID, &v.VersionNo, &v.BinFileID, &v.BinFilename,
		&v.BinSHA256, &v.BinSize, &v.ConfigFileID, &v.ConfigFilename, &v.ConfigSHA256,
		&v.ChangeNote, &stable, &v.CreatedBy, &v.CreatedAt)
	v.IsStable = stable == 1
	return v, err
}

func (d *Data) ListAppVersions(ctx context.Context, appID string) ([]*AppVersion, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT `+appVerColumns+` FROM t_app_version WHERE app_id=? ORDER BY version_no DESC`, appID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*AppVersion
	for rows.Next() {
		v, err := scanAppVer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (d *Data) GetAppVersion(ctx context.Context, appID, label string) (*AppVersion, error) {
	var no int32
	if _, err := fmt.Sscanf(label, "v%d", &no); err != nil || no <= 0 {
		return nil, ErrNotFound
	}
	v, err := scanAppVer(d.db.QueryRowContext(ctx,
		`SELECT `+appVerColumns+` FROM t_app_version WHERE app_id=? AND version_no=?`, appID, no))
	if stderrors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return v, err
}

// CreateAppVersion 由后端独占版本号递增；UNIQUE(app_id, version_no) 是并发下的最终事实源。
func (d *Data) CreateAppVersion(ctx context.Context, v *AppVersion) error {
	tx, err := d.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var maxNo int32
	if err := tx.QueryRowContext(ctx,
		`SELECT IFNULL(MAX(version_no),0) FROM t_app_version WHERE app_id=?`, v.AppID).Scan(&maxNo); err != nil {
		return err
	}
	v.VersionNo = maxNo + 1
	stable := int32(0)
	if v.IsStable {
		stable = 1
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO t_app_version
 (version_id, app_id, version_no, bin_file_id, bin_filename, bin_sha256, bin_size,
  config_file_id, config_filename, config_sha256, change_note, is_stable, created_by)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		v.VersionID, v.AppID, v.VersionNo, v.BinFileID, v.BinFilename, v.BinSHA256, v.BinSize,
		v.ConfigFileID, v.ConfigFilename, v.ConfigSHA256, v.ChangeNote, stable, v.CreatedBy); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *Data) ListAppDeployments(ctx context.Context, appID string) ([]*AppDeployment, error) {
	rows, err := d.db.QueryContext(ctx, `SELECT d.app_id, d.node_id,
 COALESCE(a.public_ip,''), COALESCE(a.display_name,''), COALESCE(a.node_type,''),
 d.current_version, d.last_success_version, d.previous_version, d.status, d.last_batch_id,
 DATE_FORMAT(d.updated_at,'%Y-%m-%d %H:%i:%s')
 FROM t_app_deployment d LEFT JOIN t_node_asset a ON a.node_id=d.node_id
 WHERE d.app_id=? ORDER BY d.node_id`, appID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*AppDeployment
	for rows.Next() {
		x := &AppDeployment{}
		if err := rows.Scan(&x.AppID, &x.NodeID, &x.PublicIP, &x.DisplayName, &x.NodeType,
			&x.CurrentVersion, &x.LastSuccessVersion, &x.PreviousVersion, &x.Status,
			&x.LastBatchID, &x.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// DeploymentVersion 返回台账实况版本；无记录返回空串。
func (d *Data) DeploymentVersion(ctx context.Context, appID, nodeID string) (string, error) {
	var v string
	err := d.db.QueryRowContext(ctx,
		`SELECT current_version FROM t_app_deployment WHERE app_id=? AND node_id=?`, appID, nodeID).Scan(&v)
	if stderrors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// ListDeployableNodes 按服务类型过滤，硬排除已软删与已下架节点。
func (d *Data) ListDeployableNodes(ctx context.Context, serviceType string) ([]*NodeAsset, error) {
	rows, err := d.db.QueryContext(ctx, `SELECT `+nodeColumns+` FROM t_node_asset
 WHERE deleted_at IS NULL AND node_type=? AND listing_status='listed' ORDER BY node_id`, serviceType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*NodeAsset
	for rows.Next() {
		n, err := scanNode(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// DataPlaneNodeExists 防止重复初始化覆盖已有心跳身份。
func (d *Data) DataPlaneNodeExists(ctx context.Context, nodeID string) (bool, error) {
	var n int32
	err := d.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM t_dataplane_node WHERE node_id=?`, nodeID).Scan(&n)
	return n > 0, err
}

func (d *Data) InsertDataPlaneNode(ctx context.Context, nodeID, displayName, advertiseHost, passwordHash string) error {
	_, err := d.db.ExecContext(ctx, `INSERT INTO t_dataplane_node
 (node_id, display_name, password_hash, enabled, advertise_host, runtime_status, scheduling_status,
  boot_id, offline_reason) VALUES (?,?,?,1,?,'unknown','disabled','','')`,
		nodeID, displayName, passwordHash, advertiseHost)
	return err
}

// RollbackDataPlaneNode 仅用于初始化写文件失败后的补偿，绝不删除既有节点。
func (d *Data) RollbackDataPlaneNode(ctx context.Context, nodeID string) error {
	_, err := d.db.ExecContext(ctx, `DELETE FROM t_dataplane_node WHERE node_id=?`, nodeID)
	return err
}

// CreateDeployBatch 只写任务表，立即返回（绕开网关 15s 超时）。
func (d *Data) CreateDeployBatch(ctx context.Context, b *DeployBatchRow, items []DeployItemSpec, clientRequestID, paramsJSON string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	ids := make([]string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.NodeID)
	}
	nodesJSON, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO t_operation_batch
 (batch_id, operator_uid, operation_id, app_id, target_version, mode, params_json, target_nodes_json,
  client_request_id, status, total, succeeded, failed, created_at)
 VALUES (?,?,?,?,?,?,?,?,?,'running',?,0,0,NOW(3))`,
		b.BatchID, b.Operator, "StartDeploy", b.AppID, b.TargetVersion, b.Mode,
		paramsJSON, string(nodesJSON), clientRequestID, len(items)); err != nil {
		return err
	}
	for _, it := range items {
		if _, err := tx.ExecContext(ctx, `INSERT INTO t_node_task
 (task_id, batch_id, node_id, from_version, to_version, health_result, kind, status,
  exit_code, output, error_msg) VALUES (?,?,?,?,?,'',?,?,0,'','')`,
			it.TaskID, b.BatchID, it.NodeID, it.FromVersion, it.ToVersion, b.Mode, it.Status); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DeployBatchContext 返回 worker 执行所需的批次上下文。
func (d *Data) DeployBatchContext(ctx context.Context, batchID string) (appID, targetVersion, mode string, concurrency int32, err error) {
	var raw string
	err = d.db.QueryRowContext(ctx, `SELECT app_id, target_version, mode, params_json
 FROM t_operation_batch WHERE batch_id=?`, batchID).Scan(&appID, &targetVersion, &mode, &raw)
	if err != nil {
		return
	}
	var p struct {
		Concurrency int32 `json:"concurrency"`
	}
	_ = json.Unmarshal([]byte(raw), &p)
	concurrency = p.Concurrency
	return
}

func (d *Data) ListDeployBatches(ctx context.Context, appID, mode string, limit int32) ([]*DeployBatchRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	q := `SELECT batch_id, COALESCE(app_id,''), mode, COALESCE(target_version,''), operator_uid,
 status, total, succeeded, failed, DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s'),
 COALESCE(DATE_FORMAT(finished_at,'%Y-%m-%d %H:%i:%s'),'')
 FROM t_operation_batch WHERE operation_id='StartDeploy'`
	var args []any
	if appID != "" {
		q += ` AND app_id=?`
		args = append(args, appID)
	}
	if mode != "" {
		q += ` AND mode=?`
		args = append(args, mode)
	}
	q += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := d.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*DeployBatchRow
	for rows.Next() {
		b := &DeployBatchRow{}
		if err := rows.Scan(&b.BatchID, &b.AppID, &b.Mode, &b.TargetVersion, &b.Operator,
			&b.Status, &b.Total, &b.Succeeded, &b.Failed, &b.CreatedAt, &b.FinishedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (d *Data) GetDeployBatch(ctx context.Context, batchID string) (*DeployBatchRow, []*DeployItemRow, error) {
	b := &DeployBatchRow{BatchID: batchID}
	err := d.db.QueryRowContext(ctx, `SELECT COALESCE(app_id,''), mode,
 COALESCE(target_version,''), operator_uid, status, total, succeeded, failed,
 DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s'),
 COALESCE(DATE_FORMAT(finished_at,'%Y-%m-%d %H:%i:%s'),'')
 FROM t_operation_batch WHERE batch_id=?`, batchID).Scan(&b.AppID, &b.Mode, &b.TargetVersion,
		&b.Operator, &b.Status, &b.Total, &b.Succeeded, &b.Failed, &b.CreatedAt, &b.FinishedAt)
	if stderrors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	rows, err := d.db.QueryContext(ctx, `SELECT t.task_id, t.batch_id, t.node_id,
 COALESCE(a.public_ip,''), t.from_version, t.to_version, t.status, t.health_result, t.error_msg,
 COALESCE(DATE_FORMAT(t.started_at,'%Y-%m-%d %H:%i:%s'),''),
 COALESCE(DATE_FORMAT(t.finished_at,'%Y-%m-%d %H:%i:%s'),'')
 FROM t_node_task t LEFT JOIN t_node_asset a ON a.node_id=t.node_id
 WHERE t.batch_id=? ORDER BY t.node_id`, batchID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var items []*DeployItemRow
	for rows.Next() {
		it := &DeployItemRow{}
		if err := rows.Scan(&it.TaskID, &it.BatchID, &it.NodeID, &it.PublicIP,
			&it.FromVersion, &it.ToVersion, &it.Status, &it.HealthResult, &it.ErrMsg,
			&it.StartedAt, &it.FinishedAt); err != nil {
			return nil, nil, err
		}
		items = append(items, it)
	}
	return b, items, rows.Err()
}

// RetryDeployItem 是同一批次续跑，不产生新批次。
func (d *Data) RetryDeployItem(ctx context.Context, batchID, nodeID string) error {
	res, err := d.db.ExecContext(ctx, `UPDATE t_node_task SET status='queued', error_msg='',
 health_result='', finished_at=NULL WHERE batch_id=? AND node_id=? AND status='failed'`, batchID, nodeID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	_, err = d.db.ExecContext(ctx,
		`UPDATE t_operation_batch SET status='running', finished_at=NULL WHERE batch_id=?`, batchID)
	return err
}

func (d *Data) StartDeployTask(ctx context.Context, taskID string) error {
	_, err := d.db.ExecContext(ctx,
		`UPDATE t_node_task SET status='running', started_at=NOW(3) WHERE task_id=?`, taskID)
	return err
}

// FinishDeployItem 在一个事务里写任务结果与部署台账。
// 失败时如实记 current_version=目标版本 + status=failed，last_success / previous 保持不动，
// 绝不自动回滚，也不假装节点还在旧版本。
func (d *Data) FinishDeployItem(ctx context.Context, taskID, batchID, appID, nodeID, targetVersion, status, healthResult, errMsg string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE t_node_task SET status=?, health_result=?, error_msg=?,
 finished_at=NOW(3) WHERE task_id=?`, status, healthResult, errMsg, taskID); err != nil {
		return err
	}
	var cur, last, prev string
	e := tx.QueryRowContext(ctx, `SELECT current_version, last_success_version, previous_version
 FROM t_app_deployment WHERE app_id=? AND node_id=? FOR UPDATE`, appID, nodeID).Scan(&cur, &last, &prev)
	if stderrors.Is(e, sql.ErrNoRows) {
		cur, last, prev = "", "", ""
	} else if e != nil {
		return e
	}
	if status == "succeeded" {
		prev, last = cur, targetVersion
	}
	depStatus := "failed"
	if status == "succeeded" {
		depStatus = "healthy"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO t_app_deployment
 (app_id, node_id, current_version, last_success_version, previous_version, status, last_batch_id)
 VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
 current_version=VALUES(current_version), last_success_version=VALUES(last_success_version),
 previous_version=VALUES(previous_version), status=VALUES(status), last_batch_id=VALUES(last_batch_id)`,
		appID, nodeID, targetVersion, last, prev, depStatus, batchID); err != nil {
		return err
	}
	return tx.Commit()
}
