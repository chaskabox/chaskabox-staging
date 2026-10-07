import { withAdmin, sb, json, httpError, audit } from '../../../_lib/auth.js';
export const onRequestPost=withAdmin(['owner','manager','fulfilment'],async(context,{user,role})=>{
  const id=context.params.id;if(!id)httpError('Order id required',400);
  const rows=await sb(context,`/rest/v1/orders?id=eq.${encodeURIComponent(id)}&select=id,order_number`); const order=rows?.[0]; if(!order)httpError('Order not found',404,'not_found');
  const now=new Date().toISOString();
  await sb(context,`/rest/v1/notification_outbox?order_id=eq.${encodeURIComponent(String(id))}`,{method:'PATCH',body:{status:'retry',next_attempt_at:now,locked_at:null,last_error:null}});
  try{await sb(context,`/rest/v1/customer_notification_outbox?order_id=eq.${encodeURIComponent(String(id))}&status=in.(retry,dead)`,{method:'PATCH',body:{status:'retry',next_attempt_at:now,locked_at:null,last_error:null}});}catch(e){console.error('[retry] customer outbox unavailable',e?.status||e?.message||e)}
  await audit(context,{actorId:user.id,actorRole:role,action:'notification.retry_requested',entityType:'order',entityId:String(id),before:null,after:{order_number:order.order_number}});
  return json({ok:true,order_number:order.order_number});
});
