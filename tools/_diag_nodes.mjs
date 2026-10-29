const GW = "http://47.120.10.73:12001/startlandapi";
async function xrpc(module, method, params, token = "") {
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
(async () => {
  const login = await xrpc("starland.login.com", "Login", { email: "ygliu_csdn@163.com", password: "Liuqwaszx123" });
  const token = login?.data?.access_token;
  console.log("LOGIN:", login.code, login.msg, "hasToken:", !!token);
  if (!token) return;

  // 取一个用户 uid
  const users = await xrpc("starland.admin.com", "ListUsers", { page: 1, page_size: 1 }, token);
  const uid = users?.data?.users?.[0]?.uid;
  console.log("SAMPLE uid:", uid);

  // 节点列表：校验新字段
  const nodes = await xrpc("starland.admin.com", "ListDataPlaneNodes", {}, token);
  console.log("\n=== ListDataPlaneNodes ===", "code:", nodes.code, "count:", nodes?.data?.nodes?.length);
  for (const n of nodes?.data?.nodes || []) {
    console.log(JSON.stringify({
      node_id: n.node_id, display_name: n.display_name, enabled: n.enabled,
      runtime_status: n.runtime_status, scheduling_status: n.scheduling_status,
      advertise_host: n.advertise_host, heartbeat_at: n.heartbeat_at, started_at: n.started_at,
      offline_at: n.offline_at, offline_reason: n.offline_reason,
    }));
  }
  const sample = nodes?.data?.nodes?.[0];
  console.log("has runtime_status field:", sample && "runtime_status" in sample, "| has advertise_host:", sample && "advertise_host" in sample);

  if (uid) {
    const assign = await xrpc("starland.admin.com", "GetUserRelayAssignment", { uid }, token);
    console.log("\n=== GetUserRelayAssignment ===", "code:", assign.code, JSON.stringify(assign?.data));
  }
})();
