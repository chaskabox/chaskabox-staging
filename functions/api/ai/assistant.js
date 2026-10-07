/* POST /api/ai/assistant
 * Customer shopping/FAQ assistant. Uses only public catalogue/settings context.
 * Sensitive-looking identifiers are NOT sent to the model; order status is
 * handled by the dedicated secure Track Order flow instead.
 */
import { sbRequest, rpc } from '../_lib/db.js';
import { takeToken, getClientIp } from '../_lib/rate-limit.js';
import { runEmbeddings, runTextAI, vectorLiteral, aiAvailable } from '../_lib/ai.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

function clean(value) { return String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280); }
function looksSensitive(q) {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(q)
    || /\bCB[-\s]?\d{4,}[A-Z0-9-]*\b/i.test(q)
    || /(?:\+?92|0)3\d{2}[\s-]?\d{7}\b/.test(q)
    || /\b\d{6,}\b/.test(q)
    || /\b(?:otp|password|passcode|pin|cvv|cvc|cnic|iban|account\s*(?:number|no)|transaction\s*(?:reference|ref)|reference\s*(?:number|no)|card\s*(?:number|no))\b/i.test(q);
}
function priceBounds(query) {
  const q = query.toLowerCase().replace(/,/g, ''); let max=null,min=null;
  let m=q.match(/(?:under|below|less than|kam|andar|budget(?:\s+of)?|max(?:imum)?)\s*(?:rs\.?|pkr)?\s*(\d{2,6})/i); if(m)max=Number(m[1]);
  if(max==null){m=q.match(/(?:rs\.?|pkr)?\s*(\d{2,6})\s*(?:se\s+kam|ke\s+andar|tak\b)/i);if(m)max=Number(m[1]);}
  m=q.match(/(?:above|over|more than|upar|zyada|min(?:imum)?)\s*(?:rs\.?|pkr)?\s*(\d{2,6})/i); if(m)min=Number(m[1]);
  if(min==null){m=q.match(/(?:rs\.?|pkr)?\s*(\d{2,6})\s*(?:se\s+zyada|se\s+upar)/i);if(m)min=Number(m[1]);}
  return {min,max};
}
function filterPrice(rows,b){return (rows||[]).filter(p=>(b.max==null||Number(p.price)<=b.max)&&(b.min==null||Number(p.price)>=b.min));}
function tokens(q){const stop=new Set(['the','and','for','with','mujhe','chahiye','koi','kuch','hai','hain','wala','wali','ka','ki','ke','snack','snacks']);return q.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2&&!stop.has(x)).slice(0,12);}
function lexical(rows,q){const ws=tokens(q),b=priceBounds(q);return filterPrice((rows||[]).map(p=>{const hay={n:String(p.name||'').toLowerCase(),c:String(p.category||'').toLowerCase(),b:String(p.brand||'').toLowerCase(),d:String(p.description||'').toLowerCase()};let s=0;for(const w of ws){if(hay.n.includes(w))s+=8;if(hay.c.includes(w))s+=5;if(hay.b.includes(w))s+=4;if(hay.d.includes(w))s+=1;}return {...p,_s:s};}).filter(p=>!ws.length||p._s>0).sort((a,b)=>b._s-a._s).slice(0,8),b).map(({_s,...p})=>p);}
async function settings(env){try{const rows=await sbRequest(env,'/public_site_settings',{query:'?select=key,value'});return Object.fromEntries((rows||[]).map(r=>[r.key,r.value]));}catch{return {};}}
async function allProducts(env){return await sbRequest(env,'/public_products',{query:'?select=id,slug,name,brand,category,pack,price,old_price,description,badge,image_url,is_bundle&limit=400'});}
async function candidates(context,q,products){
  if(!aiAvailable(context))return lexical(products,q);
  try{const {embeddings}=await runEmbeddings(context,[q]);let rows=await rpc(context.env,'match_public_products',{p_query_embedding:vectorLiteral(embeddings[0]),p_match_count:12,p_match_threshold:0.14});rows=filterPrice(rows,priceBounds(q)).slice(0,8);return rows.length?rows:lexical(products,q);}catch{return lexical(products,q);}
}
function productContext(rows){return (rows||[]).map(p=>({id:p.id,name:p.name,brand:p.brand||null,category:p.category||null,pack:p.pack||null,price:Number(p.price),description:String(p.description||'').slice(0,260)}));}

