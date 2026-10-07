/* ChaskaBox checkout logic — V3 review build */
let DELIVERY_FEE = 300;
let PREPAID_DELIVERY_FEE = 300;
let FREE_ABOVE = 5000;
const PREPAID_METHODS = new Set(['jazzcash','bank_transfer']);
const PAYMENT_LABELS = {
  cod: 'Cash on Delivery',
  jazzcash: 'JazzCash (Advance)',
  bank_transfer: 'Bank Transfer (Advance)'
};
let PRODUCTS = [], CART = {}, PAY = 'cod', placingOrder = false;
let PAYMENT_ENABLED = {cod:true,jazzcash:true,bank_transfer:true};
const $ = s => document.querySelector(s);
const fmt = n => 'Rs. ' + Number(n).toLocaleString('en-PK');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function init() {
  try {
    const cfg = await fetch('/api/storefront-config', {cache:'no-cache'}).then(r=>r.ok?r.json():null);
    const st = cfg?.settings || {};
    const settingNumber = (value, fallback) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
    DELIVERY_FEE = settingNumber(st.cod_delivery_fee_pkr, 300);
    PREPAID_DELIVERY_FEE = settingNumber(st.prepaid_delivery_fee_pkr, 300);
    FREE_ABOVE = settingNumber(st.prepaid_free_delivery_threshold_pkr, 5000);
    PAYMENT_ENABLED = {
      cod: st.cod_enabled !== false,
      jazzcash: st.jazzcash_enabled !== false,
      bank_transfer: st.bank_transfer_enabled !== false
    };
    document.querySelectorAll('[data-dynamic-delivery]').forEach(el=>el.textContent='Rs. '+DELIVERY_FEE.toLocaleString('en-PK'));
    document.querySelectorAll('[data-dynamic-threshold]').forEach(el=>el.textContent='Rs. '+FREE_ABOVE.toLocaleString('en-PK'));
    applyPaymentAvailability(st);
  } catch(e){}
  try { CART = JSON.parse(localStorage.getItem('chaskabox-cart') || '{}'); } catch (e) { CART = {}; }
  try {
    let loaded=null;
    for (const url of ['/api/products?fresh=1','/products.json']) {
      try { const r=await fetch(url,{cache:'no-cache'}); if(!r.ok) throw new Error('HTTP '+r.status); const rows=await r.json(); if(Array.isArray(rows)){loaded=rows;break;} } catch(e) {}
    }
    if(!loaded) throw new Error('Could not load product catalogue');
    PRODUCTS=loaded;
  } catch (e) {
    showOrderError('We could not load the current product catalogue. Please refresh and try again.');
    return;
  }

  if (!Object.keys(CART).length) {
    $('#coMain').innerHTML = '<div class="co-card"><div class="empty">Your bag is empty.<br><br><a class="cta" href="/shop/">← Back to shop</a></div></div>';
    return;
  }

  document.querySelectorAll('input[name="pay"]').forEach(radio => {
    radio.addEventListener('change', e => setPay(e.target.value));
  });
  $('#placeBtn')?.addEventListener('click', placeOrder);
  $('#copyBankBtn')?.addEventListener('click', copyBankAccount);
  $('#f_phone')?.addEventListener('blur', () => { $('#f_phone').value = normalizePhone($('#f_phone').value); });

  const fv = $('#f_video');
  if (fv) fv.addEventListener('change', () => $('#videoOpt').classList.toggle('sel', fv.checked));

  renderSummary();
  prefillFromAccount();
}

