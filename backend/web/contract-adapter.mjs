export function newsForHTML(n){
 const kind=n.kind||(/시민기자/.test(n.source||'')?'citizen':/의회|회의록/.test(n.source||'')?'council':/언론|보도/.test(n.source||'')?'press':/서울|국립|환경과학원/.test(n.source||'')?'official':'unknown');
 return {...n,summary:n.summary||n.body||'',url:n.url||n.sourceUrl||'',pub:n.pub!==undefined?n.pub:(n.date||null),pubKind:n.pubKind||n.dateKind||'발행일 미상',checked:n.checked||null,date:n.date||new Date(n.publishedAt||n.createdAt).toISOString().slice(0,10),source:n.source||'우이런',dateKind:n.dateKind||'앱 게시',topic:n.topic||({eco:'eco',guide:'eco',issue:'eco',plan:'plan',done:'plan'}[n.type]||'eco'),status:n.status||'안내',kind};
}
export function participationPayload(payload,activeSessionId){
 return {...payload,...(!Object.hasOwn(payload,'sessionId')&&activeSessionId?{sessionId:activeSessionId}:{})};
}
