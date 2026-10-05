/* 시드 데이터. 출처 구분:
 *  - OSM: OpenStreetMap 실제 데이터(현장 미확인)          → source: 'OSM'
 *  - EXAMPLE: 팀이 정한 예시 코스·정기 지점(현장 확인 예정) → source: 'EXAMPLE'
 *  - DEMO: 체험용 가상 관찰(실제 제보 아님)                 → source: 'DEMO'
 * 실제 서비스는 답사 CSV → Seed 검증(§24·§25)을 거친 값으로 교체한다.
 */
(function () {
  const G = window.UIRUN_GEO;
  const { MIN, H, DAY } = Policy;
  const L = i => G.left[i], R = i => G.right[i], Cn = i => G.center[i];

  // 사진마다 출처·이용 조건을 따로 적는다(확인된 것만). 교체: 사진 파일을 photos 폴더에 넣고 해당 항목의 src·size·출처 정보만 바꾼다.
  // pos는 화면 크롭 기준점(CSS object-position). 출처·촬영 시기는 마이페이지 › 정보 및 출처에서 보여준다.
  const SI = { credit: '서울연구원 서울연구데이터서비스', license: '공공누리 제1유형(출처표시)', base: 'https://data.si.re.kr/photo/' };
  const si = (src, id, place, date, size, use, pos) => ({ src, place, date, id, size, use, pos, credit: SI.credit, license: SI.license, url: SI.base + id }); // src는 단일 HTML 빌드가 찾을 수 있게 경로를 그대로 적는다
  const PHOTOS = {
    // 홈 대표 사진: 팀이 전달한 사진(KakaoTalk_20261005_150749392_02.jpg, 387×516, EXIF 없음). 촬영자·촬영일·촬영 위치·이용 조건은 확인 전.
    // 대표 이미지로만 쓰며 파일럿 코스의 출발점이나 지금 모습으로 표시하지 않는다. 이용 조건 확인 전이라 공유용 기록카드 배경으로는 쓰지 않는다.
    hero: { src: 'assets/photos/home-hero.jpg', place: '하천 산책로 풍경', date: null, id: null, size: '387×516', use: '홈 대표 사진', pos: '50% 6%',
      credit: '팀 제공 사진(전달 파일 KakaoTalk_20261005_150749392_02.jpg)', license: '이용 조건 확인 필요', note: '촬영자·촬영일·촬영 위치 미확인(파일에 촬영 정보 없음)', url: null },
    c1: si('assets/photos/uicheon-06C03527Bb80000.jpg', '06C03527Bb80000', '우이천 월계2교교차로 부근 산책로', '2020년 3월', '600×900', '우이천 왕복 3K 코스 분위기 사진', '50% 58%'),
    c2: si('assets/photos/uicheon-06C03532Bb80000.jpg', '06C03532Bb80000', '우이천 초안교 부근', '2020년 3월', '900×600', '광운로 다리 짧은 산책 코스 분위기 사진', '50% 60%'),
    river: si('assets/photos/uicheon-06C03536Bb80000.jpg', '06C03536Bb80000', '우이천 초안교 부근', '2020년 4월', '900×600', '우리 우이천 머리 사진'),
    r1: si('assets/photos/uicheon-06C03533Bb70000.jpg', '06C03533Bb70000', '우이천 번동 구간', '2020년 3월', '900×600', '정기 관찰 예시 구도'),
    r2: si('assets/photos/uicheon-06C03526Bb80000.jpg', '06C03526Bb80000', '우이천 초안교 부근', '2020년 3월', '900×600', '정기 관찰 예시 구도'),
  };

  // 우이천 소식: 공식 자료·회의록·보도를 사람이 확인해 고른 항목(2026-10-05 확인). 요약은 팀 작성, 원문 링크 제공.
  // topic(주제)과 status(자료가 실제로 말하는 상태)는 별개다. 날짜는 셋을 나눈다: pub(자료 날짜, pubKind=기사 발행·페이지 수정·회의일),
  // event(실제 사건 시점, 있을 때만), checked(팀이 내용을 확인한 날). 정렬은 pub 기준이고 pub이 없는 상시 페이지는 맨 뒤로 — 확인일을 최신 소식처럼 쓰지 않는다.
  // topic: eco(생태·하천 정보) | proposal(개선 제안) | plan(사업 계획). kind: official | council | press | citizen
  const NEWS = [
    { id: 'n1', topic: 'eco', status: '완료 안내', title: '우이천 물은 어디서 오나', pub: '2018-11-08', pubKind: '페이지 수정', checked: '2026-10-05', source: '서울특별시 내 손안에 서울', kind: 'official',
      summary: '물이 마르기 쉬운 우이천에는 중랑물재생센터에서 고도처리한 물을 7.2km 관로로 끌어와 하루 3만 톤을 흘려보내요. 근화교와 쌍한교 인근 방류부로 공급해 수심 20cm 안팎을 유지하도록 했다고 안내돼 있어요.',
      url: 'https://news.seoul.go.kr/citybuild/archives/212546' },
    { id: 'n2', topic: 'eco', status: '안내', title: '수질은 측정망에서 잽니다', pub: null, pubKind: '상시 안내 페이지', checked: '2026-10-04', source: '국립환경과학원 물환경정보시스템', kind: 'official',
      summary: '하천 수질은 국가 수질측정망에서 BOD·COD·총질소·총인 등을 주 1회 또는 월 1회 측정해 공개해요. 우이런의 사진과 간단 응답은 언제 어디서 무엇이 보였는지에 대한 기록이고, 수질 등급이나 안전 여부를 판정하지 않아요.',
      url: 'https://water.nier.go.kr/web' },
    { id: 'n3', topic: 'eco', status: '보도 · 원인 미확인', title: '하류 측정 지점 수질이 갑자기 나빠졌다는 보도', pub: '2022-07-12', pubKind: '기사 발행', checked: '2026-10-05', source: '비즈한국', kind: 'press',
      summary: '2022년 5월 하류 석관동 측정 지점의 수질 측정값이 한 달 전보다 크게 나빠졌다고 보도됐어요. 서울시는 원인을 조사하겠다고 답했고, 기사 시점까지 원인은 확인되지 않았어요.',
      url: 'https://bizhankook.com/articles/24049.html' },
    { id: 'n4', topic: 'proposal', status: '제안 · 검토 답변', title: '우이천 주변 생태 방제 도입 제안', pub: '2025-10-20', pubKind: '회의일', checked: '2026-10-05', source: '강북구의회 제286회 본회의 제2차 회의록', kind: 'council',
      summary: '곽인혜 의원이 구정질문에서 우이천 등 하천 주변 유해곤충 방제에 생태 방제 기법을 접목할 계획이 있는지 물었어요. 보건소장은 수질 안정성과 생태계 영향 등을 종합해 신중하게 검토하겠다고 답했어요. 도입이 결정된 것은 아니에요.',
      url: 'https://council.gangbuk.go.kr/viewer/minutes.do?uid=8731' },
    { id: 'n5', topic: 'plan', status: '완료 안내', title: '우이천변 ‘노원우이마루’ 개관', pub: '2026-04-06', pubKind: '기사 발행', checked: '2026-10-05', event: '2026년 3월 31일 개관', source: '서울시 미디어허브', kind: 'citizen',
      summary: '월계동 신창중 맞은편 우이천변에 수변활력거점 ‘서울물빛나루 19호 노원우이마루’가 문을 열었다고 소개됐어요. 운영 시간은 3~11월 9~21시, 12~2월 10~19시로 안내됐어요.',
      url: 'https://mediahub.seoul.go.kr/archives/2017650' },
    { id: 'n6', topic: 'plan', status: '계획 · 구청장 발언', title: '벌리교 일대 커뮤니티 공간 계획', pub: '2024-11-18', pubKind: '회의일', checked: '2026-10-05', source: '노원구의회 제289회 정례회 제1차 본회의 회의록', kind: 'council',
      summary: '2025년도 예산안 시정연설에서 구청장이 우이천 벌리교 일대에 커뮤니티 공간을 설치해 수변활력거점으로 만들겠다고 밝혔어요. 회의 발언이므로 실제 시행 여부는 이후 공식 안내로 확인해야 해요.',
      url: 'https://council.nowon.kr/record/recordView.do?key=6fb4a4de9f73b8a163d409f5a2b3d0520ef00dabb0911f8dfe58cff02e1dea84cd5c8188b4faa02e&memberName=%EB%85%B8%EC%97%B0%EC%88%98' },
    { id: 'n7', topic: 'plan', status: '계획 · 설계 예산', title: '장월교 인근 제방 상부 휴게쉼터 설계 예산', pub: '2024-04-25', pubKind: '회의일', checked: '2026-10-05', source: '노원구의회 제284회 임시회 도시환경위원회 제2차 회의록', kind: 'council',
      summary: '추가경정예산 설명에서 장월교 인근 우이천 제방 상부 휴게공간의 기본·실시설계 용역비 5,000만 원이 편성됐어요. 치수과장은 데크를 넓히고 북카페·전망대 같은 시설을 검토한다고 설명했고, 위원장은 위치에 의문을 나타냈어요. 설계 단계이며 완공을 뜻하지 않아요.',
      url: 'https://council.nowon.kr/record/recordView.do?key=512ba554eb730a5833e05a4b93012a0970a027fdd9efe5e4e80c55139d078c1e6f3507e4a9341563' },
    { id: 'n8', topic: 'plan', status: '완료 안내', title: '우이천 데크길 달 모양 경관조명', pub: '2022-06-22', pubKind: '기사 발행', checked: '2026-10-05', source: '서울&', kind: 'press',
      summary: '월계동 우이천 데크길 350m 구간에 초승달부터 그믐달까지 모양이 다른 경관조명 35개와 조명의자 2개를 설치했다고 보도됐어요.',
      url: 'https://www.seouland.com/arti/society/society_general/9677.html' },
  ];

  const slice = (fn, a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(fn(i)); return out; };
  const pathLen = pts => pts.slice(1).reduce((s, p, i) => s + Policy.distM(pts[i], p), 0);

  // 왕복 코스: 출발 → 반환점 → 출발. 선은 하천 중심선에서 평행 이동한 근사선(실측 보행로 아님).
  const c1Out = slice(L, 8, G.idx.seokgye).reverse();
  const c2Out = slice(R, G.idx.gwangunBridge, 66);
  const COURSES = [
    { id: 'c1', name: '우이천 왕복 3K', bank: '월계동 쪽 둑', start: '석계역 방면 하류 끝', turn: '파일럿 구간 상류 끝', out: c1Out, distanceM: Math.round(pathLen(c1Out) * 2), photo: 'c1', modes: ['RUN', 'WALK'], source: 'EXAMPLE' },
    { id: 'c2', name: '광운로 다리 짧은 산책', bank: '석관동 쪽 둑', start: '광운로 교량 부근', turn: '석계역 방면', out: c2Out, distanceM: Math.round(pathLen(c2Out) * 2), photo: 'c2', modes: ['WALK'], source: 'EXAMPLE' },
  ];

  const POI_LABEL = { toilets: '화장실', bicycle_parking: '자전거 보관대' };
  const FACILITIES = G.osmPois.map(p => ({ id: 'osm' + p.osmId, type: p.type, name: POI_LABEL[p.type] || p.type, lat: p.lat, lng: p.lng, osmId: p.osmId, openingHours: null, source: 'OSM' }));

  const ROUTINES = [
    { id: 'r1', name: '광운로 교량 부근', bankLabel: '월계동 쪽 둑', anchors: [L(G.idx.gwangunBridge - 2)], direction: '하류(석계역 방향)를 바라보고, 하천과 맞은편 둑이 화면의 절반을 차지하게', photo: 'r1', roundHours: 6, enabled: true, source: 'EXAMPLE' },
    { id: 'r2', name: '파일럿 구간 상류 끝', bankLabel: '월계동 쪽 둑', anchors: [L(10)], direction: '하류(광운로 방향)를 바라보고, 둑길이 왼쪽 아래에서 시작하게', photo: 'r2', roundHours: 6, enabled: true, source: 'EXAMPLE' },
  ];

  // 체험용 관찰. 현상 위치(anchor)와 서서 볼 수 있는 관찰 지점(observationAnchors)을 분리한다(§5.1).
  function demoIssues(now) {
    const base = (id, code, anchor, obsAnchors, createdAgo, extra) => Object.assign({
      id, categoryCode: code, source: 'DEMO', creatorUid: 'demo_a', createdAt: now - createdAgo, anchor, observationAnchors: obsAnchors,
      visibility: 'PUBLIC', lifecycleStatus: 'OPEN', verificationLevel: 'NONE', lastVerifiedAt: null, eventEndsAt: null, notifyFrom: now - createdAgo + 15 * MIN,
      lastSignalAt: null, signalCount: 0, signalDayKey: null, todaySignalAccountCount: 0,
      availablePhotoCount: 1, photoObservationCount: 1, lastPhotoObservedAt: now - createdAgo, photoAccounts: ['demo_a'],
      creatorPhotoAt: now - createdAgo, creatorPhotoObsId: null, creatorCreditStatus: 'ELIGIBLE', creatorPhotoDeadlineAt: null,
      firstOtherPhotoAcceptedAt: null, rewardQualificationEndsAt: now - createdAgo + 7 * DAY, bonusResolvedP: 0,
    }, extra);
    const today = Policy.kstDay(now);
    const i = G.idx.gwangunBridge;
    return [
      base('d_foam', 'FOAM', Cn(i + 9), [L(i + 9), R(i + 9)], 40 * MIN, { eventEndsAt: now - 40 * MIN + 180 * MIN, signalCount: 2, lastSignalAt: now - 12 * MIN, signalDayKey: today, todaySignalAccountCount: 2 }),
      base('d_litter', 'LITTER', L(30), [L(30)], 2 * DAY, { publicPhoto: { takenAt: now - 2 * DAY + 3 * H, acceptedAt: now - 2 * DAY + 3 * H + 4 * MIN }, lastPhotoObservedAt: now - 2 * DAY + 3 * H, photoObservationCount: 2, availablePhotoCount: 2, photoAccounts: ['demo_a', 'demo_b'], verificationLevel: 'ADMIN', lastVerifiedAt: now - DAY, signalCount: 5, lastSignalAt: now - 50 * MIN, signalDayKey: today, todaySignalAccountCount: 3 }),
      base('d_bench', 'BENCH', L(22), [L(22)], DAY + 2 * H, { availablePhotoCount: 0, photoObservationCount: 0, lastPhotoObservedAt: null, photoAccounts: [], creatorPhotoAt: null, creatorCreditStatus: 'INELIGIBLE', rewardQualificationEndsAt: null, signalCount: 3, lastSignalAt: now - 3 * H, signalDayKey: today, todaySignalAccountCount: 1 }),
      base('d_river', 'RIVER_WASTE', Cn(14), [L(14), R(14)], 6 * DAY, { publicPhoto: { takenAt: now - 5 * DAY, acceptedAt: now - 5 * DAY + 9 * MIN }, notifyFrom: now + 12 * H, pauseNote: '사진이 오래되어 알림을 쉬는 중', lastPhotoObservedAt: now - 5 * DAY, photoObservationCount: 3, availablePhotoCount: 3, photoAccounts: ['demo_a', 'demo_b', 'demo_c'], verificationLevel: 'PEER', lastVerifiedAt: now - 5 * DAY }),
      base('d_odor', 'ODOR_NOW', Cn(3), [R(3)], 25 * MIN, { eventEndsAt: now - 25 * MIN + 180 * MIN, availablePhotoCount: 0, photoObservationCount: 0, lastPhotoObservedAt: null, photoAccounts: [], creatorPhotoAt: null, signalCount: 2, lastSignalAt: now - 25 * MIN, signalDayKey: today, todaySignalAccountCount: 2 }),
      base('d_foam_old', 'FOAM', Cn(46), [L(46), R(46)], DAY + 5 * H, { eventEndsAt: now - DAY - 2 * H }),
      base('d_hidden', 'LITTER', L(26), [L(26)], 3 * H, { visibility: 'HIDDEN' }), // 운영자가 숨긴 관찰: 지도·목록·묶음·간편 지도 어디에도 나오지 않아야 한다
      base('d_archived', 'SEDIMENT', L(40), [L(40)], 9 * DAY, { lifecycleStatus: 'ARCHIVED', lastPhotoObservedAt: now - 9 * DAY }), // 보관: 기록 관리용, 해결 아님
    ];
  }

  function seedDb(now) {
    const db = Policy.emptyDb();
    ['me', 'demo_a', 'demo_b', 'demo_c'].forEach(u => Policy.ensureUser(db, u));
    demoIssues(now).forEach(is => { db.issues[is.id] = is; });
    ROUTINES.forEach(r => {
      const round = Policy.roundOf(now, r.roundHours);
      db.routines[r.id] = { id: r.id, name: r.name, enabled: r.enabled, roundHours: r.roundHours, anchors: r.anchors, rounds: { [round.id]: r.id === 'r1' ? ['demo_a', 'demo_b'] : [] } };
    });
    return db;
  }

  window.UIRUN_DATA = { G, PHOTOS, NEWS, COURSES, FACILITIES, ROUTINES, seedDb, pathLen,
    PILOT: { name: '월계1동 우이천 파일럿 구간', line: G.center, center: Cn(G.idx.gwangunBridge), note: '경계는 답사 후 확정' } };
})();