async function prefillFromAccount() {
  try {
    if (typeof initSupabase !== 'function' || !initSupabase() || !SB) return;
    const { data: sess } = await SB.auth.getSession();
    if (!sess?.session?.user) return;
    const uid = sess.session.user.id;
    const { data: addrs } = await SB.from('addresses').select('*').eq('user_id', uid).order('is_default', { ascending: false }).limit(1);
    if (addrs?.length) {
      const a = addrs[0];
      if (a.full_name && !$('#f_name').value) $('#f_name').value = a.full_name;
      if (a.phone && !$('#f_phone').value) $('#f_phone').value = a.phone;
      if (a.address && !$('#f_addr').value) $('#f_addr').value = a.address;
      if (a.city && !$('#f_city').value) $('#f_city').value = a.city;
    } else {
      const { data: prof } = await SB.from('profiles').select('name,phone').eq('id', uid).single();
      if (prof) {
        if (prof.name && !$('#f_name').value) $('#f_name').value = prof.name;
        if (prof.phone && !$('#f_phone').value) $('#f_phone').value = prof.phone;
      }
    }
  } catch(e) { console.warn('prefill failed', e); }
}


function applyPaymentAvailability(settings={}) {
  const map={cod:'pay_cod',jazzcash:'pay_jazz',bank_transfer:'pay_bank'};
  for(const [method,id] of Object.entries(map)){
    const label=document.getElementById(id); const radio=label?.querySelector('input[name="pay"]');
    const enabled=PAYMENT_ENABLED[method] !== false;
    if(label){ label.hidden=!enabled; label.setAttribute('aria-hidden', enabled?'false':'true'); }
    if(radio) radio.disabled=!enabled;
  }
  const enabledMethods=Object.keys(map).filter(k=>PAYMENT_ENABLED[k]);
  if(!enabledMethods.length){
    showOrderError('Ordering is temporarily unavailable because no payment method is enabled. Please contact ChaskaBox.');
    const b=document.getElementById('placeBtn'); if(b) b.disabled=true;
    return;
  }
  if(!PAYMENT_ENABLED[PAY]) setPay(enabledMethods[0]);
  const till=String(settings.jazzcash_till_id||'').trim();
  const qr=String(settings.jazzcash_qr_url||'').trim();
  const tillEl=document.querySelector('#jazzBox .tillid'); if(tillEl&&till)tillEl.textContent='Till ID: '+till;
  const qrEl=document.querySelector('#jazzBox img'); if(qrEl&&qr){qrEl.src=qr;qrEl.alt='JazzCash payment QR code';}
  const bank=settings.bank_transfer_details;
  if(bank && typeof bank==='object'){
    const card=document.querySelector('#bankBox .bank-card');
    const rows=card?.querySelectorAll('div');
    if(rows?.[0] && bank.bank) rows[0].querySelector('strong').textContent=bank.bank;
    if(rows?.[1] && bank.account_title) rows[1].querySelector('strong').textContent=bank.account_title;
    if(rows?.[2] && bank.account_number) rows[2].querySelector('strong').textContent=bank.account_number;
  }
}

function productById(id){ return PRODUCTS.find(x => x.id == id); }
function cartSubtotal() {
  return Object.entries(CART).reduce((s, [id, q]) => {
    const p = productById(id);
    return s + (p ? Number(p.price) * Number(q) : 0);
  }, 0);
}
function isPrepaid(){ return PREPAID_METHODS.has(PAY); }
function deliveryFee(sub) { return isPrepaid() ? (sub >= FREE_ABOVE ? 0 : PREPAID_DELIVERY_FEE) : DELIVERY_FEE; }

function setPay(method) {
  const allowed=['cod','jazzcash','bank_transfer'];
  if (!allowed.includes(method) || PAYMENT_ENABLED[method] === false) {
    method = allowed.find(m=>PAYMENT_ENABLED[m]) || 'cod';
  }
  PAY = method;
  $('#pay_cod')?.classList.toggle('sel', method === 'cod');
  $('#pay_jazz')?.classList.toggle('sel', method === 'jazzcash');
  $('#pay_bank')?.classList.toggle('sel', method === 'bank_transfer');
  if ($('#jazzBox')) $('#jazzBox').hidden = method !== 'jazzcash';
  if ($('#bankBox')) $('#bankBox').hidden = method !== 'bank_transfer';
  if ($('#prepaidRef')) $('#prepaidRef').hidden = !isPrepaid();
  if (!isPrepaid() && $('#f_reference')) $('#f_reference').value = '';
  renderSummary();
}

