// =====================================================================
// 照護學堂 · Edge Function: quiz  （伺服器端評分；不使用 AI）
//   action "grade"  : 評一題 → 寫 answers、更新積分/答對數/徽章/SRS/連續天數
//   action "finish" : 結算 → 依 session 已評的答案寫 attempts
// 效能：函式已開啟「Verify JWT」，閘道已驗證過 token，故直接從 JWT 取
//       user_id（省一次 auth 網路往返），且讀取/寫入盡量並行。
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

const SRS_INTERVALS = [0, 1, 3, 7, 14, 30, 90];
const DAYNUM = () => Math.floor(Date.now() / 86400000);

/** 從已被閘道驗證過的 JWT 直接取 user id（sub），不需再打 auth 伺服器 */
function uidFromJwt(authHeader: string): string | null {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return payload.sub || null;
  } catch (_) { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const uid = uidFromJwt(req.headers.get("Authorization") || "");
    if (!uid) return json({ error: "未登入" });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const action = body.action;

    // -------------------------------------------------- grade one answer
    if (action === "grade") {
      const { sessionId, questionId, chosen, deviceId } = body;
      if (!questionId) return json({ error: "缺少題目" });
      const sid = sessionId ?? null;

      // 並行讀取：profile / 題目 / 是否已作答 / SRS 進度
      const [profRes, qRes, existRes, revRes] = await Promise.all([
        admin.from("profiles").select("points, answered, streak, last_active").eq("id", uid).single(),
        admin.from("questions").select("correct, quiz_note, quiz_id").eq("id", questionId).single(),
        admin.from("answers").select("correct").eq("user_id", uid).eq("session_id", sid).eq("question_id", questionId).maybeSingle(),
        admin.from("reviews").select("level").eq("user_id", uid).eq("question_id", questionId).maybeSingle(),
      ]);
      const profile = profRes.data, q = qRes.data;
      if (!profile) return json({ error: "找不到使用者資料" });
      if (!q) return json({ error: "題目不存在" });

      const correct = String(chosen) === String(q.correct);
      if (existRes.data) {  // 同 session 同題已計過，不重複計分
        return json({ correct: existRes.data.correct, correctAnswer: q.correct, quizNote: q.quiz_note || "",
          gained: 0, points: profile.points, answered: profile.answered });
      }

      const gained = correct ? (10 + Math.min(profile.streak, 5)) : 0;
      let points = profile.points, answered = profile.answered;
      if (correct) { points += gained; answered += 1; }

      // 連續天數（每日首次作答才更新）
      const today = DAYNUM();
      const lastNum = profile.last_active ? Math.floor(Date.parse(profile.last_active) / 86400000) : null;
      let streak = profile.streak, lastActive = profile.last_active;
      if (lastNum !== today) {
        streak = (lastNum === today - 1) ? streak + 1 : 1;
        lastActive = new Date(today * 86400000).toISOString().slice(0, 10);
      }

      const badges = [{ user_id: uid, badge_key: "first" }];
      if (answered >= 100) badges.push({ user_id: uid, badge_key: "century" });
      if (streak >= 7) badges.push({ user_id: uid, badge_key: "streak7" });

      // SRS：熟練度上下調整
      const curLevel = revRes.data ? revRes.data.level : 0;
      const level = correct ? Math.min(curLevel + 1, SRS_INTERVALS.length - 1) : Math.max(curLevel - 1, 1);
      const due = today + SRS_INTERVALS[level];

      // 並行寫入
      await Promise.all([
        admin.from("answers").insert({ user_id: uid, quiz_id: q.quiz_id, question_id: questionId, correct, session_id: sid, device_id: deviceId || null }),
        admin.from("profiles").update({ points, answered, streak, last_active: lastActive }).eq("id", uid),
        admin.from("user_badges").upsert(badges, { onConflict: "user_id,badge_key", ignoreDuplicates: true }),
        admin.from("reviews").upsert({ user_id: uid, question_id: questionId, level, due }, { onConflict: "user_id,question_id" }),
      ]);

      return json({ correct, correctAnswer: q.correct, quizNote: q.quiz_note || "", gained, points, answered });
    }

    // -------------------------------------------------- finish an attempt
    if (action === "finish") {
      const { sessionId, quizId, deviceId } = body;
      if (!quizId || !sessionId) return json({ error: "缺少參數" });

      const [existRes, ansRes] = await Promise.all([
        admin.from("attempts").select("score, total, points").eq("user_id", uid).eq("session_id", sessionId).maybeSingle(),
        admin.from("answers").select("correct").eq("user_id", uid).eq("session_id", sessionId),
      ]);
      if (existRes.data) return json(existRes.data);   // 避免重複結算

      const ans = ansRes.data || [];
      const total = ans.length;
      const score = ans.filter((a) => a.correct).length;
      const points = score * 10;

      await Promise.all([
        admin.from("attempts").insert({ user_id: uid, quiz_id: quizId, score, total, points, session_id: sessionId, device_id: deviceId || null }),
        (total > 0 && score === total)
          ? admin.from("user_badges").upsert({ user_id: uid, badge_key: "perfect" }, { onConflict: "user_id,badge_key", ignoreDuplicates: true })
          : Promise.resolve(),
      ]);

      return json({ score, total, points });
    }

    return json({ error: "unknown action" });
  } catch (e) {
    return json({ error: (e as Error).message || String(e) });
  }
});
