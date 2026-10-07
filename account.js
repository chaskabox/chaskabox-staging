/* ChaskaBox customer account — Supabase Auth + own-row RLS only. */
let ACCOUNT_SESSION = null;
const aesc = (s) => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const afmt = (n) => 'Rs. ' + Number(n || 0).toLocaleString('en-PK');

async function initAccount(){
  if (!(await initSupabase()) || !SB) return false;
  const {data}=await SB.auth.getSession(); ACCOUNT_SESSION=data?.session||null;
  SB.auth.onAuthStateChange((_e,s)=>{ACCOUNT_SESSION=s||null; if(location.pathname==='/account/') renderAccountView();});
  return true;
}
function closeAuthModal(){ const m=document.getElementById('acctmodal'); if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');} }
function openAuthModal(mode='signin'){
  const m=document.getElementById('acctmodal'), b=document.getElementById('abody'); if(!m||!b)return;
  const signup=mode==='signup';
  b.innerHTML=`<div class="auth-card"><span class="eyebrow">${signup?'CREATE ACCOUNT':'WELCOME BACK'}</span><h2>${signup?'Create your ChaskaBox account':'Sign in'}</h2><p class="amut">Track orders and save your details securely.</p>
  ${signup?'<label>Full name<input id="authName" autocomplete="name"></label><label>Phone<input id="authPhone" inputmode="tel" autocomplete="tel"></label>':''}
  <label>Email<input id="authEmail" type="email" autocomplete="email"></label><label>Password<input id="authPass" type="password" autocomplete="'+(signup?'new-password':'current-password')+'"></label>
  <div id="authErr" class="order-error" role="alert" hidden></div><button class="cta" id="authSubmit">${signup?'Create account':'Sign in'}</button>
  <button class="text-btn" id="authSwitch">${signup?'Already have an account? Sign in':'New here? Create account'}</button></div>`;
  m.classList.add('open'); m.setAttribute('aria-hidden','false');
  document.getElementById('authSwitch').onclick=()=>openAuthModal(signup?'signin':'signup');
  document.getElementById('authSubmit').onclick=async()=>{
    const email=document.getElementById('authEmail').value.trim(), password=document.getElementById('authPass').value;
    const err=document.getElementById('authErr'); err.hidden=true;
    try{
      if(!(await initSupabase())) throw new Error('Account service is not configured.');
      let res;
      if(signup){
        const name=document.getElementById('authName').value.trim(), phone=document.getElementById('authPhone').value.trim();
        if(name.length<2) throw new Error('Please enter your full name.');
        res=await SB.auth.signUp({email,password,options:{data:{name,phone}}});
        if(res.error) throw res.error;
        if(res.data?.user){ await SB.from('profiles').upsert({id:res.data.user.id,name,phone,updated_at:new Date().toISOString()}); }
      }else{
        res=await SB.auth.signInWithPassword({email,password}); if(res.error) throw res.error;
      }
      closeAuthModal(); const {data}=await SB.auth.getSession(); ACCOUNT_SESSION=data?.session||null; renderAccountView();
    }catch(e){err.textContent=e.message||'Could not continue.';err.hidden=false;}
  };
}
async function renderAccountView(){
  const body=document.getElementById('acctbody'), nameEl=document.getElementById('acctName'); if(!body)return;
  body.innerHTML='<div class="empty-mini">Loading account…</div>';
  if(!(await initSupabase())||!SB){ body.innerHTML='<div class="empty-mini">Account service is not configured yet.</div>'; return; }
  const {data}=await SB.auth.getSession(); ACCOUNT_SESSION=data?.session||null;
  if(!ACCOUNT_SESSION){
    if(nameEl)nameEl.textContent='Sign in to view your orders';
    body.innerHTML='<div class="acct-signin"><h3>Your orders in one place</h3><p>Sign in or create an account. Guest checkout still works.</p><div class="confirm-actions"><button class="cta" id="acctSignIn">Sign in</button><button class="cta secondary" id="acctSignUp">Create account</button></div></div>';
    document.getElementById('acctSignIn').onclick=()=>openAuthModal('signin'); document.getElementById('acctSignUp').onclick=()=>openAuthModal('signup'); return;
  }
  const uid=ACCOUNT_SESSION.user.id;
  const [{data:profile},{data:orders,error:oerr}]=await Promise.all([
    SB.from('profiles').select('name,phone').eq('id',uid).maybeSingle(),
    SB.from('orders').select('id,order_number,total,payment_method,payment_status,fulfilment_status,created_at').eq('user_id',uid).order('created_at',{ascending:false}).limit(50)
  ]);
  const displayName=profile?.name||ACCOUNT_SESSION.user.user_metadata?.name||ACCOUNT_SESSION.user.email||'Customer'; if(nameEl)nameEl.textContent=displayName;
  const cards=(orders||[]).map(o=>`<article class="acct-order"><div><b>${aesc(o.order_number)}</b><small>${new Date(o.created_at).toLocaleDateString('en-PK')}</small></div><div><strong>${afmt(o.total)}</strong><small>${aesc(String(o.fulfilment_status||'new').replaceAll('_',' '))} · ${aesc(String(o.payment_status||'').replaceAll('_',' '))}</small></div><a href="/track-order.html?order=${encodeURIComponent(o.order_number)}">Track</a></article>`).join('');
  body.innerHTML=`<section class="co-card"><div class="panel-head"><div><h2>Profile</h2><p>${aesc(ACCOUNT_SESSION.user.email||'')}</p></div><button class="text-btn" id="acctLogout">Sign out</button></div><div class="form-two"><label>Name<input id="acctProfileName" value="${aesc(profile?.name||'')}"></label><label>Phone<input id="acctProfilePhone" value="${aesc(profile?.phone||'')}" inputmode="tel"></label></div><button class="cta secondary" id="acctSaveProfile">Save profile</button></section><section class="co-card" style="margin-top:16px"><h2>My Orders</h2>${oerr?'<p>Orders could not be loaded.</p>':(cards||'<div class="empty-mini">No account orders yet.</div>')}</section>`;
  document.getElementById('acctLogout').onclick=async()=>{await SB.auth.signOut();ACCOUNT_SESSION=null;renderAccountView();};
  document.getElementById('acctSaveProfile').onclick=async()=>{const btn=document.getElementById('acctSaveProfile');btn.disabled=true;await SB.from('profiles').upsert({id:uid,name:document.getElementById('acctProfileName').value.trim(),phone:document.getElementById('acctProfilePhone').value.trim(),updated_at:new Date().toISOString()});btn.textContent='Saved ✓';setTimeout(()=>{btn.textContent='Save profile';btn.disabled=false},1200);};
}