function renderSummary() {
  const box = $('#coItems');
  if (!box) return;
  box.innerHTML = Object.entries(CART).map(([id, q]) => {
    const p = productById(id); if (!p) return '';
    const img = p.img ? `<img src="/${String(p.img).replace(/^\//,'')}" alt="" class="summary-thumb">` : '🍪';
    return `<div class="sumrow"><span class="sum-product">${img}<span>${esc(p.name)} <small>× ${Number(q)}</small></span></span><span>${fmt(Number(p.price) * Number(q))}</span></div>`;
  }).join('');
  const sub = cartSubtotal(), del = deliveryFee(sub);
  $('#s_sub').textContent = fmt(sub);
  $('#s_del').innerHTML = del === 0 ? '<span class="free">FREE</span>' : fmt(del);
  $('#s_tot').textContent = fmt(sub + del);
  const hint = $('#freeHint');
  if (!hint) return;
  if (isPrepaid() && sub < FREE_ABOVE) {
    hint.hidden = false;
    hint.innerHTML = `💡 Add <b>${fmt(FREE_ABOVE - sub)}</b> more to unlock <b>FREE prepaid delivery</b> and save ${fmt(PREPAID_DELIVERY_FEE)}.`;
  } else if (isPrepaid()) {
    hint.hidden = false;
    hint.innerHTML = '🎉 <b>FREE prepaid delivery unlocked.</b>';
  } else {
    hint.hidden = true;
  }
}

function normalizePhone(v) {
  const d = String(v||'').replace(/\D/g,'').slice(0,11);
  if (d.length === 11) return `${d.slice(0,4)}-${d.slice(4,11)}`;
  return d;
}
function phoneDigits(v){ return String(v||'').replace(/\D/g,''); }
function validPhone(v) { const d = phoneDigits(v); return d.length === 11 && d.startsWith('03'); }

function checkForm() {
  let ok = true;
  const need = [
    ['f_name','e_name',v=>v.trim().length>=3],
    ['f_phone','e_phone',validPhone],
    ['f_addr','e_addr',v=>v.trim().length>=8],
    ['f_city','e_city',v=>v.trim().length>=2]
  ];
  need.forEach(([f,e,fn]) => {
    const good = fn($('#'+f)?.value || '');
    if ($('#'+e)) $('#'+e).style.display = good ? 'none' : 'block';
    if ($('#'+f)) { $('#'+f).setAttribute('aria-invalid', good ? 'false' : 'true'); $('#'+f).setAttribute('aria-describedby', e); }
    if(!good) ok=false;
  });
  if (isPrepaid()) {
    const refGood = ($('#f_reference')?.value || '').trim().length >= 4;
    if ($('#e_reference')) $('#e_reference').style.display = refGood ? 'none' : 'block';
    if (!refGood) ok = false;
  } else if ($('#e_reference')) $('#e_reference').style.display = 'none';
  return ok;
}

function orderNo() {
  const now = new Date(Date.now() + (5*60)*60000 + new Date().getTimezoneOffset()*60000);
  const dd = String(now.getDate()).padStart(2,'0'), mm = String(now.getMonth()+1).padStart(2,'0'), yy = String(now.getFullYear()).slice(2);
  const rnd = String(Math.floor(10000 + Math.random()*90000));
  return `CB-${dd}${mm}${yy}-${rnd}`;
}

function showOrderError(message){
  const el = $('#orderError');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.scrollIntoView({behavior:'smooth',block:'center'});
}
function clearOrderError(){ if ($('#orderError')) { $('#orderError').hidden = true; $('#orderError').textContent=''; } }

async function copyBankAccount(){
  const value = $('#bankAccount')?.textContent?.trim() || '';
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const b = $('#copyBankBtn'); if (b) { const old=b.textContent; b.textContent='Copied ✓'; setTimeout(()=>b.textContent=old,1600); }
  } catch(e) {
    window.prompt('Copy account number:', value);
  }
}

