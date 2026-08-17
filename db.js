/* =====================================================================
   照護學堂 · 共用資料層  db.js  （Supabase 版，取代舊 localStorage 版）
   需先載入： supabase-js（CDN） → supabase-client.js（sb / Auth） → db.js
   前台 index.html / 後台 admin.html / 報表 report.html 共用。

   設計：登入後一次把「目前使用者需要的資料」載入記憶體快取，畫面 render
   仍讀同步快取（改動最小）；寫入與評分則走非同步（Supabase / Edge Function）。
   ===================================================================== */

/* ---------- 角色 ---------- */
const ROLES = [
  { key:'care',         name:'照服員',   emoji:'🧑‍🦽', color:'#0f9d8f' },
  { key:'social',       name:'社工',     emoji:'🤝',   color:'#6366f1' },
  { key:'nurse',        name:'護理師',   emoji:'👩‍⚕️', color:'#e11d78' },
  { key:'foreign_care', name:'外籍照服', emoji:'🌏',   color:'#d97706', foreign:true },
  { key:'admin',        name:'管理員',   emoji:'🛠️',   color:'#475569' },
];
const roleOf   = k => ROLES.find(r=>r.key===k) || {name:k,color:'#888',emoji:'👤'};
const roleName = k => roleOf(k).name;
const isForeignRole = k => !!(roleOf(k)||{}).foreign;

/* ---------- 語言（外籍） ---------- */
const LANGS = [
  { key:'vi', name:'越南文', flag:'🇻🇳' },
  { key:'id', name:'印尼文', flag:'🇮🇩' },
];
const langOf   = k => LANGS.find(l=>l.key===k) || { key:k, name:(k==='zh'?'中文':k||'—'), flag:'' };
const langName = k => langOf(k).name;
/* 測驗類別（僅外籍有語言學習） */
const KINDS = [
  { key:'skill',    name:'技術學習', emoji:'📘' },
  { key:'language', name:'語言學習', emoji:'🈶' },
];
const kindOf = k => KINDS.find(x=>x.key===k) || KINDS[0];

/* ---------- 單位（機構）預設清單 ---------- */
const UNITS = [
  { code:'8C', name:'清福', zone:'C' }, { code:'7C', name:'清氣', zone:'C' }, { code:'6C', name:'清心', zone:'C' },
  { code:'5C', name:'清平', zone:'C' }, { code:'3C', name:'清安', zone:'C' }, { code:'2C', name:'護家', zone:'C' },
  { code:'8D', name:'清春', zone:'D' }, { code:'7D', name:'清日', zone:'D' }, { code:'6D', name:'清照', zone:'D' },
  { code:'5D', name:'清風', zone:'D' }, { code:'3D', name:'清景', zone:'D' }, { code:'2D', name:'護家', zone:'D' },
  { code:'8E', name:'清山', zone:'E' }, { code:'7E', name:'清泉', zone:'E' }, { code:'6E', name:'清水', zone:'E' },
  { code:'5E', name:'清清', zone:'E' }, { code:'3E', name:'清涼', zone:'E' },
];
const unitOf   = code => UNITS.find(u=>u.code===code) || null;
const unitLabel= code => { const u=unitOf(code); return u ? `${u.name}（${u.code}）` : (code || '未分單位'); };

/* SRS 間隔（天）—— 測驗複習用 */
const SRS_INTERVALS = [0, 1, 3, 7, 14, 30, 90];
/* 字卡間隔（天）—— Anki 式：按「熟悉」逐級變長，2–3 次後就很少再出現 */
const FLASH_INTERVALS = [0, 1, 2, 4, 8, 15, 30, 60];

/* =====================================================================
   共用工具（與舊版相容）
   ===================================================================== */
const todayNum = () => Math.floor(Date.now()/86400000);
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function initials(n){ return (n||'?').trim().slice(-2); }
function toast(m){ const h=document.getElementById('toast-host'); if(!h)return; const t=document.createElement('div'); t.className='toast'; t.textContent=m; h.appendChild(t); setTimeout(()=>t.remove(),2200); }

/** 每個瀏覽器一組固定 device id（用於異常偵測，不含 IP / 個資） */
function deviceId(){
  let d=localStorage.getItem('clinic_device_id');
  if(!d){ d=(crypto.randomUUID?crypto.randomUUID():'d'+Date.now()+Math.random()); localStorage.setItem('clinic_device_id',d); }
  return d;
}

