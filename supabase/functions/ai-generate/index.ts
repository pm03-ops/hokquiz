// =====================================================================
// 照護學堂 · Edge Function: ai-generate
// 後端代理 Google Gemini：出題 / 生成干擾項 / 生成教學解說。
// 金鑰只存在伺服器（GEMINI_API_KEY 密鑰），前端與 repo 都看不到。
// 僅限已登入的「管理員」呼叫（驗證 JWT + profiles.role='admin'）。
//
// 部署：Supabase → Edge Functions → Deploy a new function / Open Editor
//   函式名稱請取「ai-generate」，貼上本檔內容後 Deploy。
// 密鑰：Edge Functions → Secrets 新增
//   GEMINI_API_KEY = 你的 Google AI Studio 金鑰
//   （選用）GEMINI_MODEL = 模型名稱，預設 gemini-3.5-flash
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash";
// 語言標籤（外籍出題／翻譯／學中文用）
const LANG_LABEL: Record<string, string> = {
  zh: "繁體中文",
  vi: "越南文（Tiếng Việt）",
  id: "印尼文（Bahasa Indonesia）",
};
const langLabel = (l: string) => LANG_LABEL[l] || "繁體中文";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// 一律回 200，錯誤放在 body.error，方便前端統一處理
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

async function gemini(prompt: string, opts: { json?: boolean; schema?: unknown } = {}): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("伺服器尚未設定 GEMINI_API_KEY 密鑰");
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const generationConfig: Record<string, unknown> = { temperature: 0.7 };
  if (opts.json !== false) generationConfig.responseMimeType = "application/json";
  if (opts.schema) generationConfig.responseSchema = opts.schema;   // 結構化輸出：強制 JSON 形狀，避免模型加註解
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
  });
  if (!r.ok) {
    let t = "";
    try { t = (await r.json())?.error?.message || ""; } catch (_) { /* ignore */ }
    throw new Error(`Gemini API ${r.status}${t ? "：" + t.slice(0, 160) : ""}`);
  }
  const j = await r.json();
  return (j?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
}

