// Immutable requests survive reload for the same signed-in owner. Switching owners clears them.
export class MutationQueue {
 constructor(invoke,uid=null,storage=null){this.invoke=invoke;this.uid=null;this.storage=storage;this.pending=[];this.persistenceFailed=false;this.generation=0;this.running=null;this.setUser(uid);}
 key(uid=this.uid){return 'uirun:pending:'+uid;}
 persist(){if(!this.storage||!this.uid)return;try{if(this.pending.length)this.storage.setItem(this.key(),JSON.stringify(this.pending));else this.storage.removeItem(this.key());this.persistenceFailed=false;}catch{this.persistenceFailed=true;}}
 clearStored(uid){try{this.storage?.removeItem(this.key(uid));}catch{this.persistenceFailed=true;}}
 setUser(uid){if(uid===this.uid)return;if(this.uid)this.clearStored(this.uid);this.uid=uid;this.generation++;this.pending=[];if(uid&&this.storage){try{const saved=JSON.parse(this.storage.getItem(this.key())||'[]');this.pending=saved.filter(o=>o.uid===uid&&o.id===o.payload?.clientRequestId&&typeof o.name==='string');}catch{this.clearStored(uid);}}}
 add(name,payload={}){if(!this.uid)throw Error('UNAUTHENTICATED');const id=crypto.randomUUID(),op={id,name,payload:structuredClone({...payload,clientRequestId:id}),uid:this.uid};this.pending.push(op);this.persist();return op;}
 remove(predicate){if(this.running)throw Error('QUEUE_BUSY');this.pending=this.pending.filter(op=>!predicate(op));this.persist();}
 flush(){if(this.running)return this.running;const generation=this.generation;this.running=(async()=>{while(this.pending.length){if(generation!==this.generation)throw Error('ACCOUNT_CHANGED');const op=this.pending[0],result=await this.invoke(op.name,structuredClone(op.payload));if(generation!==this.generation)throw Error('ACCOUNT_CHANGED');if(result?.ok===false){const error=Error(result.errorCode||'REQUEST_REJECTED');error.details=result.details;throw error;}this.pending.shift();this.persist();op.result=result;}return true;})().finally(()=>{this.running=null;});return this.running;}
}