async function placeOrderViaAPI(payload) {
  // Server-authoritative order creation via Cloudflare Function.
  // Returns {ok, data} — data is the API response on success.
  try {
    const headers = { 'Content-Type': 'application/json' };
    try {
      if (typeof initSupabase === 'function' && await initSupabase() && SB) {
        const { data } = await SB.auth.getSession();
        if (data?.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
      }
    } catch(e){}
    const res = await fetch('/api/orders', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data };
    // Surface validation errors clearly
    const msg = data?.error?.message || 'Order could not be placed. Please try again.';
    return { ok: false, error: msg, details: data?.error?.details };
  } catch (e) {
    return { ok: false, error: 'Network error. Please check your connection and try again.' };
  }
}

function uuidv4() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const a=new Uint8Array(16); crypto.getRandomValues(a); a[6]=(a[6]&15)|64; a[8]=(a[8]&63)|128;
  return [...a].map((b,i)=>(i===4||i===6||i===8||i===10?'-':'')+b.toString(16).padStart(2,'0')).join('');
}


function saveLocalPurchaseSummary(order){
  // Intentionally excludes customer name, phone and address. This supports reorder UX without persisting PII.
  try {
    const orders = JSON.parse(localStorage.getItem('cb_orders')||'[]');
    orders.push({
      no:order.no,
      date:new Date().toISOString(),
      items:order.items,
      sub:order.sub,
      del:order.del,
      total:order.total,
      pay:PAYMENT_LABELS[PAY],
      payment_status:isPrepaid()?'awaiting_verification':'pending',
      video:order.video
    });
    localStorage.setItem('cb_orders', JSON.stringify(orders.slice(-10)));
  } catch(e){}
}

