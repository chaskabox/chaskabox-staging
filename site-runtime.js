/* Public storefront runtime settings bridge. Common owner-editable contact/copy
 * values come from site_settings so normal operational changes need no code edit. */
(() => {
  'use strict';
  const DEFAULT_PHONE='0332-0005381', DEFAULT_EMAIL='Chaskabox.mzg@gmail.com';
  const DEFAULT_ADDRESS='Near Ahmad Drink Corner, Railway Road, Bhatti Hussainabad, Muzaffargarh, Pakistan';
  const money=n=>`Rs. ${Number(n||0).toLocaleString('en-PK')}`;
  const phoneDigits=v=>{let d=String(v||'').replace(/\D/g,'');if(d.startsWith('0')&&d.length===11)d='92'+d.slice(1);return d;};
  function replaceText(oldValue,newValue){
    if(!oldValue||!newValue||oldValue===newValue||!document.body)return;
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode(n){const p=n.parentElement;if(!p||['SCRIPT','STYLE','NOSCRIPT'].includes(p.tagName))return NodeFilter.FILTER_REJECT;return n.nodeValue.includes(oldValue)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
    const nodes=[];while(w.nextNode())nodes.push(w.currentNode);nodes.forEach(n=>{n.nodeValue=n.nodeValue.split(oldValue).join(newValue)});
  }
  function replaceCommerceText(s){
    const cod=Number(s.cod_delivery_fee_pkr??300), pre=Number(s.prepaid_delivery_fee_pkr??300), threshold=Number(s.prepaid_free_delivery_threshold_pkr??5000), estimate=String(s.delivery_estimate||'4-7 days');
    const pairs=[
      ['COD: Rs. 300 delivery',`COD: ${money(cod)} delivery`],
      ['COD delivery charge Rs. 300',`COD delivery charge ${money(cod)}`],
      ['current delivery charge Rs. 300',`current delivery charge ${money(cod)}`],
      ['Rs. 5,000+: FREE delivery',`${money(threshold)}+: FREE delivery`],
      ['Prepaid Rs. 5,000+',`Prepaid ${money(threshold)}+`],
      ['orders of Rs. 5,000 or more',`orders of ${money(threshold)} or more`],
      ['below that threshold the current delivery charge is Rs. 300',`below that threshold the current prepaid delivery charge is ${money(pre)}`],
      ['4–7 days',estimate.replace('-', '–')],
      ['4-7 days',estimate],
    ];
    pairs.forEach(([a,b])=>replaceText(a,b));
    document.querySelectorAll('[data-dynamic-delivery]').forEach(el=>el.textContent=money(cod));
    document.querySelectorAll('[data-dynamic-threshold]').forEach(el=>el.textContent=money(threshold));
    document.querySelectorAll('[data-delivery-estimate]').forEach(el=>el.textContent=estimate);
  }
  async function run(){
    try{
      const r=await fetch('/api/storefront-config',{cache:'no-cache'});if(!r.ok)return;const d=await r.json();const s=d?.settings||{};
      const phone=String(s.support_whatsapp||DEFAULT_PHONE).trim(), email=String(s.support_email||DEFAULT_EMAIL).trim(), address=String(s.store_address||DEFAULT_ADDRESS).trim(), promo=String(s.promo_text||'').trim();
      if(promo)document.querySelectorAll('.promo').forEach(el=>el.textContent=promo);
      replaceText(DEFAULT_PHONE,phone);replaceText(DEFAULT_EMAIL,email);replaceText(DEFAULT_ADDRESS,address);replaceCommerceText(s);
      document.querySelectorAll('a[href^="mailto:"]').forEach(a=>{if(/chaskabox\.mzg@gmail\.com/i.test(a.getAttribute('href')||''))a.href='mailto:'+email});
      document.querySelectorAll('a[href*="wa.me/923320005381"]').forEach(a=>a.href='https://wa.me/'+phoneDigits(phone));
    }catch(e){console.warn('[site-runtime] settings unavailable');}
  }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',run):run();
})();
