(() => {
  'use strict';
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const money = n => `Rs. ${Number(n||0).toLocaleString('en-PK')}`;
  const escapeHtml = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const state = { products: [], categories: [], visibleLimit: 40, selected: new Set(), box: new Map(), editorId: null, drafts: loadDrafts() };

  function loadDrafts(){ try{return JSON.parse(localStorage.getItem('cb_admin_review_drafts')||'{"products":{},"hidden":[],"archived":[],"boxes":[]}')}catch{return {products:{},hidden:[],archived:[],boxes:[]}} }
  function saveDrafts(){ localStorage.setItem('cb_admin_review_drafts', JSON.stringify(state.drafts)); }
  function mergedProduct(p){ return {...p, ...(state.drafts.products?.[p.id]||{})}; }
  function isHidden(id){ return (state.drafts.hidden||[]).includes(Number(id)); }
  function isArchived(id){ return (state.drafts.archived||[]).includes(Number(id)); }
  function toast(msg){ const el=$('#adminToast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),2200); }
  function setArrayMembership(key,id,on){ id=Number(id); const set=new Set(state.drafts[key]||[]); on?set.add(id):set.delete(id); state.drafts[key]=[...set]; saveDrafts(); }

  async function init(){
    bindNavigation(); bindGeneral(); bindProductControls(); bindBoxBuilder(); bindPreview(); bindCopilot(); bindEditor();
    try{
      const res=await fetch('/products.json',{cache:'no-store'}); if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data=await res.json(); state.products=Array.isArray(data)?data:[];
      // Rehydrate locally-created review drafts without touching the real catalogue.
      Object.values(state.drafts.products||{}).filter(p=>p&&p._new).forEach(p=>{ if(!state.products.some(x=>Number(x.id)===Number(p.id))) state.products.push(p); });
      state.categories=[...new Set(state.products.map(p=>p.category).filter(Boolean))].sort();
      hydrateSelectors(); renderDashboard(); renderProducts(); renderBoxProducts();
    }catch(err){
      $('#metricProducts').textContent='!'; $('#productAdminGrid').innerHTML=`<div class="panel"><b>Could not load products.json</b><p class="muted">${escapeHtml(err.message)}</p></div>`;
    }
  }

  function bindNavigation(){
    $$('.admin-nav-btn').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
    $$('[data-jump]').forEach(el=>el.addEventListener('click',()=>{showView(el.dataset.jump); if(el.dataset.action==='add-product') openEditor(null);}));
    $('#sidebarToggle')?.addEventListener('click',()=>$('#adminSidebar').classList.toggle('open'));
  }
  function showView(name){
    $$('.admin-view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
    $$('.admin-nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
    const view=$(`#view-${name}`); if(view){$('#viewTitle').textContent=view.dataset.title||name;$('#viewSubtitle').textContent=view.dataset.subtitle||'';}
    $('#adminSidebar').classList.remove('open'); window.scrollTo({top:0,behavior:'smooth'});
    if(name==='preview') refreshPreview();
  }

  function bindGeneral(){
    $('#globalPreviewBtn')?.addEventListener('click',()=>showView('preview'));
    $('#quickAddProductBtn')?.addEventListener('click',()=>openEditor(null));
    $('#addProductBtn')?.addEventListener('click',()=>openEditor(null));
    document.addEventListener('keydown',e=>{if(e.key==='Escape' && $('#productEditor').classList.contains('open')) closeEditor();});
  }

  function hydrateSelectors(){
    const cat=$('#productCategory'); const edit=$('#editCategory');
    state.categories.forEach(c=>{cat?.insertAdjacentHTML('beforeend',`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`); edit?.insertAdjacentHTML('beforeend',`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`);});
    const route=$('#previewRoute');
    if(route){
      const cg=document.createElement('optgroup'); cg.label='Categories'; state.categories.forEach(c=>{const o=document.createElement('option');o.value='/category/'+slugify(c)+'/';o.textContent=c;cg.appendChild(o)}); route.appendChild(cg);
      const pg=document.createElement('optgroup');pg.label='Sample products';state.products.filter(p=>Number(p.id)>0).slice(0,12).forEach(p=>{const o=document.createElement('option');o.value='/product/'+p.id+'/';o.textContent=p.name;pg.appendChild(o)});route.appendChild(pg);
    }
    $('#productNavCount').textContent=state.products.filter(p=>!isArchived(p.id)).length;
  }

  function renderDashboard(){
    const products=state.products.filter(p=>!isArchived(p.id));
    const bundles=products.filter(p=>p.bundle).length;
    $('#metricProducts').textContent=products.length; $('#metricBundles').textContent=bundles; $('#metricOrders').textContent='—'; $('#metricRevenue').textContent='—';
    const counts={}; products.forEach(p=>counts[p.category]=(counts[p.category]||0)+1); const max=Math.max(1,...Object.values(counts));
    $('#categoryBars').innerHTML=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([cat,count])=>`<div class="catbar"><span>${escapeHtml(cat)}</span><div class="catbar-track"><div class="catbar-fill" style="width:${Math.round(count/max*100)}%"></div></div><b>${count}</b></div>`).join('');
  }

  function slugify(s){return String(s||'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
  function filteredProducts(){
    const q=($('#productSearch')?.value||'').trim().toLowerCase(); const cat=$('#productCategory')?.value||''; const vis=$('#productVisibility')?.value||'';
    return state.products.map(mergedProduct).filter(p=>{
      const archived=isArchived(p.id);
      if(vis==='archived') return archived && (!q || `${p.name} ${p.category} ${p.pack||''}`.toLowerCase().includes(q)) && (!cat || p.category===cat);
      if(archived) return false;
      if(q && !`${p.name} ${p.category} ${p.pack||''}`.toLowerCase().includes(q)) return false;
      if(cat && p.category!==cat) return false;
      if(vis==='visible' && isHidden(p.id)) return false;
      if(vis==='hidden' && !isHidden(p.id)) return false;
      if(vis==='bundle' && !p.bundle) return false;
      return true;
    });
  }
  function renderProducts(){
    const all=filteredProducts(); const shown=all.slice(0,state.visibleLimit);
    $('#productAdminGrid').innerHTML=shown.map(p=>productAdminCard(p)).join('') || '<div class="panel"><p class="muted">No matching products.</p></div>';
    $('#productResultCount').textContent=`Showing ${shown.length} of ${all.length} products`;
    $('#loadMoreProducts').style.display=shown.length<all.length?'inline-flex':'none';
    updateBulkbar();
  }
  function productAdminCard(p){
    const hidden=isHidden(p.id); const img=p.img?`/${String(p.img).replace(/^\//,'')}`:'';
    return `<article class="admin-product-card ${state.selected.has(p.id)?'selected':''}" data-product-id="${p.id}">
      <input class="product-select" type="checkbox" aria-label="Select ${escapeHtml(p.name)}" ${state.selected.has(p.id)?'checked':''}>
      <span class="visibility-chip ${hidden?'hidden-product':''}">${hidden?'Hidden':'Visible'}</span>
      <div class="admin-product-image">${img?`<img src="${escapeHtml(img)}" alt="">`:'<span class="placeholder">🍿</span>'}</div>
      <div class="admin-product-body"><h3>${escapeHtml(p.name)}</h3><div class="admin-product-meta">${escapeHtml(p.category)} · ${escapeHtml(p.pack||'')}</div><div class="admin-product-price"><strong>${money(p.price)}</strong>${p.oldPrice?`<del>${money(p.oldPrice)}</del>`:''}</div>
      <div class="admin-card-actions">${isArchived(p.id)?`<button data-restore="${p.id}">Restore</button><button disabled>Archived</button>`:`<button data-edit="${p.id}">Edit</button><button data-toggle-vis="${p.id}">${hidden?'Show':'Hide'}</button>`}</div></div></article>`;
  }
  function bindProductControls(){
    ['productSearch','productCategory','productVisibility'].forEach(id=>$('#'+id)?.addEventListener(id==='productSearch'?'input':'change',()=>{state.visibleLimit=40;renderProducts();}));
    $('#loadMoreProducts')?.addEventListener('click',()=>{state.visibleLimit+=40;renderProducts();});
    $('#productAdminGrid')?.addEventListener('click',e=>{
      const card=e.target.closest('[data-product-id]'); if(!card)return; const id=Number(card.dataset.productId);
      if(e.target.classList.contains('product-select')){e.target.checked?state.selected.add(id):state.selected.delete(id);renderProducts();return;}
      const edit=e.target.closest('[data-edit]'); if(edit){openEditor(Number(edit.dataset.edit));return;}
      const restore=e.target.closest('[data-restore]'); if(restore){setArrayMembership('archived',Number(restore.dataset.restore),false);toast('Product restored in review draft');renderProducts();renderDashboard();return;}
      const vis=e.target.closest('[data-toggle-vis]'); if(vis){setArrayMembership('hidden',id,!isHidden(id));toast(isHidden(id)?'Product hidden in review draft':'Product visible in review draft');renderProducts();}
    });
    $('#bulkBar')?.addEventListener('click',e=>{const a=e.target.closest('[data-bulk]')?.dataset.bulk;if(!a)return;if(a==='clear'){state.selected.clear();renderProducts();return;}[...state.selected].forEach(id=>{if(a==='hide')setArrayMembership('hidden',id,true);if(a==='show')setArrayMembership('hidden',id,false);if(a==='archive')setArrayMembership('archived',id,true);});state.selected.clear();renderProducts();renderDashboard();toast(`Bulk ${a} applied to review draft`);});
  }
  function updateBulkbar(){ const n=state.selected.size; $('#bulkBar').classList.toggle('hidden',!n); $('#bulkCount').textContent=`${n} selected`; }

  function openEditor(id){
    state.editorId=id; const p=id?mergedProduct(state.products.find(x=>Number(x.id)===Number(id))): {id:'',name:'',price:'',oldPrice:'',category:state.categories[0]||'',pack:'',desc:'',badge:'',img:'',bundle:false};
    $('#productEditorMode').textContent=id?'EDIT PRODUCT':'NEW PRODUCT'; $('#productEditorTitle').textContent=id?`Edit ${p.name}`:'Add product';
    $('#editProductId').value=id||''; $('#editName').value=p.name||''; $('#editPrice').value=p.price||''; $('#editOldPrice').value=p.oldPrice||''; $('#editCategory').value=p.category||''; $('#editPack').value=p.pack||''; $('#editBadge').value=p.badge||''; $('#editVisibility').value=id&&isHidden(id)?'hidden':'visible'; $('#editDescription').value=p.desc||''; $('#editImage').value=p.img||''; $('#editBundle').checked=!!p.bundle; $('#archiveProduct').style.display=id?'inline-flex':'none';
    renderEditorPreview(); $('#productEditor').classList.add('open'); $('#productEditor').setAttribute('aria-hidden','false'); setTimeout(()=>$('#editName').focus(),50);
  }
  function closeEditor(){ $('#productEditor').classList.remove('open'); $('#productEditor').setAttribute('aria-hidden','true'); }
  function bindEditor(){
    $$('[data-close-modal]').forEach(x=>x.addEventListener('click',closeEditor));
    $('#productForm')?.addEventListener('input',renderEditorPreview); $('#productForm')?.addEventListener('change',renderEditorPreview);
    $('#productForm')?.addEventListener('submit',e=>{e.preventDefault(); saveProductDraft();});
    $('#archiveProduct')?.addEventListener('click',()=>{if(!state.editorId)return;if(!confirm('Archive this product in the review draft? It will be restorable in the final admin system.'))return;setArrayMembership('archived',state.editorId,true);closeEditor();renderProducts();renderDashboard();toast('Product archived in review draft');});
    $('#aiImproveProduct')?.addEventListener('click',()=>{const name=$('#editName').value.trim();showView('assistant');$('#aiPrompt').value=`Improve this ChaskaBox product listing without making unverified claims. Product: ${name}. Category: ${$('#editCategory').value}. Pack: ${$('#editPack').value}. Current description: ${$('#editDescription').value}`;closeEditor();});
  }
  function editorData(){ return {name:$('#editName').value.trim(),price:Number($('#editPrice').value||0),oldPrice:$('#editOldPrice').value?Number($('#editOldPrice').value):null,category:$('#editCategory').value,pack:$('#editPack').value.trim(),badge:$('#editBadge').value,desc:$('#editDescription').value.trim(),img:$('#editImage').value.trim(),bundle:$('#editBundle').checked}; }
  function renderEditorPreview(){ const p=editorData(); const img=p.img?`/${String(p.img).replace(/^\//,'')}`:''; $('#productPreviewCard').innerHTML=`<div class="preview-product-card"><div class="img">${img?`<img src="${escapeHtml(img)}" alt="">`:'<span style="font-size:44px">🍿</span>'}</div><div class="body"><small>${escapeHtml(p.category||'Category')} · ${escapeHtml(p.pack||'Pack')}</small><h3>${escapeHtml(p.name||'Product name')}</h3><strong>${money(p.price)}</strong><button class="btn primary" type="button" disabled>Add to Bag</button></div></div>`; }
  function saveProductDraft(){ const p=editorData(); if(!p.name || p.price<0){toast('Name and valid price are required');return;} if(state.editorId){const id=Number(state.editorId);const existing=state.products.find(x=>Number(x.id)===id);const saved={...p,id,_new:!!existing?!!existing._new:id<0};state.drafts.products[id]=saved;if(existing)Object.assign(existing,saved);setArrayMembership('hidden',id,$('#editVisibility').value==='hidden');saveDrafts();toast('Product draft saved locally');} else {const tempId=-Date.now();const np={...p,id:tempId,_new:true};state.drafts.products[tempId]=np;state.products.unshift(np);if($('#editVisibility').value==='hidden')setArrayMembership('hidden',tempId,true);saveDrafts();toast('New product draft saved locally. Secure backend required to publish.');}closeEditor();renderProducts();renderDashboard(); }

  function bindBoxBuilder(){
    $('#boxProductSearch')?.addEventListener('input',renderBoxProducts); $('#boxProductList')?.addEventListener('click',e=>{const b=e.target.closest('[data-add-box]');if(!b)return;const id=Number(b.dataset.addBox);state.box.set(id,(state.box.get(id)||0)+1);renderBoxSummary();});
    $('#boxSelectedItems')?.addEventListener('click',e=>{const b=e.target.closest('[data-box-action]');if(!b)return;const id=Number(b.dataset.id), a=b.dataset.boxAction, q=state.box.get(id)||0;if(a==='plus')state.box.set(id,q+1);if(a==='minus'){q<=1?state.box.delete(id):state.box.set(id,q-1);}if(a==='remove')state.box.delete(id);renderBoxSummary();});
    $('#boxPrice')?.addEventListener('input',renderBoxSummary); $('#previewBoxBtn')?.addEventListener('click',()=>{if(!state.box.size){toast('Choose products first');return;}toast('Box preview is reflected in the builder totals. Product-page preview will be wired to secure drafts.');});
    $('#saveBoxDraftBtn')?.addEventListener('click',()=>{if(!state.box.size||!$('#boxName').value.trim()){toast('Add products and a box name first');return;}const draft={id:`box-${Date.now()}`,name:$('#boxName').value.trim(),description:$('#boxDescription').value.trim(),price:Number($('#boxPrice').value||0),badge:$('#boxBadge').value,items:[...state.box].map(([id,qty])=>({id,qty}))};state.drafts.boxes=state.drafts.boxes||[];state.drafts.boxes.push(draft);saveDrafts();toast('Chaska Box draft saved locally');});
  }
  function renderBoxProducts(){ if(!state.products.length)return; const q=($('#boxProductSearch')?.value||'').toLowerCase(); const rows=state.products.map(mergedProduct).filter(p=>!isArchived(p.id)&&!p.bundle&&(!q||`${p.name} ${p.category}`.toLowerCase().includes(q))).slice(0,80); $('#boxProductList').innerHTML=rows.map(p=>{const img=p.img?`/${String(p.img).replace(/^\//,'')}`:'';return `<div class="box-product-row">${img?`<img src="${escapeHtml(img)}" alt="">`:'<div></div>'}<div><h4>${escapeHtml(p.name)}</h4><small>${money(p.price)} · ${escapeHtml(p.pack||'')}</small></div><button data-add-box="${p.id}" aria-label="Add ${escapeHtml(p.name)}">+</button></div>`}).join(''); }
  function renderBoxSummary(){ if(!state.box.size){$('#boxSelectedItems').innerHTML='<p class="muted">No products selected yet.</p>';$('#boxRetailValue').textContent=money(0);$('#boxCustomerPrice').textContent=money(Number($('#boxPrice').value||0));$('#boxSaving').textContent=money(0);return;}let retail=0;$('#boxSelectedItems').innerHTML=[...state.box].map(([id,qty])=>{const p=mergedProduct(state.products.find(x=>Number(x.id)===Number(id)));retail+=Number(p.price||0)*qty;return `<div class="builder-item"><span>${escapeHtml(p.name)}</span><div class="qty-controls"><button data-box-action="minus" data-id="${id}">−</button><b>${qty}</b><button data-box-action="plus" data-id="${id}">+</button></div><button class="text-btn" data-box-action="remove" data-id="${id}">Remove</button></div>`}).join('');const price=Number($('#boxPrice').value||0);$('#boxRetailValue').textContent=money(retail);$('#boxCustomerPrice').textContent=money(price);$('#boxSaving').textContent=price&&retail>price?money(retail-price):money(0); }

  function bindPreview(){
    $('#previewRoute')?.addEventListener('change',refreshPreview); $('#refreshPreview')?.addEventListener('click',refreshPreview); $$('.viewport-switch button').forEach(b=>b.addEventListener('click',()=>{$$('.viewport-switch button').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#previewFrameWrap').style.width=b.dataset.width;}));
  }
  function refreshPreview(){ const route=$('#previewRoute')?.value||'/'; const frame=$('#sitePreview'); if(frame)frame.src=route+(route.includes('?')?'&':'?')+'_adminpreview='+Date.now(); const link=$('#openPreviewNew'); if(link)link.href=route; }

  function bindCopilot(){
    $$('.ai-shortcuts button').forEach(b=>b.addEventListener('click',()=>{const templates={description:'Write a concise, appetizing ChaskaBox product description. Avoid unverifiable claims. Include pack size if known.',seo:'Create an SEO title and meta description for a ChaskaBox product without keyword stuffing.',bundle:'Suggest a memorable nostalgic Chaska Box name, included snacks, target customer, selling angle and description.',category:'Suggest the best existing category, optional badge and useful flavour tags for this product.',homepage:'Suggest which real catalogue products should be featured on the homepage and why. Do not call something a bestseller without sales data.',support:'Draft a concise, respectful customer-support reply using only confirmed store policy.'};$('#aiPrompt').value=templates[b.dataset.ai]||'';}));
    $('#runAiBtn')?.addEventListener('click',async()=>{const prompt=$('#aiPrompt').value.trim();if(!prompt){toast('Enter instructions first');return;}$('#aiOutput').innerHTML='<p class="muted">Secure AI endpoint is not connected in the review build. Muse should implement <code>POST /api/admin/ai</code> with server-side credentials, admin authorization and no auto-publishing.</p><hr><p><b>Your draft request:</b></p><p>'+escapeHtml(prompt)+'</p>';});
    $('#copyAiOutput')?.addEventListener('click',async()=>{const text=$('#aiOutput').innerText;try{await navigator.clipboard.writeText(text);toast('Draft copied');}catch{toast('Copy unavailable in this browser');}});
  }

  init();
})();