function celebrateOrder(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer=document.createElement('div'); layer.className='order-confetti'; layer.setAttribute('aria-hidden','true');
  const colors=['#1a2b5c','#c62828','#f2b705','#2a9d8f','#e8722a'];
  for(let i=0;i<18;i++){
    const bit=document.createElement('i');
    bit.style.setProperty('--x',(6+Math.random()*88).toFixed(1)+'%');
    bit.style.setProperty('--c',colors[i%colors.length]);
    bit.style.setProperty('--r',(Math.random()*180-90).toFixed(0)+'deg');
    bit.style.setProperty('--d',(1.15+Math.random()*.7).toFixed(2)+'s');
    bit.style.setProperty('--delay',(Math.random()*.22).toFixed(2)+'s');
    bit.style.setProperty('--drift',((Math.random()-.5)*120).toFixed(0)+'px');
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  setTimeout(()=>layer.remove(),2200);
}

async function placeOrder() {
  if (placingOrder) return;
  clearOrderError();
  if (!checkForm()) {
    document.querySelector('.err[style=""]')?.closest('.field')?.querySelector('input,textarea')?.focus();
    window.scrollTo({top:0,behavior:'smooth'});
    return;
  }

  const btn = $('#placeBtn'); placingOrder = true; btn.disabled = true; btn.textContent = 'Placing order...';
  const sub = cartSubtotal(), del = deliveryFee(sub), total = sub + del;
  const ono = orderNo();
  const itemRows = Object.entries(CART).map(([id,q]) => {
    const p = productById(id)||{};
    return {id:Number(id),name:p.name||'',pack:p.pack||'',price:Number(p.price)||0,qty:Number(q)};
  }).filter(i=>i.name && i.qty>0);

  if (!itemRows.length) {
    showOrderError('Your bag no longer contains valid products. Please return to the shop and try again.');
    placingOrder=false; btn.disabled=false; btn.textContent='Place Order →'; return;
  }

  const items = itemRows.map(i => `${i.name} (${i.pack}) × ${i.qty} = Rs. ${(i.price*i.qty).toLocaleString('en-PK')}`);
  const payLabel = PAYMENT_LABELS[PAY];
  const reference = isPrepaid() ? ($('#f_reference').value.trim()) : '';
  const wantVideo = !!$('#f_video')?.checked;
  const note = ($('#f_note')?.value || '').trim();
  const phone = phoneDigits($('#f_phone').value);
  const turnstileToken = (typeof turnstile !== 'undefined' && turnstile.getResponse) ? turnstile.getResponse() : '';

  // Build server-authoritative API payload (contract §4).
  // Prices/totals are IGNORED by the server — it recalculates from the DB.
  const apiPayload = {
    idempotency_key: uuidv4(),
    items: itemRows.map(i => ({ product_id: i.id, qty: i.qty })),
    customer: {
      name: $('#f_name').value.trim(),
      phone: phone,
      address: $('#f_addr').value.trim(),
      city: $('#f_city').value.trim()
    },
    payment_method: PAY === 'cod' ? 'cod' : (PAY === 'jazzcash' ? 'jazzcash' : 'bank_transfer'),
    transaction_reference: reference,
    turnstile_token: turnstileToken,
    customer_note: note || undefined
  };

  // Server-authoritative order creation. Cart is cleared ONLY on API success.
  const apiResult = await placeOrderViaAPI(apiPayload);

  if (!apiResult.ok) {
    showOrderError(apiResult.error || 'We could not safely record your order. Your bag has NOT been cleared. Please retry, or WhatsApp 0332-0005381 for help.');
    placingOrder = false; btn.disabled = false; btn.textContent = 'Place Order →';
    return;
  }

  // Success — use server-returned order number and total (authoritative).
  const srv = apiResult.data;
  const finalOrderNo = srv.order_number || ono;
  const finalTotal = typeof srv.total === 'number' ? srv.total : total;

  const order = {
    no: finalOrderNo, name: $('#f_name').value.trim(), phone,
    addr: $('#f_addr').value.trim(), city: $('#f_city').value.trim(),
    items: itemRows, sub, del, total: finalTotal,
    pay_method: PAY === 'cod' ? 'COD' : (PAY === 'jazzcash' ? 'JazzCash' : 'Bank Transfer'),
    payment_reference: reference, video: wantVideo, note,
    payment_status: srv.payment_status, fulfilment_status: srv.fulfilment_status
  };

  saveLocalPurchaseSummary(order);
  CART = {}; localStorage.removeItem('chaskabox-cart');
  $('#coMain').style.display = 'none'; $('#coDone').style.display = '';
  $('#doneNo').textContent = finalOrderNo;
  if ($('#doneTotal')) $('#doneTotal').textContent = fmt(finalTotal);
  if ($('#donePayment')) $('#donePayment').textContent = PAYMENT_LABELS[PAY] || PAY;
  if ($('#doneStatus')) $('#doneStatus').textContent = isPrepaid() ? 'Awaiting payment verification' : 'Order received · COD pending';
  if ($('#doneWhatsApp')) $('#doneWhatsApp').href = 'https://wa.me/923320005381?text=' + encodeURIComponent('Salam ChaskaBox, I need help with order '+finalOrderNo);
  const track = document.getElementById('doneTrack'); if (track) track.href = '/track-order.html?order=' + encodeURIComponent(finalOrderNo) + '&phone=' + encodeURIComponent(phone);

  if (PAY === 'cod') {
    $('#doneMsg').innerHTML = `We'll contact <b>${esc(phone)}</b> if confirmation is needed, then prepare your order for dispatch. Amount due on delivery: <b>${fmt(finalTotal)}</b>.`;
  } else if (PAY === 'jazzcash') {
    $('#doneMsg').innerHTML = `Your JazzCash reference <b>${esc(reference)}</b> has been submitted for verification. Amount: <b>${fmt(finalTotal)}</b>. We'll prepare the order after payment is verified.`;
  } else {
    $('#doneMsg').innerHTML = `Your bank-transfer reference <b>${esc(reference)}</b> has been submitted for verification. Amount: <b>${fmt(finalTotal)}</b>. We'll prepare the order after payment is verified.`;
  }
  if (wantVideo) $('#doneMsg').innerHTML += '<br><br>🎬 <b>Packing video requested.</b> We will try to send a short clip on WhatsApp if operations allow.';
  celebrateOrder();
  window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}

document.addEventListener('DOMContentLoaded', init);
