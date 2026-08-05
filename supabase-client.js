/* =====================================================================
   照護學堂 · Supabase 用戶端 + 驗證層  supabase-client.js
   由 index.html / admin.html / report.html 共用。
   需先載入 supabase-js（CDN）再載入本檔。
   金鑰為 publishable（公開）金鑰，安全放在前端；資料由 RLS 保護。
   ===================================================================== */

const SUPABASE_URL  = 'https://fbgqyioheqposvgmbfnk.supabase.co';
const SUPABASE_ANON = 'sb_publishable_JWI_yrSeA1ZRmKOMPtK4HA_MZ4Ku7ff';
const EMAIL_SUFFIX  = '@clinic.local';   // 員工只輸入 H####，內部補上此後綴

/* 全域 supabase 用戶端 */
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/* 員工編號 → 內部信箱（H1974 → h1974@clinic.local） */
function empIdToEmail(empId){
  return String(empId || '').trim().toLowerCase() + EMAIL_SUFFIX;
}

/* =====================================================================
   驗證層 Auth
   ===================================================================== */
const Auth = {
  _profile: null,

  /** 以員工編號 + 密碼登入，成功後載入 profile */
  async login(empId, password){
    const email = empIdToEmail(empId);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error) throw error;
    return await this.loadProfile();
  },

  async logout(){
    await sb.auth.signOut();
    this._profile = null;
  },

  /** 目前登入的 auth session（未登入回傳 null） */
  async session(){
    const { data } = await sb.auth.getSession();
    return data.session || null;
  },

  /** 讀取目前使用者的 profile（角色、積分…），快取於 _profile */
  async loadProfile(){
    const { data: { user } } = await sb.auth.getUser();
    if(!user){ this._profile = null; return null; }
    const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
    if(error) throw error;
    this._profile = data;
    return data;
  },

  profile(){ return this._profile; },
  isAdmin(){ return !!this._profile && this._profile.role === 'admin'; },
  mustChangePassword(){ return !!this._profile && this._profile.must_change_password; },

  /** 變更自己的密碼，並清除「首次登入須改密碼」旗標 */
  async changePassword(newPassword){
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if(error) throw error;
    // 變更密碼可能輪替 access token；先重新整理 session，確保後續寫入帶有有效身分
    try{ await sb.auth.refreshSession(); }catch(_){}
    const { data: { user } } = await sb.auth.getUser();
    if(!user) throw new Error('登入狀態已失效，請重新登入後再試一次');
    const { data, error: upErr } = await sb.from('profiles')
      .update({ must_change_password: false }).eq('id', user.id).select();
    if(upErr) throw upErr;
    if(!data || !data.length) throw new Error('密碼已更新，但狀態未寫入，請再試一次');
    this._profile = data[0];
  },
};
