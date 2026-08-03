/* =====================================================================
   照護學堂 · 共用資料庫層  db.js
   前台 index.html 與 後台 admin.html 共用同一份資料。
   目前用 localStorage 當假資料庫；未來每個方法內部換成
   supabase.from(...).select()/insert()/update()/delete() 即可，
   前後台的畫面邏輯完全不用動。
   ===================================================================== */

/* ---------- 角色 ---------- */
const ROLES = [
  { key:'care',   name:'照服員', emoji:'🧑‍🦽', color:'#0f9d8f' },
  { key:'social', name:'社工',   emoji:'🤝',   color:'#6366f1' },
  { key:'nurse',  name:'護理師', emoji:'👩‍⚕️', color:'#e11d78' },
  { key:'admin',  name:'管理員', emoji:'🛠️',   color:'#475569' },
];
const roleOf   = k => ROLES.find(r=>r.key===k) || {name:k,color:'#888',emoji:'👤'};
const roleName = k => roleOf(k).name;

/* SRS 間隔（天） */
const SRS_INTERVALS = [0, 1, 3, 7, 14, 30, 90];

/* =====================================================================
   DB 層（localStorage；共用 key = clinic_quiz_v2）
   ===================================================================== */
const DB = {
  _k:'clinic_quiz_v3',
  _load(){ try{return JSON.parse(localStorage.getItem(this._k))||null}catch(e){return null} },
  _save(d){ localStorage.setItem(this._k, JSON.stringify(d)); },
  data:null,
  init(){ this.data=this._load(); if(!this.data){ this.data=seed(); this._save(this.data); } },
  /** 重新從儲存讀取（多分頁／前後台切換時保持同步） */
  refresh(){ const d=this._load(); if(d) this.data=d; },
  commit(){ this._save(this.data); },

  /* profiles */
  users(){ return this.data.users; },
  user(id){ return this.data.users.find(u=>u.id===id); },
  addUser(name, role){
    const u={ id:'u'+Date.now(), name, role, points:0, streak:0, lastActive:null, badges:[], answered:0 };
    this.data.users.push(u); this.commit(); return u;
  },
  delUser(id){ this.data.users=this.data.users.filter(u=>u.id!==id); this.commit(); },

  /* quizzes */
  quizzes(){ return this.data.quizzes; },
  quizzesFor(role){ return role==='admin'? this.data.quizzes : this.data.quizzes.filter(q=>q.roles.includes(role)); },
  quiz(id){ return this.data.quizzes.find(q=>q.id===id); },
  addQuiz(q){ q.id='q'+Date.now(); this.data.quizzes.push(q); this.commit(); return q; },
  delQuiz(id){ this.data.quizzes=this.data.quizzes.filter(q=>q.id!==id);
    this.data.questions=this.data.questions.filter(q=>q.quizId!==id); this.commit(); },

  /* questions */
  questions(){ return this.data.questions; },
  questionsOf(quizId){ return this.data.questions.filter(q=>q.quizId===quizId); },
  question(id){ return this.data.questions.find(q=>q.id===id); },
  addQuestion(q){ q.id='qq'+Date.now()+Math.floor(Math.random()*999); this.data.questions.push(q); this.commit(); return q; },
  updateQuestion(id, patch){ const q=this.question(id); if(q){ Object.assign(q,patch); this.commit(); } return q; },
  delQuestion(id){ this.data.questions=this.data.questions.filter(q=>q.id!==id); this.commit(); },

  /* attempts */
  attempts(){ return this.data.attempts; },
  addAttempt(a){ a.id='a'+Date.now()+Math.floor(Math.random()*999); this.data.attempts.push(a); this.commit(); return a; },

  /* answers（逐題作答紀錄，供報表與題目難度分析用） */
  answers(){ return this.data.answers; },
  addAnswer(a){ this.data.answers.push(a); this.commit(); return a; },

  /* SRS reviews */
  review(userId,qId){ return this.data.reviews.find(r=>r.userId===userId && r.questionId===qId); },
  dueReviews(userId,today){ return this.data.reviews.filter(r=>r.userId===userId && r.due<=today); },
  upsertReview(userId,qId,correct,today){
    let r=this.review(userId,qId);
    if(!r){ r={userId,questionId:qId,level:0,due:today}; this.data.reviews.push(r); }
    r.level = correct ? Math.min(r.level+1,SRS_INTERVALS.length-1) : Math.max(r.level-1,1);
    r.due = today + SRS_INTERVALS[r.level];
    this.commit(); return r;
  },
  badgeDefs(){ return this.data.badgeDefs; },
};

