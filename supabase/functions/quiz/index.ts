// =====================================================================
// 照護學堂 · Edge Function: quiz
// 伺服器端評分（答案金鑰不外流、成績無法偽造）。
//   action "grade"  : 評一題 → 寫 answers、更新積分/答對數/徽章/SRS/連續天數
//   action "finish" : 結算一份測驗 → 依 session 已評的答案寫 attempts
// 以呼叫者 JWT 取得身分（user_id 不可由前端偽造），再用 service role 寫入。
//
// 部署：Supabase → Edge Functions → 函式名「quiz」→ 貼上本檔 → Deploy
// 不需自訂密鑰（SERVICE_ROLE_KEY / URL 由 Supabase 自動注入）。
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "未登入" });

    // service role：略過 RLS 寫入（user_id 一律取自 token，不信任前端）
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const uid = user.id;

    const { data: profile } = await admin.from("profiles").select("*").eq("id", uid).single();
    if (!profile) return json({ error: "找不到使用者資料" });

    const body = await req.json();
    const action = body.action;

    // -------------------------------------------------- grade one answer
    if (action === "grade") {
      const { sessionId, questionId, chosen, deviceId } = body;
      if (!questionId) return json({ error: "缺少題目" });

      const { data: q } = await admin.from("questions").select("*").eq("id", questionId).single();
      if (!q) return json({ error: "題目不存在" });

      // 同一 session 同一題只計一次
      const { data: existing } = await admin.from("answers")
        .select("correct").eq("user_id", uid).eq("session_id", sessionId ?? null)
        .eq("question_id", questionId).maybeSingle();
      const correct = String(chosen) === String(q.correct);

      if (existing) {
        return json({ correct: existing.correct, correctAnswer: q.correct, quizNote: q.quiz_note || "",
          gained: 0, points: profile.points, answered: profile.answered });
      }

      await admin.from("answers").insert({
        user_id: uid, quiz_id: q.quiz_id, question_id: questionId, correct,
        session_id: sessionId ?? null, device_id: deviceId || null,
      });

      // 積分 / 答對數
      const gained = correct ? (10 + Math.min(profile.streak, 5)) : 0;
      let points = profile.points, answered = profile.answered;
      if (correct) { points += gained; answered += 1; }

      // 連續天數（每日首次作答才更新）
      const today = DAYNUM();
      const lastNum = profile.last_active ? Math.floor(Date.parse(profile.last_active) / 86400000) : null;
      let streak = profile.streak;
      let lastActive = profile.last_active;
      if (lastNum !== today) {
        streak = (lastNum === today - 1) ? streak + 1 : 1;
        lastActive = new Date(today * 86400000).toISOString().slice(0, 10);
      }

      await admin.from("profiles").update({ points, answered, streak, last_active: lastActive }).eq("id", uid);

      // 徽章
      const badges = ["first"];
      if (answered >= 100) badges.push("century");
      if (streak >= 7) badges.push("streak7");
      for (const b of badges) {
        await admin.from("user_badges").upsert({ user_id: uid, badge_key: b },
          { onConflict: "user_id,badge_key", ignoreDuplicates: true });
      }

      // SRS 間隔複習
      const { data: rev } = await admin.from("reviews")
        .select("level").eq("user_id", uid).eq("question_id", questionId).maybeSingle();
      let level = rev ? rev.level : 0;
      level = correct ? Math.min(level + 1, SRS_INTERVALS.length - 1) : Math.max(level - 1, 1);
      const due = today + SRS_INTERVALS[level];
      if (rev) await admin.from("reviews").update({ level, due }).eq("user_id", uid).eq("question_id", questionId);
      else await admin.from("reviews").insert({ user_id: uid, question_id: questionId, level, due });

      return json({ correct, correctAnswer: q.correct, quizNote: q.quiz_note || "",
        gained, points, answered });
    }

    // -------------------------------------------------- finish an attempt
    if (action === "finish") {
      const { sessionId, quizId, deviceId } = body;
      if (!quizId || !sessionId) return json({ error: "缺少參數" });

      // 避免重複結算
      const { data: existAtt } = await admin.from("attempts")
        .select("score, total, points").eq("user_id", uid).eq("session_id", sessionId).maybeSingle();
      if (existAtt) return json(existAtt);

      const { data: ans } = await admin.from("answers")
        .select("correct").eq("user_id", uid).eq("session_id", sessionId);
      const total = (ans || []).length;
      const score = (ans || []).filter((a) => a.correct).length;
      const points = score * 10;

      await admin.from("attempts").insert({
        user_id: uid, quiz_id: quizId, score, total, points,
        session_id: sessionId, device_id: deviceId || null,
      });

      if (total > 0 && score === total) {
        await admin.from("user_badges").upsert({ user_id: uid, badge_key: "perfect" },
          { onConflict: "user_id,badge_key", ignoreDuplicates: true });
      }

      return json({ score, total, points });
    }

    return json({ error: "unknown action" });
  } catch (e) {
    return json({ error: (e as Error).message || String(e) });
  }
});
