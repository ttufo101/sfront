const GW = "http://47.120.10.73:12001/startlandapi";
const FILE_BASE = "http://106.52.77.108";

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
  // 1. 登录拿管理员 token
  const login = await xrpc("starland.login.com", "Login", {
    email: "ygliu_csdn@163.com",
    password: "Liuqwaszx123",
  });
  console.log("LOGIN code:", login.code, "msg:", login.msg, "hasToken:", !!login?.data?.access_token);
  const token = login?.data?.access_token;
  if (!token) { console.log("NO TOKEN -> 无法继续"); return; }

  // 2. 取反馈详情，拿真实 file_id
  const fbId = "fb_1788a493d8b743d4b4e1b67b4046348b";
  const detail = await xrpc("starland.admin.com", "GetFeedbackDetail", { feedback_id: fbId }, token);
  console.log("DETAIL code:", detail.code, "msg:", detail.msg);
  console.log("DETAIL.data (raw):", JSON.stringify(detail.data).slice(0, 2500));
  const atts = detail?.data?.attachments || detail?.data?.ticket?.attachments || [];
  console.log("ATTACHMENTS count:", atts.length);
  for (const a of atts) {
    console.log("  file_id:", a.file_id, "| name:", a.file_name, "| url:", a.url || "(none)");
  }

  // 3. 带管理员 token 实际取图 + 对照无 token
  for (const a of atts) {
    const fid = a.file_id;
    // 3a 带 token
    try {
      const r1 = await fetch(FILE_BASE + "/api/v1/feedback-files/" + fid, {
        headers: { Authorization: "Bearer " + token },
      });
      const ct1 = r1.headers.get("content-type");
      const buf1 = Buffer.from(await r1.arrayBuffer());
      console.log(`IMG[token]  ${fid} -> ${r1.status} ct:${ct1} body:${buf1.slice(0, 220).toString("utf8")}`);
    } catch (e) { console.log(`IMG[token]  ${fid} -> ERR ${e.message}`); }
    // 3b 无 token（验证是否真"公开"）
    try {
      const r2 = await fetch(FILE_BASE + "/api/v1/feedback-files/" + fid, {});
      console.log(`IMG[noToken] ${fid} -> ${r2.status}`);
    } catch (e) { console.log(`IMG[noToken] ${fid} -> ERR ${e.message}`); }
  }
})();