/* =====================================================================
   種子資料
   ===================================================================== */
function seed(){
  const q1='q_common', q2='q_nurse';
  const data = {
    users:[
      { id:'admin', name:'系統管理員', role:'admin', points:0,  streak:0, lastActive:null, badges:[], answered:0 },
      { id:'demo1', name:'王小美',     role:'care',  points:40, streak:1, lastActive:null, badges:['first'], answered:4 },
      { id:'demo2', name:'陳社工',     role:'social',points:20, streak:1, lastActive:null, badges:['first'], answered:2 },
      { id:'demo3', name:'林護理',     role:'nurse', points:65, streak:3, lastActive:null, badges:['first'], answered:7 },
    ],
    quizzes:[
      { id:q1, title:'感染管制基礎', desc:'全體員工共同必考', emoji:'🧼', roles:['care','social','nurse'] },
      { id:q2, title:'給藥安全', desc:'護理專屬', emoji:'💊', roles:['nurse'] },
    ],
    questions:[
      { id:'qq1', quizId:q1, stem:'洗手的黃金五時機，不包含下列何者？',
        correct:'看到長輩心情不好時', distractors:['接觸長輩前','接觸體液後','接觸長輩周遭環境後'],
        explain:'洗手五時機：接觸病人前、清潔／無菌操作前、暴露體液風險後、接觸病人後、接觸病人周遭環境後。' },
      { id:'qq2', quizId:q1, stem:'酒精性乾洗手最主要的作用是？',
        correct:'快速殺滅手部大部分微生物', distractors:['去除手上的油汙','讓雙手保持濕潤','完全取代肥皂洗手'],
        explain:'手部無明顯髒污時，乾洗手能快速降低微生物量；有明顯髒污或孢子類病原仍須肥皂洗手。' },
      { id:'qq3', quizId:q2, stem:'給藥「三讀五對」中的「五對」不包含下列何者？',
        correct:'對藥價', distractors:['對病人','對藥物','對劑量'],
        explain:'五對：對病人、對藥物、對劑量、對時間、對途徑。' },
    ],
    attempts:[],
    answers:[],
    reviews:[],
    badgeDefs:[
      { key:'first',   emoji:'🌱', name:'初次作答' },
      { key:'streak7', emoji:'🔥', name:'連續7天' },
      { key:'perfect', emoji:'💯', name:'單次滿分' },
      { key:'century', emoji:'🏅', name:'答對100題' },
    ],
  };
  // ---- 產生約兩週的示範作答歷史，讓主管報表有資料可視覺化 ----
  const DAY=86400000, now=Date.now();
  const qmap={ q_common:['qq1','qq2'], q_nurse:['qq3'] };
  const plan=[
    { id:'demo1', quizzes:['q_common'],           skill:0.55 },
    { id:'demo2', quizzes:['q_common'],           skill:0.50 },
    { id:'demo3', quizzes:['q_common','q_nurse'], skill:0.62 },
  ];
  let seq=0;
  plan.forEach(p=>{
    for(let d=13; d>=0; d--){
      if(Math.random()<0.4) continue;              // 不是每天都作答
      const progress=(13-d)/13;                    // 越近期越熟練
      p.quizzes.forEach(qz=>{
        const qs=qmap[qz];
        const pCorrect=Math.min(0.97, p.skill + 0.35*progress + (Math.random()*0.16-0.08));
        const at=now - d*DAY - Math.floor(Math.random()*9)*3600000;
        let correct=0;
        qs.forEach(qid=>{ const ok=Math.random()<pCorrect; if(ok)correct++;
          data.answers.push({ userId:p.id, quizId:qz, questionId:qid, correct:ok, at }); });
        data.attempts.push({ id:'a'+at+(seq++), userId:p.id, quizId:qz, score:correct, total:qs.length, points:correct*10, at });
      });
    }
  });
  return data;
}

