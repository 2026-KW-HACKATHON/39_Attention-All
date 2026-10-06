// 로컬 Emulator(demo-uirun) 전용: 앱 ‘우이천 소식’ 화면 시험용 [테스트] 소식 3건(분류별 1건)을 추가·게시한다.
// - 원격 프로젝트·원격 호스트면 실행하지 않는다. 전체 seed(configurePilot)를 다시 돌리지 않고 기존 데이터는 그대로 둔다.
// - 고정 ID라 다시 실행해도 같은 3건을 고칠 뿐 늘어나지 않는다. `unpublish`를 붙이면 이 3건만 게시를 내린다(삭제하지 않음).
// - 실제 기관 발표처럼 보이지 않게 제목에 [테스트], 출처는 개발팀 시험 자료로 적고 원문 링크·기관명을 넣지 않는다.
// 사용: (backend 폴더) node scripts/seed-test-news.cjs [unpublish]   ※ Emulator가 켜져 있어야 한다.
const project = process.env.GCLOUD_PROJECT || 'demo-uirun';
const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
if (project !== 'demo-uirun') throw Error(`거절: demo-uirun Emulator 전용 스크립트예요(현재 ${project}).`);
if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) throw Error(`거절: 로컬 Emulator 주소만 허용해요(현재 ${host}).`);
process.env.FIRESTORE_EMULATOR_HOST = host;
process.env.GCLOUD_PROJECT = project;

const requireFunctions = require('node:module').createRequire(require('node:path').resolve(__dirname, '../functions/package.json'));
const { initializeApp } = requireFunctions('firebase-admin/app');
initializeApp({ projectId: project });
const { transact } = require('../functions/src/store');
const { execute } = require('../functions/src/service');

const SOURCE = '우이런 개발팀 시험 자료(실제 소식 아님)';
const LONG = '앱의 소식 화면을 시험하려고 만든 가짜 글이에요. 요약이 세 줄을 넘으면 접혀 보이고, ‘요약 더 보기’를 누르면 전체가 펼쳐지는지 확인해요. ';
const NEWS = [
  { id: 'test-news-eco', topic: 'eco', title: '[테스트] 생태·하천 정보 분류 확인용 소식', summary: LONG + '생태·하천 정보 분류 칩을 눌렀을 때 이 글만 남는지도 함께 확인해요. 이 글은 하천 상태나 생물 정보를 알려주지 않아요.', pub: '2026-10-03' },
  { id: 'test-news-proposal', topic: 'proposal', title: '[테스트] 개선 제안 분류 확인용 소식', summary: LONG + '개선 제안 분류가 맞게 표시되는지 확인해요. 이 글은 누구의 제안도 아니며 어떤 사업과도 관계없어요.', pub: '2026-10-02' },
  { id: 'test-news-plan', topic: 'plan', title: '[테스트] 사업 계획 분류 확인용 소식', summary: LONG + '사업 계획 분류와 날짜 표시를 확인해요. 이 글에 적힌 내용은 계획·확정·시행된 사업이 아니에요.', pub: '2026-10-01' },
];
const admin = { uid: 'test-news-script', admin: true };
const unpublish = process.argv[2] === 'unpublish';
const run = (d, name, data) => execute(d, admin, name, { ...data, clientRequestId: `${name}-${data.id}-${Date.now()}` }, Date.now());

transact(d => {
  for (const n of NEWS) {
    if (unpublish) {
      if (d.news[n.id]) run(d, 'setNewsPublished', { id: n.id, published: false });
      continue;
    }
    run(d, 'upsertNews', { id: n.id, title: n.title, body: n.summary, summary: n.summary, topic: n.topic, status: '테스트', source: SOURCE, pub: n.pub, pubKind: '테스트 작성일' });
    run(d, 'setNewsPublished', { id: n.id, published: true });
  }
  return { ok: true };
})
  .then(async () => {
    console.log(unpublish ? '[테스트] 소식 3건의 게시를 내렸어요.' : '[테스트] 소식 3건을 추가·게시했어요(다른 소식·데이터는 그대로).');
    await requireFunctions('firebase-admin/firestore').getFirestore().terminate();
  })
  .catch(e => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
