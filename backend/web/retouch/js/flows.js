/* 우이런 프로토타입 — 흐름: 로그인·권한, 운동 세션과 관찰 알림, 촬영, 환경 제보, 정기 관찰, 포인트·웰컴·쿠폰, 잠금화면 체험 */
(function () {
  'use strict';
  const D = window.UIRUN_DATA, Pl = window.Policy, Sv = window.Services, U = window.U;
  const { MIN, H, DAY, CAT, P } = Pl;
  const { esc, ic, fmt, $, nav, near, ago } = U;
  const A = U.act, S = () => U.S();

  // 코스 위치 보간 (왕복: 0→L 나가고 L→2L 돌아옴)
  D.COURSES.forEach(c => { c.cum = [0]; for (let i = 1; i < c.out.length; i++) c.cum.push(c.cum[i - 1] + Pl.distM(c.out[i - 1], c.out[i])); c.len = c.cum[c.cum.length - 1]; });
  function courseAt(c, m) {
    let d = m % (2 * c.len); if (d > c.len) d = 2 * c.len - d;
    let i = c.cum.findIndex(x => x >= d); if (i <= 0) return c.out[0];
    const f = (d - c.cum[i - 1]) / (c.cum[i] - c.cum[i - 1] || 1), a = c.out[i - 1], b = c.out[i];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  function nearestProgress(c, pt) { let best = 0, bd = Infinity; c.out.forEach((p, i) => { const d = Pl.distM(p, pt); if (d < bd) { bd = d; best = c.cum[i]; } }); return best; }
  U.courseAt = courseAt; U.nearestProgress = nearestProgress;
  const course = id => D.COURSES.find(c => c.id === id);

  // 촬영·지도처럼 다시 그리면 안 되는 요소는 DOM을 옮겨 붙인다
  const keep = {};
  function persist(root, key, make) {
    const ph = root && root.querySelector('[data-persist="' + key + '"]');
    if (!ph) return null;
    if (!keep[key]) keep[key] = make();
    ph.replaceWith(keep[key]);
    return keep[key];
  }

  // ---------- 로그인·동의·권한 ----------
  A.login = () => nav.push('sheet', 'login', {});
  U.sheets.login = () => U.sheetHead('로그인') + '<div class="sheet-body">' +
    '<p class="t-body">로그인하면 운동 기록과 환경 참여, 포인트를 모아 볼 수 있어요.</p>' +
    '<button class="btn btn-line btn-google" data-act="google"><span class="g">G</span>Google 계정으로 계속</button>' +
    '<p class="t-micro">Google 계정으로 로그인하고 기록을 서버에 저장해요.</p>' +
    '<button class="link-btn" data-act="back">둘러보기 계속</button></div>';
  A.google = el => {
    el.disabled = true; el.innerHTML = '<span class="spin"></span>로그인하는 중';
    const then = nav.top().p.then;
    setTimeout(() => nav.replace('screen', 'consent', { then, agree: {}, title: '약관 동의' }), 600);
  };
  const TERMS = [['tos', '서비스 이용약관', ''], ['privacy', '개인정보 수집·이용', '운동 경로, 촬영·참여 위치, 관찰 사진을 모아요. ' + U.RETENTION], ['lbs', '위치기반서비스 이용약관', '']];
  U.screens.consent = e => {
    const a = e.p.agree, all = TERMS.every(t => a[t[0]]);
    return U.appbar('약관 동의', { close: true }) + '<div class="screen-body scroll pad">' +
      '<label class="check-row all"><input type="checkbox" data-act="consent" data-v="all"' + (all ? ' checked' : '') + '><span>모두 동의</span></label>' +
      TERMS.map(([k, label, desc]) => '<label class="check-row"><input type="checkbox" data-act="consent" data-v="' + k + '"' + (a[k] ? ' checked' : '') + '><span><b>(필수) ' + label + '</b>' + (desc ? '<span class="t-micro">' + desc + '</span>' : '') + '</span></label>').join('') +
      '<p class="t-micro">알림과 카메라 권한은 필요한 순간에 따로 물어봐요.</p></div>' +
      '<footer class="screen-foot"><button class="btn btn-ink grow" data-act="consent-ok"' + (all ? '' : ' disabled') + '>동의하고 계속</button></footer>';
  };
  A.consent = el => { const e = nav.top(); if (el.dataset.v === 'all') TERMS.forEach(t => { e.p.agree[t[0]] = el.checked; }); else e.p.agree[el.dataset.v] = el.checked; U.render(); };
  A['consent-ok'] = () => {
    const st = S(), then = nav.top().p.then;
    st.signedIn = true; st.consentAt = U.now();
    U.toast('로그인했어요', 'ok');
    nav.back(() => { if (then) { U.render(); then(); } else nav.clear(() => { st.tab = 'home'; U.render(); }); });
  };

  U.askLocation = force => new Promise(res => {
    const st = S();
    if (st.perms.location === 'precise' && !force) return res('precise');
    nav.push('sheet', 'perm', { kind: 'loc', done: res });
  });
  U.askNotif = force => new Promise(res => {
    if (S().perms.notif !== 'unknown' && !force) return res(S().perms.notif);
    nav.push('sheet', 'perm', { kind: 'notif', done: res });
  });
  U.sheets.perm = e => e.p.kind === 'loc'
    ? U.sheetHead('정확한 위치가 필요해요') + '<div class="sheet-body"><ul class="plain">' +
      '<li>운동 거리와 경로를 기록해요</li><li>관찰 지점 가까이에서만 참여할 수 있게 확인해요</li><li>앱을 쓰는 동안에만 쓰고, 백그라운드 위치는 요청하지 않아요</li></ul>' +
      '<p class="t-sub">허용하지 않아도 날씨·지도·공개 관찰은 볼 수 있어요.</p></div>' +
      '<footer class="sheet-foot"><button class="btn btn-line" data-act="perm-skip">나중에</button><button class="btn btn-ink grow" data-act="perm-go">계속</button></footer>'
    : U.sheetHead('관찰 요청을 알림으로 받을까요?') + '<div class="sheet-body"><p class="t-body">운동 중 가까운 관찰 지점을 지날 때 짧게 알려줘요.</p>' +
      '<p class="t-sub">거절해도 운동은 그대로 할 수 있어요.</p></div>' +
      '<footer class="sheet-foot"><button class="btn btn-line" data-act="perm-skip">나중에</button><button class="btn btn-ink grow" data-act="perm-go">계속</button></footer>';
  U.after['perm:leave'] = e => { if (!e.p.resolved) { e.p.resolved = true; e.p.done('skip'); } };
  A['perm-skip'] = () => nav.back();
  A['perm-go'] = async () => {
    const e = nav.top(), st = S();
    if (e.p.kind === 'loc') {
      const r = await U.sys('<div class="sys-ic">' + ic('locate') + '</div><h2>우이런에서 이 기기의 위치에 액세스하도록 허용하시겠습니까?</h2>' +
        '<div class="sys-acc"><label><input type="radio" name="acc" value="precise" checked><span>' + ic('locate') + '정확한 위치</span></label><label><input type="radio" name="acc" value="approx"><span>' + ic('map') + '대략적인 위치</span></label></div>' +
        '<div class="sys-actions col"><button data-sys="while">앱 사용 중에만 허용</button><button data-sys="once">이번만 허용</button><button data-sys="deny">허용 안함</button></div>');
      st.perms.location = r.v === 'deny' ? 'denied' : r.acc === 'approx' ? 'approx' : 'precise';
      if (st.demo.locSource === 'real' && r.v !== 'deny') U.watchReal(true);
      U.toast(st.perms.location === 'precise' ? '정확한 위치를 허용했어요' : st.perms.location === 'approx' ? '대략적인 위치만 허용했어요' : '위치를 허용하지 않았어요', st.perms.location === 'precise' ? 'ok' : '');
    } else {
      const r = await U.sys('<div class="sys-ic">' + ic('bell') + '</div><h2>우이런에서 알림을 보내도록 허용하시겠습니까?</h2><div class="sys-actions col"><button data-sys="allow">허용</button><button data-sys="deny">허용 안함</button></div>');
      st.perms.notif = r.v === 'allow' ? 'granted' : 'denied';
    }
    e.p.resolved = true;
    nav.back(() => e.p.done(e.p.kind === 'loc' ? st.perms.location : st.perms.notif));
  };
  U.sheets.locblocked = () => {
    const st = S();
    return U.sheetHead(st.perms.location === 'approx' ? '정확한 위치가 꺼져 있어요' : '위치 권한이 없어요') + '<div class="sheet-body">' +
      '<p class="t-body">운동 기록과 현장 참여는 정확한 위치가 있어야 시작할 수 있어요.</p></div>' +
      '<footer class="sheet-foot"><button class="btn btn-line" data-act="back">둘러보기</button><button class="btn btn-ink grow" data-act="perm-retry">권한 다시 요청</button></footer>';
  };
  A['perm-retry'] = () => nav.back(() => U.askLocation(true).then(p => { if (p === 'precise') U.startWorkout(); else U.render(); }));

  // ---------- 운동 시작 ----------
  A.start = el => U.startWorkout(el.dataset.v);
  // 6시간이 지난 세션은 어느 경로로도 이어서 기록하지 않는다(§14.1) → 정리 시트로
  U.openRun = () => {
    const s = U.liveSession(); if (!s) return;
    if (U.sessionRule(s) !== 'RESUME') return nav.push('sheet', 'resume', {});
    if (!nav.find('run')) nav.push('screen', 'run', { dark: s.mode === 'RUN', title: '운동 중' });
  };
  A['open-run'] = () => U.openRun();
  U.startWorkout = async modeOverride => {
    const st = S();
    if (modeOverride) st.mode = modeOverride;
    if (!st.signedIn) return nav.push('sheet', 'login', { then: () => U.startWorkout() });
    if (st.perms.location === 'unknown') await U.askLocation();
    if (S().perms.location !== 'precise') return nav.push('sheet', 'locblocked', {});
    if (S().perms.notif === 'unknown') await U.askNotif();
    if (U.liveSession()) return nav.push('sheet', 'resume', {});
    begin();
  };
  function begin() {
    const st = S(), t = U.now();
    if (!course(st.courseId).modes.includes(st.mode)) st.courseId = 'c1';
    st.session = { id: 'run' + t, mode: st.mode, courseId: st.courseId, status: 'PREP', prepAt: Date.now(), startedAt: t, localOnly: st.demo.offline, serverStartedAt: null,
      activeMs: 0, baseMs: 0, runSince: null, rate: 1, lastFixAt: null, pauses: [], track: [], distanceM: 0, exposureIds: [], alertId: null, stateSeq: 0, progressM: 0, syncPending: false, sim: st.demo.locSource === 'sim' };
    if (st.demo.locSource === 'sim') st.sim.pos = course(st.session.courseId).out[0];
    nav.push('screen', 'run', { dark: true, title: '운동 중' });
  }
  U.beginSessionAt = (progressM, statusOverride) => { // 체험 패널용: 코스의 특정 지점에서 시작
    begin();
    const s = S().session; s.status = statusOverride || 'ACTIVE'; s.progressM = progressM; s.serverStartedAt = s.localOnly ? null : U.now();
    if (s.status === 'ACTIVE') Pl.runClock.run(s, Date.now(), rateOf(s));
    S().sim.pos = courseAt(course(s.courseId), progressM);
    U.render();
  };

  // ---------- 틱 ----------
  const SPEED = { RUN: 3.1, WALK: 1.35 }; // m/s
  const rateOf = s => (s.sim ? Math.max(1, S().demo.speed) : 1); // 체험 빨리 감기는 시뮬레이션 기록에만. 실제 위치 기록은 항상 1배
  U.tick = () => {
    const st = S(), t = U.now();
    if (Pl.expirePending(st.db, t)) { U.toast('7일 안에 확인되지 않은 검토 중 포인트가 만료됐어요'); U.render(); }
    const s = st.session;
    if (s) sessionTick(st, s, t);
    U.liveTick();
    camTick(t);
    document.querySelectorAll('[data-countdown]').forEach(el => {
      const left = Math.max(0, Number(el.dataset.countdown) - t);
      el.textContent = fmt.dur(left);
      if (!left && !el.dataset.done) { el.dataset.done = '1'; U.render(); }
    });
    const clock = $('#lock-clock'); if (clock) clock.textContent = fmt.time(t);
  };
  function sessionTick(st, s, t) {
    const sim = st.demo.locSource === 'sim';
    if (s.status === 'PREP') {
      const l = U.loc();
      if (Date.now() - s.prepAt > 1200 && l && l.accuracyM <= P.maxAccuracyM) { s.status = 'COUNT'; s.countAt = Date.now(); U.render(); }
      else updatePrep(l);
      return;
    }
    if (s.status === 'COUNT') {
      const n = 3 - Math.floor((Date.now() - s.countAt) / 1000);
      if (n <= 0) { s.status = 'ACTIVE'; s.startedAt = U.now(); Pl.runClock.run(s, Date.now(), rateOf(s)); if (!s.localOnly) s.serverStartedAt = s.startedAt; U.render(); }
      else { const el = $('#count'); if (el) el.textContent = n; }
      return;
    }
    if (s.status !== 'ACTIVE') { updateRunDom(st, s, t); return; }
    if (U.sessionRule(s) !== 'RESUME') { // 6시간이 지나면 기록을 멈추고 정리 안내
      Pl.runClock.stop(s, Date.now()); s.activeMs = s.baseMs; s.status = 'PAUSED'; s.pauses.push({ from: t }); U.saveNow();
      U.toast('시작한 지 6시간이 지나 기록을 멈췄어요'); return nav.push('sheet', 'resume', {});
    }
    // 운동 시간 = 실제 경과 시각 − 일시정지(타이머가 늦게 불려도 틀어지지 않는다). 체험 속도를 바꾸면 그때까지를 확정하고 새 배율로.
    const now = Date.now();
    if ((s.rate || 1) !== rateOf(s)) Pl.runClock.run(s, now, rateOf(s));
    s.activeMs = Pl.runClock.ms(s, now); s.seenAt = now;
    // 시뮬레이션 이동도 실제 경과 시간 기준. 5초 넘게 틱이 없었으면 그 공백을 이동으로 채우지 않는다.
    const dt = Math.min(5, Math.max(0, (now - (s.simAt || now)) / 1000)); s.simAt = now;
    if (sim && st.demo.speed > 0 && !st.sim.free) { s.progressM += SPEED[s.mode] * (s.rate || 1) * dt; st.sim.pos = courseAt(course(s.courseId), s.progressM); }
    // 새 측정값만 실제 측정 시각으로 기록한다. 같은 위치를 매초 다시 넣지 않고, 10초 넘은 위치는 넣지 않으며, 위치가 없던 시간은 비워 둔다.
    const l = U.loc();
    if (l && l.measuredAt !== s.lastFixAt && U.now() - l.measuredAt <= P.maxFixAgeSec * 1000) {
      s.lastFixAt = l.measuredAt;
      const age = (U.now() - l.measuredAt) * (s.rate || 1);
      s.track.push({ lat: +l.lat.toFixed(6), lng: +l.lng.toFixed(6), acc: l.accuracyM, t: Math.max(0, Math.round(s.activeMs - age)), m: l.measuredAt, gap: s.gapNext || undefined, alt: l.alt != null ? Math.round(l.alt) : undefined, altAcc: l.altAcc != null ? Math.round(l.altAcc) : undefined }); // 고도는 정확도와 함께 원본만 보관(화면 표시 안 함)
      s.gapNext = false;
    }
    s.distanceM = Pl.trackDistance(s.track);
    if (Date.now() - (s.savedAt || 0) > 5000) { s.savedAt = Date.now(); s.saveFailed = !U.saveNow(); } // 진행 중 기록을 5초마다 이 기기에 보관, 실패하면 화면에 알린다
    if (!st.demo.offline && !s.serverStartedAt) { s.serverStartedAt = t; s.syncPending = false; U.toast('연결됐어요. 지금부터 관찰 알림을 받을 수 있어요'); }
    if (st.demo.offline && s.stateSeq) s.syncPending = true;
    if (s.serverStartedAt && !st.demo.offline && l && l.precise) {
      const cand = Pl.exposureCandidate(st.db, Object.assign({}, s, { startedAt: s.serverStartedAt }), 'me', l, t);
      if (cand) {
        const ex = Pl.recordExposure(st.db, s, 'me', cand, t);
        s.alertId = ex.id;
        if (navigator.vibrate && st.perms.notif !== 'denied') { try { navigator.vibrate(s.mode === 'RUN' ? 60 : [40, 80, 40]); } catch (e) { /* 진동 미지원 */ } }
        U.render(); return;
      }
    }
    updateRunDom(st, s, t);
  }
  function updatePrep(l) { const el = $('#prep-acc'); if (el) el.textContent = l ? '정확도 ' + l.accuracyM + 'm' : '위치를 받는 중'; }
  function runNote(s) {
    if (s.saveFailed) return ic('warn') + '이 기기에 저장하지 못하고 있어요. 저장 공간을 확인해 주세요';
    if (s.localOnly && !s.serverStartedAt) return ic('wifi-off') + '연결 없이 기록 중 · 관찰 알림은 꺼져 있어요';
    const lastT = s.track.length ? s.track[s.track.length - 1].t : 0; // 운동 시간 축에서 마지막 위치 이후 1분 넘게 위치가 없으면
    if (s.status === 'ACTIVE' && s.activeMs - lastT > 60000) return ic('locate') + '위치를 받지 못하고 있어요 · 이 동안의 거리는 기록되지 않아요';
    return '';
  }
  function updateRunDom(st, s, t) {
    const set = (id, v) => { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
    set('r-dist', fmt.km(s.distanceM)); set('r-time', fmt.dur(s.activeMs));
    const tEl = document.getElementById('r-time'); if (tEl) tEl.classList.toggle('long', s.activeMs >= H); // 1시간 이상도 한 줄 set('r-pace', fmt.pace(s.activeMs, s.distanceM)); set('r-mini', fmt.dur(s.activeMs));
    const l = U.loc();
    set('r-gps', l ? 'GPS ' + l.accuracyM + 'm' + (l.accuracyM > P.maxAccuracyM ? ' · 거리 제외 중' : '') : '위치 없음');
    const note = $('#r-note'); if (note) { const h = runNote(s); if (note.innerHTML !== h) note.innerHTML = h; }
    const map = $('#r-map'); if (map) map.innerHTML = runArt(s);
    updateAlertDom(st, s, t, l);
  }
  // 경로는 일시정지·복구로 끊긴 곳에서 나눠 그린다(정지 중 이동을 선으로 잇지 않음)
  const segLines = segs => segs.map(pts => ({ pts, cls: 'art-route' }));
  U.recSegs = rec => rec.segs || [rec.track];
  function runArt(s) {
    const c = course(s.courseId), last = s.track[s.track.length - 1];
    return Sv.routeSvg({ lines: [{ pts: D.G.center, cls: 'art-river' }, { pts: c.out, cls: 'art-plan' }, ...segLines(Pl.trackSegments(s.track))], dots: last ? [{ pt: [last.lat, last.lng], cls: 'art-me', r: 6 }] : [], w: 340, h: 150, pad: 14, fit: c.out });
  }

  // ---------- 운동 화면 ----------
  // 정보 영역만 스크롤되고 조작부(일시정지·재개·제보·종료)는 아래에 고정된다. 알림이 떠도 조작부는 가려지지 않는다.
  U.screens.run = e => {
    const st = S(), s = st.session;
    if (!s) return '<div class="run"><div class="run-empty"><p>진행 중인 운동이 없어요.</p><button class="btn btn-white" data-act="back">돌아가기</button></div></div>';
    const modeLabel = U.MODE_LABEL[s.mode], c = course(s.courseId);
    if (s.status === 'PREP' || s.status === 'COUNT') {
      return '<div class="run prep"><header class="run-top"><span class="run-mode">' + modeLabel + '</span><span class="run-gps">' + esc(c.name) + '</span></header>' +
        (s.status === 'COUNT' ? '<div class="count"><span id="count" class="num">3</span></div>'
          : '<div class="count prep-wait"><span class="spin lg"></span><b>위치 확인 중</b><span id="prep-acc">위치를 받는 중</span>' +
            (U.loc() && U.loc().accuracyM > P.maxAccuracyM ? '<p>정확도가 30m 이하가 되면 시작해요. 정확도가 낮은 구간은 거리에서 빠져요.</p><button class="btn btn-ghost-light" data-act="run-force">기다리지 않고 시작</button>' : '') + '</div>') +
        '<div class="run-ctl"><button class="btn btn-ghost-light" data-act="run-cancel">취소</button></div></div>';
    }
    const ex = s.alertId && st.db.exposures[s.alertId];
    const showAlert = ex && !ex.dismissed;
    const paused = s.status === 'PAUSED', simple = st.uiMode === 'SIMPLE', walk = s.mode === 'WALK';
    const detail = !simple || st.runDetail;
    const report = cls => '<button class="ctl-report ' + cls + '" data-act="run-report">' + ic('flag') + '<span>환경 제보</span></button>';
    const ctl = '<div class="run-ctl">' + (walk || simple ? report('wide') : '') +
      '<div class="ctl-row">' +
      (paused ? '<button class="ctl-end" data-act="run-end">' + ic('stop') + '<span>종료</span></button>' : '<span></span>') +
      (paused ? '<button class="ctl-main resume" data-act="run-resume">' + ic('play') + '<span>재개</span></button>'
        : '<button class="ctl-main" data-act="run-pause">' + ic('pause') + '<span>일시정지</span></button>') +
      (walk || simple ? '<span></span>' : report('side')) + '</div></div>';
    const long = s.activeMs >= H ? ' long' : '';
    const nums = simple
      ? '<div class="run-simple"><div><span class="num' + long + '" id="r-time">' + fmt.dur(s.activeMs) + '</span><span>' + (walk ? '산책 시간' : '운동 시간') + '</span></div><div><span class="num" id="r-dist">' + fmt.km(s.distanceM) + '</span><span>' + (walk ? '걸은 거리(km)' : '킬로미터') + '</span></div></div>' +
        '<button class="run-more" data-act="run-detail" aria-expanded="' + !!st.runDetail + '">' + (st.runDetail ? '간단히 보기' : '자세히 보기') + '</button>' +
        (detail ? '<p class="wm-pace">평균 페이스 <b class="num" id="r-pace">' + fmt.pace(s.activeMs, s.distanceM) + '</b>/km</p>' : '')
      : walk ? '<div class="walk-main"><span class="wm-label">산책 시간</span><span class="num wm-time' + long + '" id="r-time">' + fmt.dur(s.activeMs) + '</span>' +
        '<p class="wm-dist"><span>걸은 거리</span><b class="num" id="r-dist">' + fmt.km(s.distanceM) + '</b><i>km</i></p>' +
        '<p class="wm-pace">평균 페이스 <b class="num" id="r-pace">' + fmt.pace(s.activeMs, s.distanceM) + '</b>/km</p></div>'
      : '<div class="run-hero"><span class="run-dist num" id="r-dist">' + fmt.km(s.distanceM) + '</span><span class="run-unit">킬로미터</span></div>' +
        '<div class="run-stats"><div><span class="num' + long + '" id="r-time">' + fmt.dur(s.activeMs) + '</span><span>시간</span></div><div><span class="num" id="r-pace">' + fmt.pace(s.activeMs, s.distanceM) + '</span><span>평균 페이스</span></div></div>';
    return '<div class="run' + (paused ? ' paused' : '') + (simple ? ' simple' : '') + '" data-mode="' + s.mode + '">' +
      '<header class="run-top"><span class="run-mode">' + (paused ? '일시정지' : walk ? '산책 중' : '달리기 중') + '</span>' +
      '<span class="run-gps"><span id="r-gps"></span>' + (s.sim ? ' · 체험 위치' : '') + '</span>' +
      '<button class="icon-btn light" data-act="run-min" aria-label="운동 화면 접기">' + ic('down') + '</button></header>' +
      '<div class="run-info scroll">' + (showAlert && !walk ? alertHtml(st, s, ex) : '') + nums +
      (detail ? '<div class="run-map" id="r-map">' + runArt(s) + '</div>' : '') +
      '<p class="run-note" id="r-note" aria-live="polite">' + runNote(s) + '</p>' +
      (showAlert && walk ? alertHtml(st, s, ex) : '') + '</div>' + ctl + '</div>';
  };
  U.after.run = (e, el) => { const st = S(); if (st.session) updateRunDom(st, st.session, U.now()); };

  function alertHtml(st, s, ex) {
    const t = U.now(), expired = t >= ex.expiresAt;
    let title, desc, icon, anchors;
    if (ex.kind === 'ISSUE') {
      const is = st.db.issues[ex.targetId], c = CAT[is.categoryCode];
      title = U.josa(c.label, '이', '가') + ' 보이나요?'; icon = U.catIcon(is.categoryCode); anchors = is.observationAnchors;
      desc = c.scope === 'CORRIDOR' ? '하천 안으로 들어가지 말고 둑에서 보세요.' : '';
    } else {
      const r = D.ROUTINES.find(x => x.id === ex.targetId);
      title = '정기 관찰 지점 근처예요'; icon = 'repeat'; anchors = r.anchors; desc = '이상이 없어도 지금 모습을 남길 수 있어요.';
    }
    const quickDone = !!ex.quickObsId || (ex.kind === 'ISSUE' && U.quickToday(ex.targetId)), photoDone = !!ex.photoObsId, run = s.mode === 'RUN';
    const quickBtn = ex.kind === 'ISSUE' ? '<button class="btn btn-sm ' + (run ? 'btn-white' : 'btn-ink') + '" data-act="alert-quick" id="al-quick"' + (quickDone ? ' disabled' : '') + '>' + (quickDone ? ic('check') + '오늘 남김' : '지금도 보여요') + '</button>' : '';
    const photoBtn = '<button class="btn btn-sm ' + (run ? 'btn-ghost-light' : 'btn-line') + '" data-act="alert-photo"' + (photoDone ? ' disabled' : '') + '>' + ic('camera') + (photoDone ? '사진 남김' : '사진') + '</button>';
    const body = expired ? '<p class="al-state">참여 시간이 지났어요. 관찰 상세에서 직접 참여할 수 있어요.</p>'
      : '<div class="al-actions">' + quickBtn + photoBtn + '</div><p class="al-state" id="al-state" aria-live="polite">' + (ex.msg ? esc(ex.msg) : '') + '</p>';
    return '<div class="alert ' + (run ? 'al-run' : 'al-walk') + '" role="status">' +
      '<span class="al-ic">' + ic(icon) + '</span><div class="al-main"><b>' + esc(title) + '</b>' +
      (!run && desc ? '<span>' + desc + '</span>' : '') + '<span id="al-dist" data-anchors=\'' + JSON.stringify(anchors) + '\'></span></div>' +
      '<button class="icon-btn ' + (run ? 'light' : '') + '" data-act="alert-close" aria-label="알림 닫기">' + ic('close') + '</button>' + body + '</div>';
  }
  function updateAlertDom(st, s, t, l) {
    const dEl = $('#al-dist'); if (!dEl) return;
    const ex = st.db.exposures[s.alertId]; if (!ex) return;
    if (t >= ex.expiresAt && !ex.expiredShown) { ex.expiredShown = true; U.render(); return; }
    const anchors = JSON.parse(dEl.dataset.anchors);
    const d = l ? Math.round(Pl.nearestM(l, anchors)) : null;
    dEl.textContent = (d == null ? '위치 없음' : d + 'm') + ' · ' + fmt.time(ex.expiresAt) + '까지';
    const q = $('#al-quick');
    if (q && !ex.quickObsId && !q.dataset.busy && !U.quickToday(ex.targetId)) {
      const chk = Pl.checkLocation(l, anchors, t);
      q.disabled = !!chk.code;
      const stEl = $('#al-state');
      if (stEl && !ex.msg) stEl.textContent = chk.code === 'TOO_FAR' ? '40m 안에서 남길 수 있어요' : chk.code ? U.errText({ errorCode: chk.code, details: chk }) : '';
    }
  }
  A['alert-close'] = () => { const s = S().session, ex = S().db.exposures[s.alertId]; ex.dismissed = true; U.render(); };
  A['alert-quick'] = async el => {
    const st = S(), s = st.session, ex0 = st.db.exposures[s.alertId];
    if (U.now() >= ex0.expiresAt) { ex0.msg = U.errText({ errorCode: 'EXPOSURE_EXPIRED' }); return U.render(); }
    el.dataset.busy = '1'; el.disabled = true; el.innerHTML = '<span class="spin"></span>보내는 중';
    const r = await U.api('submitQuick', { issueId: ex0.targetId, loc: U.loc(), exposureId: ex0.id, sessionId: ex0.sessionId });
    const ex = S().db.exposures[s.alertId]; // 저장 실패 시 db가 되돌려지므로 다시 읽는다
    ex.msg = r.ok ? (r.existing ? '오늘 이미 남긴 응답이에요 · 새로 기록하지 않았어요' : '남겼어요 · ' + U.reasonText(r)) : U.errText(r) + (r.retryable ? ' · 다시 눌러 주세요' : '');
    if (r.ok && !r.existing) U.toast('남겼어요 · 운동은 계속 기록 중이에요', 'ok');
    U.render();
  };
  A['alert-photo'] = () => {
    const st = S(), ex = st.db.exposures[st.session.alertId];
    if (U.now() >= ex.expiresAt) { ex.msg = U.errText({ errorCode: 'EXPOSURE_EXPIRED' }); return U.render(); }
    U.openCamera({ purpose: ex.kind === 'ISSUE' ? 'RECHECK' : 'ROUTINE', targetId: ex.targetId, exposureId: ex.id, sessionId: ex.sessionId, fromRun: true });
  };
  A['run-pause'] = () => { const s = S().session; Pl.runClock.stop(s, Date.now()); s.activeMs = s.baseMs; s.status = 'PAUSED'; s.pauses.push({ from: U.now() }); s.stateSeq++; s.syncPending = S().demo.offline; s.saveFailed = !U.saveNow(); U.render(); };
  // 재개: 일시정지 중 이동한 거리는 넣지 않도록 경로를 끊고 시작(gap)
  A['run-resume'] = () => {
    const s = S().session; if (!s) return;
    if (U.sessionRule(s) !== 'RESUME') return nav.push('sheet', 'resume', {});
    s.status = 'ACTIVE'; s.gapNext = true; s.simAt = Date.now(); Pl.runClock.run(s, Date.now(), rateOf(s)); const p = s.pauses[s.pauses.length - 1]; if (p && !p.to) p.to = U.now(); s.stateSeq++; s.syncPending = S().demo.offline; s.saveFailed = !U.saveNow(); U.render();
  };
  // 운동 중 환경 제보: 운동 상태를 바꾸지 않고 제보 화면을 위에 연다. 닫으면 운동 화면으로 돌아온다.
  A['run-report'] = () => U.openReport({ fromRun: true });
  A['run-detail'] = () => { S().runDetail = !S().runDetail; U.render(); };
  A['run-min'] = () => nav.back();
  A['run-force'] = () => { const s = S().session; s.status = 'COUNT'; s.countAt = Date.now(); U.render(); };
  A['run-cancel'] = () => { S().session = null; nav.back(); };
  A['run-end'] = () => nav.push('sheet', 'endrun', {});
  U.sheets.endrun = e => {
    const s = S().session;
    return U.sheetHead('운동을 끝낼까요?', fmt.km(s.distanceM) + 'km · ' + fmt.dur(s.activeMs)) +
      '<div class="sheet-body">' + (e.p.err ? '<p class="notice err">' + ic('warn') + esc(e.p.err) + '</p>' : '<p class="t-sub">기록을 폐기해도 운동 중 남긴 관찰과 포인트는 그대로 남아요.</p>') + '</div>' +
      '<footer class="sheet-foot col"><button class="btn btn-ink" data-act="run-finish">' + (e.p.err ? '다시 저장하기' : '저장하고 종료') + '</button><button class="btn btn-line" data-act="back">계속하기</button><button class="btn btn-text danger" data-act="run-discard">기록 폐기</button></footer>';
  };

  // 상승 고도는 표시하지 않는다: 웹 GPS 고도는 정지 상태에서도 흔들려 단순 합산이 부풀고, 검증 방법이 없다. 원본 고도만 점에 보관.
  const RAW_F = ['lat', 'lng', 'acc', 't', 'm', 'gap', 'alt', 'altAcc'];
  U.rawTrack = rec => (rec.raw ? rec.raw.p.map(a => { const o = {}; rec.raw.f.forEach((k, i) => { if (a[i] != null && !(k === 'gap' && !a[i])) o[k] = k === 'gap' ? true : a[i]; }); return o; }) : null);
  // 운동 기록 저장: 이 기기에 저장되지 않으면 세션을 되살리고 실패를 알린다
  function finishSession(status) {
    const st = S(), s = st.session, t = U.now();
    const prev = JSON.stringify(s);
    if (s.runSince != null) Pl.runClock.stop(s, Date.now());
    if (s.baseMs != null) s.activeMs = s.baseMs;
    if (s.status === 'PAUSED') { const p = s.pauses[s.pauses.length - 1]; if (p && !p.to) p.to = t; }
    const thin = seg => seg.filter((p, i) => i % 2 === 0 || i === seg.length - 1);
    // 거리·경로·구간은 같은 유효 GPS 구간에서. 구간 시간의 합은 운동 시간과 같다.
    const rec = { v: 7, id: s.id, mode: s.mode, courseId: s.courseId, startedAt: s.startedAt, endedAt: t, activeMs: s.activeMs, exposureIds: s.exposureIds.slice(), status: status || 'COMPLETED', sim: s.sim,
      // 계산 결과
      distanceM: Pl.trackDistance(s.track), laps: Pl.trackLaps(s.track), quality: Pl.trackQuality(s.track, s.activeMs),
      // 지도 표시용 축약 경로
      segs: Pl.trackSegments(s.track).map(thin),
      // 원본 측정점(위도·경도·정확도·운동 시간 축 t·측정 시각·끊김·고도·고도 정확도). 나중에 거리·구간을 다시 계산할 수 있게. 화면에는 고도를 쓰지 않는다.
      raw: { f: RAW_F, p: s.track.map(q => RAW_F.map(k => (k === 'gap' ? (q.gap ? 1 : 0) : q[k] == null ? null : q[k]))) }, rawUntil: t + P.retentionDays * DAY };
    const exps = s.exposureIds.map(id => st.db.exposures[id]);
    const appOnly = exps.filter(ex => !ex.quickObsId && !ex.photoObsId && t < ex.expiresAt && !ex.appOnly);
    appOnly.forEach(ex => { ex.appOnly = true; }); // 종료 뒤 남은 알림은 [앱에서 응답]
    st.runs.unshift(rec); st.session = null;
    if (U.saveNow()) return rec;
    st.runs.shift(); st.session = JSON.parse(prev); appOnly.forEach(ex => { ex.appOnly = false; });
    return null;
  }
  const SAVE_FAIL = '이 기기에 저장하지 못해 운동 기록을 끝내지 못했어요. 저장 공간을 확인한 뒤 다시 저장해 주세요';
  A['run-finish'] = () => { const rec = finishSession(); if (!rec) { nav.top().p.err = SAVE_FAIL; return U.render(); } nav.clear(() => nav.push('screen', 'summary', { id: rec.id, title: '운동 완료' })); };
  A['run-discard'] = async () => {
    const r = await U.sys('<h2>이번 운동 기록을 폐기할까요?</h2><p>경로와 시간이 저장되지 않아요. 운동 중 남긴 관찰은 남아요.</p><div class="sys-actions"><button data-sys="no">취소</button><button data-sys="yes" class="danger">폐기</button></div>');
    if (r.v !== 'yes') return;
    S().session = null; nav.clear(() => U.toast('운동 기록을 폐기했어요'));
  };

  // ---------- 세션 복구 (§14.1) ----------
  // 앱이 닫혀 있던 시간은 운동 시간에 넣지 않는다: 마지막으로 앱이 살아 있던 시각(seenAt)에서 멈춘 것으로 본다.
  U.onRestore = () => {
    const s = S().session;
    if (s.status === 'ACTIVE') { if (s.runSince != null) Pl.runClock.stop(s, Math.min(Date.now(), s.seenAt || s.runSince)); s.activeMs = s.baseMs != null ? s.baseMs : s.activeMs; s.status = 'PAUSED'; s.pauses.push({ from: U.now(), gap: true }); }
    s.gapNext = true; nav.push('sheet', 'resume', { restored: true });
  };
  U.sheets.resume = e => {
    const st = S(), s = st.session; if (!s) return U.sheetHead('이어서 할 운동이 없어요');
    const rule = Pl.sessionAgeRule(s.startedAt, U.now());
    const head = U.sheetHead('끝나지 않은 운동이 있어요', fmt.dt(s.startedAt) + ' 시작 · ' + fmt.km(s.distanceM) + 'km');
    const err = e.p.err ? '<p class="notice err">' + ic('warn') + esc(e.p.err) + '</p>' : '';
    if (rule === 'RESUME') return head + '<div class="sheet-body">' + err + '<p class="t-sub">' + (e.p.restored ? '앱이 닫혀 있던 동안은 기록되지 않았고, 그 구간은 경로에서 끊겨요.' : '이어서 기록하거나 지금까지의 기록을 저장할 수 있어요.') + '</p></div>' +
      '<footer class="sheet-foot col"><button class="btn btn-ink" data-act="resume-go">이어서 기록하기</button><button class="btn btn-line" data-act="resume-save">저장하고 종료</button><button class="btn btn-text danger" data-act="resume-discard">폐기</button></footer>';
    if (rule === 'CLOSE_ONLY') return head + '<div class="sheet-body">' + err + '<p class="t-sub">시작한 지 6시간이 지나 이어서 기록할 수 없어요.</p></div>' +
      '<footer class="sheet-foot col"><button class="btn btn-ink" data-act="resume-save">저장하고 종료</button><button class="btn btn-text danger" data-act="resume-discard">폐기</button></footer>';
    const canRecover = U.now() < s.startedAt + P.lateRunRecoveryDays * DAY;
    return head + '<div class="sheet-body">' + err + '<p class="t-sub">시작한 지 12시간이 지나 운동이 자동으로 정리됐어요.' + (canRecover ? ' 개인 기록으로 복구할 수 있고, 관찰 알림과 포인트는 붙지 않아요.' : ' 7일이 지나 복구할 수 없어요.') + '</p></div>' +
      '<footer class="sheet-foot col">' + (canRecover ? '<button class="btn btn-ink" data-act="resume-recover">기록 복구</button>' : '') + '<button class="btn btn-text danger" data-act="resume-discard">버리기</button></footer>';
  };
  A['resume-go'] = () => {
    const s = S().session; if (!s || U.sessionRule(s) !== 'RESUME') return U.render();
    s.status = 'ACTIVE'; s.gapNext = true; s.simAt = Date.now(); Pl.runClock.run(s, Date.now(), rateOf(s)); const p = s.pauses[s.pauses.length - 1]; if (p && !p.to) p.to = U.now();
    nav.back(() => U.openRun());
  };
  A['resume-save'] = () => { const rec = finishSession(); if (!rec) { nav.top().p.err = SAVE_FAIL; return U.render(); } nav.clear(() => nav.push('screen', 'summary', { id: rec.id, title: '운동 완료' })); };
  A['resume-recover'] = () => {
    const s = S().session, keepIds = s.exposureIds; s.status = 'ABANDONED'; s.exposureIds = [];
    const rec = finishSession('RECOVERED');
    if (!rec) { S().session.exposureIds = keepIds; nav.top().p.err = SAVE_FAIL; return U.render(); }
    nav.clear(() => { U.toast('개인 기록으로 복구했어요 · 보상 없음', 'ok'); nav.push('screen', 'record', { id: rec.id }); });
  };
  A['resume-discard'] = () => { S().session = null; nav.clear(() => U.toast('남은 운동을 정리했어요')); };

  // ---------- 운동 요약·기록 상세 ----------
  const runObs = rec => Object.values(S().db.obs).filter(o=>o.uid==='me'&&o.sessionId===rec.id&&o.visibility!=='HIDDEN'); // sessionId가 기준, 알림 연결은 이전 버전 참여만
  function partSection(rec) {
    const st = S(), obs = runObs(rec);
    const left = rec.exposureIds.map(id => st.db.exposures[id]).filter(ex => ex && st.db.issues[ex.targetId] && ex.appOnly && U.now() < ex.expiresAt && ex.kind === 'ISSUE');
    return (obs.length ? '<div class="rows">' + obs.map(o => { const rb = U.rewardBadge(o); return '<div class="row static">' + ic(o.modality === 'QUICK' ? 'tap' : 'camera') + '<span class="row-main"><b>' + esc(U.obsTitle(o)) + '</b><span>' + U.obsLabel(o) + '</span></span><span class="pts ' + rb.cls + '">' + rb.text + (rb.cls === 'pending' ? '<small>검토 중</small>' : '') + '</span></div>'; }).join('') + '</div>'
        : '<p class="t-sub">이번 운동에서는 참여하지 않았어요.</p>') +
      (left.length ? '<p class="t-sub">아직 남길 수 있는 관찰 요청이 있어요.</p><div class="rows">' + left.map(ex => '<button class="row" data-act="issue" data-id="' + ex.targetId + '"><span class="row-main"><b>' + CAT[st.db.issues[ex.targetId].categoryCode].label + '</b><span>' + fmt.time(ex.expiresAt) + '까지 · 관찰 지점에서 직접 참여</span></span>' + ic('chev') + '</button>').join('') + '</div>' : '');
  }
  // 운동 결과: 실제 지도 위 실제 이동 경로(정지·끊김 구간은 잇지 않음), 거리·시간·페이스, 구간 기록, 참여 수(환경 참여 탭과 같은 정의)
  const lapName = (x, i) => (x.partial ? '마지막 ' + (x.distM / 1000).toFixed(2) + 'km' : (i + 1) + 'km');
  // 구간 페이스: 계산 가능한 구간이 둘 이상이면 가로 막대를 바로 보여준다. 막대 길이 = 속도(길수록 빠름), 오른쪽은 /km로 맞춘 실제 페이스.
  function lapChart(laps) {
    const ok = laps.filter(x => x.distM >= 10 && x.sec > 0);
    if (ok.length < 2) return '';
    const sp = x => x.distM / x.sec, max = Math.max(...ok.map(sp)), ps = x => Math.round(x.sec / (x.distM / 1000)); // 표시하는 페이스(초/km)로 비교
    const top = Math.min(...ok.map(ps)), best = ok.filter(x => ps(x) === top).length === 1 ? ok.find(x => ps(x) === top) : null; // 같은 페이스면 ‘가장 빠름’ 없음
    return '<p class="lap-note">막대가 길수록 빨라요</p><ol class="lapbars">' + laps.map((x, i) => '<li' + (x === best ? ' class="best"' : '') + '><span class="lb-k">' + lapName(x, i) + (x === best ? '<em>가장 빠름</em>' : '') + '</span>' +
      '<span class="lb-bar">' + (ok.includes(x) ? '<i style="width:' + (sp(x) / max * 100).toFixed(1) + '%"></i>' : '') + '</span><b class="num">' + fmt.pace(x.sec * 1000, x.distM) + '</b></li>').join('') + '</ol>';
  }
  function lapsBlock(rec) {
    const laps = (rec.laps || []).filter(x => !x.partial || x.distM >= 10); // 이전 버전이 남긴 ‘마지막 0.00km’ 같은 빈 구간은 보이지 않는다
    if (!laps.length) return '';
    const chart = lapChart(laps);
    return '<h2 class="sec-title">구간 페이스</h2>' + chart +
      '<details class="lap-table"' + (chart ? '' : ' open') + '><summary>구간 표</summary><div class="rows laps"><div class="row static lap-head"><span>구간</span><span class="row-main">시간</span><span>페이스</span></div>' +
      laps.map((x, i) => '<div class="row static"><b class="lap-k">' + lapName(x, i) + '</b><span class="row-main"><span class="num">' + fmt.dur(x.sec * 1000) + '</span></span><b class="num">' + fmt.pace(x.sec * 1000, x.distM) + '</b></div>').join('') + '</div></details>' +
      (rec.legacy ? '<p class="t-micro">이전 버전에서 저장한 기록이라 완주한 km만 있어요.</p>' : '');
  }
  function resultBody(rec) {
    const n = rec.participationStats||Pl.partCounts(runObs(rec)), c = course(rec.courseId), q = rec.quality || {};
    const noDist = q.noDistance && !rec.demo;
    return '<div data-persist="res-map"></div>' +
      (rec.demo ? '<p class="notice">' + ic('info') + '체험 패널에서 만든 예시 기록이라 경로와 구간 기록이 없어요.</p>' : '') +
      (noDist ? '<p class="notice">' + ic('locate') + '위치를 받지 못해 거리·페이스·구간을 계산하지 못했어요. 운동 시간만 기록했어요.</p>'
        : q.incomplete ? '<p class="notice">' + ic('locate') + '중간에 위치를 받지 못한 시간이 있어 실제보다 거리가 짧을 수 있어요.</p>' : '') +
      '<div class="rec-head"><p class="rec-when">' + fmt.date(rec.startedAt) + ' ' + U.MODE_LABEL[rec.mode] + (rec.sim ? ' ' + U.demoTag(rec.demo ? '체험 예시 기록' : '체험 위치 기록') : '') + '</p>' +
      (noDist ? '<p class="rec-na">거리 계산 불가</p>' : '<p class="rec-dist num">' + fmt.km(rec.distanceM) + '<i>km</i></p>') +
      '<div class="rec-stats"><span><b class="num">' + fmt.dur(rec.activeMs) + '</b>' + (rec.mode === 'WALK' ? '산책 시간' : '운동 시간') + '</span><span><b class="num">' + (noDist ? '–' : fmt.pace(rec.activeMs, rec.distanceM)) + '</b>평균 페이스</span></div></div>' +
      lapsBlock(rec) +
      '<h2 class="sec-title">운동 중 환경 참여</h2><div class="stat-line"><div><b class="num">' + n.report + '</b><span>신규 제보</span></div><div><b class="num">' + n.recheck + '</b><span>현장 확인</span></div><div><b class="num">' + n.routine + '</b><span>정기 관찰</span></div></div>' +
      partSection(rec) +
      '<dl class="facts">' + U.fact('시작', fmt.dt(rec.startedAt)) + U.fact('종료', fmt.dt(rec.endedAt)) + U.fact('코스', esc(c.name)) + U.fact('위치', rec.sim ? '체험용 시뮬레이션' : '이 기기 GPS') + '</dl>';
  }
  const cardable = rec => !(rec.quality && rec.quality.noDistance); // 거리를 계산하지 못한 기록은 기록카드를 만들지 않는다
  const noRec = () => U.appbar('운동 기록', { close: true }) + '<div class="screen-body pad"><p class="empty">이 기록을 찾을 수 없어요.</p></div>';
  U.screens.summary = e => {
    const rec = S().runs.find(r => r.id === e.p.id); if (!rec) return noRec();
    return U.appbar('운동 완료', { close: true }) + '<div class="screen-body scroll pad">' + resultBody(rec) + '</div>' +
      '<footer class="screen-foot"><button class="btn btn-line' + (cardable(rec) ? '' : ' grow') + '" data-act="go-home">홈으로</button>' + (cardable(rec) ? '<button class="btn btn-blue grow" data-act="card-open" data-id="' + rec.id + '">' + ic('image') + '사진 기록카드 만들기</button>' : '') + '</footer>';
  };
  A['go-home'] = () => nav.clear(() => { S().tab = 'home'; U.render(); });
  A.record = el => nav.push('screen', 'record', { id: el.dataset.id });
  U.screens.record = e => {
    const rec = S().runs.find(r => r.id === e.p.id); if (!rec) return noRec();
    return U.appbar('운동 결과') + '<div class="screen-body scroll pad">' +
      (rec.status === 'RECOVERED' ? '<p class="notice">' + ic('history') + '늦게 정리된 기록을 복구했어요. 관찰 알림과 포인트는 붙지 않아요.</p>' : '') + resultBody(rec) + '</div>' +
      (cardable(rec) ? '<footer class="screen-foot"><button class="btn btn-blue grow" data-act="card-open" data-id="' + rec.id + '">' + ic('image') + '사진 기록카드 만들기</button></footer>' : '');
  };
  // 결과 지도: 실제 기록 구간만 그린다. 기록이 없으면 경로를 지어내지 않는다.
  function mountResMap(e, el) {
    const rec = S().runs.find(r => r.id === e.p.id);
    if (!rec || !el) return;
    const host = persist(el, 'res-map', () => { const d = document.createElement('div'); d.className = 'res-map'; return d; });
    if (!host) return;
    const segs = U.recSegs(rec).filter(sg => sg.length > 1);
    if (!Sv.MapKit.available() || !segs.length) { host.textContent = segs.length ? '지도를 불러오지 못했어요' : rec.purged ? '보존 기간(90일)이 지나 경로를 지웠어요' : '기록된 이동 경로가 없어요'; host.classList.add('empty'); return; }
    if (host._recId !== rec.id) {
      if (host._map) host._map.remove();
      const m = Sv.MapKit.create(host, { center: segs[0][0], zoom: 15 });
      segs.forEach(sg => { L.polyline(sg, { color: '#fff', weight: 10, interactive: false }).addTo(m); L.polyline(sg, { color: '#384BF0', weight: 5, interactive: false }).addTo(m); });
      for (let k = 1; k < segs.length; k++) L.circleMarker(segs[k][0], { radius: 4, color: '#222759', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).bindTooltip('일시정지 후 재개').addTo(m);
      const first = segs[0][0], lastSeg = segs[segs.length - 1], last = lastSeg[lastSeg.length - 1];
      L.marker(first, { icon: Sv.MapKit.icon('<div class="mk-end start"><i>' + ic('play') + '</i><b>출발</b></div>', [74, 30], [15, 15]), interactive: false }).addTo(m);
      L.marker(last, { icon: Sv.MapKit.icon('<div class="mk-end finish"><i>' + ic('flag') + '</i><b>종료</b></div>', [74, 30], [15, 15]), interactive: false }).addTo(m);
      m.fitBounds(L.latLngBounds(segs.flat()), { paddingTopLeft: [28, 28], paddingBottomRight: [72, 36], animate: false });
      host._map = m; host._recId = rec.id;
    }
    setTimeout(() => host._map && host._map.invalidateSize(), 60);
  }
  U.after.record = mountResMap; U.after.summary = mountResMap;
  U.after['record:leave'] = U.after['summary:leave'] = () => { const h = keep['res-map']; if (h && h._map) h._map.remove(); delete keep['res-map']; };

  // ---------- 사진 기록카드(공유용) ----------
  // 사진 + 핵심 숫자 + 작은 우이런 로고. 고른 사진은 이 기기에서 카드 편집에만 쓰고 올리지 않는다.
  // 기록카드의 앨범 사진은 환경 제보 증빙과 무관하다(제보 사진은 촬영 티켓·현장 촬영만 허용).
  const CARD_PHOTOS = ['c1', 'c2', 'river']; // 홈 대표 사진은 이용 조건 확인 전이라 공유용 카드 배경에서 뺀다
  A['card-open'] = el => {
    const rec = S().runs.find(r => r.id === el.dataset.id), c = course(rec.courseId);
    nav.push('screen', 'card', { id: rec.id, title: '사진 기록카드', src: D.PHOTOS[c.photo].src, photoKey: c.photo, kind: 'default', zoom: 1, fx: 0.5, fy: 0.5, tone: 'light' });
  };
  U.screens.card = e => {
    const p = e.p, rec = S().runs.find(r => r.id === p.id); if (!rec) return noRec();
    return U.appbar('사진 기록카드') + '<div class="screen-body scroll pad">' +
      '<div class="card-prev tone-' + p.tone + '" id="card-prev">' + (p.src ? '<img id="card-img" src="' + p.src + '" alt="기록카드 배경 사진" draggable="false">' : '<span class="card-plain"></span>') +
      '<span class="card-shade"></span><div class="card-txt"><img class="card-logo" src="' + (p.tone === 'light' ? U.LOGO.light : U.LOGO.dark) + '" alt="우이런">' +
      '<p class="card-when">' + fmt.date(rec.startedAt) + ' ' + U.MODE_LABEL[rec.mode] + '</p><p class="card-dist num">' + fmt.km(rec.distanceM) + '<i>km</i></p>' +
      '<p class="card-sub"><span><b class="num">' + fmt.dur(rec.activeMs) + '</b>시간</span><span><b class="num">' + fmt.pace(rec.activeMs, rec.distanceM) + '</b>/km</span></p>' +
      (rec.sim ? '<p class="card-note">체험 위치로 만든 기록</p>' : '') + '</div></div>' +
      '<div class="card-ctl"><button class="btn btn-line" data-act="sheet" data-v="card-photo">' + ic('image') + '사진 바꾸기</button>' +
      '<div class="seg" role="radiogroup" aria-label="글자 색">' + [['light', '밝은 글자'], ['dark', '어두운 글자']].map(([k, l]) => '<button role="radio" aria-checked="' + (p.tone === k) + '" data-act="card-tone" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      (p.src ? '<label class="card-zoom"><span>확대</span><input type="range" min="1" max="2.5" step="0.05" value="' + p.zoom + '" data-act="card-zoom" aria-label="사진 확대"></label><p class="t-micro">사진을 끌어 위치를 맞춰요.</p>' : '') +
      '<p class="t-micro">' + (p.kind === 'user' ? '고른 사진은 이 기기에서 카드를 만드는 데만 쓰고, 어디에도 올리지 않아요.' : p.kind === 'default' ? '기본 사진은 서울연구원 공공누리 사진이라 카드에 출처가 작게 들어가요.' : '') + '</p></div></div>' +
      '<footer class="screen-foot"><button class="btn btn-line" data-act="card-save">' + ic('download') + '저장</button><button class="btn btn-blue grow" data-act="card-share">' + ic('share') + '공유</button></footer>';
  };
  U.sheets['card-photo'] = () => U.sheetHead('사진 바꾸기') + '<div class="sheet-body">' +
    '<div class="photo-pick">' + CARD_PHOTOS.map(k => '<button data-act="card-default" data-v="' + k + '"><img src="' + D.PHOTOS[k].src + '" alt="' + esc(D.PHOTOS[k].place) + '"></button>').join('') +
    '<button class="plain" data-act="card-default" data-v="none"><span>사진 없이</span></button></div>' +
    '<div class="rows big"><label class="row">' + ic('camera') + '<span class="row-main"><b>사진 촬영</b></span><input class="vh" type="file" accept="image/*" capture="environment" data-act="card-file"></label>' +
    '<label class="row">' + ic('image') + '<span class="row-main"><b>앨범에서 선택</b></span><input class="vh" type="file" accept="image/*" data-act="card-file"></label></div>' +
    '<p class="t-micro">여기서 고른 사진은 기록카드에만 쓰여요. 환경 제보 사진으로는 쓸 수 없어요.</p></div>';
  const cardEntry = () => nav.find('card');
  A['card-default'] = el => { const c = cardEntry(); Object.assign(c.p, el.dataset.v === 'none' ? { src: null, kind: 'none', tone: 'light', photoKey: null } : { src: D.PHOTOS[el.dataset.v].src, kind: 'default', photoKey: el.dataset.v }, { zoom: 1, fx: 0.5, fy: 0.5 }); nav.back(); };
  // 파일을 고르지 않고 닫으면 change가 오지 않아 아무것도 바뀌지 않는다
  A['card-file'] = el => {
    const f = el.files && el.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { const c = cardEntry(); if (!c) return; Object.assign(c.p, { src: r.result, kind: 'user', zoom: 1, fx: 0.5, fy: 0.5 }); nav.back(); };
    r.onerror = () => U.toast('사진을 읽지 못했어요. 다른 사진을 골라 주세요', 'err');
    r.readAsDataURL(f);
  };
  A['card-tone'] = el => { nav.top().p.tone = el.dataset.v; U.render(); };
  A['card-zoom'] = el => { const p = nav.top().p; p.zoom = +el.value; layoutCard(p); };
  // 사진 배치: 화면 미리보기와 저장 이미지가 같은 값(zoom, fx, fy)을 쓴다
  function coverBox(W, H, iw, ih, p) { const k = Math.max(W / iw, H / ih) * p.zoom, dw = iw * k, dh = ih * k; return { dw, dh, x: (W - dw) * p.fx, y: (H - dh) * p.fy }; }
  function layoutCard(p) {
    const box = $('#card-prev'), img = $('#card-img'); if (!box || !img || !img.naturalWidth) return;
    const b = coverBox(box.clientWidth, box.clientHeight, img.naturalWidth, img.naturalHeight, p);
    Object.assign(img.style, { width: b.dw + 'px', height: b.dh + 'px', left: b.x + 'px', top: b.y + 'px' });
  }
  U.after.card = (e, el) => { const img = el && el.querySelector('#card-img'); if (img) { if (img.complete) layoutCard(e.p); else img.onload = () => layoutCard(e.p); } };
  let cd = null;
  document.addEventListener('pointerdown', ev => {
    const box = ev.target.closest('#card-prev'), img = box && box.querySelector('#card-img'); if (!img) return;
    const p = nav.top().p, b = coverBox(box.clientWidth, box.clientHeight, img.naturalWidth, img.naturalHeight, p);
    cd = { x: ev.clientX, y: ev.clientY, fx: p.fx, fy: p.fy, ox: box.clientWidth - b.dw, oy: box.clientHeight - b.dh, p }; U.setCardDrag(true);
    try { box.setPointerCapture(ev.pointerId); } catch (err) { /* 무시 */ }
  });
  document.addEventListener('pointermove', ev => {
    if (!cd) return;
    const clamp = v => Math.min(1, Math.max(0, v));
    if (cd.ox < 0) cd.p.fx = clamp(cd.fx + (ev.clientX - cd.x) / cd.ox);
    if (cd.oy < 0) cd.p.fy = clamp(cd.fy + (ev.clientY - cd.y) / cd.oy);
    layoutCard(cd.p);
  });
  const endCd = () => { if (cd) { cd = null; U.setCardDrag(false); } };
  document.addEventListener('pointerup', endCd); document.addEventListener('pointercancel', endCd);
  document.addEventListener('input', ev => { const r = ev.target.closest('input[type=range][data-act]'); if (r && A[r.dataset.act]) A[r.dataset.act](r); });
  const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  async function renderCard(p, rec) {
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    if (document.fonts) await Promise.all(['italic 800 200px Archivo', '700 44px "IBM Plex Sans KR"'].map(f => document.fonts.load(f).catch(() => null)));
    if (p.src) { const im = await loadImg(p.src), b = coverBox(W, H, im.naturalWidth, im.naturalHeight, p); g.drawImage(im, b.x, b.y, b.dw, b.dh); }
    else { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#384BF0'); gr.addColorStop(1, '#222759'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    const light = p.tone === 'light', ink = light ? '#FFFFFF' : '#111111';
    if (p.src) { const gr = g.createLinearGradient(0, H * 0.42, 0, H); gr.addColorStop(0, light ? 'rgba(17,17,17,0)' : 'rgba(255,255,255,0)'); gr.addColorStop(1, light ? 'rgba(17,17,17,.62)' : 'rgba(255,255,255,.78)'); g.fillStyle = gr; g.fillRect(0, H * 0.42, W, H * 0.58); } // 글자 뒤에만
    const logo = await loadImg(light ? U.LOGO.light : U.LOGO.dark); g.drawImage(logo, 72, 72, 230, 230 * logo.naturalHeight / logo.naturalWidth);
    g.fillStyle = ink; g.textBaseline = 'alphabetic';
    g.font = '700 46px "IBM Plex Sans KR", sans-serif'; g.fillText(fmt.date(rec.startedAt) + ' ' + U.MODE_LABEL[rec.mode], 72, 930);
    g.font = 'italic 800 230px Archivo, sans-serif'; const km = fmt.km(rec.distanceM); g.fillText(km, 60, 1150);
    const kx = 60 + g.measureText(km).width + 18; g.font = '700 60px "IBM Plex Sans KR", sans-serif'; g.fillText('km', kx, 1150);
    g.font = 'italic 800 76px Archivo, sans-serif'; g.fillText(fmt.dur(rec.activeMs), 72, 1262); const tx = 72 + g.measureText(fmt.dur(rec.activeMs)).width + 60;
    const pace = fmt.pace(rec.activeMs, rec.distanceM); g.fillText(pace, tx, 1262); const px = tx + g.measureText(pace).width + 10;
    g.font = '600 36px "IBM Plex Sans KR", sans-serif'; g.fillText('/km', px, 1262);
    g.font = '500 26px "IBM Plex Sans KR", sans-serif'; g.globalAlpha = 0.85;
    const ph = p.kind === 'default' && D.PHOTOS[p.photoKey], notes = []; if (rec.sim) notes.push('체험 위치로 만든 기록'); if (ph) notes.push('사진: ' + ph.credit + '(' + ph.license + ')');
    if (notes.length) g.fillText(notes.join(' · '), 72, 1316);
    g.globalAlpha = 1;
    return cv;
  }
  const cardBlob = async () => { const e = cardEntry(), rec = S().runs.find(r => r.id === e.p.id), cv = await renderCard(e.p, rec); return new Promise(res => cv.toBlob(b => res({ b, name: 'uirun-' + rec.id + '.png' }), 'image/png')); };
  const download = (b, name) => { const a = document.createElement('a'), u = URL.createObjectURL(b); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1500); };
  A['card-save'] = async el => { el.disabled = true; try { const { b, name } = await cardBlob(); download(b, name); U.toast('기록카드 이미지를 저장했어요', 'ok'); } catch (err) { U.toast('이미지를 만들지 못했어요', 'err'); } el.disabled = false; };
  A['card-share'] = async el => {
    el.disabled = true;
    try {
      const { b, name } = await cardBlob(), file = new File([b], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: '우이런 기록' });
      else { download(b, name); U.toast('이 브라우저는 이미지 공유를 지원하지 않아 저장했어요'); }
    } catch (err) { if (err && err.name !== 'AbortError') U.toast('공유하지 못했어요', 'err'); }
    el.disabled = false;
  };

  // ---------- 관찰 상세 ----------
  U.openIssue = id => nav.push('sheet', 'issue', { id, tall: true });
  function partState(is, t) {
    const st = S();
    if (!st.signedIn) return { block: 'login' };
    const closed = Pl.issueClosed(is, t);
    if (closed) return { block: 'closed', text: U.errText({ errorCode: closed, details: { endedAt: is.eventEndsAt } }) };
    if (is.creatorUid === 'me') return { block: 'own' };
    const l = U.loc();
    if (!l || !l.precise) return { block: 'noloc' };
    const last = st.db.photoGuards['me|' + is.id];
    return { chk: Pl.checkLocation(l, is.observationAnchors, t), qDone: !!st.db.quickMarkers['me|' + is.id + '|' + Pl.kstDay(t)],
      photoWait: last && t - last < P.photoRepeatMinH * H ? last + P.photoRepeatMinH * H : null, photoPaid: !!st.db.entitlements['PHOTO_RECHECK|me|' + is.id], quickPaid: !!st.db.entitlements['QUICK_RECHECK|me|' + is.id] };
  }
  // 상세는 위치·시간에 따라 참여 가능 여부가 바뀔 때만 다시 그린다(같은 좌표라도 위치가 오래되면 바뀐다)
  U.liveKeys.issue = e => { const is = S().db.issues[e.p.id], t = U.now(), ps = partState(is, t); return [ps.block, ps.chk && ps.chk.code, ps.qDone, !!ps.photoWait, U.issueOld(is, t), t < (is.creatorPhotoDeadlineAt || 0), Pl.todaySignals(is, t), is.verificationLevel].join(); };
  U.sheets.issue = e => {
    const st = S(), is = st.db.issues[e.p.id], c = CAT[is.categoryCode], t = U.now();
    if (is.visibility !== 'PUBLIC') return U.sheetHead(esc(c.label), '공개되지 않는 관찰') + '<div class="sheet-body"><p class="t-body">운영 기준에 따라 지금은 공개하지 않는 관찰이에요. 내가 남긴 참여 기록은 기록 › 환경 참여에 그대로 있어요.</p></div>';
    const ended = is.eventEndsAt && t >= is.eventEndsAt, ps = partState(is, t), sig = Pl.todaySignals(is, t);
    const sub = (c.scope === 'CORRIDOR' ? '하천' : '둑길') + ' · ' + (is.lifecycleStatus === 'ARCHIVED' ? '보관된 기록(해결을 뜻하지 않아요)' : c.type === 'M' ? (ended ? '일시적 현상 · 참여 종료' : '일시적 현상 · ' + fmt.time(is.eventEndsAt) + '까지') : '지속되는 현상') + (is.source === 'DEMO' ? ' · 체험용' : '');
    let part = '';
    if (ps.block === 'login') part = '<button class="btn btn-ink" data-act="login-then-issue">로그인하고 참여하기</button>';
    else if (ps.block === 'closed') part = '<p class="t-sub">' + ps.text + '. 지금도 보이면 환경 제보로 새로 남겨 주세요.</p>';
    else if (ps.block === 'noloc') part = '<p class="t-sub">정확한 위치를 허용하면 관찰 지점 가까이에서 참여할 수 있어요.</p><button class="btn btn-ink" data-act="perm-loc">위치 허용하기</button>';
    else if (ps.block === 'own') {
      const canEarn = c.r && is.creatorCreditStatus === 'OPEN' && t < is.creatorPhotoDeadlineAt && !is.firstOtherPhotoAcceptedAt;
      part = is.creatorPhotoAt ? '<p class="t-sub">내가 남긴 관찰이에요.</p>'
        : '<p class="t-sub">' + (canEarn ? fmt.time(is.creatorPhotoDeadlineAt) + '까지 내가 먼저 사진을 더하면 사진 제보 포인트(+5P, 검토 후 적립) 대상이 돼요.' : '내가 남긴 관찰이에요. 사진을 더할 수 있어요' + (c.r ? '(포인트 없음).' : '.')) + '</p>' +
          '<button class="btn btn-ink" data-act="discovery-photo" data-id="' + is.id + '">' + ic('camera') + '사진 더하기</button>';
    } else {
      const q = ps.chk.code ? U.errText({ errorCode: ps.chk.code, details: ps.chk }) : '관찰 지점 가까이에 있어요';
      const hintQ = !c.qr ? '간단 응답 포인트 없음' : !is.availablePhotoCount ? '간단 응답는 사진 기록이 생긴 뒤부터 +1P' : ps.quickPaid ? '간단 응답 포인트는 받았어요' : '간단 응답 +1P';
      const hintP = !c.r ? '사진 포인트 없음' : ps.photoPaid ? '사진 포인트는 받았어요' : '사진 +5P';
      part = '<p class="loc-line ' + (ps.chk.code ? 'warn' : 'ok') + '">' + ic(ps.chk.code ? 'locate' : 'check') + '<span>' + q + '</span></p>' +
        '<div class="pair"><button class="btn btn-ink" data-act="issue-quick"' + (ps.qDone || ps.chk.code || e.p.busy ? ' disabled' : '') + '>' + (e.p.busy === 'quick' ? '<span class="spin"></span>보내는 중' : ps.qDone ? ic('check') + '오늘 남김' : '지금도 보여요') + '</button>' +
        '<button class="btn btn-line" data-act="issue-photo"' + (ps.photoWait ? ' disabled' : '') + '>' + ic('camera') + (ps.photoWait ? fmt.time(ps.photoWait) + ' 이후' : '사진으로 남기기') + '</button></div>' +
        '<p class="t-micro">' + hintQ + ' · ' + hintP + '</p>';
    }
    if (e.p.msg) part += '<p class="result ' + e.p.msg.kind + '">' + ic(e.p.msg.kind === 'ok' ? 'check' : 'warn') + '<span>' + esc(e.p.msg.text) + '</span>' + (e.p.msg.retry ? '<button class="link-btn" data-act="' + e.p.msg.retry + '">다시 보내기</button>' : '') + '</p>';
    const anchorsTxt = [...new Set(is.observationAnchors.map(U.bankOf))].join(', ');
    // 공개 이력: 사진·검토 시각만(사진 원본·계정은 공개하지 않음)
    const hist = [[is.createdAt, is.creatorPhotoAt && is.creatorPhotoAt <= is.createdAt + MIN ? '사진과 함께 처음 관찰됨' : '처음 관찰됨']];
    Object.values(st.db.obs).filter(o => o.issueId === is.id && o.modality === 'PHOTO' && !o.late && o.role !== 'DISCOVERY').forEach(o => hist.push([o.observedAt, o.uid === 'me' ? '내가 사진 추가' : '사진 추가']));
    if (is.lastPhotoObservedAt && !hist.some(h => h[0] === is.lastPhotoObservedAt) && is.lastPhotoObservedAt !== is.createdAt) hist.push([is.lastPhotoObservedAt, '사진 추가']);
    if (is.lastVerifiedAt) hist.push([is.lastVerifiedAt, '검토 수준: ' + U.verifyLabel(is.verificationLevel)]);
    Object.values(st.db.obs).filter(o => o.issueId === is.id && o.uid === 'me' && o.modality === 'QUICK' && o.role === 'RECHECK').forEach(o => hist.push([o.observedAt, '내가 간단 응답']));
    hist.sort((a, b) => b[0] - a[0]);
    return U.sheetHead(esc(c.label), sub) + '<div class="sheet-body scroll">' +
      photoBox(is) + '<div class="evidence">' +
      (is.lastPhotoObservedAt ? '<p class="ev-photo"><b>사진 ' + ago(is.lastPhotoObservedAt) + '</b><span>사진 기록 ' + is.photoObservationCount + '건 · ' + is.photoAccounts.length + '개 계정 · ' + U.verifyLabel(is.verificationLevel) + '</span></p>'
        : '<p class="ev-photo none"><b>사진 없음</b><span>사진으로 확인된 적 없는 관찰이에요 · ' + U.verifyLabel(is.verificationLevel) + '</span></p>') +
      '<p class="ev-quick">' + (sig ? '오늘 간단 응답 ' + sig + '명 <span>· 확인 전 신호</span>' : '<span>오늘 간단 응답 없음</span>') + '</p></div>' +
      (Pl.photoStale(is, t) && !ended ? '<p class="t-sub caution">' + ic('history') + '사진이 오래됐어요. 해결됐다는 뜻은 아니에요.</p>' : '') +
      (is.pauseNote ? '<p class="t-micro">알림을 쉬는 중이에요 · 직접 참여는 할 수 있어요</p>' : '') +
      '<h3 class="sec-title">참여</h3>' + part +
      '<h3 class="sec-title">위치</h3><ul class="loc-list">' +
      '<li><span class="lg-dot issue"></span><span><b>현상 위치</b> ' + (c.scope === 'CORRIDOR' ? '하천 안 · 들어가지 말고 둑에서 보세요' : '둑길 위') + '</span></li>' +
      '<li><span class="lg-dot anchor"></span><span><b>관찰 위치</b> ' + anchorsTxt + near(is.observationAnchors) + '</span></li></ul>' +
      '<button class="link-btn" data-act="issue-map" data-id="' + is.id + '">' + ic('locate') + '이 위치 보기</button>' +
      '<h3 class="sec-title">이력</h3><ol class="hist">' + hist.map(h => '<li><span>' + fmt.dt(h[0]) + '</span>' + esc(h[1]) + '</li>').join('') + '</ol>' +
      '<button class="link-btn" data-act="sheet" data-v="obs-guide">관찰 정보 읽는 법</button></div>';
  };
  function photoBox(is) {
    const ph = U.issuePhoto(is);
    if (ph) return '<figure class="ev-fig"><img src="' + ph.src + '" alt="' + (ph.kind === 'own' ? '내가 찍은 사진' : '공개 사진') + '"><figcaption><b>촬영 ' + fmt.dt(ph.takenAt) + '</b><span>' +
      (ph.kind === 'own' ? '내가 찍은 원본 · 나만 볼 수 있어요 · 접수 ' + fmt.dt(ph.acceptedAt) : '운영자가 공개로 전환한 사진 · 접수 ' + fmt.dt(ph.acceptedAt) + (is.source === 'DEMO' ? ' · 체험용 이미지' : '')) + '</span></figcaption></figure>';
    return '<div class="ev-empty">' + ic('image') + '<b>' + (is.lastPhotoObservedAt ? '공개된 사진이 없어요' : '사진 없음') + '</b><span>' + (is.lastPhotoObservedAt ? '사진 기록 ' + is.photoObservationCount + '건이 있지만 원본은 공개하지 않아요' : '아직 사진으로 남긴 기록이 없어요') + '</span></div>';
  }
  A['login-then-issue'] = () => { const id = nav.top().p.id; nav.push('sheet', 'login', { then: () => U.openIssue(id) }); };
  A['issue-map'] = el => U.showOnMap('issue:' + el.dataset.id);
  A['issue-quick'] = async () => {
    const e = nav.top(), is = S().db.issues[e.p.id], l = U.loc();
    if (e.p.busy) return; // 보내는 중 연속 클릭
    const pre = Pl.checkLocation(l, is.observationAnchors, U.now());
    if (pre.code) { e.p.msg = { kind: 'warn', text: U.errText({ errorCode: pre.code, details: pre }) }; return U.render(); }
    e.p.busy = 'quick'; e.p.msg = null; U.render();
    const r = await U.api('submitQuick', { issueId: is.id, loc: l, sessionId: U.curSessionId() });
    e.p.busy = null;
    e.p.msg = r.ok ? { kind: 'ok', text: r.existing ? '오늘 이미 남긴 응답이에요 · 새로 기록하지 않았어요' : '남겼어요 · ' + U.reasonText(r) } : { kind: 'err', text: U.errText(r), retry: r.retryable ? 'issue-quick' : null };
    U.render();
  };
  A['issue-photo'] = () => U.openCamera({ purpose: 'RECHECK', targetId: nav.top().p.id });
  A['discovery-photo'] = el => U.openCamera({ purpose: 'DISCOVERY_PHOTO', targetId: el.dataset.id });

  // ---------- 정기 관찰 (ROUTINE) ----------
  U.liveKeys.routine = e => { const t = U.now(), rs = Pl.routineState(S().db, 'me', e.p.id, t), l = U.loc(), r = D.ROUTINES.find(x => x.id === e.p.id); return [rs.round.id, !!rs.mine, rs.accounts, Pl.checkLocation(l, r.anchors, t).code].join(); };
  U.sheets.routine = e => {
    const st = S(), r = D.ROUTINES.find(x => x.id === e.p.id), t = U.now(), rs = Pl.routineState(st.db, 'me', r.id, t), ph = D.PHOTOS[r.photo];
    const mine = rs.mine && st.db.obs[rs.mine], chk = Pl.checkLocation(U.loc(), r.anchors, t);
    let cta;
    if (!st.signedIn) cta = '<button class="btn btn-ink grow" data-act="login">로그인하고 참여하기</button>';
    else if (mine) cta = '<button class="btn btn-ink grow" disabled>' + ic('check') + '이번 회차 기록함 · 다음 ' + fmt.time(rs.round.end) + '</button>';
    else cta = '<button class="btn btn-ink grow" data-act="routine-photo" data-id="' + r.id + '">' + ic('camera') + '지금 모습 남기기</button>';
    const roundTxt = fmt.time(rs.round.start) + '–' + (fmt.time(rs.round.end) === '00:00' ? '24:00' : fmt.time(rs.round.end));
    return U.sheetHead('정기 관찰 · ' + esc(r.name), r.bankLabel + ' · 예시 지점') + '<div class="sheet-body scroll">' +
      '<p class="t-body">이상이 없어도 같은 자리에서 지금 모습을 남겨요. 같은 구도가 쌓이면 변화가 보여요.</p>' +
      '<figure class="guide-photo"><img src="' + ph.src + '" alt="예시 구도 사진"><span class="guide-frame"></span><span class="guide-horizon"></span><figcaption>예시 구도 · 다른 지점 사진</figcaption></figure>' +
      '<dl class="facts">' + U.fact('촬영 방향', esc(r.direction)) + U.fact('이번 회차', roundTxt) + U.fact('내 참여', mine ? '기록함 · ' + fmt.time(mine.acceptedAt) : '아직 안 했어요') + U.fact('이번 회차 전체', rs.accounts + '명') + '</dl>' +
      '<p class="t-micro">사진 +5P(하루 3회, 오늘 ' + rs.slotsLeft + '회 남음) · 웰컴 기여 하루 1회</p>' +
      '<p class="loc-line ' + (chk.code ? 'warn' : 'ok') + '">' + ic(chk.code ? 'locate' : 'check') + '<span>' + (chk.code ? U.errText({ errorCode: chk.code, details: chk }) : '촬영 지점 가까이에 있어요') + '</span></p>' +
      '</div><footer class="sheet-foot">' + cta + '</footer>';
  };
  A['routine-photo'] = el => U.openCamera({ purpose: 'ROUTINE', targetId: el.dataset.id });

  // ---------- 촬영 ----------
  U.openCamera = p => {
    const st = S();
    if (!st.signedIn) return nav.push('sheet', 'login', { then: () => U.openCamera(p) });
    if (st.perms.location !== 'precise') return U.askLocation(true).then(r => { if (r === 'precise') U.openCamera(p); });
    nav.push('screen', 'camera', Object.assign({ dark: true, phase: 'starting', title: '사진으로 남기기', sessionId: U.curSessionId() }, p)); // 운동 중 찍고 나중에 보내도 이 세션
  };
  function camTarget(p) {
    const st = S();
    if (p.purpose === 'ROUTINE') { const r = D.ROUTINES.find(x => x.id === p.targetId); return { title: '정기 관찰 · ' + r.name, anchors: r.anchors, routine: r }; }
    if (p.purpose === 'DISCOVERY') return { title: '환경 제보 · ' + CAT[p.cat].label, anchors: null };
    const is = st.db.issues[p.targetId]; return { title: CAT[is.categoryCode].label + (p.purpose === 'DISCOVERY_PHOTO' ? ' 사진 더하기' : ''), anchors: is.observationAnchors, scope: CAT[is.categoryCode].scope };
  }
  U.screens.camera = e => {
    const p = e.p, st = S(), tg = camTarget(p), s = st.session;
    const runPill = s && (s.status === 'ACTIVE' || s.status === 'PAUSED') ? '<div class="cam-run">' + (s.status === 'PAUSED' ? '운동 일시정지 중' : '운동 기록 중 <b id="r-mini" class="num">' + fmt.dur(s.activeMs) + '</b>') +
      '<button class="btn btn-sm btn-ghost-light" data-act="' + (s.status === 'PAUSED' ? 'run-resume' : 'run-pause') + '">' + (s.status === 'PAUSED' ? '재개' : '일시정지') + '</button></div>' : '';
    const head = '<header class="cam-top"><button class="icon-btn light" data-act="back" aria-label="닫기">' + ic('close') + '</button><b>' + esc(tg.title) + '</b><span class="appbar-gap"></span></header>';
    if (p.phase === 'done') return head + camDone(p, tg);
    if (p.phase === 'sending') return head + '<div class="cam-center"><span class="spin lg"></span><b>사진을 올리는 중</b><span class="t-micro">사진 속 위치 정보(EXIF)는 지우고 올려요</span></div>';
    if (p.phase === 'failed') return head + '<div class="cam-center"><span class="big-ic err">' + ic('warn') + '</span><b>' + esc(U.errText(p.res)) + '</b>' +
      (p.res.retryable ? '<p class="t-micro">사진은 이 화면에 남아 있어요.</p><button class="btn btn-white" data-act="cam-send">다시 보내기</button>'
        : p.res.errorCode === 'EXPOSURE_EXPIRED' ? '<p class="t-micro">관찰 지점 가까이라면 직접 참여로 보낼 수 있어요.</p><button class="btn btn-white" data-act="cam-direct">직접 참여로 보내기</button>'
        : '<button class="btn btn-white" data-act="cam-retake">다시 촬영</button>') +
      '<button class="btn btn-ghost-light" data-act="back">닫기</button></div>';
    const tk = p.ticket, ticketLine = p.ticketErr ? '<p class="cam-ticket err">' + ic('wifi-off') + '연결이 없어요. 지금 찍으면 이 기기에만 저장돼요. <button class="link-btn light" data-act="cam-ticket">다시 연결</button></p>'
      : tk ? '<p class="cam-ticket"><span data-countdown="' + (tk.issuedAt + P.captureTicketMin * MIN) + '"></span> 안에 촬영</p>' : '<p class="cam-ticket"><span class="spin"></span>촬영 준비 중</p>';
    if (p.phase === 'preview') return head + runPill + '<div class="cam-view"><img class="cam-shot" src="' + p.photo + '" alt="촬영한 사진 미리보기"></div>' +
      '<div class="cam-bottom"><p class="t-micro light">' + (p.localOnly ? '이 기기에만 저장돼요. 기록과 포인트에는 쓰이지 않아요.' : '얼굴이나 차량 번호가 크게 나왔다면 다시 찍어 주세요.') + '</p>' +
      '<div class="cam-actions"><button class="btn btn-ghost-light" data-act="cam-retake">다시 찍기</button><button class="btn btn-white grow" data-act="cam-send">' + (p.localOnly ? '이 기기에 저장' : p.purpose === 'DISCOVERY' ? '이 사진 사용' : '이 사진 보내기') + '</button></div></div>';
    let view;
    if (p.phase === 'denied') view = '<div class="cam-center"><b>카메라 권한이 필요해요</b><p class="t-micro">브라우저 주소창의 카메라 설정에서 허용해 주세요. 사진첩의 사진은 쓸 수 없어요.</p><button class="btn btn-white" data-act="cam-start">다시 시도</button><button class="btn btn-ghost-light" data-act="cam-demo">시연용 촬영으로 계속</button></div>';
    else if (p.phase === 'unavailable') view = '<div class="cam-center"><b>이 기기에서 카메라를 쓸 수 없어요</b><p class="t-micro">' + esc(p.camErr || '') + '</p><button class="btn btn-white" data-act="cam-demo">시연용 촬영으로 계속</button></div>';
    else view = '<div class="cam-view">' + (p.phase === 'demo' ? '<div class="cam-demo"><span class="tag-demo light">시연용 촬영</span></div>' : '<div data-persist="cam-video"></div>') +
      (p.purpose === 'ROUTINE' ? '<span class="guide-frame"></span><span class="guide-horizon"></span>' : '') + '</div>';
    const warn = (tg.scope || (p.cat && CAT[p.cat].scope)) === 'CORRIDOR' ? '하천 안으로 들어가지 말고 둑에서 찍어 주세요' : '현장에서 바로 찍은 사진만 쓸 수 있어요';
    return head + runPill + view + '<div class="cam-bottom">' + ticketLine +
      (tg.anchors ? '<p class="cam-dist" id="cam-dist" data-anchors=\'' + JSON.stringify(tg.anchors) + '\'></p>' : '') +
      '<p class="t-micro light">' + warn + (tg.routine ? ' · ' + esc(tg.routine.direction) : '') + '</p>' +
      '<button class="shutter" data-act="cam-shoot" aria-label="' + (shutterReady(p) ? '촬영' : '촬영 준비 중') + '"' + (shutterReady(p) ? '' : ' disabled') + '><i></i></button></div>';
  };
  function shutterReady(p) {
    const live = p.phase === 'live' || p.phase === 'demo';
    const ticketOk = p.ticket && U.now() < p.ticket.issuedAt + P.captureTicketMin * MIN;
    return live && (ticketOk || p.ticketErr);
  }
  function camDistText(el) { const l = U.loc(), d = l ? Math.round(Pl.nearestM(l, JSON.parse(el.dataset.anchors))) : null; el.textContent = d == null ? '' : d <= P.validationRadiusM ? '관찰 지점 ' + d + 'm' : '관찰 지점까지 ' + d + 'm · 40m 안에서 찍어야 기록돼요'; el.classList.toggle('warn', d > P.validationRadiusM); }
  // 촬영 화면: 셔터 전 촬영 준비가 만료되면 새로 준비하고, 관찰 지점까지 거리를 갱신한다
  function camTick(t) {
    const e = nav.top(); if (!e || e.name !== 'camera') return;
    const p = e.p;
    if ((p.phase === 'live' || p.phase === 'demo') && p.ticket && !p.ticket.shutterAt && !p.renewing && t >= p.ticket.issuedAt + P.captureTicketMin * MIN) { p.renewing = true; getTicket(e); }
    const dEl = document.getElementById('cam-dist'); if (dEl) camDistText(dEl);
    const mini = document.getElementById('r-mini'); const ss = S().session; if (mini && ss) mini.textContent = fmt.dur(ss.activeMs);
  }
  function camDone(p) {
    const r = p.res, st = S();
    let title = '우이런에 기록했어요';
    if (r.late) title = '나만 보는 기록으로 남겼어요';
    if (p.localOnly) title = '이 기기에만 저장했어요';
    const lines = [];
    if (p.localOnly) lines.push('기록과 포인트에는 쓰이지 않아요. 기록 › 환경 참여에서 볼 수 있어요.');
    else lines.push(U.reasonText(r) || '');
    if (r.welcomeCounted) lines.push('웰컴 혜택 기여 ' + Math.min(3, Pl.welcomeCount(st.db, 'me')) + '/3');
    if (r.roundEndsAt) lines.push('다음 회차 ' + fmt.time(r.roundEndsAt));
    return '<div class="cam-center done"><span class="big-ic ok">' + ic('check') + '</span><b class="t-h2">' + title + '</b>' +
      lines.filter(Boolean).map(l => '<p class="done-line">' + esc(l) + '</p>').join('') +
      '<p class="t-micro light">' + (p.localOnly ? '이 사진은 이 기기에만 있어요' : '사진 원본은 나와 운영자만 보고, 검토된 공개 사본만 공유해요') + '</p>' +
      '<button class="btn btn-white" data-act="cam-finish">' + (p.fromRun ? '운동으로 돌아가기' : '확인') + '</button></div>';
  }
  U.after.camera = (e, el) => {
    const p = e.p;
    if (p.phase === 'starting' && !p.started) { p.started = true; getTicket(e); startCam(e); return; }
    if (p.phase === 'live') { const v = persist(el, 'cam-video', () => { const x = document.createElement('video'); x.className = 'cam-video'; x.playsInline = true; x.muted = true; x.setAttribute('playsinline', ''); return x; }); if (v) Sv.Camera.attach(v); }
    const dEl = el && el.querySelector('#cam-dist'); if (dEl) camDistText(dEl);
  };
  U.after['camera:leave'] = () => { Sv.Camera.stop(); delete keep['cam-video']; };
  function getTicket(e) {
    if(window.UIRUN_REMOTE)return window.UIRUN_REMOTE.ticketFor(e);
    const p = e.p;
    p.ticketErr = false; p.ticket = null;
    setTimeout(() => {
      if (S().demo.offline) p.ticketErr = true;
      else p.ticket = { id: 'tk' + Date.now(), purpose: p.purpose, targetId: p.targetId, issuedAt: U.now() };
      p.renewing = false;
      U.render();
    }, 350);
  }
  async function startCam(e) {
    const p = e.p, st = S();
    if (st.demo.camera === 'demo') { p.phase = 'demo'; st.perms.camera = 'demo'; return U.render(); }
    if (!Sv.Camera.supported()) { p.phase = 'unavailable'; p.camErr = window.isSecureContext ? '카메라 API를 지원하지 않는 브라우저예요' : 'https 또는 localhost에서 열어야 카메라를 쓸 수 있어요'; return U.render(); }
    p.phase = 'requesting'; U.render();
    try {
      const v = document.createElement('video'); v.className = 'cam-video'; v.playsInline = true; v.muted = true; v.setAttribute('playsinline', '');
      keep['cam-video'] = v;
      await Sv.Camera.start(v);
      if (nav.top() !== e) return Sv.Camera.stop();
      st.perms.camera = 'granted'; p.phase = 'live';
    } catch (err) {
      st.perms.camera = err && err.name === 'NotAllowedError' ? 'denied' : st.perms.camera;
      p.phase = err && err.name === 'NotAllowedError' ? 'denied' : 'unavailable';
      p.camErr = err && (err.name === 'NotFoundError' ? '연결된 카메라가 없어요' : err.message);
    }
    U.render();
  }
  A['cam-start'] = () => { const e = nav.top(); e.p.phase = 'starting'; e.p.started = false; U.render(); };
  A['cam-demo'] = () => { const e = nav.top(); e.p.phase = 'demo'; U.render(); };
  A['cam-ticket'] = () => getTicket(nav.top());
  A['cam-shoot'] = () => {
    const e = nav.top(), p = e.p, tg = camTarget(p);
    if (!shutterReady(p)) return;
    const v = keep['cam-video'];
    p.photo = p.phase === 'live' && v && v.videoWidth ? Sv.Camera.capture(v) : Sv.Camera.demoFrame(tg.title);
    p.shotPhase = p.phase;
    p.localOnly = !p.ticket;
    if (p.ticket) { p.ticket.shutterAt = U.now(); p.ticket.shutterLoc = U.loc(); }
    p.phase = 'preview'; U.render();
  };
  A['cam-retake'] = () => {
    const e = nav.top(), p = e.p;
    const expired = !p.ticket || U.now() >= p.ticket.issuedAt + P.captureTicketMin * MIN || p.ticket.consumed;
    p.photo = null; p.res = null; delete p.requestId; p.phase = p.shotPhase === 'demo' || S().demo.camera === 'demo' ? 'demo' : Sv.Camera.stream ? 'live' : 'starting';
    if (p.phase === 'starting') p.started = false;
    if (expired) getTicket(e); else { delete p.ticket.shutterAt; }
    U.render();
  };
  A['cam-send'] = async () => {
    const e = nav.top(), p = e.p;
    if (p.phase === 'sending') return; // 보내는 중 연속 클릭
    if (p.localOnly) { // 연결 없이 찍은 사진은 이 기기에만. 실제 보관에 성공했을 때만 완료로 표시
      const st = S(), tg = camTarget(p);
      st.localPhotos.unshift({ id: 'lp' + Date.now(), at: U.now(), label: tg.title, photo: p.photo });
      if (!U.saveNow()) { st.localPhotos.shift(); p.res = { ok: false, errorCode: 'LOCAL_SAVE_FAILED', retryable: true }; p.phase = 'failed'; return U.render(); }
      p.res = { ok: true }; p.phase = 'done'; return U.render();
    }
    if (p.purpose === 'DISCOVERY') { const cb = p.onDone; nav.back(() => cb({ photo: p.photo, ticket: p.ticket })); return; }
    p.phase = 'sending'; p.requestId = p.requestId || U.rid(); U.render(); // 다시 보내기는 같은 요청 ID
    const fn = { RECHECK: 'submitPhotoRecheck', ROUTINE: 'submitRoutine', DISCOVERY_PHOTO: 'addDiscoveryPhoto' }[p.purpose];
    const payload = { ticket: p.ticket, photo: p.photo, exposureId: p.exposureId, sessionId: p.sessionId, requestId: p.requestId };
    if (p.purpose === 'ROUTINE') payload.missionId = p.targetId; else payload.issueId = p.targetId;
    const r = await U.api(fn, payload, { upload: true });
    p.res = r; p.phase = r.ok ? 'done' : 'failed';
    if (r.ok && p.exposureId) { const ex = S().db.exposures[p.exposureId]; if (ex) ex.msg = '사진 기록함 · ' + U.reasonText(r); }
    U.render();
  };
  A['cam-finish'] = () => nav.back();
  A['cam-direct'] = () => { const e = nav.top(); delete e.p.exposureId; delete e.p.requestId; A['cam-send'](); }; // 내용이 바뀌면 새 요청 ID

  // ---------- 환경 제보 ----------
  U.openReport = opts => {
    if (!S().signedIn) return nav.push('sheet', 'login', { then: () => U.openReport(opts) });
    if (S().perms.location !== 'precise') return U.askLocation(true).then(r => { if (r === 'precise') U.openReport(opts); });
    nav.push('screen', 'report', Object.assign({ step: 'cat', title: '환경 제보', sessionId: U.curSessionId() }, opts)); // 제보를 연 순간의 운동 세션
  };
  A.report = () => U.openReport({});
  const GROUPS = [['path', '둑길 위'], ['water', '물과 하천'], ['facility', '시설'], ['odor', '냄새']];
  const COMMON = ['LITTER', 'RIVER_WASTE', 'FOAM', 'WATER_COLOR', 'BENCH', 'ODOR_NOW'];
  const REASONS = ['조금 떨어진 다른 곳이에요', '같은 종류지만 다른 대상이에요'];
  // 위치 자동 입력: 정확도·나이가 맞지 않으면 안내하고 제출을 막는다
  function locState() {
    const l = U.loc(), t = U.now();
    if (!l) return { ok: false, kind: 'none', text: '위치를 받을 수 없어요. 위치 권한과 신호를 확인해 주세요' };
    if (!l.precise) return { ok: false, kind: 'approx', text: '정확한 위치 권한이 필요해요' };
    if (l.accuracyM > P.maxAccuracyM) return { ok: false, kind: 'acc', text: '위치 정확도가 낮아요(' + l.accuracyM + 'm). 30m 이하가 되면 남길 수 있어요' };
    if (t - l.measuredAt > P.maxFixAgeSec * 1000) return { ok: false, kind: 'stale', text: '위치 정보가 오래됐어요. 새 위치를 받는 중이에요' };
    return { ok: true, kind: 'ok', l, text: '현재 위치 · 정확도 ' + l.accuracyM + 'm' };
  }
  U.liveKeys.report = e => (e.p.step === 'method' && !e.p.pin ? locState().kind : '');
  U.screens.report = e => {
    const p = e.p, st = S(), simple = st.uiMode === 'SIMPLE', stepIdx = { cat: 0, method: 1, loc: 1 }[p.step] ?? 2;
    const prog = '<ol class="steps" aria-label="진행 단계">' + ['종류', '남기는 방법', '완료'].map((x, i) => '<li class="' + (i < stepIdx ? 'done' : i === stepIdx ? 'on' : '') + '"' + (i === stepIdx ? ' aria-current="step"' : '') + '>' + x + '</li>').join('') + '</ol>';
    const closeLike = p.step === 'cat' || p.step === 'result';
    const bar = U.appbar('환경 제보', { close: closeLike }).replace('data-act="back"', 'data-act="' + (closeLike ? 'back' : 'rep-prev') + '"');
    const ss = st.session, runNote = p.fromRun && ss ? '<p class="rep-run">' + (ss.status === 'PAUSED' ? '운동 일시정지 중' : '운동 기록 중 <b id="r-mini" class="num">' + fmt.dur(ss.activeMs) + '</b>') + '</p>' : '';
    let body = '', foot = '';
    if (p.step === 'cat') {
      // 운동 중과 간편모드는 자주 쓰는 종류부터. 전체 28종은 ‘다른 종류 보기’로.
      const tile = k => '<button class="cat" data-act="rep-cat" data-v="' + k + '">' + ic(U.catIcon(k)) + '<span>' + CAT[k].label + '</span></button>';
      body = '<h2 class="t-title">무엇을 봤나요?</h2>' + ((simple || p.fromRun) && !p.allCats
        ? '<div class="cat-grid big">' + COMMON.map(tile).join('') + '</div><button class="btn btn-line wide" data-act="rep-all">다른 종류 보기</button>'
        : GROUPS.map(([g, label]) => '<h3 class="sec-title">' + label + '</h3><div class="cat-grid">' + Object.keys(CAT).filter(k => CAT[k].group === g).map(tile).join('') + '</div>').join(''));
    } else if (p.step === 'method') {
      const c = CAT[p.cat], ls = locState();
      body = '<p class="rep-chosen">' + ic(U.catIcon(p.cat)) + '<b>' + c.label + '</b><button class="link-btn" data-act="rep-prev">바꾸기</button></p>' +
        '<p class="loc-line ' + (p.pin || ls.ok ? 'ok' : 'warn') + '">' + ic(p.pin || ls.ok ? 'locate' : 'warn') + '<span>' + (p.pin ? '정한 위치로 기록해요' : ls.text) + '</span>' +
        (ls.ok && !simple ? '<button class="link-btn" data-act="rep-adjust">위치 조정</button>' : '') + (!ls.ok && !p.pin ? '<button class="link-btn" data-act="rep-refresh">다시 확인</button>' : '') + '</p>' +
        (c.scope === 'CORRIDOR' ? '<p class="t-micro">하천 안으로 들어가지 말고 둑에서 보이는 대로 남겨 주세요.</p>' : '') +
        '<div class="choices">' +
        '<button class="choice" data-act="rep-photo"' + (ls.ok || p.pin ? '' : ' disabled') + '>' + ic('camera') + '<span><b>사진과 함께 남기기</b><span>' + (c.r ? '+5P 검토 후 적립' : '포인트 없음') + '</span></span>' + ic('chev') + '</button>' +
        '<button class="choice" data-act="rep-quick"' + (ls.ok || p.pin ? '' : ' disabled') + '>' + ic('tap') + '<span><b>사진 없이 남기기</b><span>포인트 없음</span></span>' + ic('chev') + '</button></div>';
    } else if (p.step === 'loc') {
      const l = U.loc(), c = CAT[p.cat], ok = l && l.precise && l.accuracyM <= P.maxAccuracyM;
      body = '<h2 class="t-title">위치 조정</h2><p class="t-sub">' + (c.scope === 'CORRIDOR' ? '현상이 보이는 쪽으로 핀을 옮겨 주세요.' : '핀을 끌어 현상이 있는 곳에 맞춰 주세요.') + ' 내 위치에서 50m 안에만 놓을 수 있어요.</p>' +
        '<div data-persist="rep-map"></div>' + (Sv.MapKit.fileMode ? '<p class="t-micro">' + U.fileHint + '</p>' : '') +
        (p.pinWarn ? '<p class="result warn">' + ic('warn') + '<span>' + p.pinWarn + '</span></p>' : '');
      foot = '<button class="btn btn-ink grow" data-act="rep-loc-ok"' + (ok ? '' : ' disabled') + '>이 위치로 정하기</button>';
    } else if (p.step === 'sending') {
      body = '<div class="center-block"><span class="spin lg dark"></span><b>보내는 중</b></div>';
    } else if (p.step === 'failed') {
      body = '<div class="center-block"><span class="big-ic err">' + ic('warn') + '</span><b>' + esc(U.errText(p.res)) + '</b>' + (p.res.retryable ? '<p class="t-sub">고른 내용' + (p.photo ? '과 사진' : '') + '은 그대로 있어요.</p>' : '') + '</div>';
      foot = p.res.retryable ? '<button class="btn btn-ink grow" data-act="rep-submit">다시 보내기</button>' : '<button class="btn btn-line grow" data-act="rep-prev">이전 단계로</button>';
    } else if (p.step === 'dup') {
      const t = U.now();
      body = '<h2 class="t-title">근처에 같은 종류의 관찰이 있어요</h2><p class="t-sub">같은 현상이면 기존 관찰에 더해 주세요.</p><div class="rows">' +
        p.dup.map(id => { const is = st.db.issues[id], own = is.creatorUid === 'me'; return '<div class="row static dup">' + ic(U.catIcon(is.categoryCode)) + '<span class="row-main"><b>' + CAT[is.categoryCode].label + (own ? '<em>내 제보</em>' : '') + '</b>' +
          '<span>' + Math.round(Pl.distM(p.pin || [U.loc().lat, U.loc().lng], is.anchor)) + 'm · ' + (is.lastPhotoObservedAt ? '사진 ' + fmt.ago(is.lastPhotoObservedAt) : '사진 없음') + (Pl.todaySignals(is, t) ? ' · 간단 응답 ' + Pl.todaySignals(is, t) + '명' : '') + '</span></span>' +
          '<button class="btn btn-sm btn-ink" data-act="rep-attach" data-id="' + id + '"' + (own ? ' disabled' : '') + '>여기에 더하기</button></div>'; }).join('') + '</div>' +
        '<h3 class="sec-title">다른 현상이에요</h3><div class="reason-chips">' + REASONS.map(r => '<button class="chip" data-act="rep-reason" data-v="' + r + '" aria-pressed="' + (p.reason === r) + '">' + r + '</button>').join('') + '</div>' +
        (simple ? '' : '<label class="field"><span class="t-micro">직접 적기(선택, 공개되지 않아요)</span><textarea maxlength="200" rows="2" data-input="reason">' + esc(REASONS.includes(p.reason) ? '' : p.reason || '') + '</textarea></label>') +
        '<button class="btn btn-line wide" data-act="rep-new"' + ((p.reason || '').trim() ? '' : ' disabled') + '>새 관찰로 남기기</button>';
    } else if (p.step === 'result') {
      const r = p.res, created = r.created, c = CAT[p.cat];
      const canEarn = created && p.modality === 'QUICK' && !r.late && c.r && r.creatorPhotoDeadlineAt;
      const lines = [];
      if (r.late) lines.push('촬영 후 15분이 지나 공개 관찰은 만들지 않았어요.');
      else if (r.existing) lines.push('오늘 이 관찰에 이미 남긴 응답이 있어 새로 기록하지 않았어요.');
      else if (created) lines.push(U.reasonText(r));
      else lines.push('기존 ‘' + c.label + '’ 관찰에 더했어요', U.reasonText(r));
      if (canEarn) lines.push(fmt.time(r.creatorPhotoDeadlineAt) + '까지 내가 먼저 사진을 더하면 사진 제보 포인트 대상이 돼요.');
      body = '<div class="center-block"><span class="big-ic ok">' + ic('check') + '</span><b class="t-h2">' + (r.late ? '나만 보는 기록으로 남겼어요' : r.existing ? '오늘 이미 남긴 응답이에요' : '우이런에 기록했어요') + '</b>' +
        lines.filter(Boolean).filter((l, i, a) => !(r.existing && l === U.reasonText(r))).map(l => '<p class="done-line">' + esc(l) + '</p>').join('') +
        '<p class="t-micro">구청·기관에 자동으로 전달되지 않아요. 기록은 Firebase 계정에 저장돼요.</p></div>';
      foot = (created && p.modality === 'QUICK' && !r.late ? '<button class="btn btn-line" data-act="discovery-photo" data-id="' + r.resultId + '">' + ic('camera') + '사진 더하기</button>' : '') +
        (p.fromRun ? '<button class="btn btn-ink grow" data-act="back">운동으로 돌아가기</button>'
          : (created && !r.late ? '<button class="btn btn-line" data-act="rep-see" data-id="' + r.resultId + '">이 위치 보기</button>' : '') + '<button class="btn btn-ink grow" data-act="back">확인</button>');
    }
    return bar + (p.step === 'result' ? '' : prog) + '<div class="screen-body scroll pad">' + runNote + body + '</div>' + (foot ? '<footer class="screen-foot">' + foot + '</footer>' : '');
  };
  U.after.report = (e, el) => {
    if (!el) return;
    const p = e.p;
    const host = persist(el, 'rep-map', () => { const d = document.createElement('div'); d.className = 'rep-map'; return d; });
    if (!host || !Sv.MapKit.available()) return;
    const l = U.loc();
    if (!p._map) {
      const at = l ? [l.lat, l.lng] : D.PILOT.center;
      p.draftPin = p.pin || at;
      const m = Sv.MapKit.create(host, { center: p.draftPin, zoom: 18 });
      p._map = m;
      if (l) { L.circle(at, { radius: l.accuracyM, color: '#384BF0', weight: 1, opacity: 0.35, fillOpacity: 0.07, interactive: false }).addTo(m); L.marker(at, { icon: Sv.MapKit.icon('<div class="mk-me"></div>', [22, 22]), interactive: false }).addTo(m); L.circle(at, { radius: P.pinMaxM, color: '#222759', weight: 1, dashArray: '4 6', fill: false, interactive: false }).addTo(m); }
      const mk = L.marker(p.draftPin, { draggable: true, autoPan: true, icon: Sv.MapKit.icon('<div class="pin-obs sel"><span>' + ic(U.catIcon(p.cat)) + '</span></div>', [46, 56], [23, 56]) }).addTo(m);
      mk.on('dragend', () => {
        const ll = mk.getLatLng(), here = U.loc(), np = [ll.lat, ll.lng];
        if (here && Pl.distM([here.lat, here.lng], np) > P.pinMaxM) { mk.setLatLng(p.draftPin); p.pinWarn = '내 위치에서 50m 안에만 놓을 수 있어요'; }
        else { p.draftPin = np; p.pinWarn = null; }
        U.render();
      });
    }
    setTimeout(() => p._map && p._map.invalidateSize(), 50);
  };
  function dropMap(p) { if (p._map) { p._map.remove(); p._map = null; } delete keep['rep-map']; }
  U.after['report:leave'] = e => dropMap(e.p);
  A['rep-prev'] = () => { const p = nav.top().p; if (p.step === 'loc') { dropMap(p); p.step = 'method'; } else if (p.step === 'method') { p.step = 'cat'; p.pin = null; } else p.step = 'method'; U.render(); };
  A['rep-all'] = () => { nav.top().p.allCats = true; U.render(); };
  A['rep-cat'] = el => { const p = nav.top().p; p.cat = el.dataset.v; p.step = 'method'; U.render(); };
  A['rep-adjust'] = () => { nav.top().p.step = 'loc'; U.render(); };
  A['rep-refresh'] = () => U.render();
  A['rep-loc-ok'] = () => { const p = nav.top().p; p.pin = p.draftPin; dropMap(p); p.step = 'method'; U.render(); };
  A['rep-quick'] = () => { const e = nav.top(); e.p.modality = 'QUICK'; e.p.photo = null; e.p.ticket = null; e.p.resolution = null; submitReport(e); };
  A['rep-photo'] = () => {
    const e = nav.top();
    U.openCamera({ purpose: 'DISCOVERY', cat: e.p.cat, sessionId: e.p.sessionId, onDone: ({ photo, ticket }) => { e.p.modality = 'PHOTO'; e.p.photo = photo; e.p.ticket = ticket; e.p.resolution = null; submitReport(e); } });
  };
  A['rep-submit'] = () => submitReport(nav.top());
  A['rep-attach'] = el => { const e = nav.top(); e.p.resolution = { action: 'ATTACH_EXISTING', issueId: el.dataset.id }; submitReport(e); };
  A['rep-reason'] = el => { nav.top().p.reason = el.dataset.v; U.render(); };
  A['rep-new'] = () => { const e = nav.top(); if (!(e.p.reason || '').trim()) return; e.p.resolution = { action: 'CREATE_NEW' }; submitReport(e); };
  A['rep-see'] = el => U.showOnMap('issue:' + el.dataset.id);
  document.addEventListener('input', ev => {
    const t = ev.target.closest('[data-input]'); if (!t) return;
    const e = nav.top(); e.p[t.dataset.input] = t.value;
    const b = document.querySelector('[data-act="rep-new"]'); if (b) b.disabled = !t.value.trim();
    document.querySelectorAll('[data-act="rep-reason"]').forEach(c => c.setAttribute('aria-pressed', 'false'));
  });
  async function submitReport(e) {
    const p = e.p, l = U.loc();
    if (p.step === 'sending') return; // 보내는 중에는 다시 보내지 않는다
    // 위치는 제출 시점 위치(PHOTO는 셔터 시점)로 자동 입력. 직접 조정한 경우만 그 핀을 쓴다.
    const base = p.modality === 'PHOTO' && p.ticket && p.ticket.shutterLoc ? p.ticket.shutterLoc : l;
    const pin = p.pin || (base ? [base.lat, base.lng] : null);
    if (p.step !== 'failed' || !p.requestId) p.requestId = U.rid(); // 실패 후 ‘다시 보내기’만 같은 요청 ID
    p.step = 'sending'; U.render();
    const r = await U.api('createIssue', { categoryCode: p.cat, loc: l, pin, modality: p.modality, ticket: p.ticket, photo: p.photo, resolution: p.resolution, reason: p.reason, sessionId: p.sessionId, requestId: p.requestId }, { upload: p.modality === 'PHOTO' });
    p.res = r;
    if (!r.ok && r.errorCode === 'DUPLICATE_CANDIDATES') { p.step = 'dup'; p.dup = r.details.candidates; }
    else p.step = r.ok ? 'result' : 'failed';
    U.render();
  }

  // ---------- 포인트 내역 ----------
  U.screens.ledger = () => {
    const st = S(), t = U.now(), b = Pl.budget(st.db, 'me', t), tab = st.ledgerTab;
    const rows = st.db.ledger.filter(x => x.uid === 'me' && (tab === 'all' || (tab === 'pending' && x.status === 'PENDING') || (tab === 'confirmed' && x.status === 'CONFIRMED') || (tab === 'gone' && /EXPIRED|REJECTED|REVERSED/.test(x.status))));
    const stTxt = { PENDING: '검토 중', CONFIRMED: '적립', EXPIRED: '만료', REJECTED: '취소', REVERSED: '회수' };
    return U.appbar('포인트') + '<div class="screen-body scroll pad">' +
      '<div class="stat-line"><div><b class="num stat-big">' + Pl.balance(st.db, 'me') + '<i>P</i></b><span>적립 포인트</span></div><div><b class="num pend">' + Pl.pendingSum(st.db, 'me') + '<i>P</i></b><span>검토 중</span></div></div>' +
      '<p class="t-micro">포인트로 바꿀 수 있는 상품은 아직 준비 중이에요. 새 제보 사진 포인트는 7일 안에 운영자 검토나 다른 계정 사진이 더해지면 적립돼요.</p>' +
      '<dl class="facts">' + U.fact('오늘 남은 적립 한도', (P.baseDailyCap - b.base) + 'P / 30P') + U.fact('간단 응답 한도', (P.quickDailyCap - b.quick) + 'P / 5P') + '</dl>' +
      '<div class="tabs small" role="tablist">' + [['all', '전체'], ['pending', '검토 중'], ['confirmed', '적립'], ['gone', '만료·취소']].map(([k, l]) => '<button role="tab" aria-selected="' + (tab === k) + '" data-act="ledger-tab" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<div class="rows">' + (rows.length ? rows.map(x => '<div class="row static"><span class="row-main"><b>' + esc(x.label) + '</b><span>' + fmt.dt(x.createdAt) + ' · ' + stTxt[x.status] + (x.status === 'PENDING' ? ' · ' + fmt.dt(x.expiresAt) + '까지' : '') + '</span></span><span class="pts ' + ({ PENDING: 'pending', CONFIRMED: 'on' }[x.status] || 'gone') + '">' + (x.status === 'EXPIRED' ? '' : '+') + x.amount + 'P</span></div>').join('')
        : '<p class="empty">내역이 없어요</p>') + '</div></div>';
  };
  A['ledger-tab'] = el => { S().ledgerTab = el.dataset.v; U.render(); };

  // ---------- 웰컴 혜택 ----------
  U.screens.welcome = () => {
    const st = S(), u = st.db.users.me, n = Pl.welcomeCount(st.db, 'me'), cat = st.db.catalog.WELCOME_500;
    const steps = ['사진 기여 3회', '운영자 확인', '혜택 받기', '점포에서 사용'];
    const order = ['LOCKED', 'PENDING_ADMIN', 'APPROVED', 'ISSUED'], cur = u.welcomeStatus === 'SOLD_OUT' ? 2 : order.indexOf(u.welcomeStatus);
    const contribs = Object.values(st.db.contributions).filter(c => c.uid === 'me' && c.source !== 'ROUTINE');
    const routineDays = Object.keys(st.db.routineWelcomeDays).filter(k => k.startsWith('me|')).map(k => k.split('|')[1]);
    const coupons = U.usableCoupons();
    let cta;
    if (u.welcomeStatus === 'LOCKED') cta = '<button class="btn btn-ink grow" disabled>사진 기여 ' + (P.welcomeTarget - Math.min(n, 3)) + '회 더 필요해요</button>';
    else if (u.welcomeStatus === 'PENDING_ADMIN') cta = '<button class="btn btn-ink grow" disabled>운영자 확인 중</button>';
    else if (u.welcomeStatus === 'APPROVED') cta = '<button class="btn btn-ink grow" data-act="welcome-claim">혜택 받기</button>';
    else if (u.welcomeStatus === 'SOLD_OUT') cta = '<button class="btn btn-ink grow" data-act="welcome-claim">수량 다시 확인</button>';
    else cta = '<button class="btn btn-ink grow" data-act="screen" data-v="coupon" data-id="' + (st.db.coupons.find(c => c.uid === 'me') || {}).id + '">받은 혜택 보기</button>';
    return U.appbar('웰컴 혜택') + '<div class="screen-body scroll pad">' +
      '<div class="welcome-hero"><span class="num wh-n">' + Math.min(n, 3) + '<i>/3</i></span><p>' + U.welcomeStatusText(u.welcomeStatus, Math.min(n, 3)) + '</p></div>' +
      '<ol class="timeline">' + steps.map((l, i) => '<li class="' + (i < cur ? 'done' : i === cur ? 'on' : '') + '">' + l + '</li>').join('') + '</ol>' +
      (coupons.length ? '<h2 class="sec-title">지금 사용할 수 있어요</h2><div class="rows">' + coupons.map(c => '<button class="row" data-act="screen" data-v="coupon" data-id="' + c.id + '"><span class="row-main"><b>' + cat.title + '</b><span>' + U.couponStateText(Pl.couponView(c, U.now())) + ' · 예시 혜택</span></span>' + ic('chev') + '</button>').join('') + '</div>' : '') +
      (u.welcomeStatus === 'ISSUED' ? '' : '<h2 class="sec-title">받을 혜택</h2><div class="rows"><div class="row static"><span class="row-main"><b>' + cat.title + '</b><span>' + cat.condition + ' · 받은 날부터 ' + cat.validDays + '일</span></span></div></div>' +
        '<p class="t-micro">제휴 전 예시 혜택이라 실제 점포에서는 쓸 수 없어요.</p>') +
      '<h2 class="sec-title">인정되는 기여</h2><ul class="plain"><li>다른 사람 관찰에 처음 남긴 사진 · 관찰마다 1회</li><li>새 제보 사진 · 7일 안에 검토되면 1회</li><li>정기 관찰 사진 · 하루 1회</li><li class="muted">간단 응답는 포함되지 않아요</li></ul>' +
      '<h2 class="sec-title">내 기여</h2>' + (contribs.length + routineDays.length ? '<div class="rows">' + contribs.map(c => '<div class="row static">' + ic('camera') + '<span class="row-main"><b>' + (c.source === 'NEWISSUE' ? '새 제보 확인' : '사진 참여') + '</b><span>' + esc(c.key.startsWith('RECHECK|') || c.key.startsWith('NEWISSUE|') ? CAT[st.db.issues[c.key.split('|')[1]].categoryCode].label : '') + ' · ' + fmt.date(c.acceptedAt) + '</span></span></div>').join('') +
        routineDays.map(d => '<div class="row static">' + ic('repeat') + '<span class="row-main"><b>정기 관찰</b><span>' + fmt.date(Date.parse(d + 'T12:00:00+09:00')) + '</span></span></div>').join('') + '</div>' : '<p class="empty">아직 인정된 기여가 없어요</p>') +
      '</div><footer class="screen-foot">' + cta + '</footer>';
  };
  A['welcome-claim'] = async el => {
    el.disabled = true;
    const r = await U.api('claimWelcome', {});
    if (!r.ok) { U.toast(U.errText(r), 'err'); U.render(); return; }
    U.toast('웰컴 혜택을 받았어요', 'ok');
    nav.replace('screen', 'coupon', { id: r.couponId });
  };

  // ---------- 쿠폰 사용 ----------
  U.screens.coupon = e => {
    const st = S(), cp = st.db.coupons.find(c => c.id === e.p.id), t = U.now(), cat = st.db.catalog.WELCOME_500, m = st.db.merchants[cp.merchantId];
    const view = Pl.couponView(cp, t);
    const ticket = '<div class="coupon ' + view.toLowerCase() + '"><div class="cp-top"><span class="cp-demo">예시 혜택 · 실제 점포 사용 불가</span><span class="cp-amt num">500<i>원</i></span><b>웰컴 할인</b><span>' + cat.condition + '</span></div>' +
      '<div class="cp-bot"><span>' + esc(m.name) + '</span><span>' + fmt.date(cp.expiresAt) + '까지</span></div></div>';
    let body = '', foot = '';
    if (view === 'USED') {
      body = '<div class="center-block"><b class="t-h2">사용 완료</b><dl class="facts">' + U.fact('사용 시각', fmt.dt(cp.usedAt)) + U.fact('점포', esc(m.name)) + '</dl><p class="t-micro">PIN 확인 기록이에요. 실제 결제 여부는 앱이 확인하지 않고, 기록은 Firebase 계정에 저장돼요.</p></div>';
    } else if (view === 'EXPIRED' || view === 'REVOKED') {
      body = '<p class="notice">' + ic('clock') + (view === 'EXPIRED' ? '사용 기간이 지나 쓸 수 없어요.' : '철회된 혜택이라 쓸 수 없어요.') + '</p>';
    } else if (view === 'USE_REQUESTED') {
      const locked = cp.lockedUntil && t < cp.lockedUntil;
      body = '<div class="use-window"><span class="t-micro">남은 사용 시간</span><b class="num" data-countdown="' + cp.window.endsAt + '">' + fmt.dur(cp.window.endsAt - t) + '</b><span class="t-micro">다시 열어도 시간이 늘어나지 않아요</span></div>' +
        '<p class="t-body center">점포 직원에게 이 화면을 보여주세요. 직원이 PIN 6자리를 입력해요.</p>' +
        '<div class="pin-dots" aria-label="입력한 PIN ' + (e.p.pin || '').length + '자리">' + [0, 1, 2, 3, 4, 5].map(i => '<i class="' + (i < (e.p.pin || '').length ? 'on' : '') + '"></i>').join('') + '</div>' +
        (e.p.err ? '<p class="result err">' + ic('warn') + '<span>' + esc(e.p.err) + '</span></p>' : '') +
        (locked ? '<p class="result warn">' + ic('lock') + '<span>' + U.errText({ errorCode: 'COUPON_LOCKED', details: { until: cp.lockedUntil } }) + '</span></p>' :
          '<div class="keypad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map(k => k ? '<button data-act="pin-key" data-v="' + k + '"' + (e.p.busy ? ' disabled' : '') + ' aria-label="' + (k === '⌫' ? '지우기' : k) + '">' + k + '</button>' : '<span></span>').join('') + '</div>');
    } else {
      body = '<p class="t-sub">사용하기를 누르면 10분 동안 쓸 수 있어요. 점포 직원과 함께 눌러 주세요.</p>' + (cp.lockedUntil && t < cp.lockedUntil ? '<p class="result warn">' + ic('lock') + '<span>' + U.errText({ errorCode: 'COUPON_LOCKED', details: { until: cp.lockedUntil } }) + '</span></p>' : '');
      foot = '<button class="btn btn-ink grow" data-act="coupon-use">사용하기</button>';
    }
    return U.appbar('혜택') + '<div class="screen-body scroll pad">' + ticket + body + '</div>' + (foot ? '<footer class="screen-foot">' + foot + '</footer>' : '');
  };
  A['coupon-use'] = async el => {
    const e = nav.top(); el.disabled = true;
    const r = await U.api('requestCouponUse', { couponId: e.p.id });
    if (!r.ok) U.toast(U.errText(r), 'err');
    e.p.pin = ''; e.p.err = null; e.p.useSessionId = r.ok ? r.useSessionId : null; U.render();
  };
  A['pin-key'] = async el => {
    const e = nav.top(), k = el.dataset.v; e.p.pin = e.p.pin || '';
    if (k === '⌫') e.p.pin = e.p.pin.slice(0, -1); else if (e.p.pin.length < 6) e.p.pin += k;
    e.p.err = null; U.render();
    if (e.p.pin.length < 6) return;
    e.p.busy = true; U.render();
    const cp = S().db.coupons.find(c => c.id === e.p.id);
    const r = await U.api('confirmCouponUse', { couponId: e.p.id, useSessionId: e.p.useSessionId || (cp.window && cp.window.useSessionId), pin: e.p.pin });
    e.p.busy = false; e.p.pin = '';
    if (r.ok) U.toast('사용 완료로 기록했어요', 'ok'); else e.p.err = U.errText(r);
    U.render();
  };

  // ---------- 잠금화면 알림 체험 ----------
  U.screens.lock = e => {
    const st = S(), s = st.session, ex = s && s.alertId && st.db.exposures[s.alertId], t = U.now();
    let card;
    if (!ex) card = '<div class="lock-note">아직 받은 관찰 요청이 없어요.</div>';
    else {
      const name = ex.kind === 'ISSUE' ? CAT[st.db.issues[ex.targetId].categoryCode].label : '정기 관찰';
      const expired = t >= ex.expiresAt;
      card = '<div class="lock-card"><div class="lc-head"><span class="lc-app"><img src="' + U.LOGO.icon + '" alt=""></span>우이런 · ' + fmt.time(ex.issuedAt) + '</div>' +
        '<b>근처에 ' + esc(name) + ' 관찰 요청이 있어요</b><p>' + (ex.kind === 'ISSUE' ? '지금도 보이면 눌러 주세요. 무시해도 운동 기록은 계속돼요.' : '이상이 없어도 지금 모습을 남길 수 있어요.') + '</p>' +
        (e.p.state ? '<p class="lc-state">' + esc(e.p.state) + '</p>' : '') +
        (expired ? '<p class="lc-state">참여 시간이 지나 버튼이 사라졌어요</p>' : '<div class="lc-actions">' + (ex.kind === 'ISSUE' && !ex.quickObsId && !U.quickToday(ex.targetId) ? '<button data-act="lock-quick">지금도 보여요</button>' : '') + '<button data-act="lock-photo">사진으로 남기기</button></div>') + '</div>';
    }
    return '<div class="lock"><span class="tag-demo light">Android 잠금화면 체험 · 웹 시뮬레이션</span><b id="lock-clock" class="num lock-clock">' + fmt.time(t) + '</b><span class="lock-date">' + fmt.date(t) + '</span>' + card +
      '<button class="btn btn-ghost-light lock-exit" data-act="back">잠금 해제하고 앱으로</button></div>';
  };
  A['lock-quick'] = async () => {
    const e = nav.top(), st = S(), s = st.session;
    if (!s || (s.status !== 'ACTIVE' && s.status !== 'PAUSED')) { e.p.state = '앱에서 확인이 필요해요 · 탭해서 열기'; return U.render(); }
    const ex0 = st.db.exposures[s.alertId];
    e.p.state = '보내는 중…'; U.render();
    const r = await U.api('submitQuick', { issueId: ex0.targetId, loc: U.loc(), exposureId: ex0.id, sessionId: ex0.sessionId });
    e.p.state = r.ok ? (r.existing ? '오늘 이미 남긴 응답이에요' : '남겼어요 · ' + U.reasonText(r)) : r.errorCode === 'NETWORK' ? '앱에서 확인 필요 · 연결이 끊겨 저장되지 않았어요' : U.errText(r);
    if (r.ok) S().db.exposures[s.alertId].msg = '남겼어요 · ' + U.reasonText(r);
    U.render();
  };
  A['lock-photo'] = () => { const st = S(), ex = st.db.exposures[st.session.alertId]; U.toast('잠금을 해제하면 카메라가 열려요'); nav.back(() => U.openCamera({ purpose: ex.kind === 'ISSUE' ? 'RECHECK' : 'ROUTINE', targetId: ex.targetId, exposureId: ex.id, sessionId: ex.sessionId, fromRun: true })); };
})();
