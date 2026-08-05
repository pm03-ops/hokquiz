// =====================================================================
// 照護學堂 · Edge Function: admin-users
// 管理員從後台建立 / 重設密碼 / 刪除員工帳號（需 service role 才能操作
// auth.users，故放後端）。僅限 role=admin 呼叫。
//   action "create" : {employeeId, name, role, password} → 建登入 + profile
//   action "reset"  : {userId, password}                 → 重設密碼、要求首登改密碼
//   action "delete" : {userId}                           → 刪除帳號（profile 連動刪）
//
// 部署：Edge Functions → 函式名「admin-users」→ 貼上本檔 → Deploy
// 不需自訂密鑰（URL / SERVICE_ROLE_KEY 由 Supabase 自動注入）。
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

const EMAIL_SUFFIX = "@clinic.local";
const ROLES = ["care", "social", "nurse", "admin"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "未登入" });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!me || me.role !== "admin") return json({ error: "僅限管理員" });

    const body = await req.json();
    const action = body.action;

    if (action === "create") {
      const employeeId = String(body.employeeId || "").trim().toUpperCase();
      const name = String(body.name || "").trim();
      const role = String(body.role || "");
      const password = String(body.password || "");
      if (!/^H\d{4}$/.test(employeeId)) return json({ error: "員工編號格式須為 H + 4 碼數字（例：H0002）" });
      if (!name) return json({ error: "請輸入姓名" });
      if (!ROLES.includes(role)) return json({ error: "角色不正確" });
      if (password.length < 6) return json({ error: "預設密碼至少 6 碼" });

      // 編號重複檢查
      const { data: dup } = await admin.from("profiles").select("id").eq("employee_id", employeeId).maybeSingle();
      if (dup) return json({ error: `員工編號 ${employeeId} 已存在` });

      const email = employeeId.toLowerCase() + EMAIL_SUFFIX;
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (cErr || !created?.user) return json({ error: "建立登入失敗：" + (cErr?.message || "未知錯誤") });

      const { error: pErr } = await admin.from("profiles").insert({
        id: created.user.id, employee_id: employeeId, name, role, must_change_password: true,
      });
      if (pErr) {
        // profile 失敗則回收剛建立的登入，避免孤兒帳號
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: "建立資料失敗：" + pErr.message });
      }
      return json({ ok: true, id: created.user.id, employeeId });
    }

    if (action === "reset") {
      const userId = String(body.userId || "");
      const password = String(body.password || "");
      if (!userId) return json({ error: "缺少帳號" });
      if (password.length < 6) return json({ error: "新密碼至少 6 碼" });
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: "重設失敗：" + error.message });
      await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
      return json({ ok: true });
    }

    if (action === "delete") {
      const userId = String(body.userId || "");
      if (!userId) return json({ error: "缺少帳號" });
      if (userId === user.id) return json({ error: "不能刪除自己" });
      const { error } = await admin.auth.admin.deleteUser(userId);   // profile 由 FK on delete cascade 連動刪除
      if (error) return json({ error: "刪除失敗：" + error.message });
      return json({ ok: true });
    }

    return json({ error: "unknown action" });
  } catch (e) {
    return json({ error: (e as Error).message || String(e) });
  }
});
