// A committed response remains success even when refreshing the UI is offline.
export async function commit(invoke,requests,name,data,refresh,onRefreshFailure,key,valid=()=>true){
 const fingerprint=key||JSON.stringify([name,data]);let op=requests.get(fingerprint);if(!op){op={...structuredClone(data),clientRequestId:crypto.randomUUID()};requests.set(fingerprint,op);}const result=await invoke(name,op);if(!valid())throw Error('ACCOUNT_CHANGED');requests.delete(fingerprint);if(result.ok!==false){try{await refresh();}catch(e){if(!valid())throw Error('ACCOUNT_CHANGED');onRefreshFailure(e);}}if(!valid())throw Error('ACCOUNT_CHANGED');return result;
}