function parseJsonLoose(txt: string): unknown {
  if (!txt) return null;
  const s = txt.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(s); } catch (_) { /* fall through */ }
  const m = s.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* ignore */ } }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // ---- 驗證呼叫者為管理員 ----
    const authHeader = req.headers.get("Authorization") || "";
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return json({ error: "未登入" });
    const { data: profile } = await supa.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "admin") return json({ error: "僅限管理員使用" });

    const body = await req.json();
    const action = body.action;

    if (action === "ping") {
      // 測試連線：呼叫一次 Gemini 確認金鑰有效
      const t = await gemini('請只回覆 JSON：{"ok":"成功"}');
      return json({ ok: true, model: MODEL, sample: (t || "").slice(0, 40) });
    }

    if (action === "distractors") {
      const stem = String(body.stem || ""), correct = String(body.correct || "");
      const L = langLabel(String(body.lang || "zh"));
      if (!correct) return json({ error: "請先填正解" });
      const prompt =
        `你是護理與長照教育的出題助手。針對以下單選題，生成「恰好 3 個」看似合理但明確錯誤的干擾選項。要求：與正解同類型、長度相近、使用${L}、不得與正解重複。只輸出 JSON 陣列：["干擾1","干擾2","干擾3"]\n題幹：${stem || "（未提供）"}\n正確答案：${correct}`;
      const arr = parseJsonLoose(await gemini(prompt, { schema: { type: "ARRAY", items: { type: "STRING" } } }));
      if (!Array.isArray(arr) || arr.length < 3) return json({ error: "AI 回傳格式異常，請再試一次" });
      return json({ distractors: arr.slice(0, 3).map(String) });
    }

    if (action === "explain") {
      const stem = String(body.stem || ""), correct = String(body.correct || "");
      const distractors = Array.isArray(body.distractors) ? body.distractors : [];
      const L = langLabel(String(body.lang || "zh"));
      const prompt =
        `你是護理與長照教育講師。針對以下單選題，寫一段「教學解說」給照護人員自學使用。要求：使用${L}、3–5 句、語氣親切；內容包含 (1) 正確答案為何正確的觀念或原因，(2) 一個容易混淆或常犯的錯誤提醒。內容必須與本題緊密相符。只輸出純文字，不要 JSON、不要標題或引號。\n題幹：${stem}\n正確答案：${correct}\n其他選項：${distractors.filter(Boolean).join("、")}`;
      const t = (await gemini(prompt, { json: false }) || "").trim();
      return json({ explain: t.replace(/^["「『]|["」』]$/g, "").trim() });
    }

    if (action === "flash") {
      const stem = String(body.stem || ""), correct = String(body.correct || "");
      const L = langLabel(String(body.lang || "zh"));
      if (!correct) return json({ error: "請先填正解" });
      const prompt =
        `你是護理與長照教育講師。針對以下題目與簡短正解，寫出「一句可獨立閱讀的完整敘述」，同時當作課本重點的標題與字卡背面答案。\n嚴格要求：使用${L}、必須包含主題／主詞，讓人「不看題目」也能完全理解（例如寫「成人 CPR 胸外按壓深度應至少 5 公分（約 5–6 公分）」，而不是只寫「至少 5 公分」）、1–2 句、不要列出其他選項、不要 JSON、不要引號。\n題幹：${stem}\n簡短正解：${correct}`;
      const t = (await gemini(prompt, { json: false }) || "").trim();
      return json({ flashAnswer: t.replace(/^["「『]|["」』]$/g, "").trim() });
    }

    if (action === "questions") {
      const text = String(body.text || "");
      const auto = body.n === "auto" || body.n === 0 || body.n == null;
      const n = auto ? 0 : Math.min(20, Math.max(1, Number(body.n) || 5));
      if (text.trim().length < 10) return json({ error: "教材內容太短" });
      const countInstr = auto
        ? "請你依教材的內容量與重點多寡，自行判斷「適合的題數」（約 3–15 題；重點多就多出、少就少出，不要硬湊或重複）。"
        : `請出「${n}」題。`;
      const lang = String(body.lang || "zh");
      const kind = String(body.kind || "skill");
      let prompt: string;
      if (kind === "language") {
        // 語言學習：教「在台外籍照護人員」學中文，學員母語 = lang
        const native = langLabel(lang);
        prompt =
          `你是教「在台外籍照護人員」學中文的老師，學員母語是${native}。根據以下教材（照護情境常用語），出「學中文」的單選題。${countInstr}每題需包含：\n- stem：用${native}描述情境或給一個${native}的詞／句，詢問對應的中文說法（stem 使用${native}）\n- correct：正確的中文詞語或短句\n- distractors：3 個其他中文詞語（合理但錯誤，長度與 correct 相近）\n- flash_answer：一句完整中文敘述，示範這個中文詞的正確用法\n- explain：用${native}說明這個中文詞的意思、使用時機，並附上漢語拼音發音\n內容必須與教材緊密相符。\n教材內容：\n${text.slice(0, 8000)}`;
      } else if (lang !== "zh") {
        // 外籍技術學習：一律產出目標語言（教材可能是中文需翻譯，或已是該語言）
        const L = langLabel(lang);
        prompt =
          `你是護理與長照教育的出題助手，為在台外籍照護人員出題。以下教材可能是中文、也可能已是${L}；請一律產出「${L}」的單選題（若教材為中文，請翻譯成${L}）。${countInstr}每題需包含（全部使用${L}）：\n- stem：題幹\n- correct：簡短的正確選項\n- distractors：3 個合理但明確錯誤的簡短干擾選項（長度與 correct 相近）\n- flash_answer：一句可獨立閱讀、含主題／主詞的完整敘述\n- explain：3–5 句教學解說，說明正解觀念與一個易混淆重點\n內容必須與教材緊密相符。\n教材內容：\n${text.slice(0, 8000)}`;
      } else {
        prompt =
          `你是護理與長照教育的出題助手。根據以下教材出繁體中文單選題。${countInstr}每題需包含：\n- stem：題幹\n- correct：簡短的正確選項（幾個字或一個詞組，用於測驗選項）\n- distractors：3 個合理但明確錯誤的簡短干擾選項（長度與 correct 相近）\n- flash_answer：一句「可獨立閱讀的完整敘述」，同時當作課本重點的標題。必須包含主題／主詞，讓人不看題目也能理解（例如寫「成人 CPR 胸外按壓深度應至少 5 公分」，而非只寫「至少 5 公分」）\n- explain：3–5 句教學解說，說明正解觀念與一個容易混淆或常犯的重點，讓學員光看解說也能學會\n內容必須與教材與本題緊密相符。\n教材內容：\n${text.slice(0, 8000)}`;
      }
      const questionSchema = {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            stem: { type: "STRING" },
            correct: { type: "STRING" },
            distractors: { type: "ARRAY", items: { type: "STRING" } },
            flash_answer: { type: "STRING" },
            explain: { type: "STRING" },
          },
          required: ["stem", "correct", "distractors", "flash_answer", "explain"],
        },
      };
      const arr = parseJsonLoose(await gemini(prompt, { schema: questionSchema }));
      if (!Array.isArray(arr) || !arr.length) return json({ error: "AI 回傳格式異常，請再試一次" });
      const out = arr.slice(0, auto ? Math.min(arr.length, 20) : n).map((d: Record<string, unknown>) => ({
        stem: String(d.stem || ""),
        correct: String(d.correct || ""),
        distractors: (Array.isArray(d.distractors) ? d.distractors : []).slice(0, 3).map(String),
        flash_answer: String(d.flash_answer || ""),
        explain: String(d.explain || ""),
      })).filter((d) => d.stem && d.correct);
      return json({ questions: out });
    }

    // ================= 語言學習：單字卡（學中文） =================
    const cardSchema = {
      type: "OBJECT",
      properties: {
        zh: { type: "STRING" }, pinyin: { type: "STRING" }, meaning: { type: "STRING" },
        example_zh: { type: "STRING" }, example_pinyin: { type: "STRING" }, example_native: { type: "STRING" },
        theme: { type: "STRING" }, level: { type: "STRING" },
      },
      required: ["zh", "pinyin", "meaning", "example_zh", "example_pinyin", "example_native", "theme", "level"],
    };
    const normalizeCard = (d: Record<string, unknown>) => ({
      zh: String(d.zh || "").trim(), pinyin: String(d.pinyin || "").trim(), meaning: String(d.meaning || "").trim(),
      example_zh: String(d.example_zh || "").trim(), example_pinyin: String(d.example_pinyin || "").trim(),
      example_native: String(d.example_native || "").trim(), theme: String(d.theme || "").trim(),
      level: (String(d.level || "").toLowerCase() === "advanced" ? "advanced" : "basic"),
    });
    const cardFields = (native: string) =>
      `每張卡欄位：\n- zh：中文（繁體；輸入有錯字請訂正）\n- pinyin：漢語拼音（含聲調符號）\n- meaning：用${native}寫的意思\n- example_zh：一句照護情境的例句（繁體中文）\n- example_pinyin：例句的漢語拼音\n- example_native：例句的${native}翻譯\n- theme：主題（從：問候、身體部位、症狀、日常照護、盥洗、餵食、飲食、安全緊急、情緒安撫、時間數字、稱呼；擇一或自訂簡短詞）\n- level：basic 或 advanced（依難度）`;

    // 貼中文詞/句 → 補完成一張單字卡
    if (action === "vocab_enrich") {
      const native = langLabel(String(body.lang || "vi"));
      const zh = String(body.zh || "").trim();
      if (!zh) return json({ error: "請提供中文詞或句" });
      const prompt =
        `你是教在台外籍照護人員學中文的老師，學員母語是${native}。請把下面的中文補完成一張「照護學中文單字卡」。\n${cardFields(native)}\n只輸出一個 JSON 物件。\n中文輸入：${zh}`;
      const obj = parseJsonLoose(await gemini(prompt, { schema: cardSchema }));
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return json({ error: "AI 回傳格式異常，請再試一次" });
      return json({ card: normalizeCard(obj as Record<string, unknown>) });
    }

    // 匯入中文教材 → 拆成多張單字卡
    if (action === "vocab_split") {
      const native = langLabel(String(body.lang || "vi"));
      const text = String(body.text || "");
      if (text.trim().length < 4) return json({ error: "教材內容太短" });
      const auto = body.n === "auto" || body.n === 0 || body.n == null;
      const n = auto ? 0 : Math.min(40, Math.max(1, Number(body.n) || 10));
      const countInstr = auto
        ? "請依教材內容量，自行判斷適合的張數（約 5–25 張，涵蓋照護實用重點，不要重複）。"
        : `請產出「${n}」張卡。`;
      const prompt =
        `你是教在台外籍照護人員學中文的老師，學員母語是${native}。請從以下中文教材，挑出照護實用的詞／短句，做成「學中文單字卡」。${countInstr}\n${cardFields(native)}\n只輸出 JSON 陣列。\n教材：\n${text.slice(0, 8000)}`;
      const arr = parseJsonLoose(await gemini(prompt, { schema: { type: "ARRAY", items: cardSchema } }));
      if (!Array.isArray(arr) || !arr.length) return json({ error: "AI 回傳格式異常，請再試一次" });
      const out = arr.slice(0, auto ? Math.min(arr.length, 40) : n).map((d) => normalizeCard(d as Record<string, unknown>)).filter((c) => c.zh);
      return json({ cards: out });
    }

    return json({ error: "unknown action" });
  } catch (e) {
    return json({ error: (e as Error).message || String(e) });
  }
});