/* =====================================================================
   DB 快取層
   ===================================================================== */
const DB = {
  cache: {
    quizzes:[], badgeDefs:[], userBadges:[],
    answers:[], reviews:[], leaderboard:[],
    quizQuestions:{},   // quizId -> [{id,stem,options}]（作答用，無正解）
    flash:{},           // quizId -> [{id,stem,correct,flash_answer,explain}]（字卡用）
    cardReviews:{},     // questionId -> {level,due,reps}（本人字卡複習進度）
    allQuestions:[],    // 後台用：完整題目（含正解 correct/distractors/explain/quiz_note）
  },

  /* ---------- 目前使用者 ---------- */
  me(){ return Auth.profile(); },

  /* ---------- 載入員工前台所需資料 ---------- */
  async loadForStaff(){
    const uid=this.me().id;
    const [quizzes, badgeDefs, userBadges, answers, reviews, leaderboard] = await Promise.all([
      sb.from('quizzes').select('*').order('created_at'),
      sb.from('badge_defs').select('*'),
      sb.from('user_badges').select('*').eq('user_id',uid),
      sb.from('answers').select('*').eq('user_id',uid),
      sb.from('reviews').select('*').eq('user_id',uid),
      sb.from('leaderboard').select('*'),
    ]);
    const err = [quizzes,badgeDefs,userBadges,answers,reviews,leaderboard].find(r=>r.error);
    if(err) throw err.error;
    this.cache.quizzes    = quizzes.data||[];
    this.cache.badgeDefs  = badgeDefs.data||[];
    this.cache.userBadges = (userBadges.data||[]).map(b=>b.badge_key);
    this.cache.answers    = answers.data||[];
    this.cache.reviews    = reviews.data||[];
    this.cache.leaderboard= leaderboard.data||[];
  },

  /* 依需求載入某測驗的「作答用題目」（無正解，來自 questions_public） */
  async ensureQuizQuestions(quizId){
    if(this.cache.quizQuestions[quizId]) return this.cache.quizQuestions[quizId];
    const { data, error } = await sb.from('questions_public').select('*').eq('quiz_id',quizId);
    if(error) throw error;
    this.cache.quizQuestions[quizId] = data||[];
    return this.cache.quizQuestions[quizId];
  },

  /* 依 id 取作答用題目（複習用；無正解） */
  async questionsByIds(ids){
    if(!ids||!ids.length) return [];
    const { data, error } = await sb.from('questions_public').select('*').in('id',ids);
    if(error) throw error;
    return data||[];
  },

  /* 依需求載入某測驗的「字卡」（含正解與詳解，來自 questions_flash） */
  async ensureFlash(quizId){
    if(this.cache.flash[quizId]) return this.cache.flash[quizId];
    const { data, error } = await sb.from('questions_flash').select('*').eq('quiz_id',quizId);
    if(error) throw error;
    this.cache.flash[quizId] = data||[];
    return this.cache.flash[quizId];
  },

  /* ---------- 字卡間隔複習（每帳號分開，RLS 保護） ---------- */
  async loadCardReviews(questionIds){
    if(!questionIds||!questionIds.length){ this.cache.cardReviews={}; return {}; }
    const { data, error } = await sb.from('card_reviews').select('*')
      .eq('user_id', this.me().id).in('question_id', questionIds);
    if(error) throw error;
    const map={}; (data||[]).forEach(r=>map[r.question_id]={level:r.level, due:r.due, reps:r.reps});
    this.cache.cardReviews=map; return map;
  },
  cardReview(qid){ return this.cache.cardReviews[qid]||null; },

  /** 重新載入測驗 SRS 複習清單（作答後、進入複習分頁時呼叫） */
  async refreshReviews(){
    const { data, error } = await sb.from('reviews').select('*').eq('user_id', this.me().id);
    if(!error) this.cache.reviews = data||[];
    return this.cache.reviews;
  },
  /** 評分一張字卡：known=true「熟悉」→ 間隔變長；false「需複習」→ 當天再現 */
  async rateCard(questionId, known){
    const uid=this.me().id, today=todayNum();
    const r=this.cache.cardReviews[questionId]||{level:0, reps:0};
    let level, reps;
    if(known){ level=Math.min((r.level||0)+1, FLASH_INTERVALS.length-1); reps=(r.reps||0)+1; }
    else { level=Math.max(0,(r.level||0)-1); reps=0; }
    const due = known ? today+FLASH_INTERVALS[level] : today;
    const row={ user_id:uid, question_id:questionId, level, due, reps, updated_at:new Date().toISOString() };
    const { error } = await sb.from('card_reviews').upsert(row, { onConflict:'user_id,question_id' });
    if(error) throw error;
    this.cache.cardReviews[questionId]={level, due, reps};
    return { level, due, reps, known };
  },

  /* ---------- 同步存取器（給 render 用） ---------- */
  quizzes(){ return this.cache.quizzes; },
  quiz(id){ return this.cache.quizzes.find(q=>q.id===id); },
  quizzesFor(role){ return role==='admin'? this.cache.quizzes : this.cache.quizzes.filter(q=>(q.roles||[]).includes(role)); },
  /** 外籍測驗清單：依語言(必)與類別(選) */
  foreignQuizzes(lang, kind){ return this.cache.quizzes.filter(q=>q.audience==='foreign' && q.lang===lang && (!kind || (q.kind||'skill')===kind)); },
  /** 目前登入者實際可見的測驗（台籍依角色；外籍再依語言過濾） */
  quizzesForUser(){ const u=this.me()||{}; if(u.role==='admin') return this.cache.quizzes;
    let list=this.cache.quizzes.filter(q=>(q.roles||[]).includes(u.role));
    if(isForeignRole(u.role)) list=list.filter(q=>q.lang===(u.lang||'vi'));
    return list; },
  quizQuestions(quizId){ return this.cache.quizQuestions[quizId]||[]; },
  flash(quizId){ return this.cache.flash[quizId]||[]; },
  badgeDefs(){ return this.cache.badgeDefs; },
  myBadges(){ return this.cache.userBadges; },
  answers(){ return this.cache.answers; },
  reviews(){ return this.cache.reviews; },
  leaderboard(){ return this.cache.leaderboard; },
  dueReviews(today){ return this.cache.reviews.filter(r=>r.due<=today); },

  /* ---------- 作答（伺服器評分；Edge Function：quiz） ---------- */
  /** 送出單題作答 → 伺服器評分並寫入。回傳 {correct, correctAnswer, quizNote, gained} */
  async grade(sessionId, quizId, questionId, chosen){
    const { data, error } = await sb.functions.invoke('quiz', {
      body:{ action:'grade', sessionId, quizId, questionId, chosen, deviceId:deviceId() }
    });
    if(error) throw error;
    if(data && data.error) throw new Error(data.error);
    return data;
  },
  /** 結束一份測驗 → 伺服器統計成績並寫入 attempt。回傳 {score,total,points} */
  async finish(sessionId, quizId){
    const { data, error } = await sb.functions.invoke('quiz', {
      body:{ action:'finish', sessionId, quizId, deviceId:deviceId() }
    });
    if(error) throw error;
    if(data && data.error) throw new Error(data.error);
    return data;
  },

  /** 作答後把伺服器回傳的最新狀態同步回快取（積分、答對數、複習、答題紀錄） */
  applyGradeResult(quizId, questionId, res){
    const u=this.me();
    if(u && res){ if(typeof res.points==='number') u.points=res.points; if(typeof res.answered==='number') u.answered=res.answered; }
    // 本地補一筆 answer，讓「加強弱點 / 隨機綜合」等即時可用
    this.cache.answers.push({ user_id:u.id, quiz_id:quizId, question_id:questionId, correct:!!res.correct, at:new Date().toISOString() });
  },

  /* =====================================================================
     後台（管理員）：讀寫題庫。管理員 RLS 允許直接操作 quizzes / questions。
     ===================================================================== */
  async loadForAdmin(){
    const [quizzes, questions] = await Promise.all([
      sb.from('quizzes').select('*').order('created_at'),
      sb.from('questions').select('*').order('created_at'),
    ]);
    if(quizzes.error) throw quizzes.error;
    if(questions.error) throw questions.error;
    this.cache.quizzes      = quizzes.data||[];
    this.cache.allQuestions = questions.data||[];
  },
  questionsOf(quizId){ return this.cache.allQuestions.filter(q=>q.quiz_id===quizId); },
  question(id){ return this.cache.allQuestions.find(q=>q.id===id); },

  async addQuiz({title, descr, emoji, roles, audience, lang, kind}){
    const { data, error } = await sb.from('quizzes').insert({
      title, descr:descr||'', emoji:emoji||'📘', roles,
      audience:audience||'local', lang:lang||'zh', kind:kind||'skill'
    }).select().single();
    if(error) throw error; this.cache.quizzes.push(data); return data;
  },
  async delQuiz(id){
    const { error } = await sb.from('quizzes').delete().eq('id',id);
    if(error) throw error;
    this.cache.quizzes = this.cache.quizzes.filter(q=>q.id!==id);
    this.cache.allQuestions = this.cache.allQuestions.filter(q=>q.quiz_id!==id);
  },
  async addQuestion({quiz_id, stem, correct, distractors, explain, quiz_note, flash_answer, lang}){
    const { data, error } = await sb.from('questions')
      .insert({quiz_id, stem, correct, distractors, explain:explain||'', quiz_note:quiz_note||'', flash_answer:flash_answer||'', lang:lang||'zh'}).select().single();
    if(error) throw error; this.cache.allQuestions.push(data); return data;
  },
  async updateQuestion(id, patch){
    const { data, error } = await sb.from('questions').update(patch).eq('id',id).select().single();
    if(error) throw error;
    const i=this.cache.allQuestions.findIndex(q=>q.id===id); if(i>=0) this.cache.allQuestions[i]=data;
    return data;
  },
  async delQuestion(id){
    const { error } = await sb.from('questions').delete().eq('id',id);
    if(error) throw error;
    this.cache.allQuestions = this.cache.allQuestions.filter(q=>q.id!==id);
  },
  async allProfiles(){
    const { data, error } = await sb.from('profiles').select('*').order('role').order('employee_id');
    if(error) throw error; return data||[];
  },
  async setUserUnit(userId, unit){
    const { error } = await sb.from('profiles').update({ unit: unit||'' }).eq('id', userId);
    if(error) throw error;
  },
  /** 設定員工語言（外籍照服用；管理員 RLS 可直接更新 profiles） */
  async setUserLang(userId, lang){
    const { error } = await sb.from('profiles').update({ lang: lang||'zh' }).eq('id', userId);
    if(error) throw error;
  },

  /* ---------- 語言學習：單字卡（vocab_cards / vocab_progress） ---------- */
  async loadVocab(lang){
    let q=sb.from('vocab_cards').select('*').order('theme').order('level').order('created_at');
    if(lang) q=q.eq('lang', lang);
    const { data, error }=await q; if(error) throw error; this.cache.vocab=data||[]; return this.cache.vocab;
  },
  vocab(){ return this.cache.vocab||[]; },
  async addVocabCard(c){ const { data, error }=await sb.from('vocab_cards').insert(c).select().single(); if(error) throw error; (this.cache.vocab=this.cache.vocab||[]).push(data); return data; },
  async addVocabCards(cards){ const { data, error }=await sb.from('vocab_cards').insert(cards).select(); if(error) throw error; this.cache.vocab=(this.cache.vocab||[]).concat(data||[]); return data||[]; },
  async updateVocabCard(id, patch){ const { data, error }=await sb.from('vocab_cards').update(patch).eq('id', id).select().single(); if(error) throw error; const i=(this.cache.vocab||[]).findIndex(x=>x.id===id); if(i>=0)this.cache.vocab[i]=data; return data; },
  async delVocabCard(id){ const { error }=await sb.from('vocab_cards').delete().eq('id', id); if(error) throw error; this.cache.vocab=(this.cache.vocab||[]).filter(x=>x.id!==id); },
  /* 熟悉度 */
  async loadVocabProgress(){ const { data, error }=await sb.from('vocab_progress').select('*').eq('user_id', this.me().id); if(error) throw error; this.cache.vocabProgress=data||[]; return data; },
  vocabProgress(){ return this.cache.vocabProgress||[]; },
  isFamiliar(cardId){ const p=(this.cache.vocabProgress||[]).find(x=>x.card_id===cardId); return !!(p && p.familiar); },
  async setVocabFamiliar(cardId, familiar){
    const { error }=await sb.from('vocab_progress').upsert({ user_id:this.me().id, card_id:cardId, familiar, updated_at:new Date().toISOString() }, { onConflict:'user_id,card_id' });
    if(error) throw error;
    const p=(this.cache.vocabProgress=this.cache.vocabProgress||[]); const ex=p.find(x=>x.card_id===cardId);
    if(ex) ex.familiar=familiar; else p.push({ user_id:this.me().id, card_id:cardId, familiar });
  },
  /* ---------- 字卡 SRS 間隔複習（沿用 FLASH_INTERVALS） ---------- */
  vocabProgOf(cardId){ return (this.cache.vocabProgress||[]).find(x=>x.card_id===cardId)||null; },
  /** 評分一張單字卡：known=true「熟悉」→ 間隔變長；false「不熟」→ 今天再現 */
  async rateVocab(cardId, known){
    const uid=this.me().id, today=todayNum();
    const p=(this.cache.vocabProgress=this.cache.vocabProgress||[]);
    const r=p.find(x=>x.card_id===cardId)||{level:0, reps:0};
    let level, reps;
    if(known){ level=Math.min((r.level||0)+1, FLASH_INTERVALS.length-1); reps=(r.reps||0)+1; }
    else { level=Math.max(0,(r.level||0)-1); reps=0; }
    const due = known ? today+FLASH_INTERVALS[level] : today;
    const row={ user_id:uid, card_id:cardId, familiar:known, level, due, reps, updated_at:new Date().toISOString() };
    const { error }=await sb.from('vocab_progress').upsert(row, { onConflict:'user_id,card_id' });
    if(error) throw error;
    const ex=p.find(x=>x.card_id===cardId);
    if(ex) Object.assign(ex,{familiar:known,level,due,reps}); else p.push(row);
    return { level, due, reps, known };
  },
  /** 今天到期需複習的卡（已學過、due<=今天） */
  vocabDueList(lang){ const t=todayNum(); return this.vocab().filter(c=>{ if(lang&&c.lang!==lang) return false; const pr=this.vocabProgOf(c.id); return pr && (pr.due||0)<=t; }); },
  /** 還沒學過的新卡（無進度紀錄） */
  vocabNewList(lang){ return this.vocab().filter(c=>{ if(lang&&c.lang!==lang) return false; return !this.vocabProgOf(c.id); }); },

  /* ---------- 合併單位群組（後台 / 報表用） ---------- */
  async loadUnitMerges(){
    const { data, error } = await sb.from('unit_merges').select('*').order('created_at');
    if(error) throw error; return data||[];
  },
  async saveUnitMerge(row){          // row: {id?, name, units[]}
    if(row.id){
      const { data, error } = await sb.from('unit_merges').update({ name:row.name, units:row.units }).eq('id',row.id).select().single();
      if(error) throw error; return data;
    }
    const { data, error } = await sb.from('unit_merges').insert({ name:row.name, units:row.units }).select().single();
    if(error) throw error; return data;
  },
  async deleteUnitMerge(id){
    const { error } = await sb.from('unit_merges').delete().eq('id',id);
    if(error) throw error;
  },
};