/* =====================================================================
   共用工具
   ===================================================================== */
const todayNum = () => Math.floor(Date.now()/86400000);
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function initials(n){ return (n||'?').trim().slice(-2); }
function toast(m){ const h=document.getElementById('toast-host'); if(!h)return; const t=document.createElement('div'); t.className='toast'; t.textContent=m; h.appendChild(t); setTimeout(()=>t.remove(),2200); }

/* =====================================================================
   模擬 AI（未來→Supabase Edge Function 內 LLM；金鑰不放前端）
   ===================================================================== */
function aiGenerateDistractors(stem, correct){
  const base=correct.trim();
  const cands=[ base+'（相反情況）','以上皆非', base.length>2? base.slice(0,Math.ceil(base.length/2))+'不足':base+'不足','需視醫囑而定','無特別限制' ];
  return shuffle(cands).slice(0,3);
}
function aiGenerateQuestionsFromText(text, n){
  const segs = text.split(/[\n。！？!?；;]+/).map(s=>s.trim()).filter(s=>s.length>=6 && !s.startsWith('#'));
  const out=[];
  for(const seg of segs){
    if(out.length>=n) break;
    let m = seg.match(/^(.{2,14}?)\s*[:：]\s*(.+)$/) || seg.match(/^(.{2,10}?)是(.{4,})$/);
    if(m && m[2].trim().length>=3){
      const term=m[1].trim(), def=m[2].trim();
      out.push({ stem:`關於「${term}」，下列敘述何者正確？`, correct:def,
        distractors:aiGenerateDistractors(seg,def), explain:`出自教材：${seg}` });
      continue;
    }
    let key=null;
    const num=seg.match(/\d+(\.\d+)?\s*[%％]?/);
    if(num) key=num[0].trim();
    else { const mm=seg.match(/[一-龥]{2,5}(?=[，,、。]|$)/); key=mm?mm[0]:null; }
    if(!key || key.length<1) continue;
    out.push({ stem:`填空：${seg.replace(key,'＿＿＿')}`, correct:key,
      distractors:aiGenerateDistractors(seg,key), explain:`出自教材：${seg}` });
  }
  return out;
}

/* =====================================================================
   AI 呼叫層 —— Google Gemini / Gemma（AI Studio 免費金鑰）
   金鑰由管理員在後台輸入，存在該瀏覽器 localStorage。
   沒設金鑰時自動退回本機規則生成（上方 aiGenerate* 函式）。
   ⚠️ 靜態網站的臨時做法；正式上線請改用後端保管金鑰。
   ===================================================================== */
