import { withAdmin, json, ROLE_CAPS } from '../_lib/auth.js';
export const onRequestGet=withAdmin(['owner','manager','fulfilment','content'],async(_context,{user,role})=>json({user,role,capabilities:ROLE_CAPS[role]||[]}));