/* newUUID：產生一次測驗的 session id */
function newSessionId(){ return crypto.randomUUID?crypto.randomUUID():('s'+Date.now()+Math.random()); }

/* =====================================================================
   AI 呼叫層 —— 走 Edge Function「ai-generate」，金鑰保管於後端。
   僅管理員可用（Edge Function 內會驗證身分）。
   ===================================================================== */
async function aiInvoke(action, payload){
  const { data, error } = await sb.functions.invoke('ai-generate', { body:{ action, ...payload } });
  if(error){
    // 嘗試取出後端回傳的錯誤訊息
    let msg=error.message||'AI 服務呼叫失敗';
    try{ const b=await error.context?.json?.(); if(b?.error) msg=b.error; }catch(_){}
    throw new Error(msg);
  }
  if(data && data.error) throw new Error(data.error);
  return data;
}
async function aiPing(){ return await aiInvoke('ping', {}); }

/* 後台帳號管理 —— 走 Edge Function「admin-users」（建立/重設/刪除） */
async function adminUsers(action, payload){
  const { data, error } = await sb.functions.invoke('admin-users', { body:{ action, ...payload } });
  if(error){ let msg=error.message||'呼叫失敗'; try{ const b=await error.context?.json?.(); if(b?.error) msg=b.error; }catch(_){} throw new Error(msg); }
  if(data && data.error) throw new Error(data.error);
  return data;
}
// opts 可帶 { lang:'vi'|'id', kind:'skill'|'language', translate:true }（供外籍出題／翻譯／學中文用）
async function aiDistractors(stem, correct, opts){ return (await aiInvoke('distractors', {stem, correct, ...(opts||{})})).distractors; }
async function aiExplain(stem, correct, distractors, opts){ return (await aiInvoke('explain', {stem, correct, distractors, ...(opts||{})})).explain; }
async function aiFlashAnswer(stem, correct, opts){ return (await aiInvoke('flash', {stem, correct, ...(opts||{})})).flashAnswer; }
async function aiQuestionsFromText(text, n, opts){ return (await aiInvoke('questions', {text, n, ...(opts||{})})).questions; }
/* 語言學習單字卡：貼中文補完一張 / 匯入教材拆多張 */
async function aiVocabEnrich(zh, lang){ return (await aiInvoke('vocab_enrich', {zh, lang})).card; }
async function aiVocabSplit(text, lang, n){ return (await aiInvoke('vocab_split', {text, lang, n})).cards; }

