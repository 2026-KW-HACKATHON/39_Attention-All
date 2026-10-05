/* 우이런 프로토타입 — 앱 셸: 상태·내비게이션·탭(홈/지도/우리 우이천/기록/마이)·공용 시트.
 * 운동·촬영·제보·보상·기록카드 흐름은 flows.js. 체험 패널은 demo.js.
 */
(function () {
  'use strict';
  const D = window.UIRUN_DATA, Pl = window.Policy, Sv = window.Services;
  const { MIN, H, DAY, CAT, P } = Pl;
  const U = window.U = { screens: {}, sheets: {}, act: {}, after: {}, liveKeys: {} };

  // ---------- 상태 ----------
  // 저장 키는 버전과 분리한다. 형식이 바뀌면 지우지 않고 migrate로 옮긴다(예전 키는 그대로 남겨 둔다).
  const KEY = 'uirun.retouch.remote.v3', LEGACY = 'uirun.remote.legacy', V = 7;
  function fresh() {
    const t = Date.now();
    return {
      v: V, signedIn: false, consentAt: null,
      perms: { location: 'unknown', camera: 'unknown', notif: 'unknown' },
      mode: 'RUN', courseId: 'c1', tab: 'home', homeOpen: false, riverTab: 'obs', riverOld: false, newsTopic: 'all',
      recTab: 'run', recMore: false, ledgerTab: 'all', runDetail: false, statRange: '7d',
      mapMode: 'all', mapOld: false, mapSel: null, simplePurpose: 'course', simpleMapFull: false, simpleAnchor: null, simpleCourse: 'c1',
      db: D.seedDb(t), session: null, runs: [], localPhotos: [],
      sim: { pos: D.G.left[D.G.idx.gwangunBridge] },
      demo: { timeShift: 0, locSource: 'sim', speed: 5, accuracy: 8, offline: false, failUpload: false, failStore: false, weatherFail: false, weatherStale: false, mapFail: false, camera: 'auto' },
    };
  }
  // v6 → v7: 새 필드는 안전한 기본값으로 채우고, 원본이 없어 계산할 수 없는 값(예전 기록의 마지막 부분 구간)은 만들지 않는다.
  function migrate(st) {
    if (!st || typeof st.v !== 'number') return null;
    if (st.v === 6) {
      st.runs = (st.runs || []).map(r => Object.assign({}, r, { laps: r.laps || (r.splits || []).map(x => ({ distM: 1000, sec: x.sec })), legacy: true }));
      const ss = st.session;
      if (ss && ss.baseMs == null) Object.assign(ss, { baseMs: ss.activeMs || 0, runSince: null, rate: 1, seenAt: Date.now() }); // 앱을 다시 열면 일시정지로 복구된다
      Object.values(st.db.users || {}).forEach(u => { if (u.displayName == null) u.displayName = ''; });
      Object.assign(st, { statRange: st.statRange || '7d', simpleCourse: st.simpleCourse || 'c1', v: 7 });
    }
    return st.v === V ? st : null;
  }
  let S = migrate(Sv.store.get(KEY)) || migrate(Sv.store.get(LEGACY)) || fresh();
  Sv.store.failWrites = !!S.demo.failStore;
  U.S = () => S;
  // 우이런이 쓰는 키(uirun.)만 지운다. 예전 버전 키(LEGACY)도 지워 다시 열었을 때 이전 사용자 기록이 이관되지 않게 한다.
  const wipe = all => { clearTimeout(saveT); Sv.store.keys().filter(k => (all ? k.startsWith('uirun.') : k.startsWith('uirun.state'))).forEach(Sv.store.del); };
  U.reset = all => { Sv.store.failWrites = false; wipe(all); S = fresh(); U.nav.clear(() => U.render()); }; // 화면 스택을 비운 뒤 그린다
  // 저장: 일반 화면 상태는 모아서 저장하고, 기록(사진·제보·운동)은 saveNow로 성공 여부를 확인한다
  let saveT = null, saveWarned = false;
  U.save = () => { clearTimeout(saveT); saveT = setTimeout(() => { if (!Sv.store.set(KEY, S) && !saveWarned) { saveWarned = true; U.toast('이 기기에 저장하지 못하고 있어요. 저장 공간을 확인해 주세요', 'err'); } }, 300); };
  U.saveNow = () => { clearTimeout(saveT); const ok = Sv.store.set(KEY, S); if (ok) saveWarned = false; return ok; };

  U.now = () => Date.now() + S.demo.timeShift;
  // file://로 열면 OSM 타일이 차단되어(Referer 없음) 지도 배경을 그리지 않는다. 공유용 단일 파일은 window.UIRUN_SINGLE.
  U.fileHint = window.UIRUN_SINGLE
    ? '공유용 HTML 파일이라 지도 배경 이미지는 보이지 않아요. 하천선과 위치 표시는 그대로 쓸 수 있어요.'
    : '파일로 직접 열어 지도 이미지를 불러올 수 없어요. ‘우이런 열기.bat’ 또는 <b>python serve.py</b>로 열어 주세요.';
  U.LOGO = { dark: 'assets/brand/uirun-wordmark.png', light: 'assets/brand/uirun-wordmark-light.png', icon: 'assets/brand/uirun-icon-192.png' };

  // ---------- 위치 ----------
  let realFix = null, realWatch = null;
  U.realFix = () => realFix;
  U.watchReal = on => {
    if (realWatch != null) { navigator.geolocation.clearWatch(realWatch); realWatch = null; }
    if (on && navigator.geolocation) realWatch = navigator.geolocation.watchPosition(
      p => { realFix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), alt: p.coords.altitude, altAcc: p.coords.altitudeAccuracy, at: p.timestamp || Date.now(), receivedAt: Date.now() }; }, // 캐시된 오래된 위치를 새 위치로 보지 않는다
      () => { realFix = null; }, { enableHighAccuracy: true, maximumAge: 5000 });
  };
  U.loc = () => {
    const pm = S.perms.location;
    if (pm !== 'precise' && pm !== 'approx') return null;
    const t = U.now();
    let p;
    if (S.demo.locSource === 'real') {
      if (!realFix) return null;
      p = { lat: realFix.lat, lng: realFix.lng, accuracyM: realFix.acc, alt: realFix.alt, altAcc: realFix.altAcc, measuredAt: t - (Date.now() - realFix.at) };
    } else p = { lat: S.sim.pos[0], lng: S.sim.pos[1], accuracyM: S.demo.accuracy, measuredAt: S.demo.fixFrozenAt || t }; // 체험 패널 '위치 갱신 멈춤': 같은 좌표가 오래된 위치가 된다
    p.precise = pm === 'precise';
    if (!p.precise) p.accuracyM = Math.max(p.accuracyM, 1200);
    return p;
  };

  // ---------- 모의 서버 호출 ----------
  // ponytail: 브라우저 안에서 정책 함수를 직접 호출. 실제는 Firebase callable + Transaction + 멱등 receipt.
  // 결과를 이 기기에 저장하지 못하면 처리 전 상태로 되돌리고 실패로 돌려준다(메모리에만 있는 기록을 저장 완료로 보이지 않게).
  // 중복 처리: 화면은 보내는 중 버튼을 막을 뿐이다. 같은 요청 ID(requestId)로 다시 오면 처리하지 않고 처음 결과를 돌려주는 것은
  // 서버 책임이며, 여기서는 db.receipts로 흉내 낸다(실패한 요청은 영수증을 남기지 않아 같은 ID로 다시 보낼 수 있다).
  U.rid = () => 'rq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  U.api = (fn, payload, opts) => new Promise(res => setTimeout(() => {
    if (S.demo.offline) return res({ ok: false, errorCode: 'NETWORK', retryable: true });
    if (opts && opts.upload && S.demo.failUpload) { S.demo.failUpload = false; U.save(); return res({ ok: false, errorCode: 'UPLOAD_FAILED', retryable: true }); }
    const rid = payload && payload.requestId, rc = S.db.receipts || (S.db.receipts = {});
    const fp = rid && fn + JSON.stringify(payload, (k, v) => (k === 'photo' && v ? v.length : k === 'requestId' || k === 'loc' ? undefined : v)); // 작업 지문(사진은 길이만)
    if (rid && rc[rid]) return res(rc[rid].fp && rc[rid].fp !== fp ? { ok: false, errorCode: 'REQUEST_MISMATCH', retryable: false } : Object.assign({}, rc[rid].r || rc[rid], { replayed: true }));
    const snap = JSON.stringify(S.db), tk = payload && payload.ticket, used = tk && tk.consumed;
    const r = Pl[fn](S.db, Object.assign({ uid: 'me' }, payload), U.now());
    if (rid && r.ok) S.db.receipts[rid] = { fp, r };
    if (!U.saveNow()) {
      S.db = JSON.parse(snap);
      if (tk) tk.consumed = used;
      return res({ ok: false, errorCode: 'LOCAL_SAVE_FAILED', retryable: true });
    }
    res(r);
  }, (opts && opts.upload ? 900 : 420) + Math.random() * 300));

  // ---------- 유틸 ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, cls) => '<svg class="ic ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
  const pad = n => String(n).padStart(2, '0');
  const kst = (t, o) => new Intl.DateTimeFormat('ko-KR', Object.assign({ timeZone: 'Asia/Seoul' }, o)).format(t);
  const fmt = {
    time: t => kst(t, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    date: t => kst(t, { month: 'numeric', day: 'numeric', weekday: 'short' }),
    ymd: s => s.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (m, y, mo, d) => y + '. ' + Number(mo) + '. ' + Number(d) + '.'),
    dt: t => kst(t, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    ago(t) { const d = U.now() - t; if (d < MIN) return '방금'; if (d < H) return Math.floor(d / MIN) + '분 전'; if (d < DAY) return Math.floor(d / H) + '시간 전'; return Math.floor(d / DAY) + '일 전'; },
    dur(ms) { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ':' + pad(m) + ':' + pad(s % 60) : pad(m) + ':' + pad(s % 60); },
    hm(ms) { const m = Math.floor(ms / MIN); return m >= 60 ? Math.floor(m / 60) + '시간 ' + (m % 60) + '분' : m + '분'; },
    km: m => (m / 1000).toFixed(2),
    pace: (ms, m) => Pl.paceText(ms, m) || '–',
    dist: m => (m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(1) + 'km'),
    hour: iso => Number(iso.slice(11, 13)) + '시',
  };
  const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xAC00; return w + (c >= 0 && c <= 11171 && c % 28 ? a : b); }; // 받침 여부로 조사 선택
  // 거리는 위치가 있을 때만 ' · 120m'처럼 구분점과 함께 붙는다. 위치·시간이 흐르며 바뀌는 글자는 매초 그 자리에서 고친다.
  const nearText = anchors => { const l = U.loc(); return l ? ' · ' + fmt.dist(Pl.nearestM(l, anchors)) : ''; };
  const near = anchors => '<span data-near=\'' + JSON.stringify(anchors) + '\'>' + nearText(anchors) + '</span>';
  const ago = t => '<span data-ago="' + t + '">' + fmt.ago(t) + '</span>';
  const MODE_LABEL = { RUN: '달리기', WALK: '산책' };
  const deg = v => { const n = Math.round(v) || 0; return n < 0 ? '−' + -n : String(n); }; // −0 방지, 음수는 수학 기호 마이너스
  Object.assign(U, { $, esc, ic, fmt, pad, josa, near, ago, MODE_LABEL, deg });

  U.catIcon = code => ({ LITTER: 'trash', BULKY_WASTE: 'trash', DUMPING_SUSPECT: 'trash', RIVER_WASTE: 'trash', FOAM: 'wave', WATER_COLOR: 'drop', TURBID: 'drop', OIL_LIKE: 'drop', FLOATING_MATERIAL: 'wave', LOW_FLOW: 'drop', DRY_BED: 'drop', ALGAE_LIKE: 'leaf', DEAD_FISH: 'leaf', BIO_ANOMALY: 'leaf', VEGETATION_DAMAGE: 'leaf', ODOR_NOW: 'wind', ODOR_REPEAT: 'wind', BENCH: 'bench' }[code] || 'wrench');
  U.verifyLabel = v => ({ NONE: '미검토', ADMIN: '운영자 검토', PEER: '다른 계정 사진 추가' }[v]);
  U.demoTag = txt => '<span class="tag-demo">' + (txt || '체험용') + '</span>';

  // 하류를 바라본 기준 좌안 = 월계동 쪽, 우안 = 석관동 쪽
  U.bankOf = pt => {
    const d = arr => Math.min(...arr.map(p => Pl.distM(pt, p)));
    const dl = d(D.G.left), dr = d(D.G.right), dc = d(D.G.center);
    if (dc < 8 && dc < dl && dc < dr) return '하천 안';
    return dl <= dr ? '월계동 쪽 둑' : '석관동 쪽 둑';
  };
  // 공개 필터는 이것 하나: 숨김(HIDDEN)은 지도·목록·묶음·간편 지도 어디에도 나오지 않는다. 참여 가능 여부(Pl.issueClosed)와는 별개.
  U.publicIssues = () => Object.values(S.db.issues).filter(is => is.visibility === 'PUBLIC');
  // ‘지난 기록’: 보관(ARCHIVED, 기록 관리용) · 참여 시간이 끝난 일시 현상 · 사진이 오래된 관찰. 어느 것도 ‘해결’을 뜻하지 않는다.
  U.issueOld = (is, t) => is.lifecycleStatus === 'ARCHIVED' || (is.eventEndsAt && t >= is.eventEndsAt) || Pl.photoStale(is, t);
  U.oldLabel = is => (is.lifecycleStatus === 'ARCHIVED' ? '보관된 기록' : '지난 기록');
  U.quickToday = id => !!S.db.quickMarkers['me|' + id + '|' + Pl.kstDay(U.now())]; // 오늘 이미 남긴 간단 응답(같은 날 다시 눌러도 새 참여가 아님)
  U.curSessionId = () => { const s = U.liveSession(); return s ? s.id : null; }; // 참여를 시작하는 순간의 운동 세션
  U.usableCoupons = () => S.db.coupons.filter(c => c.uid === 'me' && Pl.couponUsable(c, U.now()));

  // 관찰의 비교용 사진: 공개 사진(운영자가 공개로 전환한 사진)만 모두에게, 원본 증거 사진은 촬영한 본인에게만 보인다.
  // ponytail: 체험용 공개 사진은 실제 현장 사진이 아니라 생성 이미지다. 실제로는 식별 요소를 가린 공개 사본을 서버가 따로 보관한다.
  const pubCache = {};
  U.issuePhoto = is => {
    if (is.publicPhoto?.src) return {...is.publicPhoto,kind:'public'};
    const o = Object.values(S.db.obs).filter(x => x.issueId === is.id && x.uid === 'me' && x.photo && !x.late).sort((a, b) => b.observedAt - a.observedAt)[0];
    return o ? { src: o.photo, takenAt: o.observedAt, acceptedAt: o.acceptedAt, kind: 'own' } : null;
  };

  // ---------- 오류·보상 문구 ----------
  const REASON = {
    NO_PHOTO_BASIS: '포인트 없음 · 사진 기록이 생긴 관찰부터 적립돼요',
    ALREADY_CONSUMED: '이 관찰의 포인트는 이미 받았어요',
    ALREADY_TODAY: '오늘 이미 남긴 응답이에요 · 새로 기록하지 않았어요',
    SUBCAP: '오늘 간단 응답 포인트 한도(5P)를 채웠어요',
    DAILY_CAP: '오늘 적립 한도(30P)를 채웠어요',
    CATEGORY_NOT_REWARDED: '냄새 관찰은 포인트가 없어요',
    QUICK_NEW_NO_POINTS: '사진 없는 제보는 포인트가 없어요',
    PENDING_REVIEW: '+5P 검토 후 적립',
    SUPPLEMENT_ONLY: '사진을 보완했어요 · 포인트 없음',
    LATE_PHOTO: '촬영 후 15분이 지나 나만 보는 기록이 됐어요 · 포인트 없음',
    ROUTINE_DAILY_LIMIT: '정기 관찰 포인트는 하루 3회까지예요',
  };
  U.REASON = REASON;
  U.reasonText = r => (r.rewardReason === 'PAID' ? '+' + r.pointsAwarded + 'P 적립' : REASON[r.rewardReason] || '');
  const ERR = {
    NETWORK: '연결이 끊겨 기록되지 않았어요',
    UPLOAD_FAILED: '사진을 올리지 못해 기록되지 않았어요',
    LOCAL_SAVE_FAILED: '이 기기에 저장하지 못해 기록되지 않았어요. 저장 공간을 확인한 뒤 다시 보내 주세요',
    REQUEST_MISMATCH: '이전 요청과 내용이 달라 처리하지 않았어요. 처음부터 다시 보내 주세요',
    TOO_FAR: d => '관찰 지점에서 ' + d.distanceM + 'm 떨어져 있어요. 40m 안에서 참여할 수 있어요',
    GPS_ACCURACY_TOO_LOW: d => '위치 정확도가 낮아요(' + d.accuracyM + 'm). 30m 이하가 되면 참여할 수 있어요',
    LOCATION_STALE: '위치 정보가 오래됐어요. 새 위치를 받는 중이에요',
    PRECISE_LOCATION_REQUIRED: '정확한 위치 권한이 있어야 참여할 수 있어요',
    OWN_ISSUE_RECHECK: '내가 남긴 관찰에는 다시 참여할 수 없어요',
    ISSUE_WINDOW_CLOSED: d => '참여 시간이 끝났어요' + (d.endedAt ? ' (' + fmt.time(d.endedAt) + ')' : ''),
    MISSION_NOT_ACTIVE: '지금은 참여할 수 없는 관찰이에요',
    OBSERVATION_TOO_SOON: d => '같은 관찰은 ' + fmt.time(d.retryAfterAt) + ' 이후 다시 사진으로 남길 수 있어요',
    CAPTURE_TICKET_EXPIRED: '촬영 준비 시간(15분)이 지났어요. 다시 촬영해 주세요',
    PHOTO_TOO_OLD: '촬영한 지 60분이 지나 다시 촬영해야 해요',
    PHOTO_ALREADY_CONSUMED: '이미 제출한 사진이에요. 새로 촬영해 주세요',
    ALREADY_PARTICIPATED: d => '이번 회차에는 이미 기록했어요' + (d.nextRoundAt ? ' · 다음 회차 ' + fmt.time(d.nextRoundAt) : ''),
    ROUND_EXPIRED: '회차가 바뀌었어요. 새 회차에서 다시 촬영해 주세요',
    EXPOSURE_EXPIRED: '알림 참여 시간이 지났어요. 관찰 상세에서 직접 참여할 수 있어요',
    INVALID_ARGUMENT: d => (d.field === 'reason' ? '기존 관찰과 다른 점을 골라 주세요' : d.field === 'pin' ? '위치는 현재 위치에서 50m 안이어야 해요' : d.field === 'displayName' ? '이름은 30자까지 쓸 수 있어요' : '입력값을 확인해 주세요'),
    RATE_LIMITED: '오늘 새 제보 한도(10건)를 채웠어요',
    NOT_OWNER: '내가 남긴 관찰만 보완할 수 있어요',
    PHOTO_REQUIRED: '사진이 필요해요',
    COUPON_EXPIRED: '사용 기간이 지난 혜택이에요',
    COUPON_UNAVAILABLE: '지금 사용할 수 없는 혜택이에요',
    COUPON_LOCKED: d => 'PIN 입력이 잠겼어요 · ' + fmt.time(d.until) + '부터 다시 시도',
    INVALID_MERCHANT_PIN: d => 'PIN이 맞지 않아요 · ' + d.remaining + '회 더 틀리면 10분 동안 잠겨요',
    USE_WINDOW_EXPIRED: '사용 시간 10분이 지났어요. 사용하기를 다시 눌러 주세요',
    MERCHANT_DAILY_LIMIT: '이 점포에서는 오늘 이미 사용했어요',
    REWARD_SOLD_OUT: '준비된 수량이 모두 소진됐어요',
    WELCOME_ADMIN_REQUIRED: '운영자 확인을 기다리고 있어요',
    WELCOME_NOT_ELIGIBLE: '아직 조건을 채우지 않았어요',
  };
  U.errText = r => { const e = ERR[r.errorCode]; return typeof e === 'function' ? e(r.details || {}) : (e || '처리하지 못했어요 (' + r.errorCode + ')'); };

  // 참여 기록의 보상 표시: 원장 상태(검토 중→적립·만료)를 따른다
  U.rewardBadge = o => {
    const x = Pl.obsReward(S.db, o.id);
    if (x.status === 'CONFIRMED') return { text: '+' + x.amount + 'P', cls: 'on', note: '적립' };
    if (x.status === 'PENDING') return { text: '+' + x.amount + 'P', cls: 'pending', note: '검토 중' };
    if (x.status === 'EXPIRED') return { text: x.amount + 'P', cls: 'gone', note: '기한 안에 확인되지 않아 만료' };
    if (x.status === 'REJECTED' || x.status === 'REVERSED') return { text: '0P', cls: 'gone', note: '취소됨' };
    return { text: '0P', cls: '', note: REASON[o.rewardReason] || '포인트 없음' };
  };

  // ---------- 내비게이션 (History API: 뒤로 가기 = 시트 닫기·화면 이전) ----------
  let seq = 0;
  const opener = () => { // 닫힌 뒤 포커스를 돌려줄 요소
    const el = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-act]');
    if (!el) return null;
    return ['act', 'v', 'id'].filter(k => el.dataset[k]).map(k => '[data-' + k + '="' + el.dataset[k] + '"]').join('');
  };
  const nav = U.nav = {
    stack: [], after: null,
    push(kind, name, p) { const e = { kind, name, p: p || {}, key: ++seq, fresh: true, opener: opener() }; this.stack.push(e); history.pushState({ d: this.stack.length }, ''); U.render(); return e; },
    replace(kind, name, p) { const old = this.stack.pop(); if (old) leave(old); const e = { kind, name, p: p || {}, key: ++seq, fresh: true, opener: old && old.opener }; this.stack.push(e); history.replaceState({ d: this.stack.length }, ''); U.render(); return e; },
    back(then) { if (!this.stack.length) return then && then(); this.after = then || null; history.back(); },
    popTo(pred, then) {
      let n = 0;
      for (let i = this.stack.length - 1; i >= 0 && !pred(this.stack[i]); i--) n++;
      if (!n) return then && then();
      this.after = then || null; history.go(-n);
    },
    clear(then) { this.popTo(() => false, then); },
    top() { return this.stack[this.stack.length - 1]; },
    find(name) { return this.stack.find(e => e.name === name); },
  };
  function leave(e) { const f = U.after[e.name + ':leave']; if (f) f(e); }
  history.replaceState({ d: 0 }, '');
  addEventListener('popstate', ev => {
    const d = (ev.state && ev.state.d) || 0;
    const removed = nav.stack.length > d ? nav.stack.splice(d) : [];
    removed.slice().reverse().forEach(leave);
    U.render();
    const f = nav.after; nav.after = null;
    if (f) f();
    else if (removed[0] && removed[0].opener) { const el = document.querySelector(removed[0].opener); if (el) el.focus({ preventScroll: true }); }
  });

  // ---------- 토스트·시스템 대화상자 ----------
  U.toast = (msg, kind) => {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = (kind === 'err' ? ic('warn') : kind === 'ok' ? ic('check') : '') + '<span>' + esc(msg) + '</span>';
    $('#toast-root').appendChild(el);
    setTimeout(() => el.classList.add('out'), 2800);
    setTimeout(() => el.remove(), 3200);
  };
  // Android 권한 창 흉내. 실제 OS 대화상자가 아님을 표시한다.
  U.sys = html => new Promise(res => {
    const root = $('#sys-root'), back = document.activeElement;
    root.innerHTML = '<div class="sys-scrim"></div><div class="sys-dialog" role="alertdialog" aria-modal="true"><p class="sys-tag">Android 권한 창 체험</p>' + html + '</div>';
    root.hidden = false;
    ['#view', '#tabbar', '#stack', '#map-host'].forEach(s => { $(s).inert = true; });
    root.onclick = e => {
      const b = e.target.closest('[data-sys]'); if (!b) return;
      const acc = root.querySelector('input[name=acc]:checked');
      root.hidden = true; root.innerHTML = '';
      U.render();
      if (back && back.isConnected) back.focus({ preventScroll: true });
      res({ v: b.dataset.sys, acc: acc && acc.value });
    };
    const first = root.querySelector('[data-sys]'); if (first) first.focus();
  });

  // ---------- 날씨 ----------
  // 기상·대기질을 따로 받는다. 한쪽이 늦어도 받은 쪽은 바로 보여주고, 홈 패널은 다시 그리지 않는다.
  const WX = U.WX = { forecast: null, air: null, loading: { forecast: false, air: false } };
  U.loadWeather = force => ['forecast', 'air'].forEach(async name => {
    WX.loading[name] = true; updateWeatherDom();
    const r = await Sv.Weather.source(name, { force, simulateFail: S.demo.weatherFail, forceStale: S.demo.weatherStale });
    WX[name] = r; WX.loading[name] = false; updateWeatherDom();
  });
  function wxCurrent() {
    const f = WX.forecast, a = WX.air;
    const cur = f && f.data && f.data.current, acur = a && a.data && a.data.current;
    return { cur: cur && cur.temperature_2m != null ? cur : null, acur, f, a };
  }
  U.wxCurrent = wxCurrent;
  function updateWeatherDom() {
    const el = $('#view .wx'); if (el) el.outerHTML = S.uiMode === 'SIMPLE' ? simpleWx() : weatherBand();
    syncHomePanel();
    const top = nav.top(); if (top && top.name === 'weather') U.render();
  }

  // ---------- 렌더 ----------
  const TABS = [['home', '홈', 'home'], ['map', '지도', 'map'], ['river', '우리 우이천', 'river'], ['records', '기록', 'records'], ['my', '마이', 'user']];
  const simpleList = () => S.uiMode === 'SIMPLE' && !S.simpleMapFull; // 간편모드 지도: 목록 중심
  U.render = () => {
    document.documentElement.dataset.ui = S.uiMode === 'SIMPLE' ? 'simple' : 'default';
    const top = nav.top();
    const topScreen = [...nav.stack].reverse().find(e => e.kind === 'screen');
    // 다시 그려도 키보드 초점이 같은 버튼에 남도록 기억한다
    const fa = document.activeElement, fd = fa && fa.dataset && fa.dataset.act ? fa.dataset : null;
    const fsel = fd ? '[data-act="' + fd.act + '"]' + (fd.v ? '[data-v="' + fd.v + '"]' : '') + (fd.id ? '[data-id="' + fd.id + '"]' : '') : null;
    // 탭 화면
    const view = $('#view'), sc = view.querySelector('.scroll');
    const keep = sc && view.dataset.tab === S.tab ? sc.scrollTop : 0;
    const moreKeep = view.querySelector('.hp-more') ? view.querySelector('.hp-more').scrollTop : 0;
    const nfKeep = view.querySelector('.news-filter') ? view.querySelector('.news-filter').scrollLeft : 0;
    view.dataset.tab = S.tab;
    const mapFull = S.tab === 'map' && !simpleList();
    view.innerHTML = S.tab === 'map' ? (mapFull ? viewMap() : viewMapSimple()) : TAB_VIEW[S.tab]();
    const sc2 = view.querySelector('.scroll'); if (sc2) sc2.scrollTop = keep;
    view.querySelectorAll('.news:not(.open) .news-sum').forEach(el => { if (el.scrollHeight <= el.clientHeight + 1) el.closest('.news').querySelector('[data-act="news-more"]').hidden = true; }); // 짧은 요약은 더 보기 없음
    const nf = view.querySelector('.news-filter'); // 한 줄 분류: 가로 위치를 유지하고 선택한 항목이 보이게
    if (nf) { nf.scrollLeft = nfKeep; const on = nf.querySelector('[aria-pressed="true"]'); if (on && (on.offsetLeft < nf.scrollLeft || on.offsetLeft + on.offsetWidth > nf.scrollLeft + nf.clientWidth)) nf.scrollLeft = on.offsetLeft - 20; }
    $('#map-host').hidden = !mapFull;
    $('#app').classList.toggle('on-map', mapFull);
    syncHomePanel(moreKeep);
    // 스택
    const stackEl = $('#stack');
    const prevScroll = {};
    stackEl.querySelectorAll('[data-key]').forEach(el => { const s = el.querySelector('.scroll'); if (s) prevScroll[el.dataset.key] = s.scrollTop; });
    const idx = topScreen ? nav.stack.indexOf(topScreen) : -1;
    let html = '';
    nav.stack.forEach((e, i) => {
      if (i < idx) return;
      const fn = e.kind === 'screen' ? U.screens[e.name] : U.sheets[e.name];
      if (!fn) return;
      html += e.kind === 'screen' ? screenWrap(e, fn(e)) : sheetWrap(e, fn(e));
    });
    stackEl.innerHTML = html;
    stackEl.querySelectorAll('[data-key]').forEach(el => { const s = el.querySelector('.scroll'); if (s && prevScroll[el.dataset.key]) s.scrollTop = prevScroll[el.dataset.key]; });
    $('#tabbar').innerHTML = TABS.map(([k, label, icon]) => k === 'river'
      ? '<button class="tab tab-center" data-act="tab" data-v="river"' + (S.tab === k ? ' aria-current="page"' : '') + '><span class="tc-circle">' + ic(icon) + '</span><span class="tc-label">' + label + '</span></button>'
      : '<button class="tab" data-act="tab" data-v="' + k + '"' + (S.tab === k ? ' aria-current="page"' : '') + '>' + ic(icon) + '<span>' + label + '</span></button>').join('');
    $('#tabbar').hidden = !!topScreen;
    // 모달 접근성: 열린 맨 위 레이어만 조작 가능
    const modal = nav.stack.length > 0;
    ['#view', '#tabbar', '#map-host'].forEach(s => { $(s).inert = modal; });
    $('#stack').inert = false;
    stackEl.querySelectorAll('[data-key]').forEach(el => { el.inert = !top || el.dataset.key !== String(top.key); });
    const newly = nav.stack.filter(e => e.fresh);
    nav.stack.forEach(e => { e.fresh = false; });
    if (mapFull && !topScreen) MapUI.sync();
    nav.stack.forEach(e => { const f = U.after[e.name]; if (f) f(e, stackEl.querySelector('[data-key="' + e.key + '"]')); });
    if (newly.length && top) { const el = stackEl.querySelector('[data-key="' + top.key + '"] [data-autofocus], [data-key="' + top.key + '"] h1, [data-key="' + top.key + '"] h2'); if (el) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); } }
    else if (fsel && (!document.activeElement || document.activeElement === document.body)) { const el = [...document.querySelectorAll(fsel)].find(x => !x.closest('[inert]')); if (el) el.focus({ preventScroll: true }); }
    lastLive = liveKey();
    if (window.Demo) window.Demo.render();
    U.save();
  };
  function screenWrap(e, inner) {
    return '<section class="screen ' + (e.fresh ? 'enter ' : '') + (e.p.dark ? 'dark ' : '') + 'scr-' + e.name + '" data-key="' + e.key + '" aria-label="' + esc(e.p.title || '') + '">' + inner + '</section>';
  }
  function sheetWrap(e, inner) {
    return '<div class="sheet-layer" data-key="' + e.key + '"><div class="sheet-backdrop" data-act="back"></div>' +
      '<section class="sheet ' + (e.fresh ? 'enter ' : '') + (e.p.tall ? 'tall ' : '') + 'sh-' + e.name + '" role="dialog" aria-modal="true">' +
      '<div class="sheet-grip" data-grip aria-hidden="true"><i></i></div>' + inner + '</section></div>';
  }
  U.appbar = (title, opts) => '<header class="appbar">' + (opts && opts.noBack ? '<span class="appbar-gap"></span>' : '<button class="icon-btn" data-act="back" aria-label="' + (opts && opts.close ? '닫기' : '뒤로') + '">' + ic(opts && opts.close ? 'close' : 'back') + '</button>') +
    '<h1 class="appbar-title">' + esc(title) + '</h1>' + ((opts && opts.right) || '<span class="appbar-gap"></span>') + '</header>';
  U.sheetHead = (title, sub, extra) => '<header class="sheet-head"><div><h2 class="t-h2">' + title + '</h2>' + (sub ? '<p class="t-sub">' + sub + '</p>' : '') + '</div>' + (extra || '') +
    '<button class="icon-btn" data-act="back" aria-label="닫기">' + ic('close') + '</button></header>';

  // ---------- 시간·위치에 따른 화면 갱신 ----------
  // 매초 화면 전체를 다시 그리지 않는다. 거리·경과 시각은 그 자리에서 고치고(near/ago),
  // 참여 가능 여부·회차·날짜처럼 상태가 바뀔 때만 다시 그린다. 패널·시트를 끄는 중이면 다음 틱으로 미룬다.
  function issuesKey() {
    const t = U.now();
    return Pl.kstDay(t) + Object.values(S.db.issues).map(is => is.id + (U.issueOld(is, t) ? 1 : 0) + Pl.todaySignals(is, t)).join() +
      D.ROUTINES.map(r => { const st = Pl.routineState(S.db, 'me', r.id, t); return st.round.id + !!st.mine; }).join();
  }
  const TAB_KEYS = {
    home: () => { const s = U.liveSession(); return (s ? s.status + U.sessionRule(s) : '') + S.signedIn; },
    river: issuesKey, map: () => issuesKey() + !!U.loc(),
    records: () => Pl.kstDay(U.now()) + S.runs.length,
    my: () => [Pl.balance(S.db, 'me'), Pl.pendingSum(S.db, 'me'), U.usableCoupons().length, S.db.users.me.welcomeStatus].join(),
  };
  let lastLive = '';
  function liveKey() {
    const top = nav.top(), f = top && U.liveKeys[top.name];
    return S.tab + '|' + (TAB_KEYS[S.tab] ? TAB_KEYS[S.tab]() : '') + '|' + (f ? top.key + ':' + f(top) : '');
  }
  U.liveTick = () => {
    document.querySelectorAll('[data-near]').forEach(el => { const v = nearText(JSON.parse(el.dataset.near)); if (el.textContent !== v) el.textContent = v; });
    document.querySelectorAll('[data-ago]').forEach(el => { const v = fmt.ago(+el.dataset.ago); if (el.textContent !== v) el.textContent = v; });
    if (pd || drag || cardDrag || !$('#sys-root').hidden) return;
    if (liveKey() !== lastLive) U.render();
  };
  let cardDrag = null; U.setCardDrag = v => { cardDrag = v; };

  // ---------- 홈 ----------
  // 사진은 분위기용. 날씨는 사진 아래 깨끗한 면에 크게: ‘지금 우이천’, 아이콘, 기온, 상태, 보조 1~2개.
  // 상태(불러오는 중·정보 없음·업데이트 지연)는 숨기지 않고, 출처·갱신 시각은 날씨 상세로 보낸다.
  // 보조 정보는 체감·바람·습도 고정. 비가 와도 바람을 빼지 않는다(강수는 상세에). 값이 없으면 ‘–’로 두고 만들어 채우지 않는다.
  function wxSub(cur) {
    const v = (x, f) => (x == null ? '–' : f(x));
    return ['체감 ' + v(cur.apparent_temperature, x => deg(x) + '°'), '바람 ' + v(cur.wind_speed_10m, x => x.toFixed(1) + 'm/s'), '습도 ' + v(cur.relative_humidity_2m, x => Math.round(x) + '%')]
      .map(x => '<span>' + x + '</span>').join('');
  }
  function weatherBand() { // 높이는 상태와 관계없이 같게(보조 줄 자리를 늘 둔다) — 홈 패널 위치가 흔들리지 않게
    const { cur, f } = wxCurrent();
    const head = '<span class="wx-where">지금 우이천</span>', blank = '<span class="wx-sub" aria-hidden="true"><span class="wx-sub-in"><span>&nbsp;</span></span></span>';
    if (!cur && WX.loading.forecast) return '<div class="wx" aria-busy="true"><span class="wx-ic sk"></span><span class="wx-temp num sk">00°</span><span class="wx-txt">' + head + '<span class="wx-cond">날씨를 불러오는 중</span></span>' + blank + '</div>';
    if (!cur) return '<div class="wx"><span class="wx-ic">' + ic('warn') + '</span><span class="wx-txt wide">' + head + '<span class="wx-cond">날씨를 불러오지 못했어요</span></span><button class="btn btn-sm btn-line" data-act="wx-retry">다시 시도</button>' + blank + '</div>';
    const stale = f.status === 'stale';
    return '<button class="wx" data-act="sheet" data-v="weather" aria-label="우이천 날씨 자세히 보기">' +
      '<span class="wx-ic">' + ic(Sv.Weather.icon(cur.weather_code, cur.is_day)) + '</span>' +
      '<span class="wx-temp num">' + deg(cur.temperature_2m) + '<span class="deg">°</span></span>' +
      '<span class="wx-txt">' + head + '<span class="wx-cond">' + esc(Sv.Weather.label(cur.weather_code)) + '</span></span>' + ic('chev') +
      '<span class="wx-sub' + (stale ? ' warn' : '') + '"><span class="wx-sub-in">' + (stale ? '<span>' + ic('clock') + '업데이트 지연 · ' + fmt.time(f.fetchedAt) + ' 수신</span>' : wxSub(cur)) + '</span></span></button>';
  }
  function simpleWx() {
    const { cur, f } = wxCurrent();
    const body = cur ? '<span class="wx-ic">' + ic(Sv.Weather.icon(cur.weather_code, cur.is_day)) + '</span><b class="num">' + deg(cur.temperature_2m) + '°</b><span>' + esc(Sv.Weather.label(cur.weather_code)) + (f.status === 'stale' ? ' · 업데이트 지연' : '') + '</span>'
      : WX.loading.forecast ? '<span>불러오는 중</span>' : '<span>' + ic('warn') + '날씨 정보 없음</span>';
    return '<button class="wx wx-simple" data-act="sheet" data-v="weather" aria-label="우이천 날씨 자세히 보기"><span class="wx-where">지금 우이천</span>' + body + '</button>';
  }

  // 코스 미리보기: 분위기 사진 + 실제 코스 데이터로 그린 간략 경로도 + 이름·거리·출발 + 선택. 선택하면 지도에서 같은 코스가 선택된다.
  function routeArt(c, w, h) {
    const end = c.out[c.out.length - 1];
    return Sv.routeSvg({ lines: [{ pts: D.G.center, cls: 'art-river' }, { pts: c.out, cls: 'art-route-casing' }, { pts: c.out, cls: 'art-route' }], dots: [{ pt: end, cls: 'art-turn', r: 4.5 }, { pt: c.out[0], cls: 'art-start', r: 6 }], w, h, pad: 14, fit: c.out });
  }
  U.routeArt = routeArt;
  // 사진이 주인공. 작은 그림은 코스 모양만: 투명 바탕 위 대표 블루 선 + 얇은 흰 외곽선(사진에 묻히지 않게). 출발·반환 표시는 지도와 결과 화면에서.
  const miniArt = c => Sv.routeSvg({ lines: [{ pts: c.out, cls: 'art-route-casing' }, { pts: c.out, cls: 'art-route' }], dots: [], w: 96, h: 72, pad: 8, fit: c.out });
  function courseCard(c) {
    const ph = D.PHOTOS[c.photo];
    return '<button class="course-card" data-act="map-course" data-id="' + c.id + '">' +
      '<span class="cc-media"><img src="' + ph.src + '" alt="" loading="lazy" style="object-position:' + (ph.pos || '50% 50%') + '"><span class="cc-mini" aria-hidden="true">' + miniArt(c) + '</span></span>' +
      '<span class="cc-info"><b>' + esc(c.name) + '</b><span><b class="num">' + (c.distanceM / 1000).toFixed(1) + '</b>km 왕복 · ' + esc(c.start) + '</span></span>' +
      '<span class="cc-go">지도에서 보기' + ic('chev') + '</span></button>';
  }

  function welcomeStatusText(st, n) {
    return { LOCKED: '사진 기여 ' + (P.welcomeTarget - n) + '회 더 필요해요', PENDING_ADMIN: '운영자 확인 중', APPROVED: '받을 수 있어요', ISSUED: '받았어요', SOLD_OUT: '수량이 소진됐어요' }[st];
  }
  U.welcomeStatusText = welcomeStatusText;
  function welcomeRow(act) { // 마이페이지에서는 웰컴 화면으로, 홈 요약에서는 마이페이지 혜택 영역으로
    const n = Math.min(P.welcomeTarget, Pl.welcomeCount(S.db, 'me')), u = S.db.users.me;
    return '<button class="row" ' + (act || 'data-act="screen" data-v="welcome"') + '>' + ic('gift') + '<span class="row-main"><b>웰컴 혜택 ' + n + '/3</b><span>' + welcomeStatusText(u.welcomeStatus, n) + '</span></span>' + ic('chev') + '</button>';
  }
  U.welcomeRow = welcomeRow;

  // 진행 중 세션: 6시간이 지난 세션은 이어서 기록할 수 없어 정리 화면으로 보낸다(§14.1)
  U.liveSession = () => { const s = S.session; return s && (s.status === 'ACTIVE' || s.status === 'PAUSED') ? s : null; };
  U.sessionRule = s => Pl.sessionAgeRule(s.startedAt, U.now());

  function startBlock() {
    const s = U.liveSession();
    if (s) {
      const ok = U.sessionRule(s) === 'RESUME';
      return '<button class="btn btn-start" data-act="open-run">' + ic(ok ? 'play' : 'history') + '<span class="lbl">' + (ok ? '진행 중인 ' + MODE_LABEL[s.mode] + '으로' : '끝나지 않은 운동 정리') + '</span></button>';
    }
    return '<div class="seg" role="radiogroup" aria-label="운동 종류">' +
      ['RUN', 'WALK'].map(m => '<button role="radio" aria-checked="' + (S.mode === m) + '" data-act="mode" data-v="' + m + '">' + MODE_LABEL[m] + '</button>').join('') + '</div>' +
      '<button class="btn btn-start" data-act="start">' + ic('play') + '<span class="lbl">' + MODE_LABEL[S.mode] + ' 시작</span></button>';
  }

  function viewHome() {
    if (S.uiMode === 'SIMPLE') return viewHomeSimple();
    const ph = D.PHOTOS.hero, open = S.homeOpen;
    return '<div class="home' + (open ? ' is-open' : '') + '">' +
      '<div class="home-photo"><img class="hero-img" src="' + ph.src + '" alt="파란 산책로와 붉은 주로가 이어지는 하천 산책로 풍경" style="object-position:' + (ph.pos || '50% 45%') + '" onerror="this.parentNode.classList.add(\'noimg\')"><span class="hero-fade"></span>' +
      '<div class="hero-top"><img class="logo" src="' + U.LOGO.dark + '" alt="우이런">' + (S.signedIn ? '' : '<button class="hero-login" data-act="login">로그인</button>') + '</div></div>' +
      weatherBand() +
      '<section class="home-panel' + (open ? ' open' : '') + '" aria-label="운동">' +
      '<div class="hp-peek">' +
      '<button class="hp-handle" data-act="panel-toggle" aria-expanded="' + open + '" aria-controls="hp-more"><i aria-hidden="true"></i><span class="hp-hint">' + ic('up') + '<span>' + (open ? '접기' : '코스 보기') + '</span></span></button>' +
      startBlock() +
      '<div class="hp-links">' +
      '<button data-act="report">' + ic('flag') + '환경 제보</button>' +
      '<button data-act="benefits" data-v="benefits">' + ic('ticket') + '내 혜택</button>' +
      '</div></div>' +
      '<div class="hp-more scroll" id="hp-more">' +
      '<h2 class="sec-title">우이천 코스</h2>' +
      '<div class="hscroll">' + D.COURSES.map(courseCard).join('') + '</div>' +
      '<h2 class="sec-title">포인트·혜택</h2>' + homeSummary() +
      '</div></section></div>';
  }
  function homeSummary() { // 마이페이지와 같은 원장·웰컴 데이터. 누르면 마이페이지의 해당 영역으로
    if (!S.signedIn) return '<p class="t-sub">로그인하면 포인트와 혜택이 여기에 모여요.</p><button class="btn btn-line" data-act="login">로그인</button>';
    return '<div class="rows">' +
      '<button class="row" data-act="benefits" data-v="points">' + ic('coins') + '<span class="row-main"><b>내 포인트</b>' + (Pl.pendingSum(S.db, 'me') ? '<span>검토 중 ' + Pl.pendingSum(S.db, 'me') + 'P 별도</span>' : '') + '</span><b class="row-num num">' + Pl.balance(S.db, 'me') + '<i>P</i></b>' + ic('chev') + '</button>' +
      welcomeRow() + '</div>';
  }

  // 간편모드 홈: 슬라이드 없이 날씨·운동·제보·혜택이 바로 보이고, 작은 화면에서는 전체가 스크롤된다
  function viewHomeSimple() {
    const live = U.liveSession();
    return '<div class="scroll home-simple">' +
      '<header class="simple-top"><img src="' + D.PHOTOS.hero.src + '" alt="" style="object-position:' + (D.PHOTOS.hero.pos || '50% 45%') + '" onerror="this.remove()"><img class="logo" src="' + U.LOGO.dark + '" alt="우이런"></header>' +
      '<div class="simple-body">' + simpleWx() +
      (live ? startBlock() :
        '<button class="btn btn-start" data-act="start" data-v="WALK">' + ic('play') + '<span class="lbl">산책 시작</span></button>' +
        '<button class="btn btn-line btn-big" data-act="start" data-v="RUN">' + ic('play') + '달리기 시작</button>') +
      '<div class="rows big">' +
      '<button class="row" data-act="report">' + ic('flag') + '<span class="row-main"><b>환경 제보</b></span>' + ic('chev') + '</button>' +
      '<button class="row" data-act="benefits" data-v="points">' + ic('ticket') + '<span class="row-main"><b>포인트·혜택</b><span>' + (S.signedIn ? '적립 ' + Pl.balance(S.db, 'me') + 'P · 혜택 ' + U.usableCoupons().length + '장' : '로그인 필요') + '</span></span>' + ic('chev') + '</button>' +
      '<button class="row" data-act="tab" data-v="map">' + ic('wc') + '<span class="row-main"><b>주변 시설</b></span>' + ic('chev') + '</button></div>' +
      '<button class="link-btn" data-act="simple-off">일반 화면으로</button></div></div>';
  }

  // 홈 패널: 접힘/펼침 두 상태. 접힌 높이는 실제 조작부 높이. 상태를 바꿀 때 같은 요소를 그대로 두고 클래스만 바꾼다.
  function syncHomePanel(moreKeep) {
    const p = $('#view .home-panel'); if (!p) return;
    const home = p.parentElement, wx = home.querySelector('.wx'), peek = p.querySelector('.hp-peek');
    // 접힌 높이는 접힌 배치에서 잰다(펼치면 조작부가 한 줄로 줄어든다). 재는 동안에는 전환을 꺼서 움직임이 생기지 않게 한다.
    const open = p.classList.contains('open');
    if (open) { p.classList.add('measure'); p.classList.remove('open'); }
    home.style.setProperty('--peek-h', peek.offsetHeight + 'px');
    if (open) { p.classList.add('open'); void p.offsetHeight; p.classList.remove('measure'); }
    if (wx) home.style.setProperty('--wx-h', wx.offsetHeight + 'px');
    const more = p.querySelector('.hp-more');
    more.inert = !S.homeOpen;
    if (moreKeep) more.scrollTop = moreKeep;
  }
  addEventListener('resize', () => syncHomePanel());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => syncHomePanel());
  U.setHomeOpen = open => {
    S.homeOpen = open; U.save();
    const p = $('#view .home-panel'); if (!p) return;
    p.classList.toggle('open', open); p.parentElement.classList.toggle('is-open', open);
    const h = p.querySelector('.hp-handle'); h.setAttribute('aria-expanded', open); h.querySelector('.hp-hint span').textContent = open ? '접기' : '코스 보기';
    const more = p.querySelector('.hp-more'); more.inert = !open; if (!open) more.scrollTop = 0;
  };

  // ---------- 지도 ----------
  // 기본은 ‘전체’: 코스·현재 관찰·시설을 함께, 확대 수준에 따라 밀도 조절. 나머지는 해당 정보에 집중한 보기.
  const MODES = [['all', '전체'], ['course', '코스'], ['issue', '관찰'], ['fac', '시설']];
  const LANDMARKS = { bridge: ['광운로 교량', () => D.G.center[D.G.idx.gwangunBridge]], down: ['석계역 방면 하류 끝', () => D.COURSES[0].out[0]], up: ['파일럿 구간 상류 끝', () => D.COURSES[0].out[D.COURSES[0].out.length - 1]] };
  function viewMap() {
    if (!Sv.MapKit.available()) return viewMapFallback();
    const mode = S.mapMode, sel = S.mapSel;
    return '<div class="map-ui">' +
      '<div class="map-top">' + (S.uiMode === 'SIMPLE' ? '<button class="btn btn-sm btn-white map-back" data-act="simple-map-list">' + ic('back') + '목록으로</button>' : '') +
      '<div class="map-filter-box"><div class="map-filter" role="tablist" aria-label="지도에서 볼 것">' + MODES.map(([k, l]) => '<button role="tab" aria-selected="' + (mode === k) + '" data-act="map-mode" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      (mode === 'issue' ? '<label class="map-sub"><span>지난 기록 포함</span><input type="checkbox" role="switch" data-act="map-old"' + (S.mapOld ? ' checked' : '') + '></label>' : '') + '</div></div>' +
      (mode === 'issue' && S.mapOld ? '<p class="map-banner">회색 핀은 참여가 끝났거나 사진이 오래된 지난 기록이에요. 해결 여부와는 관계없어요.</p>' : '') +
      (Sv.MapKit.fileMode ? '<p class="map-banner err">' + ic('warn') + '<span>' + U.fileHint + '</span></p>' :
        MapUI.failed || S.demo.mapFail ? '<p class="map-banner err">' + ic('warn') + '<span>지도 이미지를 불러오지 못했어요.</span><button class="link-btn" data-act="map-retry">다시 시도</button></p>' : '') +
      '<button class="map-fab" data-act="locate" aria-label="내 위치로 이동">' + ic('locate') + '</button>' +
      (sel ? mapCard(sel) : mode === 'all' ? '<button class="btn btn-blue map-report" data-act="report">' + ic('flag') + '환경 제보</button>' : mapList(mode)) +
      '</div>';
  }
  // 집중 보기의 목록: 목록에서 고르면 지도에서도 선택된다
  function listItems(mode) {
    const t = U.now(), l = U.loc(), d = pts => (l ? Pl.nearestM(l, pts) : 0);
    if (mode === 'course') return D.COURSES.map(c => ({ key: 'course:' + c.id, ic: 'route', title: c.name, meta: (c.distanceM / 1000).toFixed(1) + 'km 왕복 · ' + c.start + ' 출발', pts: [c.out[0]], dist: d([c.out[0]]) }));
    if (mode === 'fac') return D.FACILITIES.map(f => ({ key: 'fac:' + f.id, ic: f.type === 'toilets' ? 'wc' : 'bike', title: f.name, meta: U.bankOf([f.lat, f.lng]), pts: [[f.lat, f.lng]], dist: d([[f.lat, f.lng]]) })).sort((a, b) => a.dist - b.dist);
    const iss = U.publicIssues().filter(is => S.mapOld || !U.issueOld(is, t))
      .map(is => ({ key: 'issue:' + is.id, ic: U.catIcon(is.categoryCode), title: CAT[is.categoryCode].label + (U.issueOld(is, t) ? ' · ' + U.oldLabel(is) : ''), meta: (CAT[is.categoryCode].scope === 'CORRIDOR' ? '하천' : '둑길') + ' · ' + (is.lastPhotoObservedAt ? '사진 ' + fmt.ago(is.lastPhotoObservedAt) : '사진 없음'), pts: is.observationAnchors, dist: d(is.observationAnchors) }));
    const rts = D.ROUTINES.map(r => { const st = Pl.routineState(S.db, 'me', r.id, t); return { key: 'routine:' + r.id, ic: 'repeat', title: '정기 관찰 · ' + r.name, meta: st.mine ? '이번 회차 참여함' : '이번 회차 참여 전', pts: r.anchors, dist: d(r.anchors) }; });
    return iss.concat(rts).sort((a, b) => a.dist - b.dist);
  }
  function mapList(mode) {
    const items = listItems(mode);
    return '<div class="map-sheet map-list" role="region" aria-label="목록"><div class="ml-rows scroll">' + items.map(it => '<button class="row" data-act="map-pick" data-v="' + it.key + '">' + ic(it.ic) + '<span class="row-main"><b>' + esc(it.title) + '</b><span>' + esc(it.meta) + near(it.pts) + '</span></span>' + ic('chev') + '</button>').join('') + '</div></div>';
  }
  function viewMapFallback() {
    const t = U.now();
    return '<div class="scroll pad"><h1 class="t-title">지도</h1><p class="notice err">' + ic('warn') + '지도 라이브러리를 불러오지 못했어요. 목록으로 볼 수 있어요.</p>' +
      '<h2 class="sec-title">관찰</h2><div class="rows">' + U.publicIssues().filter(is => !U.issueOld(is, t)).map(obsRow).join('') + '</div>' +
      '<h2 class="sec-title">시설</h2><div class="rows">' + D.FACILITIES.map(f => '<button class="row" data-act="facility" data-id="' + f.id + '"><span class="row-main"><b>' + f.name + '</b><span>OSM 등록 위치</span></span>' + ic('chev') + '</button>').join('') + '</div></div>';
  }
  function mapCard(sel) {
    const [kind, id] = sel.split(':'), t = U.now();
    const close = '<button class="icon-btn" data-act="map-unsel" aria-label="선택 해제">' + ic('close') + '</button>';
    if (kind === 'course') {
      const c = D.COURSES.find(x => x.id === id);
      return '<div class="map-sheet" role="region" aria-label="선택한 코스"><div class="ms-head"><div><h2>' + esc(c.name) + '</h2>' +
        '<p><b class="num">' + (c.distanceM / 1000).toFixed(1) + '</b>km 왕복 · ' + esc(c.start) + ' 출발</p></div>' + close + '</div>' +
        '<p class="ms-note">현장 확인 전 경로예요. 하천선을 따라 그린 선이라 실제 길과 다를 수 있어요.</p>' +
        '<button class="btn btn-start" data-act="course-start" data-id="' + c.id + '">' + ic('play') + '<span class="lbl">이 코스로 시작</span></button></div>';
    }
    let title, meta, act, thumb = '';
    if (kind === 'issue') {
      const is = S.db.issues[id], c = CAT[is.categoryCode], ph = U.issuePhoto(is);
      title = c.label + (U.issueOld(is, t) ? ' · ' + U.oldLabel(is) : ''); act = 'issue';
      meta = (c.scope === 'CORRIDOR' ? '하천' : '둑길') + near(is.observationAnchors) + ' · ' + (is.eventEndsAt && t >= is.eventEndsAt ? '참여 종료' : is.lastPhotoObservedAt ? '사진 ' + ago(is.lastPhotoObservedAt) : '사진 없음');
      if (ph) thumb = '<img class="ms-thumb" src="' + ph.src + '" alt="' + (ph.kind === 'own' ? '내가 찍은 사진' : '공개 사진') + '">';
    } else if (kind === 'routine') {
      const r = D.ROUTINES.find(x => x.id === id), st = Pl.routineState(S.db, 'me', id, t);
      title = '정기 관찰 · ' + esc(r.name); act = 'routine'; meta = esc(r.bankLabel) + near(r.anchors) + ' · ' + (st.mine ? '이번 회차 참여함' : '이번 회차 참여 전');
    } else {
      const f = D.FACILITIES.find(x => x.id === id);
      title = f.name; act = 'facility'; meta = U.bankOf([f.lat, f.lng]) + near([[f.lat, f.lng]]) + ' · OSM 등록 위치';
    }
    return '<div class="map-sheet" role="region" aria-label="선택한 항목"><div class="ms-head">' + thumb + '<div><h2>' + title + '</h2><p>' + meta + '</p></div>' + close + '</div>' +
      '<button class="btn btn-blue" data-act="' + act + '" data-id="' + id + '">자세히 보기</button></div>';
  }

  const C_ = { blue: '#384BF0', deep: '#222759', lime: '#CAFF42', water: '#D8E6F3' };
  const bearing = (a, b) => { const p = MapUI.map.latLngToContainerPoint(a), q = MapUI.map.latLngToContainerPoint(b); return Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI; };
  function alongPath(pts, f) { // 경로 길이의 f 지점과 그 진행 방향
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Pl.distM(pts[i - 1], pts[i]));
    const target = cum[cum.length - 1] * f; let i = cum.findIndex(x => x >= target); if (i <= 0) i = 1;
    const k = (target - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), a = pts[i - 1], b = pts[i];
    return { pt: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], a, b };
  }
  const MapUI = U.MapUI = {
    map: null, layer: null, tileErr: 0, tileOk: 0, failed: false,
    ensure() {
      if (this.map || !Sv.MapKit.available()) return !!this.map;
      this.map = Sv.MapKit.create($('#map-host'), { center: D.PILOT.center, zoom: 16 });
      this.layer = L.layerGroup().addTo(this.map);
      this.map.on('click', () => { if (S.mapSel) { S.mapSel = null; U.render(); } });
      this.map.on('zoomend', () => this.draw()); // 선 굵기·묶음·사진 표시를 확대 수준에 맞춘다
      const tl = this.map._uirunTiles;
      tl.on('tileerror', () => { this.tileErr++; if (this.tileErr > 4 && !this.tileOk && !this.failed) { this.failed = true; U.render(); } });
      tl.on('tileload', () => { this.tileOk++; if (this.failed && !S.demo.mapFail) { this.failed = false; U.render(); } });
      return true;
    },
    sync() {
      if (!this.ensure()) return;
      const tl = this.map._uirunTiles;
      const off = S.demo.mapFail || Sv.MapKit.fileMode;
      if (off && this.map.hasLayer(tl)) { this.map.removeLayer(tl); this.failed = true; }
      if (!off && !this.map.hasLayer(tl)) { tl.addTo(this.map); this.failed = false; this.tileErr = 0; }
      this.map.invalidateSize();
      // 지도 출처 표기가 하단 시트에 가리지 않게 시트 높이만큼 올린다(시트를 끌어도 따라감)
      const host = $('#map-host'), sh = $('#view .map-sheet');
      this.ro = this.ro || new ResizeObserver(e => host.style.setProperty('--sheet-h', e[0].target.offsetHeight + 'px'));
      this.ro.disconnect(); host.style.setProperty('--sheet-h', '0px'); if (sh) this.ro.observe(sh);
      this.draw();
    },
    retry() { if (Sv.MapKit.fileMode) return; this.tileErr = 0; this.tileOk = 0; this.failed = false; S.demo.mapFail = false; this.map._uirunTiles.redraw(); U.render(); },
    draw() {
      if (!this.map) return;
      const g = this.layer, map = this.map, t = U.now(), sel = S.mapSel, mode = S.mapMode, z = map.getZoom();
      g.clearLayers();
      const icon = Sv.MapKit.icon, pick = key => e => { L.DomEvent.stopPropagation(e); U.selectOnMap(key); };
      const showC = mode === 'all' || mode === 'course', showI = mode === 'all' || mode === 'issue', showF = mode === 'fac' || (mode === 'all' && z >= 16);
      L.polyline(D.PILOT.line, { color: C_.water, weight: z >= 17 ? 24 : 14, opacity: 0.9, interactive: false }).addTo(g); // 파일럿 구간 하천
      if (showC) {
        const on = sel && sel.startsWith('course:') ? D.COURSES.find(c => 'course:' + c.id === sel) : null;
        D.COURSES.filter(c => c !== on).forEach(c => { // 미선택 코스: 얇지만 보이게(흰 외곽선 + 반투명 블루) + 출발점 표시
          L.polyline(c.out, { color: '#fff', weight: 6, opacity: 0.9, interactive: false }).addTo(g);
          L.polyline(c.out, { color: C_.blue, weight: 3, opacity: on ? 0.3 : 0.5, interactive: false }).addTo(g);
          L.polyline(c.out, { color: '#000', weight: 26, opacity: 0 }).on('click', pick('course:' + c.id)).addTo(g); // 누르기 쉬운 폭
          L.marker(c.out[0], { icon: icon('<i class="mk-cdot"></i>', [14, 14]), interactive: false }).addTo(g);
        });
        if (on) {
          const w = z >= 17 ? 7 : z >= 16 ? 6 : 5, end = on.out[on.out.length - 1];
          L.polyline(on.out, { color: '#fff', weight: w + 5, opacity: 1, interactive: false }).addTo(g);
          L.polyline(on.out, { color: C_.blue, weight: w, opacity: 1, interactive: false }).addTo(g);
          [0.3, 0.62].forEach(f => { const a = alongPath(on.out, f); L.marker(a.pt, { icon: icon('<i class="mk-dir" style="transform:rotate(' + bearing(a.a, a.b).toFixed(0) + 'deg)">' + ic('arrow') + '</i>', [22, 22]), interactive: false, zIndexOffset: 300 }).addTo(g); });
          L.marker(end, { icon: icon('<div class="mk-end turn"><i>' + ic('repeat') + '</i><b>반환점</b></div>', [86, 30], [15, 15]), interactive: false, zIndexOffset: 400 }).addTo(g);
          L.marker(on.out[0], { icon: icon('<div class="mk-end start"><i>' + ic('play') + '</i><b>출발·도착</b></div>', [100, 30], [15, 15]), interactive: false, zIndexOffset: 500 }).addTo(g);
        }
      }
      if (showF) D.FACILITIES.forEach(f => { // 시설: 밝은 바탕의 각진 표시 + 아이콘. 보이는 크기와 별개로 44px 터치 영역
        const on = sel === 'fac:' + f.id;
        L.marker([f.lat, f.lng], { title: f.name, zIndexOffset: on ? 3000 : -200, icon: icon('<div class="mk-fac' + (on ? ' sel' : '') + '"><i>' + ic(f.type === 'toilets' ? 'wc' : 'bike') + '</i></div>', [44, 44]) }).on('click', pick('fac:' + f.id)).addTo(g);
      });
      if (showI) {
        const old = mode === 'issue' && S.mapOld, items = [];
        U.publicIssues().forEach(is => {
          const isOld = U.issueOld(is, t);
          if (isOld && !old) return;
          items.push({ key: 'issue:' + is.id, ll: is.anchor, title: CAT[is.categoryCode].label, cls: (is.availablePhotoCount ? '' : ' nophoto') + (isOld ? ' old' : ''), ic: U.catIcon(is.categoryCode), is, old: isOld });
        });
        D.ROUTINES.forEach(r => items.push({ key: 'routine:' + r.id, ll: r.anchors[0], title: '정기 관찰 ' + r.name, routine: true }));
        const selItem = items.find(i => i.key === sel);
        const pinHtml = (i, on) => {
          if (i.routine) return '<div class="mk-routine' + (on ? ' sel' : '') + '"><i>' + ic('repeat') + '</i></div>';
          const ph = (on || z >= 18) && U.issuePhoto(i.is); // 사진은 선택했거나 가까이 확대했을 때만 작은 원형으로
          return '<div class="pin-obs' + i.cls + (on ? ' sel' : '') + (ph ? ' photo' : '') + '"><span>' + (ph ? '<img src="' + ph.src + '" alt="">' : ic(i.ic)) + '</span>' + (i.old ? '<b class="pin-tag">' + (i.is.lifecycleStatus === 'ARCHIVED' ? '보관' : '지난') + '</b>' : '') + '</div>';
        };
        const size = (i, on) => (i.routine ? [40, 40] : on ? [46, 56] : [36, 44]), anchor = (i, on) => (i.routine ? [20, 20] : on ? [23, 56] : [18, 44]);
        // ponytail: 표시가 겹칠 만큼(32px 안) 가까운 것만 단순히 묶는다(O(n²)). 관찰이 수백 건이면 공간 색인(markercluster 등)으로 바꾼다.
        const groups = [];
        items.filter(i => i !== selItem).forEach(i => { const p = map.latLngToContainerPoint(i.ll), gr = groups.find(x => x.p.distanceTo(p) < 32); if (gr) gr.items.push(i); else groups.push({ p, items: [i] }); });
        groups.forEach(gr => {
          if (gr.items.length === 1) { const i = gr.items[0]; return L.marker(i.ll, { title: i.title, icon: icon(pinHtml(i, false), size(i, false), anchor(i, false)) }).on('click', pick(i.key)).addTo(g); }
          const b = L.latLngBounds(gr.items.map(i => i.ll));
          L.marker(b.getCenter(), { title: '관찰 ' + gr.items.length + '건 · 눌러서 확대', icon: icon('<div class="mk-cluster">' + gr.items.length + '</div>', [40, 40]) })
            .on('click', e => { L.DomEvent.stopPropagation(e); if (z >= 18) return nav.push('sheet', 'cluster', { keys: gr.items.map(i => i.key) }); map.fitBounds(b.pad(0.2), { padding: [80, 80], maxZoom: Math.min(19, z + 2), animate: false }); }).addTo(g); // 더 확대해도 겹치면 목록으로
        });
        if (selItem) {
          if (selItem.is) selItem.is.observationAnchors.filter(a => Pl.distM(a, selItem.is.anchor) > 8).forEach(a => { // 현상 위치와 서서 보는 위치를 선택했을 때만 잇는다
            L.polyline([a, selItem.is.anchor], { color: C_.deep, weight: 2, dashArray: '3 5', interactive: false }).addTo(g);
            L.marker(a, { icon: icon('<div class="mk-anchor"><i></i><b>여기서 보기</b></div>', [96, 24], [8, 12]), interactive: false }).addTo(g);
          });
          L.marker(selItem.ll, { title: selItem.title, zIndexOffset: 3000, icon: icon(pinHtml(selItem, true), size(selItem, true), anchor(selItem, true)) }).addTo(g);
        }
      }
      const here = U.loc();
      if (here) {
        L.circle([here.lat, here.lng], { radius: here.accuracyM, color: C_.blue, weight: 1, opacity: 0.35, fillOpacity: 0.07, interactive: false }).addTo(g);
        L.marker([here.lat, here.lng], { title: '내 위치', icon: icon('<div class="mk-me"></div>', [22, 22]), interactive: false, keyboard: false, zIndexOffset: 2000 }).addTo(g);
      }
    },
    focus(latlng, z, o) { if (this.map) this.map.setView(latlng, z || Math.max(this.map.getZoom(), 17), o); },
    // 하단 목록·요약·상단 필터에 가리지 않게 대상을 맞춘다
    fit(bounds, zoom) {
      if (!this.map) return;
      const b = L.latLngBounds(bounds), card = $('#view .map-sheet'), topEl = $('#view .map-top');
      const padB = (card ? card.offsetHeight : 0) + 28, padT = (topEl ? topEl.offsetTop + topEl.offsetHeight : 60) + 20;
      if (Pl.distM([b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]) < 40) { this.map.setView(b.getCenter(), zoom || 18, { animate: false }); this.map.panBy([0, (padB - padT) / 2], { animate: false }); }
      else this.map.fitBounds(b, { maxZoom: zoom || 18, paddingTopLeft: [32, padT], paddingBottomRight: [96, padB], animate: false }); // 오른쪽은 출발·반환 이름표 자리
    },
  };
  const modeOf = sel => ({ issue: 'issue', routine: 'issue', course: 'course', fac: 'fac' }[sel.split(':')[0]]);
  const boundsOf = sel => {
    const [k, id] = sel.split(':');
    if (k === 'course') return D.COURSES.find(c => c.id === id).out;
    if (k === 'issue') { const is = S.db.issues[id]; return [is.anchor, ...is.observationAnchors]; }
    if (k === 'routine') return D.ROUTINES.find(r => r.id === id).anchors;
    const f = D.FACILITIES.find(x => x.id === id); return [[f.lat, f.lng]];
  };
  // 지도 안에서 고르기: ‘전체’에서는 전체 보기를 유지하고, 집중 보기에서는 그 보기를 유지한다. 코스는 전체가 보이게 맞춘다.
  U.selectOnMap = sel => {
    S.mapSel = sel; if (S.mapMode !== 'all') S.mapMode = modeOf(sel);
    if (sel.startsWith('course:')) S.simpleCourse = sel.split(':')[1]; // 간편 지도로 돌아가도 같은 코스
    U.render(); if (sel.startsWith('course:')) MapUI.fit(boundsOf(sel), 17);
  };
  // 다른 화면에서 특정 대상을 지도로 열기: 그 대상이 선택된 상태로 진입(간편모드에서는 큰 지도로)
  U.showOnMap = (sel, bounds, zoom) => nav.clear(() => {
    S.tab = 'map'; S.mapSel = sel; S.mapMode = modeOf(sel); S.simpleMapFull = true;
    if (sel.startsWith('course:')) S.simpleCourse = sel.split(':')[1];
    if (sel.startsWith('issue:')) S.mapOld = !!U.issueOld(S.db.issues[sel.split(':')[1]], U.now());
    U.render();
    MapUI.fit(bounds || boundsOf(sel), zoom || (sel.startsWith('course:') ? 17 : 18));
  });

  // 간편모드 지도: 목적을 먼저 고르고, 가까운 항목을 큰 행으로. 지도는 위치 이해를 돕는 보조 그림.
  // 위치 권한이 없으면 거리를 지어내지 않고 기준 구간을 고르게 한다.
  function viewMapSimple() {
    const pur = S.simplePurpose, here = U.loc();
    const ref = here ? [here.lat, here.lng] : S.simpleAnchor ? LANDMARKS[S.simpleAnchor][1]() : null;
    const refName = here ? '' : S.simpleAnchor ? LANDMARKS[S.simpleAnchor][0] + '에서 ' : '';
    const dist = pts => (ref ? Pl.nearestM({ lat: ref[0], lng: ref[1] }, pts) : null);
    const t = U.now(), sc = D.COURSES.find(c => c.id === S.simpleCourse) || D.COURSES[0];
    const pub = U.publicIssues().filter(is => S.mapOld || !U.issueOld(is, t));
    let items;
    if (pur === 'course') items = D.COURSES.map(c => ({ ic: 'route', title: c.name, kind: (c.distanceM / 1000).toFixed(1) + 'km 왕복', d: dist([c.out[0]]), dTo: '출발점까지 ', act: 'course-info', id: c.id, label: '코스 정보', pick: true }));
    else if (pur === 'fac') items = D.FACILITIES.map(f => ({ ic: f.type === 'toilets' ? 'wc' : 'bike', title: f.name, kind: '시설', d: dist([[f.lat, f.lng]]), act: 'fac-map', id: f.id, label: '위치 보기' }));
    else items = pub.map(is => ({ ic: U.catIcon(is.categoryCode), title: CAT[is.categoryCode].label, kind: (U.issueOld(is, t) ? U.oldLabel(is) + ' · ' : '') + (is.lastPhotoObservedAt ? '사진 ' + fmt.ago(is.lastPhotoObservedAt) : '사진 없음'), d: dist(is.observationAnchors), act: 'issue', id: is.id, label: '자세히' }))
      .concat(D.ROUTINES.map(r => ({ ic: 'repeat', title: r.name, kind: '정기 관찰', d: dist(r.anchors), act: 'routine', id: r.id, label: '자세히' })));
    if (ref && pur !== 'course') items.sort((a, b) => a.d - b.d);
    // 축약 지도: 다른 코스는 연하고 가늘게 먼저, 선택한 코스는 진하게 마지막(위)에. 기준점 두 곳만 이름을 붙인다.
    const lm = [{ pt: LANDMARKS.bridge[1](), text: '광운로 교량', dx: -10, dy: 14, anchor: 'end' }, { pt: LANDMARKS.down[1](), text: '석계역 방면', dx: 4, dy: 20, anchor: 'end' }]; // 하천 아래쪽 빈 곳에, 코스 선과 겹치지 않게
    const lines = [{ pts: D.G.center, cls: 'art-river' }];
    if (pur === 'course') { D.COURSES.filter(c => c !== sc).forEach(c => lines.push({ pts: c.out, cls: 'art-route-dim' })); lines.push({ pts: sc.out, cls: 'art-route-casing' }, { pts: sc.out, cls: 'art-route' }); }
    const dots = pur === 'course' ? [{ pt: sc.out[sc.out.length - 1], cls: 'art-turn', r: 6 }, { pt: sc.out[0], cls: 'art-start', r: 7 }]
      : pur === 'fac' ? D.FACILITIES.map(f => ({ pt: [f.lat, f.lng], cls: 'art-fac', r: 6 })) : pub.map(is => ({ pt: is.anchor, cls: U.issueOld(is, t) ? 'art-obs old' : 'art-obs', r: 6 })); // 목록과 같은 필터
    if (ref) dots.push({ pt: ref, cls: here ? 'art-me' : 'art-ref', r: 7 });
    const art = Sv.routeSvg({ lines, dots: dots.concat(lm.map(l => ({ pt: l.pt, cls: 'art-lm', r: 3 }))), labels: lm, w: 340, h: 150, pad: 16, fit: D.G.center });
    const cap = pur === 'course' ? '<b>' + esc(sc.name) + '</b><span class="lg"><i class="lg-start"></i>출발<i class="lg-turn"></i>반환점</span>'
      : '<span>' + [here ? '파란 점이 내 위치' : S.simpleAnchor ? '검은 점이 기준 구간' : '파일럿 구간 하천', pur === 'issue' && S.mapOld && pub.some(is => U.issueOld(is, t)) ? '회색 점은 지난 기록' : ''].filter(Boolean).join(' · ') + '</span>';
    const row = x => {
      const on = x.pick && x.id === sc.id, meta = esc(x.kind) + (x.d != null ? ' · ' + refName + (x.dTo || '') + '직선 ' + fmt.dist(x.d) : '');
      const main = '<span class="row-main"><b>' + esc(x.title) + '</b><span>' + meta + '</span></span>';
      return '<div class="row static srow' + (on ? ' on' : '') + '">' + (x.pick ? '<button class="srow-pick" data-act="simple-course" data-id="' + x.id + '" aria-pressed="' + on + '" aria-label="' + esc(x.title) + (on ? ' 선택됨' : ' 선택') + '">' + ic(x.ic) + main + '<span class="srow-check" aria-hidden="true">' + (on ? ic('check') : '') + '</span></button>' : ic(x.ic) + main) +
        '<button class="btn btn-sm ' + (x.pick ? 'btn-line' : 'btn-blue') + '" data-act="' + x.act + '" data-id="' + x.id + '">' + x.label + '</button></div>';
    };
    return '<div class="scroll pad smap"><h1 class="t-title">지도</h1>' +
      '<div class="purpose" role="tablist" aria-label="무엇을 찾을까요">' + [['course', '산책 코스', 'route'], ['fac', '주변 시설', 'wc'], ['issue', '환경 관찰', 'eye']].map(([k, l, i]) => '<button role="tab" aria-selected="' + (pur === k) + '" data-act="simple-purpose" data-v="' + k + '">' + ic(i) + '<span>' + l + '</span></button>').join('') + '</div>' +
      (here ? '' : '<div class="anchor-pick"><p class="t-sub">위치 권한이 없어 거리를 계산하지 않아요. 기준 구간을 고르면 그곳에서 가까운 순으로 보여줘요.</p><div class="chips">' +
        Object.entries(LANDMARKS).map(([k, [n]]) => '<button class="chip" data-act="simple-anchor" data-v="' + k + '" aria-pressed="' + (S.simpleAnchor === k) + '">' + n + '</button>').join('') + '</div><button class="link-btn" data-act="perm-loc">위치 허용하기</button></div>') +
      '<figure class="smap-art">' + art + '<figcaption>' + cap + '</figcaption></figure>' +
      '<button class="btn btn-line btn-big" data-act="simple-map-full">' + ic('map') + '지도 크게 보기</button>' +
      (ref ? '<p class="t-micro">거리는 길찾기 거리가 아니라 직선거리예요.</p>' : '') +
      '<div class="rows big">' + items.map(row).join('') + '</div>' +
      (pur === 'issue' ? '<details class="more-opt"><summary>추가 옵션</summary><label class="row toggle"><span class="row-main"><b>지난 기록 포함</b><span>참여가 끝났거나 사진이 오래됐거나 보관된 관찰</span></span><input type="checkbox" role="switch" data-act="map-old"' + (S.mapOld ? ' checked' : '') + '></label></details>' : '') +
      '</div>';
  }

  // 코스 정보(간편 지도): 설명·거리·출발점과 두 행동. ‘지도에서 보기’는 큰 지도에 이 코스를 선택한 채로, ‘이 코스로 시작’은 이 코스로 운동 시작.
  U.sheets.course = e => {
    const c = D.COURSES.find(x => x.id === e.p.id);
    return U.sheetHead(esc(c.name), (c.distanceM / 1000).toFixed(1) + 'km 왕복') + '<div class="sheet-body"><dl class="facts">' + fact('출발', esc(c.start)) + fact('반환점', esc(c.turn)) + fact('구간', esc(c.bank)) + fact('운동', c.modes.map(m => MODE_LABEL[m]).join(' · ')) + '</dl>' +
      '<p class="t-micro">현장 확인 전 경로예요. 하천선을 따라 그린 선이라 실제 길과 다를 수 있어요.</p></div>' +
      '<footer class="sheet-foot"><button class="btn btn-line" data-act="map-course" data-id="' + c.id + '">' + ic('map') + '지도에서 보기</button><button class="btn btn-start grow" data-act="course-start" data-id="' + c.id + '">' + ic('play') + '<span class="lbl">이 코스로 시작</span></button></footer>';
  };
  U.act['course-info'] = el => { S.simpleCourse = el.dataset.id; nav.push('sheet', 'course', { id: el.dataset.id }); };
  // 밀집 핀 목록: 고르면 지도에서 그 항목이 선택된다
  U.sheets.cluster = e => U.sheetHead('이 근처 관찰 ' + e.p.keys.length + '건') + '<div class="sheet-body scroll"><div class="rows">' + e.p.keys.map(k => {
    const [kind, id] = k.split(':');
    if (kind === 'routine') { const r = D.ROUTINES.find(x => x.id === id); return '<button class="row" data-act="cluster-pick" data-v="' + k + '">' + ic('repeat') + '<span class="row-main"><b>정기 관찰 · ' + esc(r.name) + '</b></span>' + ic('chev') + '</button>'; }
    const is = S.db.issues[id]; return '<button class="row" data-act="cluster-pick" data-v="' + k + '">' + ic(U.catIcon(is.categoryCode)) + '<span class="row-main"><b>' + CAT[is.categoryCode].label + '</b><span>' + (is.lastPhotoObservedAt ? '사진 ' + fmt.ago(is.lastPhotoObservedAt) : '사진 없음') + '</span></span>' + ic('chev') + '</button>';
  }).join('') + '</div></div>';
  U.act['cluster-pick'] = el => { const k = el.dataset.v; nav.back(() => { U.selectOnMap(k); MapUI.fit(boundsOf(k)); }); };

  // ---------- 우리 우이천 ----------
  const NEWS_TOPIC = { eco: '생태·하천 정보', proposal: '개선 제안', plan: '사업 계획' };
  const KIND = { unknown: '출처 유형 미지정', official: '공식 자료', council: '의회 회의록', press: '언론 보도', citizen: '시민기자 기사' };
  // 목록은 빠르게 읽는 곳: 종류·위치·거리·사진 시각만. 검토 수준·참여 조건·공개 정책은 상세와 안내로.
  function obsRow(is) {
    const t = U.now(), c = CAT[is.categoryCode], sig = Pl.todaySignals(is, t), ended = is.eventEndsAt && t >= is.eventEndsAt;
    const ev = is.lifecycleStatus === 'ARCHIVED' ? '보관된 기록' : ended ? '참여 종료' : is.lastPhotoObservedAt ? '사진 ' + ago(is.lastPhotoObservedAt) : '사진 없음' + (sig ? ' · 간단 응답 ' + sig + '명' : '');
    return '<button class="row" data-act="issue" data-id="' + is.id + '">' + ic(U.catIcon(is.categoryCode)) +
      '<span class="row-main"><b>' + esc(c.label) + (is.creatorUid === 'me' ? '<em>내 제보</em>' : '') + '</b><span>' + (c.scope === 'CORRIDOR' ? '하천' : '둑길') + near(is.observationAnchors) + ' · ' + ev + '</span></span>' + ic('chev') + '</button>';
  }
  function routineRow(r) {
    const st = Pl.routineState(S.db, 'me', r.id, U.now());
    return '<button class="row" data-act="routine" data-id="' + r.id + '">' + ic('repeat') +
      '<span class="row-main"><b>' + esc(r.name) + '</b><span>' + esc(r.bankLabel) + near(r.anchors) + ' · ' + (st.mine ? '이번 회차 참여함' : '이번 회차 참여 전') + '</span></span>' + ic('chev') + '</button>';
  }
  U.obsRow = obsRow;
  const halfTabs = (items, cur, act, label) => '<div class="tabs half" role="tablist" aria-label="' + label + '">' + items.map(([k, l]) => '<button role="tab" aria-selected="' + (cur === k) + '" data-act="' + act + '" data-v="' + k + '">' + l + '</button>').join('') + '</div>';
  function viewRiver() {
    const ph = D.PHOTOS.river, t = U.now(), tab = S.riverTab;
    let body;
    if (tab === 'obs') {
      const here = U.loc(), dist = is => (here ? Pl.nearestM(here, is.observationAnchors) : -(is.lastPhotoObservedAt || is.createdAt));
      const pub = U.publicIssues();
      const cur = pub.filter(is => !U.issueOld(is, t)).sort((a, b) => dist(a) - dist(b));
      const old = pub.filter(is => U.issueOld(is, t));
      body = '<button class="btn btn-blue btn-block" data-act="report">' + ic('flag') + '환경 제보</button>' +
        '<h2 class="sec-title"><span class="st-l">' + (here ? '가까운 관찰' : '진행 중인 관찰') + '<b class="sec-count num">' + cur.length + '</b></span><span>체험용 데이터</span></h2>' +
        '<div class="rows">' + (cur.length ? cur.map(obsRow).join('') : '<p class="empty">지금 진행 중인 관찰이 없어요</p>') + '</div>' +
        '<h2 class="sec-title">정기 관찰</h2><div class="rows">' + D.ROUTINES.map(routineRow).join('') + '</div>' +
        (old.length ? '<button class="row row-quiet" data-act="river-old" aria-expanded="' + S.riverOld + '"><span class="row-main"><b>지난 기록 ' + old.length + '건</b></span>' + ic(S.riverOld ? 'down' : 'chev') + '</button>' +
          (S.riverOld ? '<div class="rows">' + old.map(obsRow).join('') + '</div>' : '') : '') +
        '<button class="link-btn" data-act="sheet" data-v="obs-guide">관찰 정보 읽는 법</button>';
    } else {
      const topic = S.newsTopic;
      // 자료 날짜(pub) 순. 발행일이 없는 상시 페이지는 맨 뒤 — 팀이 최근 확인한 날짜를 최신 소식처럼 쓰지 않는다.
      const list = D.NEWS.filter(n => topic === 'all' || n.topic === topic).sort((a, b) => (b.pub || '').localeCompare(a.pub || ''));
      const open = id => !!(S.newsOpen && S.newsOpen[id]);
      body = '<div class="chips news-filter" role="toolbar" aria-label="소식 분류">' + [['all', '전체'], ...Object.entries(NEWS_TOPIC)].map(([k, l]) => '<button class="chip" data-act="news-topic" data-v="' + k + '" aria-pressed="' + (topic === k) + '">' + l + '</button>').join('') + '</div>' +
        (list.length ? list.map(n => '<article class="news' + (open(n.id) ? ' open' : '') + '"><p class="news-labels"><span class="news-topic">' + NEWS_TOPIC[n.topic] + '</span><span class="news-status">' + esc(n.status) + '</span></p>' +
          '<h3>' + esc(n.title) + '</h3><p class="news-date">' + (n.pub ? fmt.ymd(n.pub) + ' ' + esc(n.pubKind) : esc(n.pubKind)) + (n.event ? ' · ' + esc(n.event) : '') + '</p>' +
          '<p class="news-sum">' + esc(n.summary) + '</p>' +
          '<p class="news-meta">' + esc(n.source) + ' · ' + KIND[n.kind] + '<span class="news-chk"' + (open(n.id) ? '' : ' hidden') + '> · 팀 확인 ' + (n.checked?fmt.ymd(n.checked):'미등록') + '</span></p>' +
          '<div class="news-act"><button class="link-btn" data-act="news-more" data-id="' + n.id + '" aria-expanded="' + open(n.id) + '">' + (open(n.id) ? '접기' : '요약 더 보기') + '</button>' +
          '<a class="news-link" href="' + n.url + '" target="_blank" rel="noopener">원문 보기' + ic('out') + '</a></div></article>').join('') : '<p class="empty">이 분류의 소식이 없어요</p>') +
        '<p class="t-micro">공식 자료·회의록·보도를 팀이 골라 요약했어요. 날짜는 자료의 발행·수정·회의 날짜이고, 팀이 확인한 날은 펼치면 보여요. 계획과 의회 발언은 확정·시행된 사업이 아니에요.</p>';
    }
    return '<div class="scroll river"><header class="river-hero"><img src="' + ph.src + '" alt="우이천 하천과 양쪽 산책로" onerror="this.remove()"><h1>우리 우이천</h1></header>' +
      '<div class="pad">' + halfTabs([['obs', '현장 관찰'], ['news', '우이천 소식']], tab, 'river-tab', '우리 우이천') + body + '</div></div>';
  }
  U.sheets['obs-guide'] = () => U.sheetHead('관찰 정보 읽는 법') + '<div class="sheet-body scroll"><dl class="faq">' +
    '<div><dt>사진 기록</dt><dd>현장에서 찍은 사진이 있는 관찰이에요. 다른 사람이 찍은 원본 사진은 보여주지 않아요. 운영자가 공개로 전환한 사진만 비교용으로 보여요.</dd></div>' +
    '<div><dt>간단 응답</dt><dd>오늘 ‘지금도 보여요’를 남긴 계정 수예요. 같은 계정은 하루 한 번만 세요. 사진처럼 현상을 확인한 근거는 아니에요.</dd></div>' +
    '<div><dt>검토 수준</dt><dd>미검토, 운영자 검토, 다른 계정 사진 추가 순서로 근거가 늘어나요. 수질이나 안전을 판정하지 않아요.</dd></div>' +
    '<div><dt>현상 위치와 관찰 위치</dt><dd>하천 안 현상은 직접 들어가지 않고 둑에서 볼 수 있는 위치를 따로 표시해요.</dd></div>' +
    '<div><dt>기관 전달</dt><dd>우이런에 남긴 기록은 구청이나 기관에 자동으로 전달되지 않아요.</dd></div></dl></div>';

  // ---------- 기록 ----------
  function viewRecords() {
    const tabs = halfTabs([['run', '운동'], ['env', '환경 참여']], S.recTab, 'rec-tab', '기록');
    let body;
    if (!S.signedIn) body = recIntro();
    else if (S.uiMode === 'SIMPLE') body = S.recTab === 'run' ? recRunSimple() : recEnvSimple();
    else body = S.recTab === 'run' ? recRun() : recEnv();
    return '<div class="scroll pad"><h1 class="t-title">기록</h1>' + tabs + body + '</div>';
  }
  // 비로그인 소개: 하천선(옅은 블루) 위 예시 코스선(대표 블루). 내 기록처럼 보이지 않게 점·숫자 없이.
  function recIntro() {
    const art = Sv.routeSvg({ lines: [{ pts: D.G.center, cls: 'art-river' }, { pts: D.COURSES[0].out, cls: 'art-route-casing' }, { pts: D.COURSES[0].out, cls: 'art-route' }], dots: [], w: 340, h: 120, pad: 18, fit: D.G.center });
    return '<section class="rec-intro"><figure class="ri-art" aria-hidden="true">' + art + '</figure>' +
      '<p class="ri-eyebrow">나의 우이천 기록</p><h2 class="ri-head">한 걸음씩 쌓이는<br>나의 하루.</h2>' +
      '<p class="ri-desc">걸어온 경로와 운동 시간, 우이천에 남긴 관찰을 한곳에서 확인해요.</p>' +
      '<button class="btn btn-blue btn-block" data-act="login-records">로그인하고 기록 모으기</button>' +
      '<button class="link-btn ri-skip" data-act="tab" data-v="home">먼저 둘러보기' + ic('chev') + '</button></section>';
  }
  const kmOrDash = r => (r.quality && r.quality.noDistance ? '<span class="na" aria-label="계산 불가">–</span>' : fmt.km(r.distanceM)); // 위치가 없어 계산할 수 없는 거리는 0으로 보이지 않게
  const runRow = r => '<button class="row run-row" data-act="record" data-id="' + r.id + '"><b class="num rr-dist">' + kmOrDash(r) + '</b>' +
    '<span class="row-main"><b>' + fmt.date(r.startedAt) + ' ' + MODE_LABEL[r.mode] + '</b><span>' + fmt.dur(r.activeMs) + (r.quality && r.quality.noDistance ? ' · 거리 계산 불가' : ' · ' + fmt.pace(r.activeMs, r.distanceM) + '/km') + (r.sim ? ' · 체험 기록' : '') + (r.status === 'RECOVERED' ? ' · 복구한 기록' : '') + '</span></span>' + ic('chev') + '</button>';
  U.kmOrDash = kmOrDash;
  // 기간별 거리: 한국 시간 기준 날짜(7일·30일은 일별, 12개월은 월별, 전체는 그래프 없이). 합계·그래프·아래 목록은 모두 같은 기간.
  const RANGES = [['7d', '7일', '최근 7일'], ['30d', '30일', '최근 30일'], ['12m', '12개월', '최근 12개월'], ['all', '전체', '전체 기간']];
  const rangeName = r => RANGES.find(x => x[0] === r)[2];
  function statBuckets(range) {
    const now = U.now(), out = [];
    if (range === '12m') {
      let [y, m] = Pl.kstDay(now).slice(0, 7).split('-').map(Number);
      for (let i = 0; i < 12; i++) { out.unshift({ key: y + '-' + pad(m), label: m + '월', full: y + '년 ' + m + '월' }); if (--m === 0) { m = 12; y--; } }
    } else if (range !== 'all') {
      const n = range === '30d' ? 30 : 7;
      for (let i = n - 1; i >= 0; i--) {
        const k = Pl.kstDay(now - i * DAY), mid = Date.parse(k + 'T12:00:00+09:00');
        out.push({ key: k, label: i === 0 ? '오늘' : range === '7d' ? kst(mid, { weekday: 'short' }) : Number(k.slice(5, 7)) + '/' + Number(k.slice(8)), full: kst(mid, { month: 'long', day: 'numeric', weekday: 'short' }) });
      }
    }
    out.forEach(b => Object.assign(b, { distM: 0, ms: 0, n: 0 }));
    const idx = new Map(out.map((b, i) => [b.key, i])), keyOf = r => (range === '12m' ? Pl.kstDay(r.startedAt).slice(0, 7) : Pl.kstDay(r.startedAt));
    const runs = range === 'all' ? S.runs.slice() : S.runs.filter(r => idx.has(keyOf(r)));
    runs.forEach(r => { const i = idx.get(keyOf(r)); if (i != null) { const b = out[i]; b.distM += r.distanceM; b.ms += r.activeMs; b.n++; } });
    return { buckets: out, runs };
  }
  // 막대는 버튼: 누르면 아래 한 줄에 그 날(달)의 거리와 횟수
  function statBars(bs) {
    const max = Math.max(...bs.map(b => b.distM)), every = bs.length === 30 ? 7 : 1, sel = bs.find(b => b.key === S.statSel);
    return '<div class="sbars" role="group" aria-label="기간별 거리 막대">' + bs.map((b, i) => '<button class="sbar' + (b === sel ? ' on' : '') + (i === bs.length - 1 ? ' now' : '') + '" data-act="stat-bar" data-v="' + b.key + '" aria-pressed="' + (b === sel) + '" aria-label="' + b.full + ' ' + fmt.km(b.distM) + 'km">' +
      '<span class="sb-col">' + (b.distM ? '<i style="height:' + Math.max(4, b.distM / max * 100).toFixed(1) + '%"></i>' : '<i class="zero"></i>') + '</span><span class="sb-x">' + ((bs.length - 1 - i) % every === 0 ? b.label : '') + '</span></button>').join('') + '</div>' +
      '<p class="sbar-sel" aria-live="polite">' + (sel ? '<b>' + sel.full + '</b> ' + fmt.km(sel.distM) + 'km · ' + sel.n + '회' : '최대 ' + fmt.km(max) + 'km · 막대를 누르면 값을 보여줘요') + '</p>';
  }
  function statBlock(simple) {
    const range = simple ? '7d' : S.statRange || '7d', name = rangeName(range), { buckets, runs } = statBuckets(range);
    const dist = runs.reduce((a, r) => a + r.distanceM, 0), ms = runs.reduce((a, r) => a + r.activeMs, 0), n = runs.length;
    if (simple) return '<p class="recent-sum">' + name + ' 합계 <b class="num">' + fmt.km(dist) + '</b>km · ' + n + '회</p>';
    return '<div class="seg stat-range" role="radiogroup" aria-label="기간">' + RANGES.map(([k, l]) => '<button role="radio" aria-checked="' + (range === k) + '" data-act="stat-range" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<div class="stat-line period"><div><b class="num stat-big">' + fmt.km(dist) + '<i>km</i></b><span>' + name + ' 거리</span></div><div><b class="num">' + n + '</b><span>운동 횟수</span></div><div><b class="num">' + fmt.dur(ms) + '</b><span>운동 시간</span></div></div>' +
      (n && buckets.length ? statBars(buckets) : '') +
      '<h2 class="sec-title">' + name + ' 운동</h2>' +
      (n ? '<div class="rows">' + runs.map(runRow).join('') + '</div>' : '<p class="empty">' + name + ' 동안 기록이 없어요</p>'); // 다른 기간 기록을 섞어 보여주지 않는다
  }
  function recRun() {
    if (!S.runs.length) return '<div class="empty-block"><p>아직 운동 기록이 없어요.</p><button class="btn btn-start" data-act="start">' + ic('play') + '<span class="lbl">첫 ' + MODE_LABEL[S.mode] + ' 시작</span></button></div>';
    return statBlock(false);
  }
  // 간편모드: 그래프 대신 최근 기록과 최근 7일 합계
  function recRunSimple() {
    if (!S.runs.length) return '<div class="empty-block"><p>아직 운동 기록이 없어요.</p><button class="btn btn-start" data-act="start" data-v="WALK">' + ic('play') + '<span class="lbl">첫 산책 시작</span></button></div>';
    const r = S.runs[0];
    return '<section class="recent"><p class="recent-when">' + fmt.date(r.startedAt) + ' ' + MODE_LABEL[r.mode] + (r.sim ? ' · 체험 기록' : '') + '</p>' +
      '<p class="recent-nums"><b class="num">' + kmOrDash(r) + '<i>km</i></b><b class="num">' + fmt.dur(r.activeMs) + '</b></p>' +
      '<button class="btn btn-blue btn-big" data-act="record" data-id="' + r.id + '">기록 보기</button>' + (r.quality && r.quality.noDistance ? '' : '<button class="btn btn-line btn-big" data-act="card-open" data-id="' + r.id + '">' + ic('image') + '사진 카드 만들기</button>') + '</section>' +
      statBlock(true) +
      (S.runs.length > 1 ? '<h2 class="sec-title">지난 기록</h2><div class="rows big">' + S.runs.slice(1).map(runRow).join('') + '</div>' : '');
  }
  // 환경 참여 = 내 활동 이력. 포인트 잔액·혜택은 마이페이지에서 관리하고 여기서는 각 참여의 결과(+5P·검토 중·0P)만 보인다.
  const myObs = U.myObs = () => Object.values(S.db.obs).filter(o => o.uid === 'me').sort((a, b) => (b.acceptedAt || b.observedAt) - (a.acceptedAt || a.observedAt));
  function partSummary(mine) { // 집계 정의는 Pl.partCounts 하나(운동 결과와 같다)
    const pc = Pl.partCounts(mine);
    return '<div class="stat-line"><div><b class="num">' + pc.report + '</b><span>신규 제보</span></div><div><b class="num">' + pc.recheck + '</b><span>현장 확인</span></div><div><b class="num">' + pc.routine + '</b><span>정기 관찰</span></div></div>' +
      '<p class="t-micro">현장 확인은 사진 ' + pc.recheckPhoto + ' · 간단 응답 ' + pc.recheckQuick + (pc.supplement ? ' · 내 제보 사진 보완 ' + pc.supplement + '건은 따로 세요' : '') + '</p>';
  }
  const ptsLink = '<button class="link-btn" data-act="benefits" data-v="points">내 포인트' + ic('chev') + '</button>';
  function histList(mine, limit) {
    const list = limit ? mine.slice(0, limit) : mine;
    return (list.length ? groupByDay(list, o => o.acceptedAt || o.observedAt).map(([day, items]) => '<h3 class="date-h">' + day + '</h3><div class="rows">' + items.map(histRow).join('') + '</div>').join('')
      : '<div class="empty-block"><p>아직 환경 참여 기록이 없어요.</p><button class="btn btn-blue" data-act="report">' + ic('flag') + '첫 환경 제보 남기기</button></div>');
  }
  const localPhotos = () => (S.localPhotos.length ? '<h2 class="sec-title">이 기기에만 저장한 사진</h2><div class="rows">' +
    S.localPhotos.map(lp => '<div class="row static"><img class="row-img" src="' + lp.photo + '" alt=""><span class="row-main"><b>' + esc(lp.label) + '</b><span>' + fmt.dt(lp.at) + ' · 연결 없이 찍어 기록에 쓰이지 않음</span></span></div>').join('') + '</div>' : '');
  function recEnv() {
    const mine = myObs();
    return '<h2 class="sec-title first">참여 요약</h2>' + partSummary(mine) +
      '<h2 class="sec-title">참여 이력' + ptsLink + '</h2>' + histList(mine) + localPhotos();
  }
  // 간편모드: 횟수와 최근 이력 다섯 건
  function recEnvSimple() {
    const mine = myObs();
    return partSummary(mine) + '<h2 class="sec-title">최근 참여' + ptsLink + '</h2>' + histList(mine, S.recMore ? 0 : 5) +
      (!S.recMore && mine.length > 5 ? '<button class="btn btn-line btn-big" data-act="rec-more">이력 더 보기</button>' : '') + localPhotos();
  }
  const groupByDay = (arr, tf) => { const m = new Map(); arr.forEach(x => { const k = fmt.date(tf(x)); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return [...m.entries()]; };
  function obsLabel(o) {
    if (o.role === 'ROUTINE') return '정기 관찰';
    if (o.role === 'DISCOVERY') return o.modality === 'QUICK' ? '신규 제보 · 사진 없이' : '신규 제보 · 사진';
    if (o.role === 'DISCOVERY_PHOTO') return '내 제보 사진 보완';
    return o.modality === 'QUICK' ? '현장 확인 · 간단 응답' : '현장 확인 · 사진';
  }
  U.obsLabel = obsLabel;
  function obsTitle(o) { return o.missionId ? D.ROUTINES.find(r => r.id === o.missionId).name : o.issueId ? CAT[S.db.issues[o.issueId].categoryCode].label : CAT[o.categoryCode].label; }
  U.obsTitle = obsTitle;
  function histRow(o) { // 사진 여부 · 접수 시각 · 이 참여의 적립 결과(원장 상태)
    const rb = U.rewardBadge(o), is = o.issueId && S.db.issues[o.issueId];
    const state = o.late ? '나만 보는 기록' : is && is.visibility !== 'PUBLIC' ? '공개되지 않는 관찰' : is && is.lifecycleStatus === 'ARCHIVED' ? '보관된 관찰' : '';
    return '<button class="row" data-act="' + (o.missionId ? 'routine' : o.issueId ? 'issue' : 'noop') + '" data-id="' + (o.missionId || o.issueId || '') + '">' +
      (o.photo ? '<img class="row-img" src="' + o.photo + '" alt="내가 찍은 사진">' : '<span class="row-ic">' + ic(o.modality === 'QUICK' ? 'tap' : 'camera') + '</span>') +
      '<span class="row-main"><b>' + esc(obsTitle(o)) + '</b><span>' + obsLabel(o) + ' · 접수 ' + fmt.time(o.acceptedAt || o.observedAt) + (state ? ' · ' + state : '') + '</span>' + (rb.cls === '' || rb.cls === 'gone' ? '<span>' + esc(rb.note) + '</span>' : '') + '</span>' +
      '<span class="pts ' + rb.cls + '">' + rb.text + (rb.cls === 'pending' ? '<small>' + ic('clock') + '검토 중</small>' : rb.cls === 'on' ? '<small>적립</small>' : '') + '</span></button>';
  }
  function couponStateText(st) { return { ISSUED: '사용 가능', USE_REQUESTED: '사용 중(10분)', USED: '사용 완료', EXPIRED: '기간 만료', REVOKED: '철회됨' }[st]; }
  U.couponStateText = couponStateText;

  // ---------- 마이페이지 ----------
  // 포인트·혜택 관리는 여기 한 곳. 활동은 요약과 진입점만(그래프·이력은 기록 탭). 집계 기준은 기록 탭과 같다(Pl.partCounts).
  function viewMy() {
    const u = S.db.users.me;
    const head = S.signedIn
      ? '<div class="profile-row"><span class="avatar">' + ic('user') + '</span><div class="pr-main"><b' + (u.displayName ? '' : ' class="muted"') + '>' + (u.displayName ? esc(u.displayName) : '이름 없음') + '</b><span>Firebase 계정 · 서버에 기록 중</span></div>' +
        '<button class="text-link" data-act="profile-edit" aria-label="프로필 수정">수정' + ic('chev') + '</button></div>'
      : '<div class="profile-row"><span class="avatar">' + ic('user') + '</span><div class="pr-main"><b>둘러보는 중</b><span>로그인하면 포인트와 기록이 모여요</span></div><button class="text-link" data-act="login-my">로그인' + ic('chev') + '</button></div>';
    let mid = '';
    if (S.signedIn) {
      const usable = U.usableCoupons().length, pc = (window.UIRUN_REMOTE?.snapshots.my?.participationStats||Pl.partCounts(myObs())), total = S.runs.reduce((a, r) => a + r.distanceM, 0);
      const n = Math.min(P.welcomeTarget, Pl.welcomeCount(S.db, 'me'));
      mid = '<section class="pcard" aria-label="내 포인트"><div class="pc-top"><span>내 포인트</span><button class="pc-link" data-act="ledger" data-v="all">내역' + ic('chev') + '</button></div>' +
        '<p class="pc-bal"><b class="num">' + Pl.balance(S.db, 'me') + '</b><i>P</i></p>' +
        '<div class="pc-bot"><button class="pc-link sub" data-act="ledger" data-v="pending">' + ic('clock') + '검토 중 ' + Pl.pendingSum(S.db, 'me') + 'P</button>' +
        '<button class="pc-link" data-act="screen" data-v="benefits">사용 가능한 혜택 ' + usable + '장' + ic('chev') + '</button></div></section>' +
        '<h2 class="sec-title">나의 활동<span title="저장한 모든 운동의 거리 합">전체 누적 이동 ' + fmt.km(total) + 'km</span></h2><div class="rows">' +
        '<button class="row" data-act="go-records" data-v="run">' + ic('records') + '<span class="row-main"><b>운동 기록</b></span><span class="row-meta">' + S.runs.length + '회</span>' + ic('chev') + '</button>' +
        '<button class="row" data-act="go-records" data-v="env">' + ic('flag') + '<span class="row-main"><b>환경 참여</b></span><span class="row-meta">' + (pc.report + pc.recheck + pc.routine) + '건</span>' + ic('chev') + '</button>' +
        '<button class="row" data-act="screen" data-v="welcome">' + ic('gift') + '<span class="row-main"><b>웰컴 혜택</b></span><span class="row-meta">' + n + '/3 · ' + welcomeStatusText(u.welcomeStatus, n) + '</span>' + ic('chev') + '</button></div>';
    }
    return '<div class="scroll pad my"><h1 class="t-title">마이페이지</h1>' + head + mid +
      '<h2 class="sec-title">사용 설정</h2><div class="seg mode-seg" role="radiogroup" aria-label="화면 모드">' + [['DEFAULT', '일반 화면'], ['SIMPLE', '간편 화면']].map(([k, l]) => '<button role="radio" aria-checked="' + ((S.uiMode || 'DEFAULT') === k) + '" data-act="ui-mode" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<p class="t-micro">간편 화면은 큰 글씨와 적은 선택지로 보여줘요. 포인트와 참여 조건은 같아요.</p>' +
      (S.signedIn ? '<div class="rows">' + toggleRow('repeat', '반복 관찰 알림', '사진을 남긴 관찰도 6시간 뒤 다시 알림 · 추가 포인트 없음', u.repeatObservationNotifications) + '</div>' : '') +
      '<h2 class="sec-title">이용 안내</h2><div class="rows">' +
      '<button class="row" data-act="screen" data-v="privacy">' + ic('shield') + '<span class="row-main"><b>권한 및 개인정보</b></span>' + ic('chev') + '</button>' +
      '<button class="row" data-act="screen" data-v="info">' + ic('info') + '<span class="row-main"><b>정보 및 출처</b></span>' + ic('chev') + '</button>' +
      '<button class="row" data-act="sheet" data-v="help">' + ic('help') + '<span class="row-main"><b>도움말</b></span>' + ic('chev') + '</button></div>' +
      '<p class="t-micro foot-note">우이런 · Firebase 서버 연결 검토본</p></div>';
  }
  // 혜택 목록: 사용 가능 / 지난 혜택(사용 완료·만료·철회). 지난 혜택은 사용 가능 개수에 넣지 않는다.
  U.screens.benefits = () => {
    const now = U.now(), mine = S.db.coupons.filter(c => c.uid === 'me'), cat = S.db.catalog.WELCOME_500;
    const usable = mine.filter(c => Pl.couponUsable(c, now)), past = mine.filter(c => !Pl.couponUsable(c, now));
    const row = c => '<button class="row" data-act="screen" data-v="coupon" data-id="' + c.id + '">' + ic('ticket') + '<span class="row-main"><b>' + esc(cat.title) + ' 웰컴 혜택</b><span>' + couponStateText(Pl.couponView(c, now)) + ' · ' + (c.usedAt ? fmt.date(c.usedAt) + ' 사용' : fmt.date(c.expiresAt) + '까지') + ' · 예시 혜택</span></span>' + ic('chev') + '</button>';
    return U.appbar('혜택') + '<div class="screen-body scroll pad">' +
      '<h2 class="sec-title first">사용 가능<span>' + usable.length + '장</span></h2>' + (usable.length ? '<div class="rows">' + usable.map(row).join('') + '</div>' : '<p class="empty">지금 쓸 수 있는 혜택이 없어요</p>') +
      '<div class="rows gap">' + welcomeRow() + '</div>' +
      (past.length ? '<h2 class="sec-title">지난 혜택</h2><div class="rows">' + past.map(row).join('') + '</div>' : '') + '</div>';
  };
  // 프로필 수정: 이름 하나(30자 이하, 빈 값 허용). 저장 전 뒤로 가면 바뀌지 않고, 실패하면 입력을 그대로 둔다.
  U.screens.profile = e => U.appbar('프로필 수정') + '<div class="screen-body scroll pad">' +
    '<label class="field"><span class="field-label">이름</span><input class="text-in" type="text" autocomplete="nickname" data-input="value" value="' + esc(e.p.value) + '" data-autofocus>' +
    '<span class="t-micro">30자까지 · 비워 두면 ‘이름 없음’으로 보여요 · 마이페이지에만 보여요</span></label>' +
    (e.p.err ? '<p class="result err">' + ic('warn') + '<span>' + esc(e.p.err) + '</span></p>' : '') + '</div>' +
    '<footer class="screen-foot"><button class="btn btn-blue grow" data-act="profile-save"' + (e.p.busy ? ' disabled' : '') + '>' + (e.p.busy ? '<span class="spin"></span>저장하는 중' : '저장') + '</button></footer>';
  function toggleRow(key, title, desc, on) {
    return '<label class="row toggle"><span class="row-main"><b>' + title + '</b><span>' + desc + '</span></span><input type="checkbox" role="switch" data-act="toggle" data-v="' + key + '"' + (on ? ' checked' : '') + '></label>';
  }

  const TAB_VIEW = { home: viewHome, river: viewRiver, records: viewRecords, my: viewMy };

  // ---------- 마이페이지 상세 ----------
  const PERM = { precise: '정확한 위치 허용', approx: '대략적인 위치만', denied: '허용 안 함', unknown: '아직 묻지 않음', granted: '허용', demo: '시연용 촬영' };
  U.screens.privacy = () => U.appbar('권한 및 개인정보') + '<div class="screen-body scroll pad">' +
    '<h2 class="sec-title">권한</h2><div class="rows">' +
    '<button class="row" data-act="perm-loc"><span class="row-main"><b>위치</b><span>' + PERM[S.perms.location] + ' · 앱을 쓰는 동안만</span></span>' + ic('chev') + '</button>' +
    '<div class="row static"><span class="row-main"><b>카메라</b><span>' + (PERM[S.perms.camera] || S.perms.camera) + ' · 촬영할 때 물어요</span></span></div>' +
    '<button class="row" data-act="perm-notif"><span class="row-main"><b>알림</b><span>' + PERM[S.perms.notif] + '</span></span>' + ic('chev') + '</button></div>' +
    (S.signedIn ? '<h2 class="sec-title">동의 내역</h2><div class="rows"><div class="row static"><span class="row-main"><b>이용약관·개인정보·위치기반서비스</b><span>' + fmt.dt(S.consentAt) + '</span></span></div></div>' : '') +
    '<h2 class="sec-title">모두에게 보여요</h2><ul class="plain"><li>관찰 종류와 현상 위치</li><li>최근 사진 시각과 사진 기록 수</li><li>운영자가 공개로 전환한 공개 사진</li><li>오늘 간단 응답한 계정 수</li><li>검토 수준</li></ul>' +
    '<h2 class="sec-title">나와 운영자만 봐요</h2><ul class="plain"><li>내가 찍은 원본 사진</li><li>촬영·참여 위치와 운동 경로</li><li>내 계정, 포인트, 혜택</li><li>기록카드에 쓴 내 사진(이 기기에서만 쓰고 올리지 않아요)</li></ul>' +
    '<p class="t-sub">다른 사람이 찍은 원본 사진은 앱에서 보여주지 않아요.</p>' +
    '<h2 class="sec-title">보존 기간</h2><p class="t-sub">' + U.RETENTION + '</p>' +
    (S.signedIn ? '<div class="rows"><button class="row danger" data-act="delete-account"><span class="row-main"><b>계정과 내 데이터 삭제</b></span>' + ic('chev') + '</button></div>' : '') + '</div>';

  U.screens.info = () => U.appbar('정보 및 출처') + '<div class="screen-body scroll pad">' +
    '<h2 class="sec-title">사진</h2><p class="t-sub">사진마다 확인된 출처와 이용 조건만 적어요. 분위기 사진이며 코스의 정확한 지점이나 지금 모습이 아니에요.</p>' +
    '<div class="rows">' + Object.values(D.PHOTOS).map(p => '<' + (p.url ? 'a href="' + p.url + '" target="_blank" rel="noopener"' : 'div') + ' class="row' + (p.url ? '' : ' static') + '"><span class="row-main"><b>' + esc(p.use) + '</b><span>' +
      [p.place, p.date ? p.date + ' 촬영' : null, p.credit, p.license, p.note, p.size + 'px'].filter(Boolean).map(esc).join(' · ') + '</span></span>' + (p.url ? ic('out') : '') + '</' + (p.url ? 'a' : 'div') + '>').join('') + '</div>' +
    '<h2 class="sec-title">로고</h2><p class="t-sub">우이런 로고 11-A(팀 시안). 앱 아이콘과 워드마크 부분만 잘라 썼어요.</p>' +
    '<h2 class="sec-title">지도</h2><p class="t-sub">배경 지도: ' + esc(Sv.MapKit.TILE.name) + '(지도 위 표기 유지). 하천선과 시설 위치: © OpenStreetMap 기여자(ODbL). 시설은 현장 확인 전이고, 코스와 정기 관찰 지점은 현장 확인 전 경로예요.</p>' +
    '<h2 class="sec-title">날씨</h2><p class="t-sub">출처와 갱신 시각은 홈의 날씨를 눌러 확인할 수 있어요.</p>' +
    '<h2 class="sec-title">우이천 소식</h2><div class="rows">' + D.NEWS.map(n => '<a class="row" href="' + n.url + '" target="_blank" rel="noopener"><span class="row-main"><b>' + esc(n.source) + '</b><span>' + (n.pub ? fmt.ymd(n.pub) + ' ' + esc(n.pubKind) : esc(n.pubKind)) + ' · 팀 확인 ' + (n.checked?fmt.ymd(n.checked):'미등록') + '</span></span>' + ic('out') + '</a>').join('') + '</div>' +
    '<h2 class="sec-title">서비스 연결 범위</h2><ul class="plain"><li>Firebase 계정으로 로그인하고 운동·참여 기록을 서버에 저장해요.</li><li>포인트·검증·혜택은 서버에서 권한과 적립 조건을 확인해 처리해요.</li><li>관찰은 구청이나 기관에 자동으로 전달되지 않고, 내보내기(Export)도 없어요.</li><li>웹에서는 화면이 꺼지거나 다른 앱으로 가면 위치 기록이 멈출 수 있어요. 잠금화면 알림은 앱 안의 체험 화면이에요.</li><li>예시 혜택은 실제 점포에서 쓸 수 없어요.</li></ul></div>';

  U.sheets.help = () => U.sheetHead('도움말') + '<div class="sheet-body scroll"><dl class="faq">' +
    '<div><dt>간단 응답과 사진은 어떻게 달라요?</dt><dd>간단 응답은 이미 있는 관찰에 ‘지금도 보여요’를 남기는 거예요. 사진은 현장 사진이 근거로 남고, 포인트 조건도 달라요.</dd></div>' +
    '<div><dt>검토 중 포인트는 언제 적립돼요?</dt><dd>새 제보 사진은 7일 안에 운영자가 검토하거나 다른 계정이 사진을 더하면 적립돼요. 그 전에는 쓸 수 없어요.</dd></div>' +
    '<div><dt>포인트는 어디에 쓰나요?</dt><dd>포인트로 바꿀 수 있는 상품은 아직 준비 중이에요. 웰컴 혜택은 포인트와 별개로 사진 기여 3회를 채우면 받을 수 있어요.</dd></div>' +
    '<div><dt>운동 중에 제보하면 운동이 멈춰요?</dt><dd>아니요. 제보하거나 사진을 찍는 동안에도 운동은 그대로예요. 멈추고 싶으면 직접 일시정지하세요.</dd></div>' +
    '<div><dt>내 제보가 구청에 전달되나요?</dt><dd>자동으로 전달되지 않아요. 우이런 안에 기록으로 남아요.</dd></div></dl></div>';

  // 보존 기간 문구는 한 곳에서: 기획 기준과 지금 구현 상태를 섞지 않는다
  U.RETENTION = '사진 원본·개인 경로·정밀 위치는 수집 후 90일이 지나면 서버 정리 작업으로 삭제해요. 운동 거리·시간 요약은 남겨요. 계정 삭제를 요청하면 서버가 개인정보와 사진을 함께 정리해요.';

  // ---------- 공용 시트 ----------
  U.sheets.weather = () => {
    const { cur, acur, f, a } = wxCurrent();
    const hrs = Sv.Weather.hours(f && f.data, ['temperature_2m', 'precipitation_probability', 'weather_code'], 12);
    const ahrs = Sv.Weather.hours(a && a.data, ['pm10', 'pm2_5'], 6);
    const state = (s, loading) => loading && !s ? '<span class="st">불러오는 중</span>' : !s || s.status === 'error' ? '<span class="st bad">' + ic('warn') + '정보 없음</span>' : s.status === 'stale' ? '<span class="st warn">' + ic('clock') + '업데이트 지연 · ' + fmt.time(s.fetchedAt) + ' 수신</span>' : '<span class="st">정상 · ' + fmt.time(s.fetchedAt) + ' 수신</span>';
    let body;
    if (!cur) body = (WX.loading.forecast ? '<p class="t-sub">불러오는 중이에요.</p>' : '<p class="notice err">' + ic('warn') + '날씨를 불러오지 못했어요.</p><button class="btn btn-line" data-act="wx-retry">다시 시도</button>');
    else body = '<div class="wx-detail"><span class="wx-ic">' + ic(Sv.Weather.icon(cur.weather_code, cur.is_day)) + '</span><span class="num wx-big">' + cur.temperature_2m.toFixed(1) + '°</span><div><b>' + esc(Sv.Weather.label(cur.weather_code)) + '</b><span class="t-sub">' + cur.time.slice(11, 16) + ' 예보 기준</span></div></div>' +
      '<dl class="facts">' + (cur.apparent_temperature != null ? fact('체감', Math.round(cur.apparent_temperature) + '°') : '') + fact('습도', cur.relative_humidity_2m + '%') + fact('바람', cur.wind_speed_10m.toFixed(1) + ' m/s') + fact('강수(직전 15분)', cur.precipitation + ' mm') + '</dl>' +
      '<h3 class="sec-title">앞으로 12시간</h3>' + hourlyChart(hrs);
    return U.sheetHead('우이천 날씨', '파일럿 구간 중앙 좌표') + '<div class="sheet-body scroll">' + body +
      '<h3 class="sec-title">미세먼지</h3>' + airBlock(acur, ahrs) +
      '<h3 class="sec-title">자료 상태</h3><dl class="facts one">' + fact('기상', state(f, WX.loading.forecast)) + fact('대기질', state(a, WX.loading.air)) + '</dl>' +
      '<h3 class="sec-title">관측과 예측</h3><p class="t-sub">현재값도 측정소 관측값이 아니라 예보 모델이 계산한 값이에요. 대기질은 약 45km 격자의 모델 추정값이라 우이천 실제 공기와 다를 수 있어요. 등급은 환경부 기준 구간을 참고로 붙였어요.</p>' +
      '<h3 class="sec-title">제공처</h3><p class="t-sub">기상: Open-Meteo 예보 API · 대기질: Open-Meteo Air Quality(CAMS) · Weather data by Open-Meteo.com (CC BY 4.0)</p>' +
      '<p class="t-sub">하천 통행이나 운동 안전을 판단하는 정보가 아니에요. 호우·하천 통제는 현장 안내와 구청 공지를 확인하세요.</p></div>';
  };
  const fact = (k, v) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>';
  U.fact = fact;
  function airBlock(acur, hrs) {
    if (!acur) return WX.loading.air ? '<p class="t-sub">불러오는 중이에요.</p>' : '<p class="t-sub">미세먼지 정보가 없어요. 값이 없을 때 ‘좋음’으로 바꿔 보여주지 않아요.</p>';
    const v = (k, label, gk) => { const x = acur[k]; return '<div><dt>' + label + '</dt><dd>' + (x == null ? '값 없음' : Math.round(x) + ' ㎍/㎥ <em>' + Sv.Weather.grade(gk, x) + '(예상)</em>') + '</dd></div>'; };
    return '<dl class="facts">' + v('pm10', '미세먼지', 'pm10') + v('pm2_5', '초미세먼지', 'pm25') + '</dl>' +
      '<div class="mini-hours" aria-label="초미세먼지 시간별 예상값">' + hrs.map(h => '<span><b>' + fmt.hour(h.time) + '</b>' + (h.pm2_5 == null ? '–' : Math.round(h.pm2_5)) + '</span>').join('') + '</div>';
  }
  function hourlyChart(hrs) {
    if (!hrs.length) return '<p class="empty">시간별 예보가 없어요</p>';
    const w = 340, h = 150, n = hrs.length, x = i => 14 + i * ((w - 28) / (n - 1 || 1));
    const temps = hrs.map(r => r.temperature_2m).filter(v => v != null);
    if (!temps.length) return '<p class="empty">시간별 기온 값이 없어요</p>';
    const lo = Math.min(...temps), hi = Math.max(...temps), y = v => 70 - ((v - lo) / ((hi - lo) || 1)) * 46;
    let d = '', pen = false;
    hrs.forEach((r, i) => { if (r.temperature_2m == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r.temperature_2m).toFixed(1); pen = true; });
    const bars = hrs.map((r, i) => r.precipitation_probability == null ? '' : '<rect class="ch-bar" x="' + (x(i) - 6).toFixed(1) + '" y="' + (128 - r.precipitation_probability * 0.3).toFixed(1) + '" width="12" height="' + (r.precipitation_probability * 0.3).toFixed(1) + '"/>').join('');
    const labels = hrs.map((r, i) => (i % 3 === 0 ? '<text class="ch-x" x="' + x(i).toFixed(1) + '" y="146">' + fmt.hour(r.time) + '</text>' : '') +
      (r.temperature_2m != null && i % 3 === 0 ? '<text class="ch-t" x="' + x(i).toFixed(1) + '" y="' + (y(r.temperature_2m) - 9).toFixed(1) + '">' + Math.round(r.temperature_2m) + '°</text>' : '')).join('');
    return '<figure class="chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="12시간 기온과 강수확률"><line class="ch-base" x1="8" x2="' + (w - 8) + '" y1="128" y2="128"/>' + bars + '<path class="ch-line" d="' + d + '"/>' + labels + '</svg>' +
      '<figcaption><span><i class="lg-line"></i>기온</span><span><i class="lg-bar"></i>강수확률</span></figcaption></figure>';
  }

  U.sheets.facility = e => {
    const f = D.FACILITIES.find(x => x.id === e.p.id);
    return U.sheetHead(esc(f.name), U.bankOf([f.lat, f.lng]) + near([[f.lat, f.lng]])) +
      '<div class="sheet-body scroll"><dl class="facts">' + fact('운영시간', '확인되지 않음') + fact('출입 동선', '현장 확인 예정') + '</dl>' +
      '<p class="t-sub">OpenStreetMap에 등록된 위치예요(노드 ' + f.osmId + '). 답사 전이라 실제와 다를 수 있어요.</p></div>' +
      '<footer class="sheet-foot"><button class="btn btn-blue grow" data-act="fac-map" data-id="' + f.id + '">' + ic('locate') + '위치 확인</button></footer>';
  };

  // ---------- 동작 ----------
  const A = U.act;
  A.back = () => nav.back();
  A.noop = () => {};
  A.tab = el => {
    const v = el.dataset.v;
    if (S.tab === v && !nav.stack.length) { const sc = $('#view .scroll'); if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    nav.clear(() => { S.tab = v; if (v === 'map' && S.uiMode === 'SIMPLE') S.simpleMapFull = false; U.render(); });
  };
  // 달리기·산책 선택은 그 자리에서만 바꾼다(패널을 다시 그리지 않음)
  A.mode = el => {
    S.mode = el.dataset.v; U.save();
    const seg = el.closest('.seg'); if (!seg) return U.render();
    seg.querySelectorAll('[role=radio]').forEach(b => b.setAttribute('aria-checked', b.dataset.v === S.mode));
    const lbl = $('#view [data-act="start"] .lbl'); if (lbl) lbl.textContent = MODE_LABEL[S.mode] + ' 시작';
  };
  A.sheet = el => nav.push('sheet', el.dataset.v, { id: el.dataset.id, tall: el.dataset.v === 'weather' });
  A.screen = el => nav.push('screen', el.dataset.v, { id: el.dataset.id });
  A.issue = el => U.openIssue(el.dataset.id);
  A.routine = el => nav.push('sheet', 'routine', { id: el.dataset.id, tall: true });
  A.facility = el => nav.push('sheet', 'facility', { id: el.dataset.id });
  // 포인트·혜택은 마이페이지에서 관리한다. 홈의 ‘내 혜택’은 혜택 목록, 포인트 요약은 마이페이지로. 로그인이 필요하면 로그인 뒤 같은 곳으로.
  A.benefits = el => {
    const v = (el && el.dataset && el.dataset.v) || 'benefits';
    if (!S.signedIn) return nav.push('sheet', 'login', { then: () => A.benefits({ dataset: { v } }) });
    nav.clear(() => { S.tab = 'my'; U.render(); if (v === 'benefits') nav.push('screen', 'benefits', {}); });
  };
  A['login-my'] = () => nav.push('sheet', 'login', { then: () => nav.clear(() => { S.tab = 'my'; U.render(); }) });
  // 기록 소개에서 로그인하면 고르던 기록 하위 탭(S.recTab)으로 돌아온다
  A['login-records'] = () => nav.push('sheet', 'login', { then: () => nav.clear(() => { S.tab = 'records'; U.render(); }) });
  A['go-records'] = el => nav.clear(() => { S.tab = 'records'; S.recTab = el.dataset.v; if (el.dataset.v === 'run') { S.statRange = 'all'; S.statSel = null; } U.render(); }); // 운동 기록은 전체 목록으로
  A.ledger = el => { S.ledgerTab = el.dataset.v || 'all'; nav.push('screen', 'ledger', {}); };
  A['profile-edit'] = () => { if (nav.find('profile')) return; nav.push('screen', 'profile', { title: '프로필 수정', value: S.db.users.me.displayName || '' }); };
  A['profile-save'] = async () => {
    const e = nav.top(); if (e.p.busy) return;
    e.p.busy = true; e.p.err = null; U.render();
    const r = await U.api('updateProfile', { displayName: e.p.value || '' });
    e.p.busy = false;
    if (!r.ok) { e.p.err = U.errText(r); return U.render(); } // 입력은 e.p.value에 그대로 남는다
    nav.back(() => U.toast(r.displayName ? '이름을 저장했어요' : '이름을 비웠어요', 'ok'));
  };
  A['stat-bar'] = el => { S.statSel = S.statSel === el.dataset.v ? null : el.dataset.v; U.render(); };
  A['stat-range'] = el => { S.statRange = el.dataset.v; S.statSel = null; U.render(); };
  // 간편 지도: 제목을 누르면 이 화면에 머문 채 선택 코스만 바꾼다(운동 종류·시작은 그대로). ‘코스 보기’는 전체 지도로.
  A['simple-course'] = el => { S.simpleCourse = el.dataset.id; U.render(); };
  A['panel-toggle'] = () => U.setHomeOpen(!S.homeOpen);
  A['river-tab'] = el => { S.riverTab = el.dataset.v; U.render(); };
  A['river-old'] = () => { S.riverOld = !S.riverOld; U.render(); };
  A['news-topic'] = el => { S.newsTopic = el.dataset.v; U.render(); };
  A['news-more'] = el => { // 그 항목만 바꾼다: 다른 항목의 펼침 상태와 스크롤은 그대로
    S.newsOpen = S.newsOpen || {}; const open = S.newsOpen[el.dataset.id] = !S.newsOpen[el.dataset.id]; U.save();
    const art = el.closest('.news'); art.classList.toggle('open', open); el.textContent = open ? '접기' : '요약 더 보기'; el.setAttribute('aria-expanded', open);
    const chk = art.querySelector('.news-chk'); if (chk) chk.hidden = !open;
  };
  A['wx-retry'] = () => U.loadWeather(true);
  A['map-mode'] = el => { S.mapMode = el.dataset.v; if (S.mapSel && el.dataset.v !== 'all' && modeOf(S.mapSel) !== el.dataset.v) S.mapSel = null; U.render(); }; // 화면 위치는 그대로 둔다
  A['map-pick'] = el => { const sel = el.dataset.v; U.selectOnMap(sel); if (!sel.startsWith('course:')) MapUI.fit(boundsOf(sel)); };
  A['map-old'] = el => { S.mapOld = el.checked; S.mapSel = null; U.render(); };
  A['map-unsel'] = () => { S.mapSel = null; U.render(); };
  A['map-retry'] = () => MapUI.retry();
  A['simple-purpose'] = el => { S.simplePurpose = el.dataset.v; U.render(); };
  A['simple-anchor'] = el => { S.simpleAnchor = el.dataset.v; U.render(); };
  A['simple-map-full'] = () => {
    const course = S.simplePurpose === 'course';
    S.simpleMapFull = true; S.mapMode = { course: 'course', fac: 'fac', issue: 'issue' }[S.simplePurpose]; S.mapSel = course ? 'course:' + (S.simpleCourse || 'c1') : null; U.render();
    if (course) MapUI.fit(boundsOf(S.mapSel), 17); // 축약 지도에서 고른 코스를 큰 지도에서도 선택한 채로
  };
  A['simple-map-list'] = () => { S.simpleMapFull = false; U.render(); };
  A.locate = () => {
    const here = U.loc();
    if (!here) return U.askLocation().then(() => { const h = U.loc(); if (h) MapUI.focus([h.lat, h.lng]); U.render(); });
    if (Pl.distM([here.lat, here.lng], D.PILOT.center) > 3000) U.toast('파일럿 구간 밖에 있어요. 우이천 구간을 보여줄게요');
    MapUI.focus(Pl.distM([here.lat, here.lng], D.PILOT.center) > 3000 ? D.PILOT.center : [here.lat, here.lng]);
  };
  A['fac-map'] = el => U.showOnMap('fac:' + el.dataset.id);
  A['course-start'] = el => { S.courseId = el.dataset.id; const c = D.COURSES.find(x => x.id === el.dataset.id); if (!c.modes.includes(S.mode)) S.mode = 'WALK'; nav.clear(() => U.startWorkout()); };
  A['map-course'] = el => { if (S.tab === 'map' && !simpleList()) U.selectOnMap('course:' + el.dataset.id); else U.showOnMap('course:' + el.dataset.id); };
  A['rec-tab'] = el => { S.recTab = el.dataset.v; U.render(); };
  A['rec-more'] = () => { S.recMore = true; U.render(); };
  // 화면 모드 전환: 탭·지도 위치·작성 중인 제보(화면 스택)·운동 상태는 그대로 두고 그리기만 바꾼다
  const setUiMode = m => { S.uiMode = m; S.db.users.me.uiMode = m; U.render(); };
  A['ui-mode'] = el => { setUiMode(el.dataset.v); U.toast(el.dataset.v === 'SIMPLE' ? '간편모드로 바꿨어요' : '일반 화면으로 바꿨어요', 'ok'); };
  A['simple-off'] = () => setUiMode('DEFAULT');
  A.toggle = el => {
    if (el.dataset.v === 'repeat') S.db.users.me.repeatObservationNotifications = el.checked;
    U.render();
  };
  A['perm-loc'] = () => U.askLocation(true).then(U.render);
  A['perm-notif'] = () => U.askNotif(true).then(U.render);
  A['delete-account'] = async () => {
    const ok = await U.sys('<h2>계정과 내 데이터를 삭제할까요?</h2><p>운동 기록, 내가 찍은 사진, 포인트, 혜택이 이 브라우저에서 삭제돼요. 이전 버전에서 옮겨 온 기록도 함께 지워요.</p><div class="sys-actions"><button data-sys="no">취소</button><button data-sys="yes" class="danger">삭제</button></div>');
    if (ok.v === 'yes') { U.reset(true); U.toast('계정과 데이터를 삭제했어요', 'ok'); }
  };

  // ---------- 이벤트 ----------
  let suppressClick = false; // 패널을 끌다 놓은 직후의 클릭은 무시
  document.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el.tagName === 'INPUT') return; // 스위치·파일 선택은 change에서
    const f = A[el.dataset.act];
    if (f) { e.preventDefault(); f(el, e); }
  }, true);
  document.addEventListener('change', e => { const el = e.target.closest('input[data-act]'); if (el && A[el.dataset.act]) A[el.dataset.act](el, e); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#sys-root').hidden) return;
    if (e.key === 'Escape' && nav.stack.length) { const top = nav.top(); if (!(top.p && top.p.locked)) nav.back(); }
    else if (e.key === 'Escape' && S.tab === 'home' && S.homeOpen) U.setHomeOpen(false);
  });
  // 시트 손잡이를 아래로 끌어 닫기
  let drag = null;
  document.addEventListener('pointerdown', e => { const g = e.target.closest('[data-grip]'); if (!g) return; drag = { y: e.clientY, el: g.closest('.sheet') }; g.setPointerCapture(e.pointerId); });
  document.addEventListener('pointermove', e => { if (!drag) return; const dy = Math.max(0, e.clientY - drag.y); drag.el.style.transform = 'translateY(' + dy + 'px)'; });
  document.addEventListener('pointerup', e => { if (!drag) return; const dy = e.clientY - drag.y, el = drag.el; drag = null; if (dy > 90) nav.back(); else el.style.transform = ''; });

  // 홈 운동 패널 끌기: 조작부(달리기·산책·시작·바로가기) 위에서는 시작하지 않는다.
  // 끄는 동안 손가락을 따라가고, 놓으면 가까운 상태로 같은 요소가 미끄러져 간다(CSS 전환).
  // 펼친 내용은 맨 위일 때만 아래로 끌어 접는다. 10px 미만 움직임과 가로 움직임(코스 넘기기)은 끌기로 보지 않는다.
  let pd = null;
  document.addEventListener('pointerdown', e => {
    const p = e.target.closest('.home-panel');
    if (!p || e.button > 0 || nav.stack.length) return;
    const inMore = !!e.target.closest('.hp-more');
    if (!inMore && e.target.closest('button, a, input, label') && !e.target.closest('.hp-handle')) return;
    pd = { y: e.clientY, x: e.clientX, id: e.pointerId, type: e.pointerType, p, inMore, open: S.homeOpen, more: p.querySelector('.hp-more'), dragging: false, last: 0 };
  });
  document.addEventListener('pointermove', e => {
    if (!pd || e.pointerId !== pd.id) return;
    const dy = e.clientY - pd.y, dx = e.clientX - pd.x;
    if (!pd.dragging) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { pd = null; return; } // 가로: 코스 목록 넘기기에 맡긴다
      if (Math.abs(dy) < 10) return;
      if ((pd.open && dy < 0) || (!pd.open && dy > 0) || (pd.inMore && pd.more.scrollTop > 0)) { pd = null; return; }
      pd.dragging = true; pd.p.classList.add('dragging');
      pd.range = pd.p.offsetHeight - parseFloat(getComputedStyle(pd.p).getPropertyValue('--peek-h'));
      try { pd.p.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    }
    pd.last = Math.min(pd.range, Math.max(0, (pd.open ? 0 : pd.range) + dy));
    pd.p.style.transform = 'translateY(' + pd.last + 'px)';
  });
  const endPanelDrag = () => {
    if (!pd) return;
    const d = pd; pd = null;
    if (!d.dragging) return;
    d.p.classList.remove('dragging'); d.p.style.transform = '';
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    U.setHomeOpen(d.last < d.range * (d.open ? 0.25 : 0.85)); // 펼친 상태는 25%, 접힌 상태는 15%만 끌면 넘어간다
  };
  document.addEventListener('pointerup', endPanelDrag);
  document.addEventListener('pointercancel', endPanelDrag);
  // 터치: 펼친 내용이 맨 위일 때 아래로 끄는 동작은 스크롤 대신 패널 접기로 처리
  document.addEventListener('touchmove', e => {
    if (!pd) return;
    if (pd.dragging || (pd.inMore && pd.open && pd.more.scrollTop <= 0 && e.touches[0].clientY > pd.y && Math.abs(e.touches[0].clientY - pd.y) > Math.abs(e.touches[0].clientX - pd.x))) e.preventDefault();
  }, { passive: false });

  // ---------- 시작 ----------
  U.boot = () => {
    const t0 = Date.now(); let purged = 0;
    S.runs.forEach(r => { if (r.rawUntil && t0 >= r.rawUntil && (r.raw || (r.segs && r.segs.length))) { delete r.raw; r.segs = []; r.purged = true; purged++; } });
    if (purged) U.saveNow();
    U.render();
    U.loadWeather(false);
    setInterval(() => U.loadWeather(false), 15 * MIN); // 캐시가 신선하면 다시 부르지 않는다
    document.addEventListener('visibilitychange', () => { if (!document.hidden) U.loadWeather(false); });
    if (S.demo.locSource === 'real') U.watchReal(true);
    setInterval(() => { if (U.tick) U.tick(); }, 1000);
    if (U.liveSession() && U.onRestore) U.onRestore();
  };
})();
