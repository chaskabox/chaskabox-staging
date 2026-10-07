(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => `Rs. ${Number(n||0).toLocaleString('en-PK')}`;
  const asset = s => { s=String(s||''); if(!s)return ''; return /^(?:https?:|data:|blob:|\/)/i.test(s)?s:'/'+s.replace(/^\.\//,''); };
  const productHref = id => `/product/?id=${encodeURIComponent(id)}`;
  let products = [], product = null, settings = {};
  function loadCart(){try{return JSON.parse(localStorage.getItem('chaskabox-cart')||'{}')}catch{return {}}}
  function saveCart(c){localStorage.setItem('chaskabox-cart',JSON.stringify(c));updateBag();}
  function updateBag(){const c=loadCart();let n=0;Object.values(c).forEach(q=>n+=Number(q)||0);const b=$('#bagCount');if(b)b.textContent=n;}
  function add(){if(!product)return;const q=Math.max(1,Math.min(99,Number($('#pdQty')?.value||1)));const c=loadCart();c[product.id]=(Number(c[product.id])||0)+q;saveCart(c);const b=$('#addBtn');if(b){const old=b.textContent;b.textContent='Added ✓';b.disabled=true;setTimeout(()=>{b.textContent=old;b.disabled=false},850)}}
  function noImage(p){return `<div class="noimg dynamic"><div><b>CHASKABOX</b><span>Photo<br>coming soon</span><small>${esc(p.category||'')}</small></div></div>`}
  function card(p){const img=p.img?`<img src="${esc(asset(p.img))}" alt="${esc(p.name)}" loading="lazy">`:noImage(p);return `<a class="card" href="${productHref(p.id)}"><div class="pimg">${img}</div><div class="pbody"><div class="pcat">${esc(p.category||'')}</div><div class="pname">${esc(p.name)}</div><div class="ppack">${esc(p.pack||'')}</div><div class="price">${fmt(p.price)}</div></div></a>`}
  function render(){
    const root=$('#dynamicProduct');
    if(!product){root.innerHTML='<div class="dynamic-error"><h1>Snack not found</h1><p>This product may be hidden, archived or unavailable.</p><a class="cta" href="/shop/">Browse available snacks →</a></div>';return;}
    const cod=Number(settings.cod_delivery_fee_pkr??300), threshold=Number(settings.prepaid_free_delivery_threshold_pkr??5000), pre=Number(settings.prepaid_delivery_fee_pkr??300);
    const rel=products.filter(p=>p.id!==product.id && (p.category===product.category || p.brand===product.brand)).slice(0,8);
    const img=product.img?`<img src="${esc(asset(product.img))}" alt="${esc(product.name)}">`:noImage(product);
    root.innerHTML=`<nav class="crumb"><a href="/">Home</a> / <a href="/shop/">Shop</a> / <span>${esc(product.name)}</span></nav><div class="dynamic-pd-grid"><section class="dynamic-pd-img">${img}</section><section class="dynamic-pd-info"><div class="pcat">${esc(product.category||'')} ${product.bundle?'· CHASKA BOX':''}</div><h1>${esc(product.name)}</h1>${product.brand?`<div class="pd-brand">${esc(product.brand)}</div>`:''}<div class="pd-price"><span class="price">${fmt(product.price)}</span>${product.oldPrice&&product.oldPrice>product.price?` <span class="oldprice">${fmt(product.oldPrice)}</span>`:''}</div><div class="ppack">${esc(product.pack||'')}</div><p class="pd-desc">${esc(product.desc||'Original ChaskaBox catalogue item. Contact us if you need ingredient or availability details before ordering.')}</p><div class="dynamic-actions"><label class="sr-only" for="pdQty">Quantity</label><input id="pdQty" type="number" min="1" max="99" value="1"><button class="cta" id="addBtn">Add to Bag · ${fmt(product.price)}</button></div><div class="dynamic-meta"><span>🚚 COD delivery: ${fmt(cod)}</span><span>⚡ Prepaid delivery: ${fmt(pre)} · FREE from ${fmt(threshold)}</span><span>📦 Estimated delivery: ${esc(settings.delivery_estimate||'4-7 days')}</span><span>✅ Original sealed packs</span></div><p><a href="/track-order.html">Track an existing order →</a></p></section></div>${rel.length?`<section class="dynamic-related"><h2>You may also like</h2><div class="dynamic-related-grid">${rel.map(card).join('')}</div></section>`:''}`;
    $('#addBtn')?.addEventListener('click',add);
    document.title=`${product.name} | ChaskaBox`;
    const m=document.querySelector('meta[name="description"]');if(m)m.content=String(product.desc||`Buy ${product.name} from ChaskaBox.`).slice(0,155);
    const canonical=document.createElement('link');canonical.rel='canonical';canonical.href=`https://chaskabox.online/product/?id=${encodeURIComponent(product.id)}`;document.head.appendChild(canonical);
    history.replaceState(null,'',productHref(product.id));
  }
  async function init(){
    updateBag();
    const id=Number(new URL(location.href).searchParams.get('id'));
    if(!Number.isInteger(id)||id<=0){render();return;}
    try{
      const [pr,cfg]=await Promise.all([fetch('/api/products?fresh=1',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('catalogue');return r.json()}),fetch('/api/storefront-config',{cache:'no-cache'}).then(r=>r.ok?r.json():({settings:{}}))]);
      products=Array.isArray(pr)?pr:[];settings=cfg?.settings||{};product=products.find(p=>Number(p.id)===id)||null;render();
    }catch{rootError();}
  }
  function rootError(){const root=$('#dynamicProduct');if(root)root.innerHTML='<div class="dynamic-error"><h1>Catalogue temporarily unavailable</h1><p>Please refresh in a moment. Your cart is safe.</p><a class="cta" href="/shop/">Back to shop</a></div>'}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
})();
