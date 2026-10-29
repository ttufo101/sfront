const GW = "http://47.120.10.73:12001/startlandapi";
const FILE_BASE = "http://106.52.77.108";
import { readFileSync } from "node:fs";

const SERVICE_TOKEN = readFileSync("E:/sfront/.tmp_fu/svc_token.txt", "utf8").trim();

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
  const login = await xrpc("starland.login.com", "Login", {
    email: "ygliu_csdn@163.com",
    password: "Liuqwaszx123",
  });
  console.log("LOGIN code:", login.code, "msg:", login.msg, "hasToken:", !!login?.data?.access_token);
  const token = login?.data?.access_token;
  if (!token) { console.log("NO TOKEN -> 无法继续"); return; }

  const fbId = "fb_1788a493d8b743d4b4e1b67b4046348b";
  const detail = await xrpc("starland.admin.com", "GetFeedbackDetail", { feedback_id: fbId }, token);
  console.log("DETAIL code:", detail.code, "msg:", detail.msg);
  const atts = detail?.data?.attachments || detail?.data?.ticket?.attachments || [];
  console.log("ATTACHMENTS count:", atts.length);
  for (const a of atts) {
    console.log("  file_id:", a.file_id, "| name:", a.file_name, "| url:", a.url || "(none)");
  }
  if (atts.length === 0) { console.log("无附件，跳过取图测试"); return; }

  const fid = atts[0].file_id;
  const url = FILE_BASE + "/api/v1/feedback-files/" + fid;

  async function get(label, headers) {
    try {
      const r = await fetch(url, { headers });
      const buf = Buffer.from(await r.arrayBuffer());
      const peek = r.headers.get("content-type") || "";
      console.log(`${label} -> ${r.status} ct:${peek} len:${buf.length} head:${buf.slice(0, 16).toString("hex")}`);
    } catch (e) { console.log(`${label} -> ERR ${e.message}`); }
  }

  console.log(`\n=== 测试 file_id=${fid} ===`);
  await get("a. Bearer only        ", { Authorization: "Bearer " + token });
  await get("b. Bearer+X-Service(correct)", { Authorization: "Bearer " + token, "X-Service-Token": SERVICE_TOKEN });
  await get("c. Bearer+X-Service(wrong)  ", { Authorization: "Bearer " + token, "X-Service-Token": "wrong-token" });
  await get("d. no token           ", {});
})();
