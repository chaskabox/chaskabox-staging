/* ChaskaBox static store app */
const NAVY='#1a2b5c';
let PRODUCTS=[], CART={};
const PROGRESS_STATE={drawer:0,cart:0};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const fmt=n=>'Rs. '+Number(n).toLocaleString('en-PK');
function assetUrl(src){ if(!src) return ''; if(/^(https?:|data:|blob:|\/)/i.test(src)) return src; return '/'+String(src).replace(/^\.\//,''); }

/* ---------- data ---------- */
async function loadProducts(){
  let lastError=null;
  for(const url of ['/api/products','/products.json']){
    try{const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw new Error('HTTP '+r.status);const rows=await r.json();if(!Array.isArray(rows))throw new Error('Invalid catalogue');PRODUCTS=rows;return;}catch(e){lastError=e;}
  }
  throw lastError||new Error('Could not load product catalogue');
}
function activeProducts(){ return PRODUCTS.filter(p=>p.active!==false); }

/* ---------- delivery date estimate (4-7 days) ---------- */
function deliveryRange(){
  const f=d=>d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  const raw=String(STORE_CONFIG?.settings?.delivery_estimate||'4-7 days');const nums=raw.match(/\d+/g)||[];
  const min=Math.max(0,Number(nums[0]||4)),max=Math.max(min,Number(nums[1]||nums[0]||7));
  const a=new Date(); a.setDate(a.getDate()+min);
  const b=new Date(); b.setDate(b.getDate()+max);
  return `From ${f(a)} to ${f(b)}`;
}

function productHref(id){return '/product/?id='+encodeURIComponent(id);}

/* ---------- cards ---------- */
function bundleFanHTML(p){
  if(!p?.bundle || !p?.desc) return '';
  const m=String(p.desc).match(/Bundle pack with:\s*(.+?)(?:\.\s|$)/i);
  if(!m) return '';
  const wanted=m[1].split(',').map(s=>s.trim()).filter(Boolean);
  const picks=wanted.map(name=>PRODUCTS.find(x=>String(x.name||'').trim().toLowerCase()===name.toLowerCase())).filter(x=>x&&x.img).slice(0,3);
  if(picks.length<2) return '';
  return `<span class="bundle-fan" aria-hidden="true">${picks.map((x,i)=>`<img src="${esc(assetUrl(x.img))}" alt="" class="bf${i+1}">`).join('')}</span>`;
}
function cardHTML(p){
  const src=assetUrl(p.img||'');
  const img=src?`<img src="${esc(src)}" alt="${esc(p.name)}" loading="lazy">`:`<div class="noimg"><b>CHASKABOX</b><span>Photo<br>coming soon</span><small>${esc(p.category||'')}</small></div>`;
  const badge=p.badge?`<span class="badge ${p.badge==='Bestseller'?'bestseller':''}">${esc(p.badge==='Sale'?'SALE':p.badge.toUpperCase())}</span>`:'';
  const old=p.oldPrice&&p.oldPrice>p.price?`<span class="oldprice">${fmt(p.oldPrice)}</span>`:'';
  const save=p.oldPrice&&p.oldPrice>p.price?`<span class="savepill">Save ${Math.round((1-p.price/p.oldPrice)*100)}%</span>`:'';
  const catlabel=p.category?`<div class="pcat">${esc(p.category)}${p.bundle?' · BOX':''}</div>`:'';
  const href=productHref(p.id);
  const fan=bundleFanHTML(p);
  return `<article class="card${p.bundle?' bundle-card':''}">${badge}${typeof wishBtnHTML==='function'?wishBtnHTML(p):''}
    <a class="pimg" href="${href}">${fan}${img}</a>
    <div class="pbody">
      ${catlabel}
      <a class="pname" href="${href}">${esc(p.name)}</a>
      <div class="ppack">${esc(p.pack||'')}</div>
      <div class="prow"><div class="pricewrap"><span class="price">${fmt(p.price)}</span>${old}${save}</div></div>
      <button class="addcart" aria-label="Add ${esc(p.name)} to bag" onclick="addToCart(${p.id},1,this)"><span class="addcart-label">Add to Bag</span><span class="addcart-price">${fmt(p.price)}</span></button>
    </div></article>`;
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

/* ---------- home ---------- */
/* Clean SVG illustrations for category tiles (match original custom art) */
const TILE_SVG={
'All':`<svg viewBox="0 0 64 64"><ellipse cx="32" cy="46" rx="20" ry="8" fill="#3b6fd4"/><ellipse cx="32" cy="42" rx="20" ry="8" fill="#5a8de0"/><circle cx="22" cy="34" r="6" fill="#e5484d"/><circle cx="32" cy="30" r="6" fill="#f2b705"/><circle cx="42" cy="34" r="6" fill="#2a9d8f"/><circle cx="27" cy="26" r="5" fill="#9b7ed9"/><circle cx="37" cy="26" r="5" fill="#e8722a"/><rect x="18" y="36" width="28" height="4" rx="2" fill="#d4a017"/></svg>`,
'Biscuits & Wafers':`<svg viewBox="0 0 64 64"><ellipse cx="32" cy="50" rx="18" ry="5" fill="#4a3020"/><ellipse cx="32" cy="44" rx="16" ry="7" fill="#c8956c"/><ellipse cx="32" cy="42" rx="16" ry="7" fill="#d4a97c"/><ellipse cx="32" cy="36" rx="16" ry="7" fill="#c8956c"/><ellipse cx="32" cy="34" rx="16" ry="7" fill="#d4a97c"/><ellipse cx="32" cy="28" rx="16" ry="7" fill="#c8956c"/><ellipse cx="32" cy="26" rx="16" ry="7" fill="#e0b988"/><circle cx="26" cy="25" r="1.5" fill="#8a5a2b"/><circle cx="32" cy="27" r="1.5" fill="#8a5a2b"/><circle cx="38" cy="25" r="1.5" fill="#8a5a2b"/></svg>`,
'Bunties & Cakes':`<svg viewBox="0 0 64 64"><path d="M22 30h20l-3 22H25z" fill="#e5484d"/><path d="M22 30c0-8 4-14 10-14s10 6 10 14z" fill="#f4a4c0"/><circle cx="26" cy="22" r="2" fill="#fff"/><circle cx="32" cy="18" r="2" fill="#f2b705"/><circle cx="38" cy="22" r="2" fill="#2a9d8f"/><circle cx="29" cy="25" r="1.5" fill="#e8722a"/><circle cx="35" cy="25" r="1.5" fill="#3b6fd4"/><rect x="20" y="28" width="24" height="4" rx="2" fill="#c9303e"/></svg>`,
'Chews & Gums':`<svg viewBox="0 0 64 64"><ellipse cx="32" cy="34" rx="14" ry="18" fill="#3daa7a" transform="rotate(-15 32 34)"/><ellipse cx="32" cy="34" rx="14" ry="18" fill="#4cbb8a" transform="rotate(15 32 34)"/><path d="M32 16v36" stroke="#2a7a5a" stroke-width="2"/><path d="M32 28l-8-6M32 28l8-6M32 38l-8-6M32 38l8-6" stroke="#2a7a5a" stroke-width="1.5"/></svg>`,
'Chocolates & Candies':`<svg viewBox="0 0 64 64"><rect x="14" y="20" width="36" height="26" rx="4" fill="#6b2d1a"/><rect x="18" y="24" width="10" height="8" rx="2" fill="#8a4028"/><rect x="30" y="24" width="10" height="8" rx="2" fill="#8a4028"/><rect x="18" y="34" width="10" height="8" rx="2" fill="#8a4028"/><rect x="30" y="34" width="10" height="8" rx="2" fill="#8a4028"/><rect x="42" y="24" width="6" height="18" rx="2" fill="#d4a017"/></svg>`,
'Imli & Ice Lollies':`<svg viewBox="0 0 64 64"><circle cx="24" cy="24" r="10" fill="#e5484d"/><circle cx="24" cy="24" r="6" fill="#f4707a"/><rect x="22.5" y="32" width="3" height="20" rx="1.5" fill="#fff"/><circle cx="42" cy="28" r="9" fill="#e8722a"/><circle cx="42" cy="28" r="5" fill="#f49a5a"/><rect x="40.5" y="35" width="3" height="17" rx="1.5" fill="#fff"/></svg>`,
'Jellies & Marshmallow':`<svg viewBox="0 0 64 64"><ellipse cx="32" cy="44" rx="18" ry="10" fill="#fff" opacity=".9"/><ellipse cx="32" cy="42" rx="18" ry="10" fill="#f0d0e0"/><rect x="20" y="28" width="10" height="10" rx="3" fill="#fff"/><rect x="32" y="26" width="10" height="10" rx="3" fill="#f4a4c0"/><rect x="26" y="34" width="10" height="10" rx="3" fill="#d46a8a"/><rect x="38" y="34" width="8" height="8" rx="2" fill="#fff"/></svg>`,
'Snacks & Nimco':`<svg viewBox="0 0 64 64"><ellipse cx="32" cy="46" rx="20" ry="8" fill="#c47a1a"/><ellipse cx="32" cy="42" rx="20" ry="8" fill="#e0952f"/><path d="M20 38l4-8 4 6 4-10 4 8 4-6 4 8" stroke="#f2b705" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="26" cy="32" r="3" fill="#d4a017"/><circle cx="38" cy="30" r="3" fill="#d4a017"/></svg>`,
'Betel Nuts & Pan Masala':`<svg viewBox="0 0 64 64"><path d="M32 8C20 20 16 34 32 52 48 34 44 20 32 8z" fill="#2d6a4f"/><path d="M32 14v32" stroke="#1a4a35" stroke-width="2"/><path d="M32 24l-10-4M32 24l10-4M32 34l-10-4M32 34l10-4" stroke="#1a4a35" stroke-width="1.5"/><ellipse cx="32" cy="52" rx="12" ry="4" fill="#c8956c"/><circle cx="28" cy="50" r="3" fill="#8a5a2b"/><circle cx="36" cy="50" r="3" fill="#8a5a2b"/></svg>`,
'Bundles':`<svg viewBox="0 0 64 64"><rect x="16" y="26" width="32" height="24" rx="3" fill="#d4a017"/><rect x="29" y="26" width="6" height="24" fill="#b8860b"/><rect x="16" y="20" width="32" height="8" rx="2" fill="#e8b82a"/><path d="M32 20c-4-8-12-8-12-2 0 4 6 4 12 2zm0 0c4-8 12-8 12-2 0 4-6 4-12 2z" fill="#b8860b"/></svg>`
};
const CAT_STYLE={
  'All':{bg:'#f2b705'},
  'Biscuits & Wafers':{bg:'#6b4a35'},
  'Bunties & Cakes':{bg:'#9b8ac4'},
  'Chews & Gums':{bg:'#2a9d8f'},
  'Chocolates & Candies':{bg:'#a83232'},
  'Imli & Ice Lollies':{bg:'#e8722a'},
  'Jellies & Marshmallow':{bg:'#d46a8a'},
  'Snacks & Nimco':{bg:'#e0952f'},
  'Betel Nuts & Pan Masala':{bg:'#2d6a4f'},
  'Bundles':{bg:'#3b6fd4'}
};
const BAND_COLORS={
  'Biscuits & Wafers':'#6b4a35',
  'Bunties & Cakes':'#7b6b9e',
  'Bundles':'#d9a03a',
  'Chews & Gums':'#2a8a6a',
  'Chocolates & Candies':'#93342e',
  'Imli & Ice Lollies':'#a5522e',
  'Jellies & Marshmallow':'#6a5a8e',
  'Snacks & Nimco':'#c9932b',
  'Betel Nuts & Pan Masala':'#4e7d4e'
};
const CAT_ORDER=['Biscuits & Wafers','Bunties & Cakes','Chews & Gums','Chocolates & Candies','Imli & Ice Lollies','Jellies & Marshmallow','Snacks & Nimco','Betel Nuts & Pan Masala','Bundles'];
function renderHomeContent(){
  const act=activeProducts();
  // categories
  const cats={};
  act.forEach(p=>{cats[p.category]=cats[p.category]||[];cats[p.category].push(p);});
  // category tiles: clean SVG illustrations (match original custom art)
  const allCount=act.length;
  const tileOrder=['All',...CAT_ORDER.filter(c=>cats[c]&&cats[c].length)];
  // ensure 'All' pseudo-category first, then fixed original order
  $('#catTiles').innerHTML=tileOrder.map(c=>{
    const st=CAT_STYLE[c]||{bg:'#8a94a6'};
    const list=c==='All'?act:(cats[c]||[]);
    const n=c==='All'?allCount:list.length;
    if(c!=='All'&&!n) return '';
    const inner=TILE_SVG[c]?`<span class="ci-svg">${TILE_SVG[c]}</span>`:`<span class="ci-emoji">🛍️</span>`;
    const href=c==='All'?'/shop/':categoryPath(c);
    return `<a class="cat reveal" href="${href}">
      <div class="ci" style="background:${st.bg}">${inner}</div>
      <b>${esc(c)}</b><small>${n} items</small></a>`;
  }).join('');
  // hero collage: 3 product images
  const heroPicks=act.filter(p=>p.img).slice(0,3);
  const hi=$('#heroCollage');
  if(hi&&heroPicks.length) hi.innerHTML=heroPicks.map((p,i)=>`<img src="${esc(assetUrl(p.img))}" alt="" loading="lazy" class="hc${i+1}">`).join('');
  // Curated homepage shelves: fast discovery without dumping the full catalogue
  shelfSeq=0;
  let html='';
  const sale=act.filter(p=>p.oldPrice&&p.oldPrice>p.price).slice(0,10);
  const picks=curatedProducts('chaska_picks',act.filter(p=>p.category!=='Bundles').slice(0,10));
  const bundles=curatedProducts('boxes',(cats['Bundles']||[]).slice(0,10));
  const chatpata=curatedProducts('chatpata_picks',(cats['Snacks & Nimco']||[]).slice(0,10));
  const newest=curatedProducts('new_items',[...act].sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,10));
  if(sale.length) html+=shelf('🔥 Deals Worth Grabbing',sale,'#b42318','', 'Sale','deals');
  if(picks.length) html+=shelf('⭐ Chaska Picks',picks,'#1a2b5c','','','chaska_picks');
  if(bundles.length) html+=shelf('📦 Chaska Boxes',bundles,'#d49a17','Bundles','','boxes');
  if(chatpata.length) html+=shelf('🌶️ Chatpata Picks',chatpata,'#3d8b5f','Snacks & Nimco','','chatpata_picks');
  if(newest.length) html+=shelf('✨ New & Recently Added',newest,'#6b4f9d','','','new_items');
  $('#shelves').innerHTML=html;
  const wp=$('#weeklyPick');
  if(wp){
    const pick=sale[0]||picks[0]||act[0];
    if(pick){
      wp.innerHTML=`<a class="pickcard" href="${productHref(pick.id)}"><div class="pickimg"><img src="${esc(assetUrl(pick.img||''))}" alt="${esc(pick.name)}" loading="lazy"></div><div class="pickinfo"><div class="picktag">${esc((pick.category||'ChaskaBox').toUpperCase())}</div><b>${esc(pick.name)}</b><div class="pickprice">${fmt(pick.price)}</div><span class="alink">View snack →</span></div></a>`;
    } else wp.innerHTML='';
  }
  observeReveals();
}
let shelfSeq=0;
function shelf(title,items,color,cat,badge,homeKey){
  const href=badge?'/shop/':(cat?categoryPath(cat):'/shop/');
  const action=badge?`onclick="goBadge('${esc(badge)}');return false"`:'';
  const sid='hs'+(++shelfSeq);
  return `<section class="shelf reveal"${homeKey?` data-home-section="${esc(homeKey)}"`:``}>
    <div class="shelfband" style="background:${color}">
      <div class="shelfw"><h2>${esc(title)}</h2>
      <div class="shelfnav"><a class="viewall" href="${href}" ${action}>View all →</a>
      <button class="sarrow" aria-label="Scroll left" onclick="shelfScroll('${sid}',-1)">←</button>
      <button class="sarrow" aria-label="Scroll right" onclick="shelfScroll('${sid}',1)">→</button></div></div>
    </div>
    <div class="shelfbody"><div class="hscroll" id="${sid}">${items.map(cardHTML).join('')}</div></div>
  </section>`;
}
function shelfScroll(id,dir){
  const el=document.getElementById(id); if(!el) return;
  el.scrollBy({left:dir*el.clientWidth*.85,behavior:'smooth'});
}

/* ---------- shop ---------- */
let shopState={q:'',cat:'',sort:'feat',brands:[],maxPrice:0,pack:'',badge:''};
/* navigation is defined in the clean History API router below */
/* populate desktop header dropdowns (categories + top brands) */
function renderHeaderDropdowns(){
  try{
    const dc=$('#ddCats');
    if(dc){
      const cats={}; activeProducts().forEach(p=>{cats[p.category]=(cats[p.category]||0)+1;});
      const order=CAT_ORDER.filter(c=>cats[c]);
      dc.innerHTML=order.map(c=>'<a href="'+categoryPath(c)+'">'+esc(c)+'<span class="cnt">'+cats[c]+'</span></a>').join('');
    }
    const db=$('#ddBrands');
    if(db){
      const bc={}; activeProducts().forEach(p=>{const b=getBrand(p.name);bc[b]=(bc[b]||0)+1;});
      const top=Object.entries(bc).sort((a,b)=>b[1]-a[1]).slice(0,9);
      db.innerHTML='<a href="/shop/">🏷️ All Brands</a>'
        +top.map(([b,n])=>'<a href="#" onclick="goBrand(&quot;'+esc(b)+'&quot;);return false">'+esc(b)+'<span class="cnt">'+n+'</span></a>').join('');
    }
  }catch(e){ console.warn('header dropdowns', e); }
}
function getBrand(name){
  const m=String(name||'').split('|')[0].trim();
  return m||'ChaskaBox';
}
function filterPanelHTML(){
  const all=activeProducts();
  const brands=[...new Set(all.map(p=>getBrand(p.name)))].sort();
  const packs=[...new Set(all.map(p=>p.pack).filter(Boolean))].sort();
  const maxP=Math.max(...all.map(p=>p.price),1000);
  const catLinks=['',...CAT_ORDER.filter(c=>c!=='Bundles')].map(c=>{
    const label=c||'All Snacks', href=c?categoryPath(c):'/shop/', active=shopState.cat===c;
    return `<a class="filter-link${active?' active':''}" href="${href}">${esc(label)}${active?'<span>✓</span>':''}</a>`;
  }).join('');
  const selectedBrands=shopState.brands.length?`<small>${shopState.brands.length} selected</small>`:'';
  return `<details class="fgroup filter-group" open><summary>Category</summary><div class="filter-options filter-links">${catLinks}</div></details>`
    +`<details class="fgroup filter-group"><summary>Brand ${selectedBrands}</summary><div class="filter-options">${brands.map(b=>'<label><input type="checkbox" value="'+esc(b)+'" '+(shopState.brands.includes(b)?'checked':'')+' onchange="toggleBrand(this)"> '+esc(b)+'</label>').join('')}</div></details>`
    +`<details class="fgroup filter-group"><summary>Price</summary><div class="filter-options"><input type="range" min="100" max="${maxP}" step="50" value="${shopState.maxPrice||maxP}" oninput="shopState.maxPrice=+this.value;this.closest('.fgroup').querySelector('.pval').textContent=fmt(+this.value);renderShopResults()"><div class="pval">${fmt(shopState.maxPrice||maxP)}</div></div></details>`
    +`<details class="fgroup filter-group"><summary>Pack size</summary><div class="filter-options"><select onchange="shopState.pack=this.value;renderShopResults()"><option value="">All packs</option>${packs.map(p=>'<option '+(shopState.pack===p?'selected':'')+' value="'+esc(p)+'">'+esc(p)+'</option>').join('')}</select></div></details>`
    +'<button class="fclear" onclick="clearAllFilters()">Clear filters</button>';
}
function renderShopContent(){
  const {cat,badge}=shopState;
  let title=cat||'All Snacks';
  if(badge) title=(badge==='Sale'?'🔥 ':'⭐ ')+title;
  $('#crumbCat').textContent=title;
  $('#catTitle').textContent=title;
  const html=filterPanelHTML();
  $('#shopSidebar').innerHTML=html;
  const sb=$('#filterSheetBody'); if(sb)sb.innerHTML=html;
  renderShopList();
}
/* ---------- mobile filter bottom sheet ---------- */
let filterReturnFocus=null;
function openFilters(){
  filterReturnFocus=document.activeElement;
  const sb=$('#filterSheetBody'); if(sb)sb.innerHTML=filterPanelHTML();
  $('#filterSheet').classList.add('open');
  $('#filterSheet').setAttribute('aria-hidden','false');
  $('#filterSheet').removeAttribute('inert');
  $('#filterBackdrop').classList.add('open');
  document.body.style.overflow='hidden';
  updateApplyBtn();
  setTimeout(()=>document.querySelector('#filterSheet .fsclose')?.focus(),0);
}
function closeFilters(){
  const s=$('#filterSheet'); if(s){s.classList.remove('open');s.setAttribute('aria-hidden','true');s.setAttribute('inert','');}
  const b=$('#filterBackdrop'); if(b)b.classList.remove('open');
  document.body.style.overflow='';
  if(filterReturnFocus&&typeof filterReturnFocus.focus==='function'){const f=filterReturnFocus;filterReturnFocus=null;setTimeout(()=>f.focus(),0);}
}
function clearAllFilters(){
  shopState.brands=[];shopState.maxPrice=0;shopState.pack='';shopState.q='';shopState.badge='';
  renderShopContent();
}
function activeFilterCount(){
  return shopState.brands.length+(shopState.maxPrice?1:0)+(shopState.pack?1:0)+(shopState.badge?1:0);
}
function updateApplyBtn(){
  const n=filteredShop().length;
  const ab=$('#applyFiltersBtn'); if(ab)ab.textContent='Show '+n+' Result'+(n===1?'':'s');
  const badge=$('#filterCount'),c=activeFilterCount();
  if(badge){ if(c>0){badge.style.display='';badge.textContent=c;} else badge.style.display='none'; }
}
function removeBrandChip(el){
  const b=el.getAttribute('data-v');
  shopState.brands=shopState.brands.filter(x=>x!==b);
  renderShopContent();
}
function renderFilterChips(){
  const el=$('#filterChips'); if(!el)return;
  let h='';
  shopState.brands.forEach(b=>{h+='<button class="fchip" data-v="'+esc(b)+'" onclick="removeBrandChip(this)">'+esc(b)+' <span>\u2715</span></button>';});
  if(shopState.maxPrice)h+='<button class="fchip" onclick="shopState.maxPrice=0;renderShopContent()">Under '+fmt(shopState.maxPrice)+' <span>\u2715</span></button>';
  if(shopState.pack)h+='<button class="fchip" onclick="shopState.pack=\'\';renderShopContent()">'+esc(shopState.pack)+' <span>\u2715</span></button>';
  if(shopState.badge)h+='<button class="fchip" onclick="shopState.badge=\'\';renderShopContent()">'+(shopState.badge==='Sale'?'🔥 On Sale':'⭐ Bestsellers')+' <span>\u2715</span></button>';
  el.innerHTML=h;
}
function toggleBrand(el){
  const b=el.value;
  shopState.brands=el.checked?[...shopState.brands,b]:shopState.brands.filter(x=>x!==b);
  renderShopList();
}
function filteredShop(){
  let list=activeProducts();const{q,cat,sort,brands,maxPrice,pack,badge}=shopState;
  if(cat)list=list.filter(p=>p.category===cat);
  if(badge)list=list.filter(p=>p.badge===badge);
  if(q){const n=q.toLowerCase();list=list.filter(p=>(p.name+' '+(p.pack||'')).toLowerCase().includes(n));}
  if(brands.length)list=list.filter(p=>brands.includes(getBrand(p.name)));
  if(maxPrice)list=list.filter(p=>p.price<=maxPrice);
  if(pack)list=list.filter(p=>p.pack===pack);
  if(sort==='lo')list=[...list].sort((a,b)=>a.price-b.price);
  else if(sort==='hi')list=[...list].sort((a,b)=>b.price-a.price);
  else if(sort==='az')list=[...list].sort((a,b)=>a.name.localeCompare(b.name));
  return list;
}
let shopSearchTimer;
function renderShopList(){
  const{q,cat,sort}=shopState;
  $('#shopFilters').innerHTML=
    '<div class="shop-search-wrap"><input type="search" id="fq" autocomplete="off" aria-label="Search products" placeholder="Search in '+esc(cat||'all snacks')+'..." value="'+esc(q)+'" oninput="queueShopSearch(this.value)" onkeydown="shopSearchKey(event)"><div id="shopSearchSuggestions" class="shop-search-suggestions" role="listbox" hidden></div></div>'
    +'<select aria-label="Sort products" onchange="shopState.sort=this.value;renderShopResults()">'
    +'<option value="feat" '+(sort==='feat'?'selected':'')+'>Recommended</option>'
    +'<option value="lo" '+(sort==='lo'?'selected':'')+'>Price: Low → High</option>'
    +'<option value="hi" '+(sort==='hi'?'selected':'')+'>Price: High → Low</option>'
    +'<option value="az" '+(sort==='az'?'selected':'')+'>Name A–Z</option>'
    +'</select><span class="cnt" id="shopResultCount"></span>';
  renderShopResults();
}
function queueShopSearch(value){
  shopState.q=value;
  renderShopSearchSuggestions(value);
  clearTimeout(shopSearchTimer);
  shopSearchTimer=setTimeout(renderShopResults,140);
}
let shopSuggestIndex=-1;
function renderShopSearchSuggestions(value){
  const box=document.getElementById('shopSearchSuggestions');if(!box)return;
  const q=String(value||'').trim().toLowerCase(); shopSuggestIndex=-1;
  if(q.length<2){box.hidden=true;box.innerHTML='';return;}
  const matches=activeProducts().filter(p=>(p.name+' '+(p.category||'')+' '+getBrand(p.name)).toLowerCase().includes(q)).slice(0,5);
  if(!matches.length){box.hidden=true;box.innerHTML='';return;}
  box.hidden=false;
  box.innerHTML=matches.map((p,i)=>`<a role="option" data-sidx="${i}" href="${productHref(p.id)}"><img src="${esc(assetUrl(p.img||''))}" alt=""><span><b>${esc(p.name)}</b><small>${esc(p.pack||p.category||'')}</small></span><strong>${fmt(p.price)}</strong></a>`).join('');
}
function setShopSuggestion(index){
  const box=document.getElementById('shopSearchSuggestions'); if(!box||box.hidden)return;
  const items=[...box.querySelectorAll('[data-sidx]')]; if(!items.length)return;
  shopSuggestIndex=(index+items.length)%items.length;
  items.forEach((el,i)=>{el.classList.toggle('active',i===shopSuggestIndex);el.setAttribute('aria-selected',i===shopSuggestIndex?'true':'false');});
  items[shopSuggestIndex].scrollIntoView({block:'nearest'});
}
function shopSearchKey(event){
  const box=document.getElementById('shopSearchSuggestions');
  if(event.key==='ArrowDown'&&!box?.hidden){event.preventDefault();setShopSuggestion(shopSuggestIndex+1);}
  else if(event.key==='ArrowUp'&&!box?.hidden){event.preventDefault();setShopSuggestion(shopSuggestIndex-1);}
  else if(event.key==='Enter'&&shopSuggestIndex>=0&&!box?.hidden){event.preventDefault();const a=box.querySelector(`[data-sidx="${shopSuggestIndex}"]`);if(a)location.href=a.href;}
  else if(event.key==='Escape'&&box){box.hidden=true;shopSuggestIndex=-1;}
}
let smartSearchSeq=0, smartSearchTimer;
function serverProductToLocal(p){return {id:Number(p.id),name:p.name||'',category:p.category||'',brand:p.brand||'',pack:p.pack||'',price:Number(p.price||0),oldPrice:p.old_price==null?null:Number(p.old_price),desc:p.description||'',badge:p.badge||'',img:p.image_url||''};}
async function renderSmartSearchResults(query,seq){
  try{
    const r=await fetch('/api/ai/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
    if(!r.ok)throw new Error('smart search unavailable'); const data=await r.json();
    if(seq!==smartSearchSeq||shopState.q!==query)return;
    const rows=(data.products||[]).map(serverProductToLocal);
    const grid=$('#shopGrid'),cnt=document.getElementById('shopResultCount');
    if(rows.length){grid.innerHTML=rows.map(cardHTML).join('');if(cnt)cnt.textContent=rows.length+' smart matches';$('#catCount').textContent=rows.length+' smart matches';}
    else grid.innerHTML='<div class="empty">No products found. Try another search.</div>';
    observeReveals();
  }catch{if(seq===smartSearchSeq&&shopState.q===query)$('#shopGrid').innerHTML='<div class="empty">No products found. Try another search.</div>';}
}
function renderShopResults(){
  const list=filteredShop();
  $('#catCount').textContent=list.length+' products';
  const cnt=document.getElementById('shopResultCount');if(cnt)cnt.textContent=list.length+' products';
  const canSmart=!list.length&&String(shopState.q||'').trim().length>=2&&!shopState.cat&&!shopState.brands.length&&!shopState.maxPrice&&!shopState.pack&&!shopState.badge;
  if(list.length){clearTimeout(smartSearchTimer);smartSearchSeq++;$('#shopGrid').innerHTML=list.map(cardHTML).join('');}
  else if(canSmart){const seq=++smartSearchSeq;clearTimeout(smartSearchTimer);$('#shopGrid').innerHTML='<div class="empty">✦ Looking for smart matches…</div>';smartSearchTimer=setTimeout(()=>renderSmartSearchResults(shopState.q,seq),420);}
  else {clearTimeout(smartSearchTimer);smartSearchSeq++;$('#shopGrid').innerHTML='<div class="empty">No products found. Try another search.</div>';}
  renderFilterChips();updateApplyBtn();
  const ms=$('#mSort'); if(ms)ms.value=shopState.sort;
  if(typeof revealObs!=='undefined'&&revealObs){
    [...document.querySelectorAll('#shopGrid .card')].forEach((c,i)=>{c.classList.add('reveal');c.style.transitionDelay=((i%8)*45)+'ms';});
  }
  observeReveals();
}


/* ---------- product modal ---------- */
let productModalReturnFocus=null;
function openProduct(id){
  productModalReturnFocus=document.activeElement;
  const p=PRODUCTS.find(x=>x.id===id); if(!p)return;
  const img=p.img?`<img src="${esc(assetUrl(p.img))}" alt="">`:`<div class="noimg"><b>CHASKABOX</b><span>Photo<br>coming soon</span><small>${esc(p.category||'')}</small></div>`;
  const old=p.oldPrice?`<span class="oldprice">${fmt(p.oldPrice)}</span>`:'';
  $('#mbody').innerHTML=`<div class="mgrid">
    <div class="pimg">${img}</div>
    <div><h2 style="color:var(--navy);font-size:20px;margin-bottom:6px">${esc(p.name)}</h2>
    <div class="ppack" style="margin-bottom:8px">${esc(p.pack||'')} · ${esc(p.category)}</div>
    <div style="margin-bottom:10px"><span class="price" style="font-size:22px">${fmt(p.price)}</span>${old}</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:14px">${esc(p.desc||'')}</p>
    <div class="qty" style="margin-bottom:12px"><button onclick="mQty(-1)">−</button><b id="mqty">1</b><button onclick="mQty(1)">+</button></div>
    <button class="add" style="padding:12px 26px;font-size:15px" onclick="addToCart(${p.id},+document.getElementById('mqty').textContent,this);closeModal()">Add to Bag</button>
    </div></div>`;
  $('#pmodal').classList.add('open');
  $('#pmodal').setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  setTimeout(()=>$('#pmodal .mclose')?.focus(),0);
}
function mQty(d){const e=$('#mqty');e.textContent=Math.max(1,+e.textContent+d);}
function closeModal(){$('#pmodal').classList.remove('open');$('#pmodal').setAttribute('aria-hidden','true');document.body.style.overflow='';if(productModalReturnFocus&&typeof productModalReturnFocus.focus==='function'){const f=productModalReturnFocus;productModalReturnFocus=null;setTimeout(()=>f.focus(),0);}}

/* ---------- product detail page ---------- */
function renderProductDetail(id){
  const p=PRODUCTS.find(x=>x.id===id); if(!p){ navigate('/'); return; }
  const img=p.img?`<img src="${esc(assetUrl(p.img))}" alt="${esc(p.name)}">`:`<div class="noimg"><b>CHASKABOX</b><span>Photo<br>coming soon</span><small>${esc(p.category||'')}</small></div>`;
  const badge=p.badge?`<span class="badge ${p.badge==='Bestseller'?'bestseller':''}">${esc(p.badge==='Sale'?'Sale':p.badge.toUpperCase())}</span>`:'';
  const old=p.oldPrice&&p.oldPrice>p.price?`<span class="oldprice">${fmt(p.oldPrice)}</span>`:'';
  const save=p.oldPrice&&p.oldPrice>p.price?`<span class="pdsave">Save ${Math.round((1-p.price/p.oldPrice)*100)}%</span>`:'';
  const catlabel=p.category?`<div class="pcat">${esc(p.category)}${p.bundle?' · BUNDLE':''}</div>`:'';
  $('#pdCrumbCat').textContent=p.category||'All Snacks';
  $('#pdCrumbCat').setAttribute('onclick',`goShop('${esc(p.category||'')}');return false`);
  $('#pdCrumbName').textContent=p.name;
  $('#pdetail').innerHTML=`<div class="pdetail">
    <div class="pd-grid">
      <div class="pd-imgwrap">${badge}<div class="pd-img">${img}</div></div>
      <div class="pd-info">
        ${catlabel}
        <h1>${esc(p.name)}</h1>
        <div class="pd-brand">${esc(getBrand(p.name))}</div>
        <div class="pd-price"><span class="price" style="font-size:26px">${fmt(p.price)}</span>${old}${save}</div>
        <div class="ppack" style="margin-bottom:10px">${esc(p.pack||'')}</div>
        <p class="pd-desc">${esc(p.desc||'Product details are being updated. Contact ChaskaBox if you need ingredient or allergen information before ordering.')}</p>
        <div class="pd-buyrow">
          <div class="qty"><button onclick="pdQty(-1)" aria-label="Decrease quantity">−</button><b id="pdqty">1</b><button onclick="pdQty(1)" aria-label="Increase quantity">+</button></div>
          <button class="pdbtn" onclick="addToCart(${p.id},+document.getElementById('pdqty').textContent,this)">Add to Bag</button>
          <button class="pdwish${typeof isWished==='function'&&isWished(p.id)?' on':''}" aria-label="Add ${esc(p.name)} to wishlist" onclick="toggleWishlist(${p.id},this)">♥</button>
        </div>
        <div class="dbox"><b>Estimated delivery</b><small>Pakistan-wide delivery window<br><span class="ddates">${deliveryRange()}</span></small></div>
        <div class="pd-meta"><span>🚚 COD: ${fmt(settingNum('cod_delivery_fee_pkr',300))} delivery</span><span>⚡ Prepaid ${fmt(settingNum('prepaid_free_delivery_threshold_pkr',5000))}+: FREE delivery</span><span>✅ Original sealed packs</span></div>
        <div class="product-help"><b>Need ingredients or allergen details?</b><span>Message ChaskaBox on WhatsApp before ordering. If an item becomes unavailable, we will contact you before any substitution.</span></div>
      </div>
    </div>
  </div>`;
  showView('product');
  window.scrollTo(0,0);
}
function pdBack(){ history.back(); }
function pdQty(d){const e=$('#pdqty');e.textContent=Math.max(1,+e.textContent+d);}


/* ---------- public CMS/settings (admin-controlled, public-safe) ---------- */
let STORE_CONFIG={settings:{},sections:[]};
async function loadStorefrontConfig(){
  try{const r=await fetch('/api/storefront-config',{cache:'no-cache'});if(r.ok)STORE_CONFIG=await r.json();}catch(e){}
  return STORE_CONFIG;
}
function settingNum(key,fallback){const v=STORE_CONFIG?.settings?.[key];const n=Number(v);return Number.isFinite(n)?n:fallback;}
function sectionConfig(key){return (STORE_CONFIG?.sections||[]).find(r=>r.section_key===key)?.config||{};}
function curatedProducts(key,fallback){
  const ids=sectionConfig(key)?.product_ids;
  if(!Array.isArray(ids)||!ids.length) return fallback;
  const by=new Map(activeProducts().map(p=>[Number(p.id),p]));
  const chosen=ids.map(Number).map(id=>by.get(id)).filter(Boolean);
  return chosen.length?chosen:fallback;
}
function applyHomeCms(){
  const rows=STORE_CONFIG?.sections||[]; const by=Object.fromEntries(rows.map(r=>[r.section_key,r]));
  const selectors={
    announcement_bar:['.promo'], hero:['#view-home .hero'], categories:['#view-home .discover'],
    chaska_picks:['#view-home [data-home-section="chaska_picks"]'], boxes:['#view-home .box-spotlight','#view-home [data-home-section="boxes"]'],
    chatpata_picks:['#view-home [data-home-section="chatpata_picks"]'], new_items:['#view-home [data-home-section="new_items"]'],
    how_it_works:['#view-home .fresh'], faq:['#view-home .faq-section']
  };
  for(const [key,sels] of Object.entries(selectors)){
    const row=by[key]; if(!row) continue;
    for(const sel of sels){
      const el=document.querySelector(sel); if(!el) continue;
      el.hidden=row.enabled===false;
      if(row.heading){const h=el.querySelector('h1,h2');if(h)h.textContent=row.heading;}
      if(row.subheading){const text=el.querySelector('p,.freshdesc');if(text)text.textContent=row.subheading;}
    }
  }
}
/* ---------- views ---------- */
function showView(v){
  const views=['home','shop','product','account','cart','404'];
  views.forEach(name=>{
    const el=document.getElementById('view-'+name);
    if(!el) return;
    const active = (v===name);
    // Only active route content is in DOM; inactive views are cleared
    // (SEO: prevents multiple H1s; a11y: screen readers skip cleared content)
    if(!active){
      // Preserve shop/account/cart shells (JS re-renders them), clear home static content
      if(name==='home') el.innerHTML='';
      el.style.display='none';
      el.setAttribute('hidden','');
      el.setAttribute('aria-hidden','true');
      el.setAttribute('inert','');
    } else {
      el.style.display='';
      el.removeAttribute('hidden');
      el.removeAttribute('aria-hidden');
      el.removeAttribute('inert');
    }
  });
  if(typeof closeFilters==='function') closeFilters();
  closeMnav();
}

/* ---------- Route renderers ---------- */
function setMetaRobots(noindex){
  let m=document.querySelector('meta[name="robots"]');
  if(!m){ m=document.createElement('meta'); m.name='robots'; document.head.appendChild(m); }
  m.content=noindex?'noindex, follow':'index, follow';
}
function setPageMeta(title,path,noindex,description){
  document.title=title;
  setMetaRobots(!!noindex);
  const canonical='https://chaskabox.online'+normalizePath(path||'/');
  let c=document.querySelector('link[rel="canonical"]');
  if(!c){ c=document.createElement('link'); c.rel='canonical'; document.head.appendChild(c); }
  c.href=canonical;
  let og=document.querySelector('meta[property="og:url"]');
  if(og) og.content=canonical;
  if(description){ const d=document.querySelector('meta[name="description"]'); if(d)d.content=description; }
}
function renderHomeRoute(){
  setPageMeta('ChaskaBox — Pakistani Snacks Online','/',false,'Pakistani snacks and Chaska Boxes delivered across Pakistan with COD, JazzCash and Bank Transfer options.');
  // Mount home content from template (SEO: only active route in DOM)
  const vh=document.getElementById('view-home');
  const tpl=document.getElementById('tpl-home');
  if(vh && tpl && !vh.innerHTML.trim()){
    vh.appendChild(tpl.content.cloneNode(true));
  }
  showView('home');
  renderHomeContent();
  loadStorefrontConfig().then(applyHomeCms);
}
function renderShopRoute(){
  setPageMeta('Shop Pakistani Snacks | ChaskaBox','/shop/',false,'Browse Pakistani snacks by category, brand and price at ChaskaBox.');
  shopState.cat='';
  const urlQ=new URLSearchParams(location.search).get('q'); if(urlQ!==null) shopState.q=urlQ;
  showView('shop');
  renderShopContent();
}
function renderBundlesRoute(){
  setPageMeta('Chaska Boxes — Snack Bundles | ChaskaBox','/bundles/',false,'Curated Chaska Boxes for gifting, cravings and easy snack shopping.');
  shopState.cat='Bundles';
  showView('shop');
  renderShopContent();
}
function renderCategoryRoute(slug){
  const catName=CATEGORY_SLUGS[slug];
  if(!catName){ render404('/category/'+slug+'/'); return; }
  setPageMeta(catName+' | ChaskaBox','/category/'+slug+'/',false,'Shop '+catName+' from ChaskaBox.');
  shopState.cat=catName;
  showView('shop');
  renderShopContent();
}
function renderCartRoute(){
  setPageMeta('Your Snack Bag | ChaskaBox','/cart/',true);
  showView('cart');
  renderCartPage();
}
function renderCartPage(){
  const el=document.getElementById('view-cart'); if(!el)return;
  const items=Object.entries(CART);
  if(!items.length){
    el.innerHTML='<div class="section cart-page"><div class="crumbs"><a href="/">Home</a> <span>›</span> Bag</div><div class="cart-empty"><span>🛒</span><h1>Your snack bag is empty</h1><p>Apna favourite chaska choose karein — singles, deals ya Chaska Boxes.</p><a class="cta" href="/shop/">Shop All Snacks</a></div></div>';
    return;
  }
  let subtotal=0;
  const rows=items.map(([id,qty])=>{
    const p=PRODUCTS.find(x=>x.id==id); if(!p)return '';
    subtotal+=p.price*qty;
    return `<div class="cart-page-item"><a href="${productHref(p.id)}"><img src="${esc(assetUrl(p.img||''))}" alt="${esc(p.name)}"></a><div class="cart-page-copy"><a href="${productHref(p.id)}"><b>${esc(p.name)}</b></a><small>${esc(p.pack||'')}</small><span>${fmt(p.price)}</span></div><div class="qty"><button onclick="setCartPageQty(${p.id},${qty-1})" aria-label="Decrease">−</button><b>${qty}</b><button onclick="setCartPageQty(${p.id},${qty+1})" aria-label="Increase">+</button></div><b>${fmt(p.price*qty)}</b><button class="cart-remove" onclick="setCartPageQty(${p.id},0)" aria-label="Remove ${esc(p.name)}">Remove</button></div>`;
  }).join('');
  const threshold=Math.max(0,settingNum('prepaid_free_delivery_threshold_pkr',5000));
  const remaining=Math.max(0,threshold-subtotal), pct=threshold<=0?100:Math.min(100,Math.round(subtotal/threshold*100));
  const progress=remaining?`<p><b>${fmt(remaining)}</b> more to unlock FREE delivery with prepaid payment.</p>`:'<p><b>🎉 Free delivery unlocked</b> for prepaid payment.</p>';
  el.innerHTML=`<div class="section cart-page"><div class="crumbs"><a href="/">Home</a> <span>›</span> Bag</div><div class="section-head"><div><span class="eyebrow">YOUR CHASKA</span><h1>Your Snack Bag</h1></div><a href="/shop/">Continue shopping →</a></div><div class="cart-page-layout"><div class="cart-page-items">${rows}</div><aside class="cart-summary"><h3>Order summary</h3><div class="drow"><span>Subtotal</span><b>${fmt(subtotal)}</b></div><div class="shipping-progress"><div class="progress-track"><span class="${pct>=100?'is-full':''}" data-progress="${pct}"></span></div>${progress}</div><p class="cart-note">COD: ${fmt(settingNum('cod_delivery_fee_pkr',300))} delivery · Prepaid ${fmt(threshold)}+: free delivery</p><a class="checkoutbtn cart-checkout" href="/checkout.html">Proceed to Checkout →</a></aside></div></div>`;
  animateProgressIn(el,'cart',pct);
}
function setCartPageQty(id,qty){ if(qty<=0)delete CART[id]; else CART[id]=qty; saveCart(); renderCartPage(); }
function renderAccountRoute(){
  setPageMeta('My Account | ChaskaBox','/account/',true);
  showView('account');
  if(typeof renderAccountView==='function')renderAccountView();
}
function render404(path){
  setPageMeta('Page Not Found | ChaskaBox',path||'/',true);
  showView('404');
  const el=document.getElementById('view-404');
  if(el)el.innerHTML='<div class="section notfound"><div class="nf-emoji">🍬</div><h1>Yahan chaska nahi mila.</h1><p>Page move ho gaya ho sakta hai — shop ya home se dobara start karein.</p><div class="nf-actions"><a class="cta" href="/">Home</a><a class="cta secondary" href="/shop/">Shop Snacks</a></div></div>';
}

/* ---------- History API router with clean URLs ---------- */
/* Canonical URL style: trailing slash (matches /product/<id>/) */

const CATEGORY_SLUGS = {
  'biscuits-and-wafers': 'Biscuits & Wafers',
  'bunties-and-cakes': 'Bunties & Cakes',
  'chocolates-and-candies': 'Chocolates & Candies',
  'snacks-and-nimco': 'Snacks & Nimco',
  'jellies-and-marshmallow': 'Jellies & Marshmallow',
  'imli-and-ice-lollies': 'Imli & Ice Lollies',
  'chews-and-gums': 'Chews & Gums',
  'betel-nuts-and-pan-masala': 'Betel Nuts & Pan Masala',
};
const CATEGORY_NAMES_TO_SLUG=Object.fromEntries(Object.entries(CATEGORY_SLUGS).map(([slug,name])=>[name,slug]));
CATEGORY_NAMES_TO_SLUG['Bundles']='bundles';
function categoryPath(cat){ if(!cat)return '/shop/'; if(cat==='Bundles')return '/bundles/'; const slug=CATEGORY_NAMES_TO_SLUG[cat]||cat; return CATEGORY_SLUGS[slug]?'/category/'+slug+'/':'/shop/'; }

function normalizePath(p){
  if(!p) return '/';
  p = p.split('?')[0].split('#')[0]; // strip query and hash
  if(!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+/g, '/'); // collapse duplicate slashes
  p = p.toLowerCase();
  if(p.length > 1 && !p.endsWith('/')) p += '/';
  return p;
}

function navigate(path){
  path = normalizePath(path);
  if(location.pathname === path){
    route(); // same path, re-render
    return;
  }
  history.pushState(null, '', path);
  route();
}

function goHome(){ navigate('/'); }
function goShop(cat){
  closeMnav();
  shopState={q:'',cat:'',sort:'feat',brands:[],maxPrice:0,pack:'',badge:''};
  if(!cat){ navigate('/shop/'); return; }
  if(cat==='Bundles'||cat==='bundles'){ navigate('/bundles/'); return; }
  const slug=CATEGORY_SLUGS[cat]?cat:CATEGORY_NAMES_TO_SLUG[cat];
  if(slug&&CATEGORY_SLUGS[slug]) navigate('/category/'+slug+'/'); else navigate('/shop/');
}
function goBadge(badge){ closeMnav(); shopState={q:'',cat:'',sort:'feat',brands:[],maxPrice:0,pack:'',badge:badge||''}; navigate('/shop/'); }
function goShopBadge(cat,badge){
  closeMnav(); shopState={q:'',cat:cat||'',sort:'feat',brands:[],maxPrice:0,pack:'',badge:badge||''};
  navigate(cat==='Bundles'?'/bundles/':categoryPath(cat));
}
function goFlavor(q){ closeMnav(); shopState={q:q||'',cat:'',sort:'feat',brands:[],maxPrice:0,pack:'',badge:''}; navigate('/shop/'); }
function goBrand(b){ closeMnav(); shopState={q:'',cat:'',sort:'feat',brands:b?[b]:[],maxPrice:0,pack:'',badge:''}; navigate('/shop/'); }
function goBundles(){ closeMnav(); shopState={q:'',cat:'Bundles',sort:'feat',brands:[],maxPrice:0,pack:'',badge:''}; navigate('/bundles/'); }
function goCart(){ navigate('/cart/'); }
function goAccount(){ navigate('/account/'); }
function focusShopSearch(){
  if(normalizePath(location.pathname)!=='/shop/') navigate('/shop/');
  setTimeout(()=>{const s=document.getElementById('fq'); if(s){s.focus();s.scrollIntoView({behavior:'smooth',block:'center'});}},80);
}

let homeSuggestIndex=-1;
function renderHomeSearchSuggestions(value){
  const box=document.getElementById('homeSearchSuggestions'); if(!box)return;
  const raw=String(value||'').trim(), q=raw.toLowerCase(); homeSuggestIndex=-1;
  if(q.length<2){box.hidden=true;box.innerHTML='';return;}
  const allMatches=activeProducts().filter(p=>{
    const hay=[p.name,p.category,p.brand,getBrand(p.name)].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
  const matches=allMatches.slice(0,6);
  box.hidden=false;
  box.setAttribute('role','listbox');
  box.innerHTML=matches.length?matches.map((p,i)=>`<a role="option" data-hidx="${i}" href="${productHref(p.id)}"><img src="${esc(assetUrl(p.img||''))}" alt=""><span><b>${esc(p.name)}</b><small>${esc(p.pack||p.category||'')}</small></span><strong>${fmt(p.price)}</strong></a>`).join('')+`<button class="search-all" type="button" onclick="searchAllFromHome()">See all ${allMatches.length} result${allMatches.length===1?'':'s'} →</button>`:'<div class="search-empty">No exact match — press Search to browse all results.</div>';
}
function setHomeSuggestion(index){
  const box=document.getElementById('homeSearchSuggestions');if(!box||box.hidden)return;
  const items=[...box.querySelectorAll('[data-hidx]')];if(!items.length)return;
  homeSuggestIndex=(index+items.length)%items.length;
  items.forEach((el,i)=>{el.classList.toggle('active',i===homeSuggestIndex);el.setAttribute('aria-selected',i===homeSuggestIndex?'true':'false');});
  items[homeSuggestIndex].scrollIntoView({block:'nearest'});
}
function searchAllFromHome(){ submitHomeSearch(); }
function submitHomeSearch(){
  const input=document.getElementById('homeSearch');
  const q=(input?.value||'').trim();
  shopState={q,cat:'',sort:'feat',brands:[],maxPrice:0,pack:'',badge:''};
  navigate('/shop/');
  setTimeout(()=>document.getElementById('fq')?.focus(),80);
}
function submitHeaderSearch(event){
  event?.preventDefault();
  const input=document.getElementById('headerSearch'); const q=(input?.value||'').trim();
  const box=document.getElementById('headerSearchSuggestions'); if(box){box.hidden=true;}
  shopState={q,cat:'',sort:'feat',brands:[],maxPrice:0,pack:'',badge:''};
  navigate('/shop/');
  setTimeout(()=>{const el=document.getElementById('fq');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}},80);
}
let headerSuggestIndex=-1;
function renderHeaderSearchSuggestions(value){
  const box=document.getElementById('headerSearchSuggestions'); if(!box)return;
  const raw=String(value||'').trim(), q=raw.toLowerCase(); headerSuggestIndex=-1;
  if(q.length<2){box.hidden=true;box.innerHTML='';return;}
  const allMatches=activeProducts().filter(p=>{
    const hay=[p.name,p.category,p.brand,getBrand(p.name)].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
  const matches=allMatches.slice(0,6);
  box.hidden=false;
  box.innerHTML=matches.length?matches.map((p,i)=>`<a role="option" data-hidx="${i}" href="${productHref(p.id)}"><img src="${esc(assetUrl(p.img||''))}" alt=""><span><b>${esc(p.name)}</b><small>${esc(p.pack||p.category||'')}</small></span><strong>${fmt(p.price)}</strong></a>`).join(''):'<div class="search-empty">No matches — press Enter to search.</div>';
}
function headerSearchKey(event){
  const box=document.getElementById('headerSearchSuggestions');
  if(event.key==='ArrowDown'&&box&&!box.hidden){
    event.preventDefault();
    const items=[...box.querySelectorAll('[data-hidx]')];if(!items.length)return;
    headerSuggestIndex=(headerSuggestIndex+1)%items.length;
    items.forEach((el,i)=>el.classList.toggle('active',i===headerSuggestIndex));
    items[headerSuggestIndex].scrollIntoView({block:'nearest'});
  }
  else if(event.key==='ArrowUp'&&box&&!box.hidden){
    event.preventDefault();
    const items=[...box.querySelectorAll('[data-hidx]')];if(!items.length)return;
    headerSuggestIndex=(headerSuggestIndex-1+items.length)%items.length;
    items.forEach((el,i)=>el.classList.toggle('active',i===headerSuggestIndex));
    items[headerSuggestIndex].scrollIntoView({block:'nearest'});
  }
  else if(event.key==='Enter'&&box&&!box.hidden&&headerSuggestIndex>=0){
    const a=box.querySelector(`[data-hidx="${headerSuggestIndex}"]`);
    if(a){event.preventDefault();location.href=a.href;return;}
  }
  else if(event.key==='Escape'){if(box){box.hidden=true;}headerSuggestIndex=-1;}
}
// Hide header suggestions when clicking outside
document.addEventListener('click',event=>{
  const box=document.getElementById('headerSearchSuggestions');
  if(box&&!box.hidden&&!event.target.closest('.header-search')){box.hidden=true;headerSuggestIndex=-1;}
});
function homeSearchKey(event){
  const box=document.getElementById('homeSearchSuggestions');
  if(event.key==='ArrowDown'&&!box?.hidden){event.preventDefault();setHomeSuggestion(homeSuggestIndex+1);}
  else if(event.key==='ArrowUp'&&!box?.hidden){event.preventDefault();setHomeSuggestion(homeSuggestIndex-1);}
  else if(event.key==='Enter'){
    event.preventDefault();
    if(homeSuggestIndex>=0&&!box?.hidden){const a=box.querySelector(`[data-hidx="${homeSuggestIndex}"]`);if(a){location.href=a.href;return;}}
    submitHomeSearch();
  } else if(event.key==='Escape'){if(box)box.hidden=true;homeSuggestIndex=-1;}
}

/* Legacy hash URL migration: #/shop -> /shop/ (replaceState, no new history entry) */
function migrateHashURL(){
  const h = location.hash;
  if(h && h.startsWith('#/')){
    const hashPath = h.slice(1); // remove #
    let newPath = '/';
    if(hashPath.startsWith('/shop')){
      const parts=hashPath.split('/').filter(Boolean);
      if(parts.length>1){ try{ newPath=categoryPath(decodeURIComponent(parts.slice(1).join('/'))); }catch(e){ newPath='/shop/'; } } else newPath='/shop/';
    } else if(hashPath.startsWith('/product/')){
      // Let product hash URLs redirect to clean product URLs if possible
      const m = hashPath.match(/\/product\/(\d+)/);
      if(m) newPath = productHref(m[1]);
    }
    history.replaceState(null, '', normalizePath(newPath)+location.search);
    // replaceState already clears the legacy hash without adding history
  }
}

/* Main router */
function route(){
  let path = normalizePath(location.pathname);
  // Normalize URL in address bar if needed (replaceState, no history entry)
  if(path !== location.pathname){
    history.replaceState(null, '', path);
  }

  // Scroll to top for new navigations (popstate handles back/forward restore)
  const scrollTop = !route._isPopstate;

  if(path === '/'){
    renderHomeRoute();
  } else if(path === '/shop/'){
    shopState.cat = '';
    renderShopRoute();
  } else if(path === '/bundles/'){
    renderBundlesRoute();
  } else if(path === '/cart/'){
    renderCartRoute();
  } else if(path === '/account/'){
    renderAccountRoute();
  } else if(path.startsWith('/category/')){
    const slug = path.replace('/category/', '').replace(/\/$/, '');
    renderCategoryRoute(slug);
  } else if(path.startsWith('/product/')){
    // Product pages are separate static HTML files - let browser handle
    // This should not happen via router, but if it does, don't intercept
    return;
  } else {
    render404(path);
  }

  if(scrollTop) window.scrollTo(0, 0);
  route._isPopstate = false;
}

/* Back/forward navigation */
if('scrollRestoration' in history) history.scrollRestoration='auto';
window.addEventListener('popstate', function(){
  route._isPopstate = true;
  route();
});

/* Link interception - only same-origin, preserve Ctrl/Cmd/middle-click */
document.addEventListener('click', function(e){
  const a = e.target.closest('a');
  if(!a) return;
  const href = a.getAttribute('href');
  if(!href || href.startsWith('#')) return; // skip hash-only links
  // Skip special protocols
  if(/^(mailto:|tel:|javascript:)/i.test(href)) return;
  // Skip download links
  if(a.hasAttribute('download')) return;
  // Skip external links
  let url;
  try{ url = new URL(href, location.origin); }catch(err){ return; }
  if(url.origin !== location.origin) return;
  if(url.hash && url.pathname === '/') {
    e.preventDefault();
    if(normalizePath(location.pathname)!=='/') navigate('/');
    setTimeout(()=>{ const t=document.querySelector(url.hash); if(t)t.scrollIntoView({behavior:'smooth',block:'start'}); },80);
    return;
  }
  // Skip product pages (separate static files - let browser handle for full load)
  // Actually, product pages are static HTML, SPA navigation won't work for them
  // Let them do full page loads
  if(url.pathname.startsWith('/product/')) return;
  // Skip checkout and admin (separate HTML files)
  if(url.pathname === '/checkout.html' || url.pathname === '/admin.html') return;
  // Preserve Ctrl/Cmd-click, Shift-click, middle-click (open in new tab)
  if(e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
  // Skip target=_blank
  if(a.target === '_blank') return;

  e.preventDefault();
  navigate(url.pathname);
});

/* ---------- cart ---------- */
function loadCart(){try{CART=JSON.parse(localStorage.getItem('chaskabox-cart')||'{}');}catch(e){CART={};}}
function saveCart(){
  localStorage.setItem('chaskabox-cart',JSON.stringify(CART));
  updateBadge(); renderDrawer();
  if(normalizePath(location.pathname)==='/cart/') renderCartPage();
}
let toastTimer=null;
function showCartToast(p,qty){
  let t=document.getElementById('cartToast');
  if(!t){ t=document.createElement('div'); t.id='cartToast'; t.className='cart-toast'; t.setAttribute('role','status'); t.setAttribute('aria-live','polite'); document.body.appendChild(t); }
  t.innerHTML=`<span>✓ ${qty>1?qty+' × ':''}${esc(p?.name||'Snack')} added</span><button onclick="openDrawer()">View Bag</button>`;
  t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2600);
}
function addToCart(id,qty=1,el){
  const p=PRODUCTS.find(x=>x.id===id); if(!p)return;
  qty=Math.max(1,Number(qty)||1);
  if(el) flyToCart(el,id);
  CART[id]=(CART[id]||0)+qty; saveCart(); popBadge();
  if(el && el.closest && el.closest('.card')){
    const old=el.innerHTML; el.innerHTML='Added ✓'; el.disabled=true;
    setTimeout(()=>{ if(document.body.contains(el)){el.innerHTML=old;el.disabled=false;} },850);
    showCartToast(p,qty);
  }else openDrawer();
}
function popBadge(){ $$('.cartcount').forEach(e=>{ e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop'); }); }
/* fly-to-cart: product image flies to the bag icon */
function flyToCart(el,id){
  try{
    if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const p=PRODUCTS.find(x=>x.id===id);
    const target=document.querySelector('.hbtn.solid');
    const imgEl=el.closest('.card')?.querySelector('.pimg img')||el.closest('.mbox')?.querySelector('.pimg img')||el.closest('.pdetail')?.querySelector('.pd-img img');
    if(!p||!p.img||!target||!imgEl) return;
    const r1=imgEl.getBoundingClientRect(), r2=target.getBoundingClientRect();
    if(!r1.width||!r2.width) return;
    const g=document.createElement('img');
    g.src=assetUrl(p.img); g.alt=''; g.className='fly-ghost';
    g.style.left=(r1.left+r1.width/2-27)+'px';
    g.style.top=(r1.top+r1.height/2-27)+'px';
    document.body.appendChild(g);
    const dx=(r2.left+r2.width/2)-(r1.left+r1.width/2);
    const dy=(r2.top+r2.height/2)-(r1.top+r1.height/2);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      g.style.transform=`translate(${dx}px,${dy}px) scale(.12)`;
      g.style.opacity='.25';
    }));
    setTimeout(()=>g.remove(),700);
  }catch(e){}
}
function cartCount(){return Object.values(CART).reduce((a,b)=>a+b,0);}
function cartSubtotal(){return Object.entries(CART).reduce((s,[id,q])=>{const p=PRODUCTS.find(x=>x.id==id);return s+(p?p.price*q:0);},0);}
function updateBadge(){const n=cartCount();$$('.cartcount').forEach(e=>{e.textContent=n;e.style.display=n?'flex':'none';});}
let drawerReturnFocus=null;
function openDrawer(){drawerReturnFocus=document.activeElement;renderDrawer();$('#overlay').classList.add('open');$('#drawer').classList.add('open');$('#drawer').setAttribute('aria-hidden','false');$('#drawer').removeAttribute('inert');document.body.style.overflow='hidden';setTimeout(()=>$('#drawer .mclose')?.focus(),0);}
function closeDrawer(){$('#overlay').classList.remove('open');$('#drawer').classList.remove('open');$('#drawer').setAttribute('aria-hidden','true');$('#drawer').setAttribute('inert','');document.body.style.overflow='';if(drawerReturnFocus&&typeof drawerReturnFocus.focus==='function'){const f=drawerReturnFocus;drawerReturnFocus=null;setTimeout(()=>f.focus(),0);}}
function renderDrawer(){
  const box=$('#ditems');
  const ids=Object.keys(CART);
  if(!ids.length){box.innerHTML='<div class="empty">Your bag is empty.<br>Go grab some chaska! 🍪</div>';}
  else box.innerHTML=ids.map(id=>{
    const p=PRODUCTS.find(x=>x.id==id); if(!p)return '';
    const img=p.img?`<img src="${esc(assetUrl(p.img))}" alt="${esc(p.name)}">`:'<div style="font-size:36px">🍪</div>';
    return `<div class="ditem">${img}<div class="di"><div class="din">${esc(p.name)}</div>
    <div class="dip">${fmt(p.price)} each</div></div>
    <div class="qty"><button onclick="chQty(${id},-1)">−</button><b>${CART[id]}</b><button onclick="chQty(${id},1)">+</button></div></div>`;
  }).join('');
  const sub=cartSubtotal();
  const rem=Math.max(0,5000-sub), pct=Math.min(100,Math.round(sub/5000*100));
  $('#dfoot').innerHTML=`<div class="drow total"><span>Subtotal</span><span>${fmt(sub)}</span></div><div class="drawer-progress"><div class="progress-track"><span class="${pct>=100?'is-full':''}" data-progress="${pct}"></span></div><small>${rem?fmt(rem)+' more for FREE prepaid delivery':'🎉 FREE prepaid delivery unlocked'}</small></div><div class="drawer-actions"><a class="drawer-viewcart" href="/cart/" onclick="closeDrawer()">View Bag</a><a class="checkoutbtn" href="/checkout.html">Checkout →</a></div>`;
  animateProgressIn($('#dfoot'),'drawer',pct);
}
function chQty(id,d){CART[id]=(CART[id]||0)+d;if(CART[id]<=0)delete CART[id];saveCart();}

function animateProgressIn(scope,key,pct){
  const bar=scope?.querySelector('.progress-track span[data-progress]');
  if(!bar) return;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prev=Math.max(0,Math.min(100,Number(PROGRESS_STATE[key])||0));
  const next=Math.max(0,Math.min(100,Number(pct)||0));
  bar.style.width=(reduce?next:prev)+'%';
  if(!reduce) requestAnimationFrame(()=>requestAnimationFrame(()=>{bar.style.width=next+'%';}));
  PROGRESS_STATE[key]=next;
}

/* ---------- Chaska Help (FAQ + product finder) ---------- */
function fallbackDeliveryEstimate(){return String(STORE_CONFIG?.settings?.delivery_estimate||'4-7 days').replace(/^"|"$/g,'');}
function fallbackDeliveryCopy(){const cod=settingNum('cod_delivery_fee_pkr',300),pre=settingNum('prepaid_delivery_fee_pkr',300),thr=settingNum('prepaid_free_delivery_threshold_pkr',5000);return `COD par ${fmt(cod)} delivery fee hai. JazzCash ya Bank Transfer prepaid order ${fmt(thr)}+ ho to delivery FREE hai — is se kam par ${fmt(pre)}.`;}
function fallbackJazzCopy(){const thr=settingNum('prepaid_free_delivery_threshold_pkr',5000);return `Checkout par JazzCash select karein, screen par dikhaye gaye official payment details par exact total bhejein, phir transaction/reference number enter karein. ${fmt(thr)}+ prepaid order par delivery FREE hai. ✅`;}
const AI_QA=[
 {q:'Delivery kitne din mein hogi?',k:['deliver','din','kitne','time','pohnch','kab'],a:()=>`Pakistan-wide estimated delivery ${fallbackDeliveryEstimate()} hai. 🚚 Order ke waqt available estimate bhi dikhaya jata hai.`},
 {q:'Delivery charges kya hain?',k:['charge','fee','delivery charges','kitna'],a:()=>fallbackDeliveryCopy()},
 {q:'Payment kaise karun?',k:['payment','pay','pese','paise','jazzcash','easypaisa','cod'],a:'Available options checkout par live settings ke mutabiq dikhte hain: Cash on Delivery aur enabled prepaid methods. Prepaid payment checkout total ke mutabiq karein aur transaction/reference number submit karein.'},
 {q:'JazzCash par paise kaise bhejun?',k:['jazzcash','till','qr','advance','bhejun','send'],a:()=>fallbackJazzCopy()},
 {q:'Order kaise track karun?',k:['track','status','order number','kahan'],a:'Order ke baad aapko order number milta hai (jaise CB-041026-00001). WhatsApp 0332-0005381 par order number bhej kar status pooch sakte hain.'},
 {q:'Order number kya hai?',k:['order number','number'],a:'Har order par ek unique number milta hai, jaise CB-041026-00001. Ye confirmation screen par aur email mein hota hai — isi se aapka order track hota hai.'},
 {q:'Kya products original hain?',k:['original','asli','fake','naqli','brand'],a:'Hum original sealed branded packs source karne ki koshish karte hain — Hilal, Kolson, Mayfair, Candyland waghera. Kisi specific pack ya authenticity concern par WhatsApp se verify kar sakte hain. ✅'},
 {q:'Return ya exchange policy?',k:['return','exchange','wapsi','damage','kharab','ghalat'],a:'Ghalat ya damage item mile to 48 ghante ke andar WhatsApp 0332-0005381 par rabta karein — tasveer bhej dein, hum foran hal nikalenge.'},
 {q:'Bulk ya bara order kar sakta hun?',k:['bulk','bara','wholesale','zyada','dokan','shop'],a:'Bulk order ke liye WhatsApp 0332-0005381 par quantity aur products bhej dein — ChaskaBox availability aur possible pricing confirm karega. 📦'},
 {q:'Kya recommend karoge?',k:['best','seller','mashhoor','popular','famous','recommend'],a:'Homepage par Chaska Picks aur current Deals dekhein — ya mujhe flavour/product ka naam likhein, main matching snacks dhoond deta hun. 🔥'},
 {q:'Naye products kab aate hain?',k:['naye','new','arrival','kab'],a:'Naye snacks waqtan-fa-waqtan add hote rehte hain. Page refresh kar ke "All Snacks" dekhein — ya WhatsApp par poochein! 🆕'},
 {q:'Address ghalat likh diya, kya karun?',k:['address','ghalat','pata','change','tabdeel'],a:'Fikar na karein! Foran WhatsApp 0332-0005381 par apna order number aur sahi address bhej dein — dispatch se pehle hum update kar denge.'},
 {q:'Gift ya tohfa bhejna hai?',k:['gift','tohfa','wrap','present'],a:'Chaska Boxes gifting ke liye easy option hain. Special packing request ho to order se pehle WhatsApp 0332-0005381 par confirm kar lein. 🎁'},
 {q:'Payment mein masla ho gaya?',k:['masla','problem','fail','error','payment mein'],a:'Payment mein masla ho to order submit na karein jab tak reference available na ho. COD choose kar sakte hain, ya WhatsApp 0332-0005381 par help lein.'}
];
function aiReply(text){
  const t=text.toLowerCase().trim();
  // Greetings & small talk
  const greetings=[
    {k:['salam','assalam','hello','hi ','hey','aoa'],a:'Walaikum Assalam! 😊 Main Chaska Help hun. Kya dhoond rahe hain? Product ka naam likhein ya category batayein!'},
    {k:['kia hal','kya hal','hal hai','how are you','kesay ho','kese ho'],a:'Main bilkul theek hun, shukriya poochne ka! 😊 Aap sunayein? Koi snack chahiye to naam likhein — main dhoond dunga!'},
    {k:['shukriya','thanks','thank you','meherbani'],a:'Khush amdeed! 😊 Aur kuch chahiye to batayein!'},
    {k:['allah hafiz','bye','khuda hafiz','alvida'],a:'Allah Hafiz! 👋 Phir zaroor aayiyega!'},
    {k:['tum kaun','who are you','ap kaun','your name'],a:'Main ChaskaBox ka shopping helper hun! 💬 Products dhoondne mein madad karta hun. Kya chahiye?'},
    {k:['mazak','joke','funny'],a:'Ek snack ne dusre se kaha: "Tum to bohat namkeen ho!" 😄'},
  ];
  for(const g of greetings){
    if(g.k.some(k=>t.includes(k))) return {text:g.a};
  }
  // Product search: if query looks like a product search, show matching products
  const prod=searchProductsAI(t);
  if(prod.length) return {products:prod};
  let best=null,bestScore=0;
  AI_QA.forEach(x=>{
    let s=0;
    x.k.forEach(k=>{ if(t.includes(k)) s+=k.length; });
    if(s>bestScore){bestScore=s;best=x;}
  });
  return best?{text:(typeof best.a==='function'?best.a():best.a)}:{text:'Hmm, ye sawal samajh nahi aaya. 🤔 Product ka naam likhein (jaise "chocolate") ya WhatsApp 0332-0005381 par poochein!'};
}
function searchProductsAI(q){
  // Skip if it's clearly a FAQ question
  const faqWords=['delivery','payment','return','refund','address','order','track','cash','jazzcash','bank','transfer','cod','whatsapp','gift','discount','offer','sale'];
  if(faqWords.some(w=>q.includes(w))) return [];
  // Search products by name/category
  const words=q.split(/\s+/).filter(w=>w.length>2);
  if(!words.length) return [];
  const res=PRODUCTS.filter(p=>{
    const hay=(p.name+' '+(p.category||'')+' '+(p.brand||'')).toLowerCase();
    return words.some(w=>hay.includes(w));
  }).slice(0,5);
  return res;
}
function aiProductCards(prods){
  return '<div class="aiprods">'+prods.map(p=>`
    <div class="aiprod">
      <img src="${esc(assetUrl(p.img||'images/placeholder.png'))}" alt="${esc(p.name)}" loading="lazy">
      <div class="aipname">${esc(p.name)}</div>
      <div class="aipprice">Rs. ${p.price}</div>
      <button class="aipadd" onclick="addToCart(${p.id})">Add +</button>
    </div>`).join('')+'</div>';
}
let helpReturnFocus=null;
function toggleAI(open){
  const m=$('#aimodal');
  const willOpen=open===undefined?!m.classList.contains('open'):!!open;
  if(willOpen) helpReturnFocus=document.activeElement;
  m.classList.toggle('open',willOpen);
  m.setAttribute('aria-hidden',willOpen?'false':'true');
  document.getElementById('helpFab')?.setAttribute('aria-expanded',willOpen?'true':'false');
  if(willOpen){ renderAIQA(); setTimeout(()=>document.getElementById('aiq')?.focus(),0); }
  else if(helpReturnFocus&&typeof helpReturnFocus.focus==='function'){setTimeout(()=>helpReturnFocus.focus(),0);}
}
function renderAIQA(){
  const path=normalizePath(location.pathname);
  let intro='Salam! 👋 Main Chaska Help hun. Neeche sawal chunein ya apna sawal likhein:';
  let ids=[0,1,2,4,5,6];
  if(path==='/cart/'){intro='Bag mein help chahiye? Delivery, payment ya order ke bare mein poochein:';ids=[1,2,3,4,6];}
  else if(path.startsWith('/product/')){intro='Is snack ke bare mein help chahiye? Payment, delivery ya authenticity poochein:';ids=[0,1,5,6,8];}
  $('#aibody').innerHTML='<div class="amsg bot">'+esc(intro)+'</div>'+
    ids.filter(i=>AI_QA[i]).map(i=>`<button class="aq" onclick="askAI(${i})">${esc(AI_QA[i].q)}</button>`).join('');
}
function aiSay(user,bot){
  $('#aibody').innerHTML+=`<div class="amsg user">${esc(user)}</div><div class="amsg bot">${bot}</div>`;
  $('#aibody').scrollTop=$('#aibody').scrollHeight;
}
function askAI(i){
  const x=AI_QA[i];
  aiSay(x.q,esc(typeof x.a==='function'?x.a():x.a));
}
async function askAIFree(){
  const inp=$('#aiq'),v=(inp.value||'').trim();
  if(!v) return;
  inp.value=''; inp.disabled=true;
  const body=$('#aibody'), id='aiwait-'+Date.now();
  body.innerHTML+=`<div class="amsg user">${esc(v)}</div><div class="amsg bot" id="${id}">✦ Soch raha hun…</div>`; body.scrollTop=body.scrollHeight;
  const out=document.getElementById(id);
  try{
    const res=await fetch('/api/ai/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:v})});
    const data=await res.json().catch(()=>({})); if(!res.ok)throw new Error(data.error||'AI unavailable');
    const prods=(data.products||[]).map(serverProductToLocal);
    const answer=esc(data.answer||'').replace(/\n/g,'<br>');
    out.innerHTML=answer+(prods.length?'<br>'+aiProductCards(prods):'')+(data.track_url?`<br><a class="aq" href="${esc(data.track_url)}">Secure Track Order →</a>`:'');
  }catch{
    const r=aiReply(v);
    out.innerHTML=r.products&&r.products.length?'Ye rahe matching products! 👇<br>'+aiProductCards(r.products):esc(r.text||r);
  }finally{inp.disabled=false;inp.focus();body.scrollTop=body.scrollHeight;}
}

/* ---------- promo rotation ---------- */
function promoItems(){return ['Original sealed packs',`🚚 ${fallbackDeliveryEstimate()} nationwide delivery`,'💰 COD + prepaid options','🎁 Chaska Boxes for easy gifting'];}
let promoIdx=0;
function initPromo(){
  const el=document.getElementById('promoMsg');
  if(!el) return;
  setInterval(()=>{
    el.classList.add('fading');
    setTimeout(()=>{
      const promos=promoItems();promoIdx=(promoIdx+1)%promos.length;
      el.textContent=promos[promoIdx];
      el.classList.remove('fading');
    },350);
  },7000);
}

/* ---------- packing video (Market Fresh section) ----------
   Rameez: apni packing video ka path/link yahan dalo.
   - MP4 file:   'videos/packing.mp4'            (file repo ke "videos" folder mein rakho)
   - YouTube:    'https://www.youtube.com/embed/VIDEO_ID'
   - Khaali '':  video section hidden rahega. */
const PACKING_VIDEO = '';
function renderPackingVideo(){
  const box=document.getElementById('packingVideoBox');
  if(!box) return;
  const v=(PACKING_VIDEO||'').trim();
  if(!v){ const wrap=box.closest('.freshvideo'); if(wrap) wrap.hidden=true; box.innerHTML=''; return; }
  const wrap=box.closest('.freshvideo'); if(wrap) wrap.hidden=false;
  if(/\.mp4(\?|$)/i.test(v)){
    box.innerHTML='<video class="fv-frame" controls preload="metadata" playsinline src="'+esc(v)+'">'
      +'Aapka browser video support nahi karta.</video>';
  }else if(/youtu(\.be|be\.com)/i.test(v)){
    let src=v;
    if(/watch\?v=/.test(v)) src=v.replace('watch?v=','embed/');
    if(/youtu\.be\//.test(v)) src=v.replace('youtu.be/','www.youtube.com/embed/');
    box.innerHTML='<iframe class="fv-frame" src="'+esc(src)+'" title="Packing video" frameborder="0" '
      +'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
  }else{
    // unknown format — treat as direct video file
    box.innerHTML='<video class="fv-frame" controls preload="metadata" playsinline src="'+esc(v)+'"></video>';
  }
}

/* ---------- animations: scroll reveals, hero tilt ---------- */
let revealObs=null;
function initReveals(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  revealObs=new IntersectionObserver(entries=>{
    entries.forEach(en=>{
      if(en.isIntersecting){
        en.target.classList.add('in');
        setTimeout(()=>{en.target.style.transitionDelay='';},700);
        revealObs.unobserve(en.target);
      }
    });
  },{threshold:.08,rootMargin:'0px 0px -30px 0px'});
}
function observeReveals(scope){
  if(!revealObs) return;
  (scope||document).querySelectorAll('.reveal:not(.in)').forEach(el=>revealObs.observe(el));
}
function initTilt(){
  if(!matchMedia('(pointer:fine)').matches) return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const hero=$('.hero'), col=$('#heroCollage');
  if(!hero||!col) return;
  let frame=0,last=null;
  hero.addEventListener('mousemove',e=>{
    last={x:e.clientX,y:e.clientY};
    if(frame) return;
    frame=requestAnimationFrame(()=>{
      frame=0; if(!last) return;
      const r=hero.getBoundingClientRect();
      const x=(last.x-r.left)/r.width-.5, y=(last.y-r.top)/r.height-.5;
      col.style.transform=`rotateY(${(x*3.2).toFixed(2)}deg) rotateX(${(-y*2.6).toFixed(2)}deg)`;
    });
  },{passive:true});
  hero.addEventListener('mouseleave',()=>{last=null;if(frame){cancelAnimationFrame(frame);frame=0;}col.style.transform='';});
}
function initCardTilt(){
  if(!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let frame=0,pending=null;
  document.addEventListener('pointermove',e=>{
    const card=e.target.closest?.('.card'); if(!card) return;
    if(card.classList.contains('reveal')&&!card.classList.contains('in')) return;
    pending={card,x:e.clientX,y:e.clientY};
    if(frame) return;
    frame=requestAnimationFrame(()=>{
      frame=0; if(!pending) return;
      const {card,x,y}=pending; pending=null;
      if(!document.body.contains(card)) return;
      card.classList.add('motion-tilt');
      const r=card.getBoundingClientRect();
      const px=Math.max(0,Math.min(1,(x-r.left)/r.width));
      const py=Math.max(0,Math.min(1,(y-r.top)/r.height));
      card.style.setProperty('--tilt-y',((px-.5)*5).toFixed(2)+'deg');
      card.style.setProperty('--tilt-x',((.5-py)*4).toFixed(2)+'deg');
      card.style.setProperty('--shine-x',(px*100).toFixed(1)+'%');
      card.style.setProperty('--shine-y',(py*100).toFixed(1)+'%');
    });
  },{passive:true});
  document.addEventListener('pointerout',e=>{
    const card=e.target.closest?.('.card'); if(!card) return;
    if(e.relatedTarget&&card.contains(e.relatedTarget)) return;
    card.style.setProperty('--tilt-x','0deg');
    card.style.setProperty('--tilt-y','0deg');
  });
}

/* ---------- mobile header fix ---------- */
function fixMobileHeader(){
  document.querySelectorAll('header .mnav-btn, header .search-btn, header .account-btn').forEach(btn=>{
    btn.style.removeProperty('display'); btn.style.removeProperty('visibility');
  });
}

/* ---------- global keyboard escape ---------- */
function getOpenDialog(){
  return document.querySelector('#aimodal.open,#pmodal.open,#acctmodal.open,#filterSheet.open,#drawer.open');
}
function trapDialogTab(event){
  const dialog=getOpenDialog(); if(!dialog||event.key!=='Tab')return;
  const nodes=[...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>el.offsetParent!==null);
  if(!nodes.length)return; const first=nodes[0],last=nodes[nodes.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}
document.addEventListener('keydown',event=>{
  trapDialogTab(event);
  if(event.key!=='Escape') return;
  // Cart drawer: check both class and aria-hidden for robustness
  const drawer = document.getElementById('drawer');
  if(drawer && (drawer.classList.contains('open') || drawer.getAttribute('aria-hidden')==='false')) { closeDrawer(); return; }
  else if(document.getElementById('filterSheet')?.classList.contains('open')) closeFilters();
  else if(document.getElementById('pmodal')?.classList.contains('open')) closeModal();
  else if(document.getElementById('aimodal')?.classList.contains('open')) toggleAI(false);
  else if(document.getElementById('acctmodal')?.classList.contains('open')&&typeof closeAuthModal==='function') closeAuthModal();
});

/* ---------- init ---------- */
document.addEventListener('DOMContentLoaded',async()=>{
  fixMobileHeader();
  loadCart(); await loadProducts(); updateBadge();
  initReveals(); initTilt(); initCardTilt(); initPromo(); renderPackingVideo();
  renderHeaderDropdowns();
  /* premium header: deeper shadow once scrolled */
  (function(){const h=document.querySelector('header');if(!h)return;
    const onS=()=>h.classList.toggle('scrolled',window.scrollY>60);
    window.addEventListener('scroll',onS,{passive:true});onS();})();
  try{ await loadStorefrontConfig(); }catch(e){}
  if(typeof initAccount==='function') try{ await initAccount(); }catch(e){ console.warn('account init', e); }
  migrateHashURL(); /* migrate old #/shop URLs to clean paths (replaceState) */
  route(); /* Phase 1: route from clean URL path */
  observeReveals();
});

/* ---------- mobile nav drawer ---------- */
function toggleMnav(force){
  const m=$('#mnav'); if(!m) return;
  const open=force!==undefined?force:!m.classList.contains('open');
  m.classList.toggle('open',open);
  $('#overlay').classList.toggle('open',open&&!$('#drawer').classList.contains('open'));
  if(open) renderMnav();
}
function closeMnav(){const m=$('#mnav');if(m)m.classList.remove('open');if(!$('#drawer').classList.contains('open'))$('#overlay').classList.remove('open');}
function renderMnav(){
  const cats={}; activeProducts().forEach(p=>{cats[p.category]=cats[p.category]||[];cats[p.category].push(p);});
  const order=['',...CAT_ORDER.filter(c=>cats[c]&&cats[c].length)];
  const catsHtml=order.map(c=>`<a href="${c===''?'/shop/':categoryPath(c)}">${c===''?'🛍️ All Snacks':esc(c)}</a>`).join('');
  $('#mnavList').innerHTML=catsHtml+`
    <div style="border-top:1px solid var(--border);margin:8px 0"></div>
    <a href="/bundles/">📦 Chaska Boxes</a>
    <a href="/shop/" onclick="goBadge('Sale');return false">🔥 Deals</a>
    <div style="border-top:1px solid var(--border);margin:8px 0"></div>
    <a href="/account/" onclick="closeMnav()">👤 My Account</a>`;
}