/* =====================================================================
   檔案內容擷取 —— .txt/.md/.csv/.tsv、Word(.docx)、Excel(.xlsx)
   Word/Excel 皆為 ZIP+XML，用瀏覽器原生 DecompressionStream 解壓。
   （純前端工具，不需金鑰；擷取後的文字才送到 Edge Function 出題）
   ===================================================================== */
function decodeXml(s){
  return String(s)
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCharCode(parseInt(h,16)))
    .replace(/&amp;/g,'&');
}
async function _unzip(file){
  const buf=new Uint8Array(await file.arrayBuffer());
  const dv=new DataView(buf.buffer);
  let eocd=-1;
  for(let i=buf.length-22;i>=0 && i>buf.length-22-65536;i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
  if(eocd<0) throw new Error('檔案格式無法解析');
  const count=dv.getUint16(eocd+10,true); let p=dv.getUint32(eocd+16,true);
  const entries={};
  for(let n=0;n<count;n++){
    if(dv.getUint32(p,true)!==0x02014b50) break;
    const method=dv.getUint16(p+10,true), compSize=dv.getUint32(p+20,true);
    const nameLen=dv.getUint16(p+28,true), extraLen=dv.getUint16(p+30,true), commentLen=dv.getUint16(p+32,true);
    const localOff=dv.getUint32(p+42,true);
    const nm=new TextDecoder().decode(buf.subarray(p+46,p+46+nameLen));
    entries[nm]={method,compSize,localOff};
    p+=46+nameLen+extraLen+commentLen;
  }
  return {buf,dv,entries};
}
async function _readEntry(zip,name){
  const e=zip.entries[name]; if(!e) return null;
  const {buf,dv}=zip, lo=e.localOff;
  if(dv.getUint32(lo,true)!==0x04034b50) throw new Error('ZIP 讀取錯誤');
  const nameLen=dv.getUint16(lo+26,true), extraLen=dv.getUint16(lo+28,true);
  const start=lo+30+nameLen+extraLen, comp=buf.subarray(start,start+e.compSize);
  if(e.method===0) return new TextDecoder().decode(comp);
  if(e.method===8){
    if(typeof DecompressionStream==='undefined') throw new Error('此瀏覽器不支援解壓縮，請改用 CSV 或純文字');
    const ds=new DecompressionStream('deflate-raw');
    const out=await new Response(new Blob([comp]).stream().pipeThrough(ds)).arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(out));
  }
  throw new Error('不支援的壓縮方式');
}
async function _extractDocx(file){
  const zip=await _unzip(file);
  const xml=await _readEntry(zip,'word/document.xml');
  if(!xml) throw new Error('Word 內容讀取失敗');
  let s=xml.replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'');
  return decodeXml(s).replace(/\n{3,}/g,'\n\n').trim();
}
async function _extractXlsx(file){
  const zip=await _unzip(file);
  const ssXml=await _readEntry(zip,'xl/sharedStrings.xml')||'';
  const shared=[];
  ssXml.replace(/<si>([\s\S]*?)<\/si>/g,(_,si)=>{ let t=''; si.replace(/<t[^>]*>([\s\S]*?)<\/t>/g,(_,x)=>{t+=x;return'';}); shared.push(decodeXml(t)); return ''; });
  let sheetName=Object.keys(zip.entries).find(k=>/^xl\/worksheets\/.*\.xml$/i.test(k));
  const sheetXml = sheetName? await _readEntry(zip,sheetName):null;
  if(!sheetXml) throw new Error('Excel 工作表讀取失敗');
  const lines=[];
  sheetXml.replace(/<row[^>]*>([\s\S]*?)<\/row>/g,(_,row)=>{
    const cells=[];
    row.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g,(_,attrs,cell)=>{
      const type=(attrs.match(/t="([^"]+)"/)||[])[1];
      const vm=cell.match(/<v>([\s\S]*?)<\/v>/), tm=cell.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      let v='';
      if(type==='s' && vm) v=shared[+vm[1]]||'';
      else if(tm) v=decodeXml(tm[1]);
      else if(vm) v=decodeXml(vm[1]);
      v=(v||'').trim(); if(v!=='') cells.push(v);
      return '';
    });
    if(cells.length) lines.push(cells.join('：'));
    return '';
  });
  if(!lines.length) throw new Error('Excel 沒有讀到內容');
  return lines.join('\n');
}
async function extractTextFromFile(file){
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  if(['txt','md','csv','tsv','text'].includes(ext)) return await file.text();
  if(ext==='docx') return await _extractDocx(file);
  if(ext==='xlsx') return await _extractXlsx(file);
  if(ext==='pdf') throw new Error('PDF 目前需另存為 Word / Excel / 純文字，或直接貼上內容');
  if(ext==='doc'||ext==='xls') throw new Error('舊版 .doc/.xls 不支援，請另存為 .docx/.xlsx');
  return await file.text();
}

