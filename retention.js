/* ChaskaBox — PART 3: Retention features (all localStorage-first, degrade gracefully) */
(function(){
'use strict';

/* ---------- tiny storage helpers ---------- */
function lsGet(k, d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }
function todayStr(){ return new Date().toISOString().slice(0,10); }

/* ---------- device id (for guest referral codes) ---------- */
function deviceId(){
  let id = lsGet('cb_device_id', null);
  if(!id){ id = Math.random().toString(36).slice(2,8).toUpperCase(); lsSet('cb_device_id', id); }
  return id;
}

/* ---------- slim dismissible banner (under header) ---------- */
function showSlimBanner(html, id, opts){
  opts = opts || {};
  if(id && lsGet('cb_banner_hide_'+id, '') === todayStr()) return; // dismissed today
  if(document.getElementById('retain-'+id)) return;
  const bar = document.createElement('div');
  bar.className = 'retain-banner' + (opts.cls ? ' '+opts.cls : '');
  bar.id = 'retain-'+id;
  bar.innerHTML = '<div class="retain-inner">'+html
    + '<button class="retain-x" aria-label="Band karein">✕</button></div>';
  const promo = document.querySelector('.promo');
  if(promo && promo.parentNode) promo.parentNode.insertBefore(bar, promo.nextSibling);
  else document.body.insertBefore(bar, document.body.firstChild);
  bar.querySelector('.retain-x').onclick = function(){
    lsSet('cb_banner_hide_'+id, todayStr());
    bar.remove();
  };
}

/* ============================================================
   1. ABANDONED CART RECOVERY
   - records when the user leaves with items in cart
   - on next visit: if 30+ min passed and cart still has items,
     show a friendly nudge (max once per day)
   ============================================================ */
function cartCount(){
  try{
    const c = JSON.parse(localStorage.getItem('chaskabox-cart')||'{}');
    return Object.keys(c).length;
  }catch(e){ return 0; }
}
function markAbandon(){
  if(cartCount() > 0) lsSet('cb_cart_abandoned_at', Date.now());
  else lsDel('cb_cart_abandoned_at');
}
function checkAbandonedCart(){
  const at = lsGet('cb_cart_abandoned_at', 0);
  if(!at) return;
  if(cartCount() === 0){ lsDel('cb_cart_abandoned_at'); return; }
  const THIRTY_MIN = 30*60*1000;
  if(Date.now() - at < THIRTY_MIN) return;
  if(lsGet('cb_nudge_date','') === todayStr()) return; // once per day
  lsSet('cb_nudge_date', todayStr());
  lsDel('cb_cart_abandoned_at'); // only once per abandon cycle
  openCartNudge();
}
function openCartNudge(){
  closeCartNudge();
  const m = document.createElement('div');
  m.className = 'modal open'; m.id = 'cartnudge';
  m.innerHTML =
    '<div class="mbox nudgebox" role="dialog" aria-label="Cart reminder">'
    + '<button class="mclose" onclick="closeCartNudge()">✕</button>'
    + '<div class="nudge-emoji">🛒</div>'
    + '<h3>Bhool gaye? 😊</h3>'
    + '<p>Aapki snack bag abhi bhi wait kar rahi hai!<br><small class="amut">Order complete karein — 4-7 din mein delivery.</small></p>'
    + '<button class="abtn" onclick="closeCartNudge();openDrawer()">🛒 Complete Order</button>'
    + '<button class="alink" onclick="closeCartNudge()">Baad mein</button> '
    + '<button class="alink danger" onclick="if(confirm(\'Cart clear karein?\')){CART={};saveCart();}closeCartNudge()">Clear cart</button>'
    + '</div>';
  m.addEventListener('click', function(e){ if(e.target===m) closeCartNudge(); });
  document.body.appendChild(m);
}
window.closeCartNudge = function(){ const m=document.getElementById('cartnudge'); if(m) m.remove(); };

/* ============================================================
   2. MARKET FRESH — weekly pick render
   ============================================================ */
var WEEKLY_PICK_ID = 0; // 0 = auto (first Bestseller, else first active product)
function renderWeeklyPick(){
  const box = document.getElementById('weeklyPick');
  if(!box || typeof activeProducts !== 'function') return;
  const prods = activeProducts();
  if(!prods.length) return;
  let pick = WEEKLY_PICK_ID ? prods.find(p=>p.id==WEEKLY_PICK_ID) : null;
  if(!pick) pick = prods.find(p=>p.badge==='Bestseller');
  if(!pick) pick = prods[0];
  box.innerHTML = '<div class="pickcard" onclick="showProductDetail('+pick.id+')">'
    + '<div class="pickimg"><img src="'+esc(typeof assetUrl==='function'?assetUrl(pick.img||''):(pick.img||''))+'" alt="'+esc(pick.name||'')+'" loading="lazy" onerror="this.style.display=\'none\'"></div>'
    + '<div class="pickinfo"><div class="picktag">'+esc((pick.category||'ChaskaBox').toUpperCase())+'</div>'
    + '<b>'+esc(pick.name||'')+'</b>'
    + '<div class="pickprice">'+fmt(pick.price||0)+'</div>'
    + '<span class="alink">Dekhein ›</span></div></div>';
}

/* ============================================================
   3. ONESIGNAL WEB PUSH — soft prompt after 2nd visit
   (only fires when OneSignal is actually configured)
   ============================================================ */
var ONESIGNAL_APP_ID = ''; // Rameez: apni App ID yahan ya PUSH-SETUP.md ke mutabiq lagayein
function oneSignalReady(){
  return !!ONESIGNAL_APP_ID && typeof OneSignal !== 'undefined';
}
/* visit count is tracked in initRetention() below */
function maybePushPrompt(){
  if(!oneSignalReady()) return;
  if(lsGet('cb_visits', 0) < 2) return;
  if(lsGet('cb_push_asked','') === todayStr()) return;
  // only ask if not already subscribed
  try{
    OneSignal.push(function(){
      OneSignal.isPushNotificationsEnabled(function(enabled){
        if(enabled) return;
        lsSet('cb_push_asked', todayStr());
        showSlimBanner('🔔 <b>Deals miss na karein!</b> Notifications on karein aur sale ki khabar sab se pehle payein.'
          + ' <button class="alink" onclick="enablePush()">Enable</button>', 'push', {});
      });
    });
  }catch(e){}
}
window.enablePush = function(){
  if(!oneSignalReady()) return;
  try{ OneSignal.push(function(){ OneSignal.showNativePrompt(); }); }catch(e){}
  const b = document.getElementById('retain-push'); if(b) b.remove();
};

/* ============================================================
   4. BIRTHDAY CLUB — 7 days before + on the day
   Birthday stored in localStorage 'cb_birthday' (YYYY-MM-DD),
   synced from account profile when logged in.
   ============================================================ */
function getBirthday(){ return lsGet('cb_birthday', ''); }
function daysUntilBirthday(){
  const b = getBirthday();
  if(!b) return null;
  const parts = b.split('-');
  if(parts.length < 3) return null;
  const now = new Date();
  let next = new Date(now.getFullYear(), Number(parts[1])-1, Number(parts[2]));
  if(next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next.setFullYear(next.getFullYear()+1);
  return Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}
function checkBirthday(){
  const d = daysUntilBirthday();
  if(d === null) return;
  if(d === 0){
    showSlimBanner('🎂 <b>Happy Birthday!</b> ChaskaBox ki taraf se bohat saari duaein — apna favourite snack box zaroor choose karein! 🎁', 'bday0', {cls:'bday'});
  }else if(d <= 7){
    showSlimBanner('🎂 <b>Birthday coming in '+d+' day'+(d>1?'s':'')+'!</b> Special gift tayyar hai — birthday par zaroor aayiyega! 🎁', 'bday7', {cls:'bday'});
  }
}
window.saveBirthday = function(v){
  if(!v) return;
  lsSet('cb_birthday', v);
};

/* ============================================================
   5. REFERRAL PROGRAM — unique code + WhatsApp share
   ============================================================ */
function getReferralCode(){
  let code = lsGet('cb_referral_code', '');
  if(code) return code;
  let base = 'GUEST';
  try{
    if(typeof ACCT !== 'undefined' && ACCT.user && ACCT.user.email){
      base = ACCT.user.email.split('@')[0].replace(/[^a-z0-9]/gi,'').toUpperCase().slice(0,5) || 'USER';
    }else if(typeof ACCT !== 'undefined' && ACCT.user && ACCT.user.id){
      base = String(ACCT.user.id).replace(/[^a-z0-9]/gi,'').toUpperCase().slice(-5) || 'USER';
    }
  }catch(e){}
  if(base === 'GUEST' || base === 'USER') base += deviceId().slice(0,4);
  code = 'CHASKA-' + base;
  lsSet('cb_referral_code', code);
  return code;
}
/* capture ?ref=CODE visits */
function captureReferral(){
  try{
    const q = new URLSearchParams(location.search).get('ref');
    if(!q) return;
    const code = String(q).toUpperCase().slice(0,24);
    if(!/^[A-Z0-9-]+$/.test(code)) return;
    if(lsGet('cb_referred_by','')) return; // already attributed
    lsSet('cb_referred_by', code);
    const refs = lsGet('cb_referrals', {count:0, list:[]});
    if(refs.list.indexOf(code) === -1){
      refs.count += 1; refs.list.push(code);
      lsSet('cb_referrals', refs);
    }
    // clean the URL (no reload)
    history.replaceState(null, '', location.pathname + location.hash);
  }catch(e){}
}
window.copyReferral = function(){
  const code = getReferralCode();
  const done = function(){ alert('Referral code copy ho gaya! 📋\n'+code); };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(code).then(done, function(){ prompt('Copy karein:', code); });
  }else{ prompt('Copy karein:', code); }
};
window.shareReferralWA = function(){
  const code = getReferralCode();
  const msg = '🍬 ChaskaBox try karo — Pakistani snacks ghar baithe!\n'
    + 'Mera referral code: *'+code+'*\n'
    + 'Signup par is code se dono ko inaam! 🎁\n'
    + 'https://chaskabox.online/?ref='+encodeURIComponent(code);
  window.open('https://wa.me/?text='+encodeURIComponent(msg), '_blank');
};

/* ============================================================
   6. REORDER REMINDERS — 7 days after last order
   Uses localStorage 'cb_orders' (guest + logged-in all land there)
   ============================================================ */
function checkReorderReminder(){
  const orders = lsGet('cb_orders', []);
  if(!orders.length) return;
  const last = orders[orders.length-1];
  if(!last || !last.date) return;
  if(!Array.isArray(last.items) || !last.items.some(i=>i && typeof i==='object' && i.id)) return;
  const days = Math.floor((Date.now() - new Date(last.date).getTime()) / 86400000);
  if(days < 7) return;
  const key = 'cb_reorder_shown_' + (last.no || last.date);
  if(lsGet(key, false)) return; // shown once per order
  lsSet(key, true);
  const firstName = (last.items && last.items[0] && last.items[0].name) || 'snacks';
  showSlimBanner('🔁 <b>'+esc(firstName.split('—')[0].split('|')[0].trim().slice(0,28))+' khatam ho gaya?</b> Dobara mangwao — ek click mein!'
    + ' <button class="alink" onclick="reorderLast()">Reorder ›</button>', 'reorder', {});
}
window.reorderLast = function(){
  const orders = lsGet('cb_orders', []);
  const last = orders[orders.length-1];
  if(!last || !Array.isArray(last.items)) return;
  last.items.forEach(function(i){ if(i.id) CART[i.id] = (CART[i.id]||0) + (Number(i.qty)||1); });
  if(typeof saveCart === 'function') saveCart();
  if(typeof openDrawer === 'function') openDrawer();
  const b = document.getElementById('retain-reorder'); if(b) b.remove();
};

/* ============================================================
   INIT
   ============================================================ */
function initRetention(){
  captureReferral();
  // visit tracking (for push prompt)
  const visits = lsGet('cb_visits', 0);
  lsSet('cb_visits', visits + 1);

  renderWeeklyPick();
  checkAbandonedCart();
  checkBirthday();
  checkReorderReminder();
  maybePushPrompt();

  // track abandon when leaving the page with items in cart
  window.addEventListener('pagehide', markAbandon);
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden') markAbandon();
  });
}

/* run after the main app is ready (products loaded) */
function retentionProductsReady(){
  try{ return (typeof activeProducts === 'function') && (typeof PRODUCTS !== 'undefined') && PRODUCTS.length > 0; }
  catch(e){ return false; }
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', function(){
    if(retentionProductsReady()) initRetention();
    else {
      // wait for products (app.js loads them async)
      let tries = 0;
      const t = setInterval(function(){
        tries++;
        if(retentionProductsReady() || tries > 40){ clearInterval(t); initRetention(); }
      }, 250);
    }
  });
}else{
  initRetention();
}

})();
