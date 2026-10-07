/* ChaskaBox product-page runtime bridge.
 * Existing pre-rendered PDPs keep their SEO shell but refresh price/content from
 * the live public catalogue so Admin edits do not require regenerating files.
 */
(async function(){
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function fmt(n){return 'Rs. '+Number(n||0).toLocaleString('en-PK');}
  function imgSrc(src){const s=String(src||'');if(!s)return '';return /^(?:https?:|data:|blob:|\/)/i.test(s)?s:'/'+s.replace(/^\.\//,'');}
  async function getJson(url){const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
  try{
    const [cfg, liveProducts] = await Promise.all([
      getJson('/api/storefront-config').catch(()=>null),
      getJson('/api/products').catch(()=>null),
    ]);
    const st=cfg?.settings||{};
    const settingNumber=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
    const cod=settingNumber(st.cod_delivery_fee_pkr,300);
    const threshold=settingNumber(st.prepaid_free_delivery_threshold_pkr,5000);
    document.querySelectorAll('.pd-meta span').forEach(function(el){
      const t=el.textContent||'';
      if(/COD:/i.test(t)) el.textContent='🚚 COD: '+fmt(cod)+' delivery';
      if(/Prepaid/i.test(t) && /FREE/i.test(t)) el.textContent='⚡ Prepaid '+fmt(threshold)+'+: FREE delivery';
    });

    if(!Array.isArray(liveProducts) || typeof window.PID==='undefined') return;
    // Refresh global lookup so drawer/related cards use current prices too.
    if(typeof window.LOOKUP==='object' && window.LOOKUP){
      liveProducts.forEach(function(p){
        window.LOOKUP[String(p.id)]={name:p.name,price:Number(p.price),img:(p.img&&!/^https?:/i.test(String(p.img)))?String(p.img).replace(/^\//,''):null,cat:p.category||'',brand:p.brand||p.name||''};
      });
    }
    const p=liveProducts.find(x=>Number(x.id)===Number(window.PID));
    if(!p){
      // Successful live catalogue response + missing PID means hidden/archived/deleted.
      const detail=document.querySelector('.pdetail');
      if(detail) detail.innerHTML='<div class="section" style="text-align:center;padding:48px 20px"><span class="eyebrow">CURRENTLY UNAVAILABLE</span><h1>This snack is not available right now.</h1><p>Please browse the current ChaskaBox catalogue.</p><a class="cta" href="/shop/">Shop available snacks →</a></div>';
      const rel=document.querySelector('.rel-sec'); if(rel) rel.hidden=true;
      return;
    }

    const info=document.querySelector('.pd-info');
    if(info){
      const set=(sel,val)=>{const e=info.querySelector(sel);if(e)e.textContent=val||'';};
      set('.pcat',p.category); set('h1',p.name); set('.pd-brand',p.brand||'');
      set('.pd-price .price',fmt(p.price)); set('.ppack',p.pack||''); set('.pd-desc',p.desc||'');
      const btn=info.querySelector('.pdbtn'); if(btn)btn.textContent='Add to Bag · '+fmt(p.price);
      const imgBox=document.querySelector('.pd-img');
      if(imgBox){
        if(p.img){imgBox.innerHTML='<img src="'+esc(imgSrc(p.img))+'" alt="'+esc(p.name)+'">';}
        else{imgBox.innerHTML='<div class="noimg"><b>CHASKABOX</b><span>Photo<br>coming soon</span><small>'+esc(p.category||'')+'</small></div>';}
      }
    }
    const crumb=document.querySelector('.crumb span');if(crumb)crumb.textContent=p.name;
    document.title=p.name+' | ChaskaBox';
    const meta=document.querySelector('meta[name="description"]');if(meta&&p.desc)meta.setAttribute('content',String(p.desc).slice(0,155));
    if(typeof window.CUR_CAT!=='undefined')window.CUR_CAT=p.category||'';
    if(typeof window.CUR_BRAND!=='undefined')window.CUR_BRAND=p.brand||p.name||'';
    try{if(typeof window.renderRelated==='function')window.renderRelated();}catch{}
  }catch(e){console.warn('[product-runtime] live refresh unavailable',e?.message||e);}
})();