export async function onRequestPost(context){
  try{
    const {request,env}=context, ip=getClientIp(request);
    const rl=await takeToken(`ai-assistant:${ip}`,env,{capacity:6,perMinute:4});
    if(!rl.allowed)return json({error:'Chaska Help limit reached. Please try again shortly.',code:'rate_limited'},429,{'Retry-After':String(rl.retryAfterSec)});
    let body={};try{body=await request.json();}catch{return json({error:'Invalid JSON',code:'invalid_json'},400);}
    const question=clean(body.question);if(question.length<2)return json({error:'Question is too short',code:'invalid_question'},400);
    if(looksSensitive(question))return json({mode:'safe_redirect',answer:'Order number, phone, email ya transaction/reference details AI chat mein share na karein. Apna order dekhne ke liye secure Track Order page use karein.',products:[],track_url:'/track-order.html'});

    const cfg=await settings(env);
    if(cfg.ai_customer_assistant_enabled===false)return json({mode:'disabled',answer:'Chaska Help AI filhaal off hai. Search ya WhatsApp support use karein.',products:[]});
    const products=await allProducts(env), found=await candidates(context,question,products);
    if(!aiAvailable(context))return json({mode:'deterministic_fallback',answer:found.length?'Aapke sawal ke mutabiq ye products relevant lagte hain.':'Exact match nahi mila. Search mein product/category ka naam try karein.',products:found});

    const publicRules={
      delivery_estimate:cfg.delivery_estimate??'4-7 days',
      cod_enabled:cfg.cod_enabled!==false,
      cod_delivery_fee_pkr:Number(cfg.cod_delivery_fee_pkr??300),
      jazzcash_enabled:cfg.jazzcash_enabled!==false,
      bank_transfer_enabled:cfg.bank_transfer_enabled!==false,
      prepaid_delivery_fee_pkr:Number(cfg.prepaid_delivery_fee_pkr??300),
      prepaid_free_delivery_threshold_pkr:Number(cfg.prepaid_free_delivery_threshold_pkr??5000),
    };
    const system=[
      'You are Chaska Help, a concise shopping and FAQ assistant for ChaskaBox, a Pakistani snacks store.',
      'Answer in friendly Roman Urdu with simple English where useful. Keep answers under 90 words unless necessary.',
      'Use ONLY the supplied public store rules and product candidates. Never invent ingredients, allergens, authenticity guarantees, stock, discounts, delivery promises, bestseller claims, or payment status.',
      'If the user asks about an order/account/payment verification, tell them to use Track Order or official support; never guess private order data.',
      'Do not ask for phone, email, order number, address, transaction reference, card/bank credentials, password, OTP, or other sensitive data.',
      'When relevant, mention up to 3 candidate product names and why they fit. Prices must match the supplied candidate data.',
      'If no supplied fact answers the question, say you do not have that confirmed information.',
    ].join('\n');
    const user=`Question: ${question}\nPublic store rules: ${JSON.stringify(publicRules)}\nRelevant product candidates: ${JSON.stringify(productContext(found.slice(0,6)))}`;
    try{
      const out=await runTextAI(context,{system,user,maxTokens:320,temperature:0.25});
      return json({mode:'workers_ai',answer:out.text,model:out.model,products:found.slice(0,5)});
    }catch(error){
      console.warn('[ai-assistant] generation unavailable',error?.message||error);
      return json({mode:'deterministic_fallback',answer:found.length?'AI response filhaal available nahi, lekin ye matching products milay hain.':'AI response filhaal available nahi. Search ya WhatsApp support use karein.',products:found.slice(0,5)});
    }
  }catch(error){console.error('[ai-assistant] failed',error?.message||error);return json({error:'Chaska Help is temporarily unavailable',code:'assistant_unavailable'},503);}
}
