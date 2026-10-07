/* POST /api/admin/ai-reindex
 * Generates/refreshes semantic-search embeddings using FREE Workers AI.
 * Safe to rerun. No customer/order data is sent to AI.
 */
import { withAdmin, json, httpError, readJson, audit, sb } from './_lib/auth.js';
import { runEmbeddings, vectorLiteral, aiAvailable, selectedEmbeddingModel } from '../_lib/ai.js';

function embeddingText(p){
  return [
    `Name: ${p.name||''}`,
    `Brand: ${p.brand||''}`,
    `Category: ${p.category||''}`,
    `Pack: ${p.pack||''}`,
    `Description: ${p.description||''}`,
    `Tags: ${Array.isArray(p.tags)?p.tags.join(', '):''}`,
  ].join('\n').slice(0,6000);
}

export const onRequestPost = withAdmin(['owner','manager','content'], async (context,{user,role})=>{
  if(!aiAvailable(context))httpError('Free Workers AI binding is not configured',503,'ai_not_configured');
  const body=await readJson(context.request,16*1024);
  const ids=Array.isArray(body.product_ids)?body.product_ids.map(Number).filter(x=>Number.isInteger(x)&&x>0).slice(0,50):[];
  const limit=Math.max(1,Math.min(50,Number(body.limit)||40));
  const filters=['visibility=neq.archived'];
  if(ids.length) filters.push(`id=in.(${ids.join(',')})`);
  else if(body.stale_only!==false) filters.push('ai_embedding=is.null');
  const rows=await sb(context,`/rest/v1/products?select=id,name,brand,category,pack,description,tags,visibility&${filters.join('&')}&order=updated_at.desc&limit=${limit}`);
  if(!rows?.length){
    const remaining=await sb(context,'/rest/v1/products?ai_embedding=is.null&visibility=neq.archived&select=id&limit=1');
    return json({indexed:0,remaining:remaining?.length?1:0,model:selectedEmbeddingModel(context),message:'AI search index is already up to date.'});
  }
  const texts=rows.map(embeddingText);
  try{
    const {embeddings,model}=await runEmbeddings(context,texts);
    const payload=rows.map((p,i)=>({id:p.id,text:texts[i],embedding:vectorLiteral(embeddings[i])}));
    const changed=await sb(context,'/rest/v1/rpc/set_product_ai_embeddings',{method:'POST',body:{p_rows:payload}});
    const remainingRows=await sb(context,'/rest/v1/products?ai_embedding=is.null&visibility=neq.archived&select=id&limit=51');
    const remaining=(remainingRows||[]).length;
    await audit(context,{actorId:user.id,actorRole:role,action:'ai.search_index_refreshed',entityType:'ai',entityId:'products',after:{indexed:Number(changed)||rows.length,remaining_hint:remaining,model}});
    return json({indexed:Number(changed)||rows.length,remaining,model,product_ids:rows.map(r=>r.id)});
  }catch(error){console.error('[ai-reindex] failed',error?.message||error);httpError('Free AI indexing is temporarily unavailable or daily quota is exhausted.',503,'ai_unavailable');}
});
