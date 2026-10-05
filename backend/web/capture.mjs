export async function ensureSealed(ticket,seal){
 if(ticket.sealed)return;if(!ticket.sealData)throw Error('PHOTO_REQUIRED');
 if(!ticket.sealPromise)ticket.sealPromise=Promise.resolve().then(()=>seal(structuredClone(ticket.sealData))).then(r=>{if(r.ok===false)throw Error(r.errorCode);ticket.sealed=true;return r;}).finally(()=>{ticket.sealPromise=null;});
 return ticket.sealPromise;
}