const AI = {
  cfgKey:'ai_cfg_v1',
  MODEL:'gemini-3.5-flash',            // 已固定模型（2026/8 查證：GA 穩定版；最新為 3.6-flash）
  get(){ try{ return JSON.parse(localStorage.getItem(this.cfgKey))||{}; }catch(e){ return {}; } },
  set(c){ localStorage.setItem(this.cfgKey, JSON.stringify(c)); },
  enabled(){ return !!this.get().key; },
  model(){ return this.MODEL; },
  async call(prompt, opts){
    const c=this.get();
    if(!c.key) throw new Error('尚未設定 AI 金鑰');
    const json = !opts || opts.json!==false;   // 預設要求 JSON；純文字時傳 {json:false}
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${this.model()}:generateContent?key=${encodeURIComponent(c.key)}`;
    const gen={ temperature:0.8 }; if(json) gen.responseMimeType='application/json';
    const body={ contents:[{ parts:[{ text:prompt }] }], generationConfig:gen };
    let r;
    try{ r=await fetch(url,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); }
    catch(e){ throw new Error('網路或跨域錯誤，請確認金鑰與網路'); }
    if(!r.ok){ let t=''; try{ t=(await r.json()).error?.message||''; }catch(_){ } throw new Error(`API ${r.status}${t?'：'+t.slice(0,120):''}`); }
    const j=await r.json();
    return (j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts||[]).map(p=>p.text||'').join('');
  },
};
function parseJsonLoose(txt){
  if(!txt) return null;
  try{ return JSON.parse(txt); }catch(e){}
  const m=txt.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
  return null;
}
/* 生成 3 個干擾項（有金鑰用 Gemini，否則退回本機） */
async function aiDistractors(stem, correct){
  if(!AI.enabled()) return aiGenerateDistractors(stem, correct);
  const prompt=`你是護理與長照教育的出題助手。針對以下單選題，生成「恰好 3 個」看似合理但明確錯誤的干擾選項。要求：與正解同類型、長度相近、繁體中文、不得與正解重複。只輸出 JSON 陣列：["干擾1","干擾2","干擾3"]
題幹：${stem||'（未提供）'}
正確答案：${correct}`;
  const arr=parseJsonLoose(await AI.call(prompt));
  if(!Array.isArray(arr)||arr.length<3) throw new Error('AI 回傳格式異常，請再試一次');
  return arr.slice(0,3).map(x=>String(x));
}
/* 讀教材生成整批題目（有金鑰用 Gemini，否則退回本機） */
async function aiQuestionsFromText(text, n){
  if(!AI.enabled()) return aiGenerateQuestionsFromText(text, n);
  const prompt=`你是護理與長照教育的出題助手。根據以下教材，出「${n}」題繁體中文單選題。每題需有 1 個正確答案、3 個合理但錯誤的干擾選項，以及一段「教學解說」(explain)。
教學解說要求：2–4 句、說明正確答案的觀念或原因、並提醒一個容易混淆或常犯的錯誤，讓學員光看解說也能學會，內容必須與本題緊密相符。
只輸出 JSON 陣列，格式：
[{"stem":"題幹","correct":"正解","distractors":["干擾1","干擾2","干擾3"],"explain":"教學解說"}]
教材內容：
${String(text).slice(0,8000)}`;
  const arr=parseJsonLoose(await AI.call(prompt));
  if(!Array.isArray(arr)||!arr.length) throw new Error('AI 回傳格式異常，請再試一次');
  return arr.slice(0,n).map(d=>({
    stem:String(d.stem||''), correct:String(d.correct||''),
    distractors:(Array.isArray(d.distractors)?d.distractors:[]).slice(0,3).map(String),
    explain:String(d.explain||''),
  })).filter(d=>d.stem && d.correct);
}

/* 生成／加強單題的教學解說（用於學習模式；與該題內容相符） */
async function aiExplain(stem, correct, distractors){
  if(!AI.enabled()){
    return `正確答案是「${correct}」。學習時請掌握此重點，並留意與其他選項（${(distractors||[]).filter(Boolean).join('、')||'其他'}）的差異，避免混淆。`;
  }
  const prompt=`你是護理與長照教育講師。針對以下單選題，寫一段「教學解說」給照護人員自學使用。
要求：繁體中文、2–4 句、語氣親切；內容包含 (1) 正確答案為何正確的觀念或原因，(2) 一個容易混淆或常犯的錯誤提醒。內容必須與本題緊密相符。只輸出純文字，不要 JSON、不要標題或引號。
題幹：${stem}
正確答案：${correct}
其他選項：${(distractors||[]).filter(Boolean).join('、')}`;
  const t=(await AI.call(prompt, {json:false})||'').trim();
  return t.replace(/^["「『]|["」』]$/g,'').trim() || `正確答案是「${correct}」。`;
}

/* =====================================================================
   檔案內容擷取 —— 支援 .txt/.md/.csv/.tsv、Word(.docx)、Excel(.xlsx)
   Word/Excel 皆為 ZIP+XML，用瀏覽器原生 DecompressionStream 解壓，
   不需外部函式庫。PDF 仍需後端處理。
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
    if(cells.length) lines.push(cells.join('：'));   // 兩欄→「題目：答案」，最適合出題
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
  if(ext==='pdf') throw new Error('PDF 目前需後端處理，請改上傳 Word / Excel / 純文字，或直接貼上內容');
  if(ext==='doc'||ext==='xls') throw new Error('舊版 .doc/.xls 不支援，請另存為 .docx/.xlsx');
  return await file.text();
}

/* 啟動即載入資料 */
DB.init();
