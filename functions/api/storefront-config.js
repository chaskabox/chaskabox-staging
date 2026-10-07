import { sbRequest } from './_lib/db.js';
export async function onRequestGet({ env }){
  try{
    const [settings,sections]=await Promise.all([
      sbRequest(env,'/public_site_settings',{query:'?select=key,value'}),
      sbRequest(env,'/public_homepage_sections',{query:'?select=section_key,enabled,position,heading,subheading,config&order=position.asc'})
    ]);
    const map={}; for(const r of settings||[]) map[r.key]=r.value;
    return new Response(JSON.stringify({settings:map,sections:sections||[]}),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=120,stale-while-revalidate=600'}});
  }catch(e){ return new Response(JSON.stringify({settings:{},sections:[]}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}); }
}
