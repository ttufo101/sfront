// 实跑「隔离 → 轮换 → 恢复」流程并核对（dev 环境）
// 目标节点：relay-106-52-77-108-01（当前 disabled、无 advertise_host，不参与调度，风险最低）
// 完成后将其 scheduling_status 还原为原始值，避免改变线上状态。
const GW = "http://47.120.10.73:12001/startlandapi";
const TARGET = "relay-106-52-77-108-01";

async function xrpc(module, method, params, token) {
  const res = await fetch(GW, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      com: { dev_id: "diag", dev_type: "web", app_ver: "1.0", os_ver: "web", jwt_token: token },
      req: { module, method, params },
    }),
  });
  return res.json();
}
const show = (n) => JSON.stringify({
  node_id: n.node_id, display_name: n.display_name, enabled: n.enabled,
  runtime_status: n.runtime_status, scheduling_status: n.scheduling_status,
  advertise_host: n.advertise_host, heartbeat_at: n.heartbeat_at,
});

(async () => {
  const login = await xrpc("starland.login.com", "Login", { email: "ygliu_csdn@163.com", password: "Liuqwaszx123" });
  const token = login?.data?.access_token;
  console.log("LOGIN:", login.code, login.msg, "hasToken:", !!token);
  if (!token) return;

  const list = await xrpc("starland.admin.com", "ListDataPlaneNodes", {}, token);
  const node = list?.data?.nodes?.find((n) => n.node_id === TARGET);
  if (!node) { console.log("未找到目标节点", TARGET); return; }
  const orig = { display_name: node.display_name, enabled: node.enabled, scheduling_status: node.scheduling_status, advertise_host: node.advertise_host };
  console.log("\n[0] 原始状态:", show(node), "原始 scheduling_status =", orig.scheduling_status);

  // 1) 隔离：scheduling_status -> isolated（全量更新）
  const iso = await xrpc("starland.admin.com", "UpdateDataPlaneNode",
    { node_id: TARGET, display_name: orig.display_name, enabled: orig.enabled, scheduling_status: "isolated", advertise_host: orig.advertise_host }, token);
  let after = (await xrpc("starland.admin.com", "ListDataPlaneNodes", {}, token)).data.nodes.find((n) => n.node_id === TARGET);
  console.log("\n[1] 隔离 UpdateDataPlaneNode code:", iso.code, iso.msg);
  console.log("    隔离后状态:", show(after), "-> scheduling_status =", after.scheduling_status, after.scheduling_status === "isolated" ? "✅" : "❌");

  // 2) 轮换密码：返回一次性明文
  const rot = await xrpc("starland.admin.com", "RotateDataPlaneNodePassword", { node_id: TARGET }, token);
  console.log("\n[2] 轮换 RotateDataPlaneNodePassword code:", rot.code, rot.msg, "success:", rot?.data?.success);
  console.log("    一次性明文密码(仅本次):", rot?.data?.node_password ? "已返回(len=" + rot.data.node_password.length + ")" : "未返回");
  after = (await xrpc("starland.admin.com", "ListDataPlaneNodes", {}, token)).data.nodes.find((n) => n.node_id === TARGET);
  console.log("    轮换后状态:", show(after), "(密码哈希已更新，前端不存储明文)");

  // 3) 恢复：scheduling_status 还原为原始值
  const rest = await xrpc("starland.admin.com", "UpdateDataPlaneNode",
    { node_id: TARGET, display_name: orig.display_name, enabled: orig.enabled, scheduling_status: orig.scheduling_status, advertise_host: orig.advertise_host }, token);
  after = (await xrpc("starland.admin.com", "ListDataPlaneNodes", {}, token)).data.nodes.find((n) => n.node_id === TARGET);
  console.log("\n[3] 恢复 UpdateDataPlaneNode code:", rest.code, rest.msg);
  console.log("    恢复后状态:", show(after), "-> scheduling_status =", after.scheduling_status, after.scheduling_status === orig.scheduling_status ? "✅ 已还原" : "⚠️ 未还原");

  console.log("\n=== 流程核对结论 ===");
  console.log("隔离(isolate):", iso.code === 0 ? "OK" : "FAIL", "| 轮换(rotate):", rot.code === 0 && rot?.data?.node_password ? "OK" : "FAIL", "| 恢复(restore):", rest.code === 0 ? "OK" : "FAIL");
})();