/* ---- 結構化表格讀取（保留欄位位置，供帳號匯入用）：回傳 [[cell,cell,...], ...] ---- */
function _colToIdx(ref){ const m=(ref||'').match(/^([A-Z]+)/); if(!m) return 0; let n=0; for(const ch of m[1]) n=n*26+(ch.charCodeAt(0)-64); return n-1; }
async function _extractXlsxRows(file){
  const zip=await _unzip(file);
  const ssXml=await _readEntry(zip,'xl/sharedStrings.xml')||'';
  const shared=[];
  ssXml.replace(/<si>([\s\S]*?)<\/si>/g,(_,si)=>{ let t=''; si.replace(/<t[^>]*>([\s\S]*?)<\/t>/g,(_,x)=>{t+=x;return'';}); shared.push(decodeXml(t)); return ''; });
  const sheetName=Object.keys(zip.entries).find(k=>/^xl\/worksheets\/.*\.xml$/i.test(k));
  const sheetXml = sheetName? await _readEntry(zip,sheetName):null;
  if(!sheetXml) throw new Error('Excel 工作表讀取失敗');
  const rows=[];
  sheetXml.replace(/<row[^>]*>([\s\S]*?)<\/row>/g,(_,row)=>{
    const cells=[];
    row.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g,(_,attrs,cell)=>{
      const ref=(attrs.match(/r="([A-Z]+\d+)"/)||[])[1];
      const idx=_colToIdx(ref);
      const type=(attrs.match(/t="([^"]+)"/)||[])[1];
      const vm=cell.match(/<v>([\s\S]*?)<\/v>/), tm=cell.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      let v='';
      if(type==='s' && vm) v=shared[+vm[1]]||'';
      else if(tm) v=decodeXml(tm[1]);
      else if(vm) v=decodeXml(vm[1]);
      cells[idx]=(v||'').trim();
      return '';
    });
    for(let i=0;i<cells.length;i++) if(cells[i]===undefined) cells[i]='';
    rows.push(cells);
    return '';
  });
  return rows;
}
function _parseCSVLine(line, delim){
  const out=[]; let cur='', q=false;
  for(let i=0;i<line.length;i++){ const ch=line[i];
    if(q){ if(ch==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=ch; }
    else { if(ch==='"') q=true; else if(ch===delim){ out.push(cur); cur=''; } else cur+=ch; } }
  out.push(cur); return out.map(s=>s.trim());
}
async function parseTabularRows(file){
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  if(ext==='xlsx') return await _extractXlsxRows(file);
  if(['doc','docx','xls','pdf'].includes(ext)) throw new Error('請用 .xlsx 或 .csv 匯入帳號');
  const text=(await file.text()).replace(/^﻿/,'');   // 去除 UTF-8 BOM，避免第一格前多一個看不見的字元
  const delim = ext==='tsv' ? '\t' : (text.indexOf('\t')>=0 && text.indexOf(',')<0 ? '\t' : ',');
  return text.split(/\r?\n/).filter(l=>l.trim()!=='').map(l=>_parseCSVLine(l, delim));
}
