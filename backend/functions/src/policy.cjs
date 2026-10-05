// Source: user supplied autumn prototype, policy layer. Server adapter validates trusted boundaries.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Policy = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN = 60e3, H = 60 * MIN, DAY = 24 * H;

  // §18.2 전역 기본값 (appConfig / rewardPolicy)
  const P = {
    alertRadiusM: 100, validationRadiusM: 40, maxAccuracyM: 30, maxFixAgeSec: 10, pinMaxM: 50, dedupeM: 30,
    maxAlertsPerSession: 3, alertCooldownMin: 5, peerMinDelayMin: 15, exposureWindowMin: 30,
    persistentNotifyCooldownH: 24, momentaryNotifyCooldownMin: 30, notifyDelayMin: 15,
    photoRepeatMinH: 6, routineRoundH: 6, routineGraceMin: 15,
    quickPoint: 1, photoPoint: 5, baseDailyCap: 30, quickDailyCap: 5, routineSlotsPerDay: 3, verifyWeeklyCap: 40,
    maxSessionH: 6, abandonSessionH: 12, lateRunRecoveryDays: 7,
    captureTicketMin: 15, lateMaxMin: 60, creatorPhotoQualMin: 60, pendingDays: 7,
    couponUseMin: 10, couponFailures: 5, couponLockMin: 10, merchantDailyFailures: 10,
    welcomeTarget: 3, newIssuesPerDay: 10, reasonMaxLen: 200,
  };

  // §11.1 검증 보너스 목표
  const TIER = { 0: { ADMIN: 0, PEER: 0 }, 1: { ADMIN: 3, PEER: 5 }, 2: { ADMIN: 6, PEER: 10 }, 3: { ADMIN: 12, PEER: 20 } };

  // §18.1 카테고리 Seed. q=QUICK 신규/재관찰, r=사진 보상·Welcome, v=PEER, qr=QUICK 보상
  const C = (label, group, scope, type, tier, extra) => Object.assign(
    { label, group, scope, type, tier, q: true, r: true, v: true, qr: true,
      staleH: type === 'M' ? 6 : 72, windowMin: type === 'M' ? 180 : null }, extra);
  const CAT = {
    LITTER: C('쓰레기', 'path', 'PATH', 'P', 1),
    BULKY_WASTE: C('대형 폐기물', 'path', 'PATH', 'P', 1),
    DUMPING_SUSPECT: C('무단투기 의심', 'path', 'PATH', 'P', 1),
    BRANCH: C('쓰러진 나뭇가지', 'path', 'PATH', 'P', 1),
    SEDIMENT: C('흙·퇴적물', 'path', 'PATH', 'P', 1),
    OBSTRUCTION: C('통행 방해물', 'path', 'PATH', 'P', 1),
    FLOOD_TRACE: C('침수 흔적', 'path', 'PATH', 'P', 1),
    VEGETATION_DAMAGE: C('식생 훼손', 'path', 'PATH', 'P', 2),
    RIVER_WASTE: C('하천 안 쓰레기', 'water', 'CORRIDOR', 'P', 2),
    FOAM: C('거품', 'water', 'CORRIDOR', 'M', 3),
    WATER_COLOR: C('물 색 변화', 'water', 'CORRIDOR', 'M', 3),
    TURBID: C('탁한 물', 'water', 'CORRIDOR', 'M', 3),
    OIL_LIKE: C('기름띠처럼 보임', 'water', 'CORRIDOR', 'M', 3),
    FLOATING_MATERIAL: C('떠다니는 물질', 'water', 'CORRIDOR', 'M', 2),
    LOW_FLOW: C('물 흐름 약함', 'water', 'CORRIDOR', 'P', 3),
    DRY_BED: C('하천 바닥 드러남', 'water', 'CORRIDOR', 'P', 3),
    ALGAE_LIKE: C('녹조처럼 보임', 'water', 'CORRIDOR', 'P', 3),
    DEAD_FISH: C('죽은 물고기', 'water', 'CORRIDOR', 'M', 3),
    BIO_ANOMALY: C('생물 이상', 'water', 'CORRIDOR', 'M', 3),
    PAVEMENT: C('바닥 파손', 'facility', 'PATH', 'P', 2),
    RAIL: C('난간 파손', 'facility', 'PATH', 'P', 2),
    SIGN: C('안내판 파손', 'facility', 'PATH', 'P', 2),
    BENCH: C('벤치 파손', 'facility', 'PATH', 'P', 2),
    LIGHT: C('조명 고장', 'facility', 'PATH', 'P', 2),
    FITNESS: C('운동기구 고장', 'facility', 'PATH', 'P', 2),
    STEPPING_STONE: C('징검다리 이상', 'facility', 'CORRIDOR', 'P', 2),
    ODOR_NOW: C('지금 나는 냄새', 'odor', 'CORRIDOR', 'M', 0, { r: false, v: false, qr: false }),
    ODOR_REPEAT: C('반복되는 냄새', 'odor', 'CORRIDOR', 'M', 0, { r: false, v: false, qr: false }),
  };

  // ---------- 시간 (§3: 저장은 UTC, 일·주 한도는 KST) ----------
  const kstDay = t => new Date(t + 9 * H).toISOString().slice(0, 10);
  function kstWeek(t) { // ISO week year + week number (KST 날짜 기준)
    const k = new Date(t + 9 * H);
    const d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // 그 주의 목요일
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const w = 1 + Math.round(((d - jan4) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return d.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
  }
  function roundOf(t, hours) {
    const len = (hours || P.routineRoundH) * H;
    const start = Math.floor((t + 9 * H) / len) * len - 9 * H;
    return { id: kstDay(start) + 'T' + String(new Date(start + 9 * H).getUTCHours()).padStart(2, '0'), start, end: start + len };
  }

  function distM(a, b) {
    const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(s));
  }
  const nearestM = (loc, anchors) => Math.min(...anchors.map(a => distM([loc.lat, loc.lng], a)));

  // ---------- 저장소 (서버 컬렉션의 메모리 대역) ----------
  function emptyDb() {
    return {
      seq: 0, issues: {}, obs: {}, ledger: [], entitlements: {}, budgets: {}, bonusWeeks: {}, quickMarkers: {}, photoGuards: {},
      routineKeys: {}, routineSlots: {}, routineWelcomeDays: {}, contributions: {}, exposures: {}, routines: {}, coupons: [], users: {},
      catalog: { WELCOME_500: { stock: 30, title: '500원 할인', condition: '5,000원 이상 구매 시', validDays: 30, isDemo: true } },
      merchants: { m_demo: { name: '예시 점포 (테스트)', pin: '246810', isDemo: true } }, merchantFails: {}, merchantUses: {},
    };
  }
  function ensureUser(db, uid) { // §19.4 기본값: displayName 빈 문자열, 반복 알림 false
    return db.users[uid] || (db.users[uid] = { displayName: '', uiMode: 'DEFAULT', repeatObservationNotifications: false, welcomeStatus: 'LOCKED', welcomeApprovalAt: null, lastAlertAt: 0 });
  }

  // ---------- 공통 ----------
  const fail =(errorCode, details) => ({ ok: false, errorCode, details: details || {}, pointsAwarded: 0 });
  const nextId = (db, p) => p + (++db.seq);

  function budget(db, uid, t) {
    const k = uid + '|' + kstDay(t);
    return db.budgets[k] || (db.budgets[k] = { base: 0, quick: 0 });
  }
  function addLedger(db, e) {
    e.id = nextId(db, 'tx');
    e.dayKey = e.dayKey || kstDay(e.createdAt);
    db.ledger.unshift(e);
    return e;
  }
  const balance = (db, uid) => db.ledger.filter(x => x.uid === uid && x.status === 'CONFIRMED').reduce((s, x) => s + x.amount, 0);
  const pendingSum = (db, uid) => db.ledger.filter(x => x.uid === uid && x.status === 'PENDING').reduce((s, x) => s + x.amount, 0);

  function addObs(db, o) {
    o.id = o.id || nextId(db, 'obs');
    db.obs[o.id] = o;
    return o;
  }

  // §5 위치 판정의 UX용 요약. 둑 모호성(AMBIGUOUS_LOCATION)·구간별 정확도 한도는 Seed geometry가 필요해 생략.
  // ponytail: 반경·정확도·age만 검사. 실제 판정은 서버 ScopeValidator(PATH/CORRIDOR, dTarget/dOpp)가 한다.
  function checkLocation(loc, anchors, t, radius) {
    if (!loc || !loc.precise) return { code: 'PRECISE_LOCATION_REQUIRED' };
    if (loc.accuracyM > P.maxAccuracyM) return { code: 'GPS_ACCURACY_TOO_LOW', accuracyM: loc.accuracyM };
    if (t - loc.measuredAt > P.maxFixAgeSec * 1000) return { code: 'LOCATION_STALE' };
    const d = nearestM(loc, anchors);
    if (d > (radius || P.validationRadiusM)) return { code: 'TOO_FAR', distanceM: Math.round(d) };
    return { code: null, distanceM: Math.round(d) };
  }

  // §15.2 Fresh / Late / Too old. ticket은 상세 진입 시 선발급(15분).
  function checkTicket(ticket, t) {
    if (!ticket || !ticket.shutterAt) return { code: 'PHOTO_REQUIRED' };
    if (ticket.consumed) return { code: 'PHOTO_ALREADY_CONSUMED' };
    if (ticket.shutterAt >= ticket.issuedAt + P.captureTicketMin * MIN) return { code: 'CAPTURE_TICKET_EXPIRED' };
    const age = t - ticket.issuedAt;
    if (age > P.lateMaxMin * MIN) return { code: 'PHOTO_TOO_OLD' };
    return { code: null, late: age >= P.captureTicketMin * MIN };
  }

  function issueClosed(is, t) {
    if (is.visibility !== 'PUBLIC' || is.lifecycleStatus !== 'OPEN') return 'MISSION_NOT_ACTIVE';
    if (is.eventEndsAt && t >= is.eventEndsAt) return 'ISSUE_WINDOW_CLOSED';
    return null;
  }
  const todaySignals = (is, t) => (is.signalDayKey === kstDay(t) ? is.todaySignalAccountCount : 0);
  const photoStale = (is, t) => !!is.lastPhotoObservedAt && t - is.lastPhotoObservedAt > CAT[is.categoryCode].staleH * H;

  // §8.3·§15.2: 알림(Exposure)을 통해 참여하면 참여권 만료도 함께 검사한다. 지도 직접 참여는 exposureId 없이 제출.
  function exposureExpired(db, exposureId, t) {
    const ex = exposureId && db.exposures[exposureId];
    return !!(ex && t >= ex.expiresAt);
  }
  function linkExposure(db, exposureId, kind, obsId) {
    const ex = exposureId && db.exposures[exposureId];
    if (ex && !ex[kind + 'ObsId']) ex[kind + 'ObsId'] = obsId;
  }

  // ---------- Welcome (§12.1) ----------
  function welcomeCount(db, uid) {
    const keys = Object.values(db.contributions).filter(c => c.uid === uid && c.status === 'VALID' && c.source !== 'ROUTINE').length;
    const days = Object.keys(db.routineWelcomeDays).filter(k => k.startsWith(uid + '|')).length;
    return keys + days;
  }
  function refreshWelcome(db, uid) {
    const u = db.users[uid];
    if (u.welcomeStatus === 'LOCKED' && welcomeCount(db, uid) >= P.welcomeTarget) u.welcomeStatus = 'PENDING_ADMIN';
  }
  function addContribution(db, uid, key, source, t, obsId) {
    if (db.contributions[key]) return false;
    db.contributions[key] = { uid, key, source, acceptedAt: t, dayKey: kstDay(t), obsId, status: 'VALID' };
    refreshWelcome(db, uid);
    return true;
  }

  // ---------- §21.2 간단 재관찰 (QUICK) ----------
  function submitQuick(db, { uid, issueId, loc, exposureId }, t) {
    const is = db.issues[issueId], c = CAT[is.categoryCode];
    const closed = issueClosed(is, t);
    if (closed) return fail(closed, { endedAt: is.eventEndsAt });
    if (is.creatorUid === uid) return fail('OWN_ISSUE_RECHECK');
    if (!c.q) return fail('INVALID_ARGUMENT');
    if (exposureExpired(db, exposureId, t)) return fail('EXPOSURE_EXPIRED');
    const l = checkLocation(loc, is.observationAnchors, t);
    if (l.code) return fail(l.code, l);

    const day = kstDay(t), mk = uid + '|' + issueId + '|' + day;
    if (db.quickMarkers[mk]) { // Q02: 같은 KST일은 기존 결과
      const prev = db.obs[db.quickMarkers[mk]];
      linkExposure(db, exposureId, 'quick', prev.id);
      return { ok: true, saved: false, existing: true, resultId: prev.id, pointsAwarded: 0, rewardReason: 'ALREADY_TODAY' };
    }
    const o = addObs(db, { uid, issueId, role: 'RECHECK', modality: 'QUICK', observedAt: t, dayKey: day, exposureId: exposureId || null, entry: exposureId ? 'NOTIFICATION' : 'MAP' });
    db.quickMarkers[mk] = o.id;
    is.lastSignalAt = t; is.signalCount++;
    if (is.signalDayKey !== day) { is.signalDayKey = day; is.todaySignalAccountCount = 0; }
    is.todaySignalAccountCount++;

    let pts = 0, reason;
    const ek = 'QUICK_RECHECK|' + uid + '|' + issueId;
    if (!c.qr) reason = 'CATEGORY_NOT_REWARDED';
    else if (!(is.availablePhotoCount > 0)) reason = 'NO_PHOTO_BASIS'; // Q06: entitlement 미소비
    else if (db.entitlements[ek]) reason = 'ALREADY_CONSUMED';
    else {
      const b = budget(db, uid, t);
      if (b.quick + P.quickPoint > P.quickDailyCap) reason = 'SUBCAP';
      else if (b.base + P.quickPoint > P.baseDailyCap) reason = 'DAILY_CAP';
      else {
        pts = P.quickPoint; b.quick += pts; b.base += pts; reason = 'PAID';
        addLedger(db, { uid, amount: pts, status: 'CONFIRMED', type: 'QUICK_RECHECK', label: c.label + ' 간단 응답', sourceId: o.id, createdAt: t });
      }
      db.entitlements[ek] = { outcome: pts ? 'PAID' : 'CAP', at: t };
    }
    o.points = pts; o.rewardReason = reason;
    linkExposure(db, exposureId, 'quick', o.id);
    return { ok: true, saved: true, resultId: o.id, pointsAwarded: pts, pointsPending: 0, rewardReason: reason, welcomeCounted: false };
  }

  // ---------- 검증 보너스와 최초 제보자 보상 (§11.1, §11.4) ----------
  function settleCreator(db, is, level, t) {
    const c = CAT[is.categoryCode];
    if (is.creatorCreditStatus !== 'ELIGIBLE' || !is.rewardQualificationEndsAt || t >= is.rewardQualificationEndsAt) return;
    const uid = is.creatorUid;
    const base = db.ledger.find(x => x.type === 'PHOTO_NEW' && x.issueId === is.id && x.status === 'PENDING');
    if (base) { base.status = 'CONFIRMED'; base.confirmedAt = t; }
    const target = (TIER[c.tier] || TIER[0])[level] || 0;
    const diff = target - (is.bonusResolvedP || 0);
    if (diff > 0) {
      const wk = uid + '|' + kstWeek(t);
      const used = db.bonusWeeks[wk] || 0;
      const paid = Math.max(0, Math.min(diff, P.verifyWeeklyCap - used));
      db.bonusWeeks[wk] = used + paid;
      is.bonusResolvedP = target;
      is.bonusForfeitedP = (is.bonusForfeitedP || 0) + (diff - paid);
      if (paid) addLedger(db, { uid, amount: paid, status: 'CONFIRMED', type: 'VERIFY_BONUS', label: c.label + ' 확인 보너스(' + (level === 'PEER' ? '다른 계정 사진' : '운영자 검토') + ')', issueId: is.id, createdAt: t });
    }
    if (c.r) addContribution(db, uid, 'NEWISSUE|' + is.id, 'NEWISSUE', t, is.creatorPhotoObsId);
  }

  function setVerification(db, is, level, t) {
    const rank = { NONE: 0, ADMIN: 1, PEER: 2 };
    if (rank[level] > rank[is.verificationLevel]) { is.verificationLevel = level; is.lastVerifiedAt = t; }
    settleCreator(db, is, level, t);
  }

  // §11.1 PEER: 최초 제보자 정상 사진 + 15분 이후·접수 순서가 뒤인 다른 계정 정상 사진
  function evaluatePeer(db, is, o, t) {
    const c = CAT[is.categoryCode];
    if (!c.v || !is.creatorPhotoAt || o.uid === is.creatorUid) return;
    if (o.observedAt < is.createdAt + P.peerMinDelayMin * MIN || o.observedAt < is.creatorPhotoAt) return;
    setVerification(db, is, 'PEER', t);
  }

  // ---------- §21.3 사진 재관찰 ----------
  function submitPhotoRecheck(db, { uid, issueId, loc, ticket, photo, exposureId }, t) {
    const is = db.issues[issueId], c = CAT[is.categoryCode];
    const closed = issueClosed(is, t);
    if (closed) return fail(closed, { endedAt: is.eventEndsAt });
    if (is.creatorUid === uid) return fail('OWN_ISSUE_RECHECK');
    if (exposureExpired(db, exposureId, t)) return fail('EXPOSURE_EXPIRED');
    const tk = checkTicket(ticket, t);
    if (tk.code) return fail(tk.code);
    const l = checkLocation(ticket.shutterLoc, is.observationAnchors, ticket.shutterAt); // PHOTO는 셔터 시점 위치·fixAge
    if (l.code) return fail(l.code, l);
    const gk = uid + '|' + issueId, last = db.photoGuards[gk];
    if (last && t - last < P.photoRepeatMinH * H) return fail('OBSERVATION_TOO_SOON', { retryAfterAt: last + P.photoRepeatMinH * H });
    ticket.consumed = true;

    const base = { uid, issueId, role: 'RECHECK', modality: 'PHOTO', observedAt: ticket.shutterAt, acceptedAt: t, dayKey: kstDay(t), photo, exposureId: exposureId || null, entry: exposureId ? 'NOTIFICATION' : 'MAP' };
    if (tk.late) { // §15.2 LATE: 본인 감사 기록만
      const o = addObs(db, Object.assign(base, { late: true, points: 0, rewardReason: 'LATE_PHOTO', visibility: 'PRIVATE' }));
      return { ok: true, saved: true, late: true, resultId: o.id, pointsAwarded: 0, rewardReason: 'LATE_PHOTO' };
    }
    const o = addObs(db, base);
    db.photoGuards[gk] = t;
    is.photoObservationCount++; is.availablePhotoCount++; is.lastPhotoObservedAt = Math.max(is.lastPhotoObservedAt || 0, o.observedAt);
    if (!is.photoAccounts.includes(uid)) is.photoAccounts.push(uid);
    if (!is.firstOtherPhotoAcceptedAt) {
      is.firstOtherPhotoAcceptedAt = t;
      if (is.creatorCreditStatus === 'OPEN') is.creatorCreditStatus = 'INELIGIBLE';
    }

    let pts = 0, reason, welcome = false;
    const ek = 'PHOTO_RECHECK|' + uid + '|' + issueId;
    if (!c.r) reason = 'CATEGORY_NOT_REWARDED';
    else if (db.entitlements[ek]) reason = 'ALREADY_CONSUMED'; // P05
    else {
      const b = budget(db, uid, t);
      if (b.base + P.photoPoint > P.baseDailyCap) reason = 'DAILY_CAP'; // P06: 분할 지급 없음
      else {
        pts = P.photoPoint; b.base += pts; reason = 'PAID';
        addLedger(db, { uid, amount: pts, status: 'CONFIRMED', type: 'PHOTO_RECHECK', label: c.label + ' 사진', sourceId: o.id, createdAt: t });
      }
      db.entitlements[ek] = { outcome: pts ? 'PAID' : 'CAP', at: t };
      welcome = addContribution(db, uid, 'RECHECK|' + issueId, 'RECHECK', t, o.id);
    }
    o.points = pts; o.rewardReason = reason; o.welcomeCounted = welcome;

    evaluatePeer(db, is, o, t);
    is.notifyFrom = c.type === 'M' ? Math.min(t + P.momentaryNotifyCooldownMin * MIN, is.eventEndsAt) : t + P.persistentNotifyCooldownH * H;
    linkExposure(db, exposureId, 'photo', o.id);
    return { ok: true, saved: true, resultId: o.id, pointsAwarded: pts, pointsPending: 0, rewardReason: reason, welcomeCounted: welcome, verificationLevel: is.verificationLevel };
  }

  // ---------- §7.2 중복 후보 ----------
  function findDuplicates(db, categoryCode, pin, t, scopeMatch) {
    return Object.values(db.issues).filter(is => is.categoryCode === categoryCode && is.visibility === 'PUBLIC' &&
      (!scopeMatch || (CAT[categoryCode].scope === 'PATH' ? is.pathSegmentId === scopeMatch.id : is.corridorSegmentId === scopeMatch.corridorId)) && is.lifecycleStatus === 'OPEN' && !(is.eventEndsAt && t >= is.eventEndsAt) && distM(is.anchor, pin) <= P.dedupeM);
  }

  // ---------- §21.1 신규 제보 ----------
  function createIssue(db, { uid, categoryCode, loc, pin, modality, ticket, photo, resolution, reason, scopeMatch }, t) {
    const c = CAT[categoryCode];
    if (!c) return fail('INVALID_ARGUMENT');
    let tk = null;
    if (modality === 'PHOTO') {
      tk = checkTicket(ticket, t);
      if (tk.code) return fail(tk.code);
      loc = ticket.shutterLoc || loc; // PHOTO는 셔터 시점 위치로 검사
    }
    if (!loc || !loc.precise) return fail('PRECISE_LOCATION_REQUIRED');
    if (loc.accuracyM > P.maxAccuracyM) return fail('GPS_ACCURACY_TOO_LOW', { accuracyM: loc.accuracyM });
    if ((tk ? ticket.shutterAt : t) - loc.measuredAt > P.maxFixAgeSec * 1000) return fail('LOCATION_STALE');
    if (distM([loc.lat, loc.lng], pin) > P.pinMaxM) return fail('INVALID_ARGUMENT', { field: 'pin' });
    if (!resolution) {
      const dups = findDuplicates(db, categoryCode, pin, t, scopeMatch);
      if (dups.length) return fail('DUPLICATE_CANDIDATES', { candidates: dups.map(d => d.id) });
    }
    if (resolution && resolution.action === 'ATTACH_EXISTING') {
      const target = db.issues[resolution.issueId];
      if (target.creatorUid === uid) return fail('OWN_ISSUE_RECHECK');
      return modality === 'QUICK'
        ? submitQuick(db, { uid, issueId: target.id, loc }, t)
        : submitPhotoRecheck(db, { uid, issueId: target.id, loc, ticket: Object.assign(ticket, { shutterLoc: ticket.shutterLoc || loc }), photo }, t);
    }
    if (resolution && resolution.action === 'CREATE_NEW' && !(reason && reason.trim())) return fail('INVALID_ARGUMENT', { field: 'reason' });
    if (reason && reason.length > P.reasonMaxLen) return fail('INVALID_ARGUMENT', { field: 'reason' });
    const today = Object.values(db.issues).filter(x => x.creatorUid === uid && kstDay(x.createdAt) === kstDay(t)).length;
    if (today >= P.newIssuesPerDay) return fail('RATE_LIMITED');
    if (tk && tk.late) { // §15.2: Late 사진으로 공개 Issue를 만들지 않음
      const o = addObs(db, { uid, issueId: null, categoryCode, role: 'DISCOVERY', modality: 'PHOTO', observedAt: ticket.shutterAt, acceptedAt: t, dayKey: kstDay(t), photo, late: true, points: 0, rewardReason: 'LATE_PHOTO', visibility: 'PRIVATE' });
      return { ok: true, saved: true, late: true, resultId: o.id, pointsAwarded: 0, rewardReason: 'LATE_PHOTO' };
    }

    const id = nextId(db, 'issue');
    const photoFirst = modality === 'PHOTO';
    // ponytail: observationAnchors = 최초 유효 관찰 위치(§5.1 fallback). CORRIDOR Seed 안전지점 자동 연결은 서버 geometry 단계.
    const is = {
      id, categoryCode, source: 'USER', creatorUid: uid, createdAt: t, anchor: pin, observationAnchors: [[loc.lat, loc.lng]],
      visibility: 'PUBLIC', lifecycleStatus: 'OPEN', verificationLevel: 'NONE', lastVerifiedAt: null,
      eventEndsAt: c.windowMin ? t + c.windowMin * MIN : null, notifyFrom: t + P.notifyDelayMin * MIN,
      lastSignalAt: null, signalCount: 0,
      signalDayKey: null, todaySignalAccountCount: 0,
      availablePhotoCount: photoFirst ? 1 : 0, photoObservationCount: photoFirst ? 1 : 0,
      lastPhotoObservedAt: photoFirst ? ticket.shutterAt : null, photoAccounts: photoFirst ? [uid] : [],
      creatorPhotoAt: photoFirst ? ticket.shutterAt : null, creatorPhotoObsId: null,
      creatorCreditStatus: photoFirst ? 'ELIGIBLE' : 'OPEN',
      creatorPhotoDeadlineAt: photoFirst ? null : t + P.creatorPhotoQualMin * MIN,
      firstOtherPhotoAcceptedAt: null, rewardQualificationEndsAt: photoFirst ? t + P.pendingDays * DAY : null,
      bonusResolvedP: 0, reason: reason || null,
    };
    db.issues[id] = is;
    const o = addObs(db, { uid, issueId: id, role: 'DISCOVERY', modality, observedAt: photoFirst ? ticket.shutterAt : t, acceptedAt: t, dayKey: kstDay(t), photo: photo || null, entry: 'REPORT' });
    if (photoFirst) { ticket.consumed = true; is.creatorPhotoObsId = o.id; db.photoGuards[uid + '|' + id] = t; }

    let pending = 0, rewardReason;
    if (!photoFirst) rewardReason = 'QUICK_NEW_NO_POINTS';
    else if (!c.r) rewardReason = 'CATEGORY_NOT_REWARDED';
    else {
      const b = budget(db, uid, t);
      if (b.base + P.photoPoint > P.baseDailyCap) rewardReason = 'DAILY_CAP';
      else {
        pending = P.photoPoint; b.base += pending; rewardReason = 'PENDING_REVIEW';
        addLedger(db, { uid, amount: pending, status: 'PENDING', type: 'PHOTO_NEW', label: c.label + ' 새 제보 사진', issueId: id, sourceId: o.id, createdAt: t, expiresAt: is.rewardQualificationEndsAt });
      }
      db.entitlements['PHOTO_NEW|' + uid + '|' + id] = { outcome: pending ? 'PENDING' : 'CAP', at: t };
    }
    o.points = 0; o.pointsPending = pending; o.rewardReason = rewardReason;
    return { ok: true, saved: true, created: true, resultId: id, pointsAwarded: 0, pointsPending: pending, rewardReason, rewardQualificationEndsAt: is.rewardQualificationEndsAt, creatorPhotoDeadlineAt: is.creatorPhotoDeadlineAt };
  }

  // ---------- §7.1 최초 제보자 사진 보완 ----------
  function addDiscoveryPhoto(db, { uid, issueId, ticket, photo }, t) {
    const is = db.issues[issueId], c = CAT[is.categoryCode];
    if (is.creatorUid !== uid) return fail('NOT_OWNER');
    if (is.creatorPhotoAt) return fail('ALREADY_PARTICIPATED');
    const closed = issueClosed(is, t);
    if (closed) return fail(closed, { endedAt: is.eventEndsAt });
    const tk = checkTicket(ticket, t);
    if (tk.code) return fail(tk.code);
    const l = checkLocation(ticket.shutterLoc, is.observationAnchors, ticket.shutterAt);
    if (l.code) return fail(l.code, l);
    if (tk.late) return fail('PHOTO_TOO_OLD');
    ticket.consumed = true;
    const o = addObs(db, { uid, issueId, role: 'DISCOVERY_PHOTO', modality: 'PHOTO', observedAt: ticket.shutterAt, acceptedAt: t, dayKey: kstDay(t), photo, entry: 'ISSUE' });
    is.creatorPhotoAt = o.observedAt; is.creatorPhotoObsId = o.id;
    is.photoObservationCount++; is.availablePhotoCount++; is.lastPhotoObservedAt = Math.max(is.lastPhotoObservedAt || 0, o.observedAt);
    if (!is.photoAccounts.includes(uid)) is.photoAccounts.push(uid);
    db.photoGuards[uid + '|' + issueId] = t;

    const eligible = is.creatorCreditStatus === 'OPEN' && t < is.creatorPhotoDeadlineAt && !is.firstOtherPhotoAcceptedAt;
    let pending = 0, reason = 'SUPPLEMENT_ONLY';
    if (eligible) {
      is.creatorCreditStatus = 'ELIGIBLE';
      is.rewardQualificationEndsAt = t + P.pendingDays * DAY;
      if (!c.r) reason = 'CATEGORY_NOT_REWARDED';
      else {
        const b = budget(db, uid, t);
        if (b.base + P.photoPoint > P.baseDailyCap) reason = 'DAILY_CAP';
        else {
          pending = P.photoPoint; b.base += pending; reason = 'PENDING_REVIEW';
          addLedger(db, { uid, amount: pending, status: 'PENDING', type: 'PHOTO_NEW', label: c.label + ' 제보 사진 보완', issueId, sourceId: o.id, createdAt: t, expiresAt: is.rewardQualificationEndsAt });
        }
        db.entitlements['PHOTO_NEW|' + uid + '|' + issueId] = { outcome: pending ? 'PENDING' : 'CAP', at: t };
      }
    } else {
      is.creatorCreditStatus = 'INELIGIBLE';
    }
    o.points = 0; o.pointsPending = pending; o.rewardReason = reason;
    return { ok: true, saved: true, resultId: o.id, pointsAwarded: 0, pointsPending: pending, rewardReason: reason, rewardQualificationEndsAt: is.rewardQualificationEndsAt };
  }

  // ---------- §21.4 정기 관찰 (ROUTINE) ----------
  function routineState(db, uid, missionId, t) {
    const m = db.routines[missionId], r = roundOf(t, m.roundHours);
    const mine = db.routineKeys[uid + '|' + missionId + '|' + r.id] || null;
    const slots = db.routineSlots[uid + '|' + kstDay(t)] || 0;
    return { round: r, mine, accounts: (m.rounds[r.id] || []).length, slotsLeft: Math.max(0, P.routineSlotsPerDay - slots), welcomeToday: !!db.routineWelcomeDays[uid + '|' + kstDay(t)] };
  }

  function submitRoutine(db, { uid, missionId, ticket, photo, exposureId }, t) {
    const m = db.routines[missionId];
    if (!m.enabled) return fail('MISSION_NOT_ACTIVE');
    if (!ticket || !ticket.shutterAt) return fail('PHOTO_REQUIRED');
    if (exposureExpired(db, exposureId, t)) return fail('EXPOSURE_EXPIRED');
    const r = roundOf(ticket.issuedAt, m.roundHours);
    if (roundOf(ticket.shutterAt, m.roundHours).id !== r.id) return fail('ROUND_EXPIRED'); // K02
    if (t >= r.end + P.routineGraceMin * MIN) return fail('ROUND_EXPIRED');
    const tk = checkTicket(ticket, t);
    if (tk.code) return fail(tk.code);
    if (tk.late) return fail('PHOTO_TOO_OLD');
    const l = checkLocation(ticket.shutterLoc, m.anchors, ticket.shutterAt);
    if (l.code) return fail(l.code, l);
    const rk = uid + '|' + missionId + '|' + r.id;
    if (db.routineKeys[rk]) return fail('ALREADY_PARTICIPATED', { nextRoundAt: r.end });
    ticket.consumed = true;

    const day = kstDay(t);
    const o = addObs(db, { uid, missionId, roundId: r.id, role: 'ROUTINE', modality: 'PHOTO', observedAt: ticket.shutterAt, acceptedAt: t, dayKey: day, photo, exposureId: exposureId || null, entry: exposureId ? 'NOTIFICATION' : 'MAP' });
    db.routineKeys[rk] = o.id;
    (m.rounds[r.id] = m.rounds[r.id] || []).push(uid);

    const sk = uid + '|' + day, used = db.routineSlots[sk] || 0;
    let pts = 0, reason, welcome = false;
    if (used >= P.routineSlotsPerDay) reason = 'ROUTINE_DAILY_LIMIT'; // R04
    else {
      db.routineSlots[sk] = used + 1;
      const b = budget(db, uid, t);
      if (b.base + P.photoPoint > P.baseDailyCap) reason = 'DAILY_CAP';
      else {
        pts = P.photoPoint; b.base += pts; reason = 'PAID';
        addLedger(db, { uid, amount: pts, status: 'CONFIRMED', type: 'ROUTINE', label: m.name + ' 정기 기록', sourceId: o.id, createdAt: t });
      }
      db.contributions['ROUTINE|' + uid + '|' + missionId + '|' + r.id] = { uid, key: 'ROUTINE|' + missionId + '|' + r.id, source: 'ROUTINE', acceptedAt: t, dayKey: day, obsId: o.id, status: 'VALID' };
      if (!db.routineWelcomeDays[sk]) { db.routineWelcomeDays[sk] = o.id; welcome = true; refreshWelcome(db, uid); } // R06
    }
    o.points = pts; o.rewardReason = reason; o.welcomeCounted = welcome;
    linkExposure(db, exposureId, 'photo', o.id);
    return { ok: true, saved: true, resultId: o.id, pointsAwarded: pts, rewardReason: reason, welcomeCounted: welcome, roundEndsAt: r.end };
  }

  // ---------- §11.4 PENDING 만료 ----------
  function expirePending(db, t, limit = 80) {
    let n = 0;
    for (const x of db.ledger) {
      if (n >= limit) break;
      if (x.status === 'PENDING' && x.expiresAt && t >= x.expiresAt) {
        x.status = 'EXPIRED';
        const b = db.budgets[x.uid + '|' + x.dayKey];
        if (b) b.base = Math.max(0, b.base - x.amount); // 원래 KST일 예산만 반환
        const ent = db.entitlements['PHOTO_NEW|' + x.uid + '|' + x.issueId];
        if (ent) ent.outcome = 'EXPIRED';
        n++;
      }
    }
    return n;
  }

  // ---------- §12 Welcome·쿠폰 ----------
  function claimWelcome(db, { uid }, t) {
    const u = db.users[uid], cat = db.catalog.WELCOME_500;
    if (u.welcomeStatus === 'ISSUED') return fail('WELCOME_NOT_ELIGIBLE');
    if (u.welcomeStatus !== 'APPROVED' && u.welcomeStatus !== 'SOLD_OUT') return fail('WELCOME_ADMIN_REQUIRED');
    if (welcomeCount(db, uid) < P.welcomeTarget) return fail('WELCOME_NOT_ELIGIBLE');
    if (cat.stock <= 0) { u.welcomeStatus = 'SOLD_OUT'; return fail('REWARD_SOLD_OUT'); }
    cat.stock--;
    const cp = { id: nextId(db, 'cp'), uid, rewardId: 'WELCOME_500', merchantId: 'm_demo', status: 'ISSUED', issuedAt: t, expiresAt: t + 30 * DAY, window: null, failCount: 0, lockedUntil: null };
    db.coupons.push(cp);
    u.welcomeStatus = 'ISSUED';
    return { ok: true, couponId: cp.id };
  }

  function couponView(cp, t) { // 화면에 보일 상태(지연 Scheduler 없이 진입 시 검사)
    if (cp.status === 'USED' || cp.status === 'REVOKED') return cp.status;
    if (t >= cp.expiresAt) return 'EXPIRED';
    if (cp.window && t < cp.window.endsAt) return 'USE_REQUESTED';
    return 'ISSUED';
  }

  function requestCouponUse(db, { uid, couponId }, t) {
    const cp = db.coupons.find(c => c.id === couponId && c.uid === uid);
    if (!cp) return fail('NOT_FOUND');
    const st = couponView(cp, t);
    if (st === 'EXPIRED') { cp.status = 'EXPIRED'; return fail('COUPON_EXPIRED'); }
    if (st !== 'ISSUED' && st !== 'USE_REQUESTED') return fail('COUPON_UNAVAILABLE', { status: st });
    if (st === 'USE_REQUESTED') return { ok: true, useSessionId: cp.window.useSessionId, expiresAt: cp.window.endsAt }; // C01
    if (cp.lockedUntil && t < cp.lockedUntil) return fail('COUPON_LOCKED', { until: cp.lockedUntil });
    cp.window = { useSessionId: nextId(db, 'use'), endsAt: Math.min(cp.expiresAt, t + P.couponUseMin * MIN) };
    cp.status = 'USE_REQUESTED';
    return { ok: true, useSessionId: cp.window.useSessionId, expiresAt: cp.window.endsAt };
  }

  // ponytail: PIN을 브라우저 메모리에서 비교. 실제는 Secret Manager pepper + HMAC(merchantId+pinVersion) 서버 검증.
  function confirmCouponUse(db, { uid, couponId, useSessionId, pin }, t) {
    const cp = db.coupons.find(c => c.id === couponId && c.uid === uid);
    if (!cp || !cp.window || cp.window.useSessionId !== useSessionId) return fail('NOT_FOUND');
    if (cp.status === 'USED' || cp.status === 'REVOKED') return fail('COUPON_UNAVAILABLE', { status: cp.status });
    if (t >= cp.expiresAt) { cp.status = 'EXPIRED'; return fail('COUPON_EXPIRED'); }
    if (t >= cp.window.endsAt) { cp.status = t >= cp.expiresAt ? 'EXPIRED' : 'ISSUED'; return fail('USE_WINDOW_EXPIRED'); }
    if (cp.lockedUntil && t < cp.lockedUntil) return fail('COUPON_LOCKED', { until: cp.lockedUntil });
    if (cp.lockedUntil && t >= cp.lockedUntil) { cp.lockedUntil = null; cp.failCount = 0; }
    const m = db.merchants[cp.merchantId], dk = uid + '|' + cp.merchantId + '|' + kstDay(t);
    if ((db.merchantFails[dk] || 0) >= P.merchantDailyFailures) return fail('COUPON_LOCKED', { until: Date.parse(kstDay(t) + 'T00:00:00+09:00') + DAY });
    if (db.merchantUses[dk]) return fail('MERCHANT_DAILY_LIMIT');
    if (pin !== m.pin) {
      cp.failCount++; db.merchantFails[dk] = (db.merchantFails[dk] || 0) + 1;
      if (cp.failCount >= P.couponFailures) { cp.lockedUntil = t + P.couponLockMin * MIN; return fail('COUPON_LOCKED', { until: cp.lockedUntil }); }
      return fail('INVALID_MERCHANT_PIN', { remaining: P.couponFailures - cp.failCount });
    }
    cp.status = 'USED'; cp.usedAt = t; cp.failCount = 0; db.merchantUses[dk] = true;
    return { ok: true, usedAt: t };
  }

  // ---------- §14 세션 ----------
  function sessionAgeRule(startedAt, t) {
    const age = t - startedAt;
    if (age < P.maxSessionH * H) return 'RESUME';
    if (age < P.abandonSessionH * H) return 'CLOSE_ONLY';
    return 'ABANDONED';
  }

  // §9.1 노출 후보. 반환: {target, distanceM} | {suppressed: reason} | null
  function exposureCandidate(db, sess, uid, loc, t) {
    if (!sess || sess.status !== 'ACTIVE' || !loc) return null;
    if (t - sess.startedAt >= P.maxSessionH * H) return null;
    if (sess.exposureIds.length >= P.maxAlertsPerSession) return null;
    const lastAt = db.users[uid].lastAlertAt || 0;
    if (t - lastAt < P.alertCooldownMin * MIN) return null;
    const here = [loc.lat, loc.lng];
    const seen = new Set(sess.exposureIds.map(id => db.exposures[id].targetKey));
    const cands = [];
    for (const is of Object.values(db.issues)) {
      if (is.creatorUid === uid || issueClosed(is, t) || t < is.notifyFrom) continue;
      const d = Math.min(...is.observationAnchors.map(a => distM(here, a)));
      if (d > P.alertRadiusM || seen.has(is.id)) continue;
      const last = db.photoGuards[uid + '|' + is.id];
      if (last && t - last < P.photoRepeatMinH * H) continue; // SUPPRESSED
      if (db.entitlements['PHOTO_RECHECK|' + uid + '|' + is.id] && !db.users[uid].repeatObservationNotifications) continue; // N02
      cands.push({ kind: 'ISSUE', id: is.id, d, priority: CAT[is.categoryCode].tier });
    }
    for (const m of Object.values(db.routines)) {
      const r = roundOf(t, m.roundHours), key = m.id + '|' + r.id;
      const d = Math.min(...m.anchors.map(a => distM(here, a)));
      if (!m.enabled || d > P.alertRadiusM || seen.has(key) || db.routineKeys[uid + '|' + m.id + '|' + r.id]) continue; // N01
      cands.push({ kind: 'ROUTINE', id: m.id, d, priority: 0, roundId: r.id });
    }
    cands.sort((a, b) => b.priority - a.priority || a.d - b.d || (a.id < b.id ? -1 : 1));
    return cands[0] || null;
  }

  function recordExposure(db, sess, uid, cand, t) {
    const id = nextId(db, 'ex');
    const is = cand.kind === 'ISSUE' ? db.issues[cand.id] : null;
    const r = cand.kind === 'ROUTINE' ? roundOf(t, db.routines[cand.id].roundHours) : null;
    const end = Math.min(t + P.exposureWindowMin * MIN, (is && is.eventEndsAt) || Infinity, r ? r.end + P.routineGraceMin * MIN : Infinity);
    db.exposures[id] = { id, uid, sessionId: sess.id, kind: cand.kind, targetId: cand.id, targetKey: cand.kind === 'ISSUE' ? cand.id : cand.id + '|' + r.id, sessionMode: sess.mode, issuedAt: t, displayedAt: t, expiresAt: end, quickObsId: null, photoObsId: null };
    sess.exposureIds.push(id);
    db.users[uid].lastAlertAt = t;
    return db.exposures[id];
  }

  // §14.2 기록 계산: 정확도 30m 초과·12m/s 초과·60초 초과 공백은 거리에서 제외
  function trackDistance(points) {
    let d = 0, prev = null;
    for (const p of points) {
      if (p.acc > P.maxAccuracyM) continue;
      if (prev && !p.gap) {
        const seg = distM([prev.lat, prev.lng], [p.lat, p.lng]), dt = (p.t - prev.t) / 1000;
        if (dt > 0 && dt <= 60 && seg / dt <= 12) d += seg;
      }
      prev = p;
    }
    return d;
  }
  const pace = (ms, m) => (m > 0 ? ms / 1000 / (m / 1000) : null); // 초/km
  // 분·초 표기: 초를 먼저 반올림해야 5'59.6"이 6'00"이 된다
  function paceText(ms, m) {
    const p = pace(ms, m);
    if (!p || !isFinite(p) || p >= 3600 || m < 10) return null;
    const s = Math.round(p);
    return Math.floor(s / 60) + "'" + String(s % 60).padStart(2, '0') + '"';
  }
  const couponUsable = (cp, t) => ['ISSUED', 'USE_REQUESTED'].includes(couponView(cp, t));
  // 참여 기록의 보상 표시는 원장(ledger)의 현재 상태를 따른다(대기→확정·만료 반영)
  function obsReward(db, obsId) {
    const x = db.ledger.find(l => l.sourceId === obsId && l.type !== 'VERIFY_BONUS');
    return x ? { amount: x.amount, status: x.status } : { amount: 0, status: 'NONE' };
  }

  return {
    emptyDb, ensureUser, P, TIER, CAT, MIN, H, DAY, kstDay, kstWeek, roundOf, distM, nearestM, balance, pendingSum, budget,
    checkLocation, checkTicket, issueClosed, todaySignals, photoStale, welcomeCount, findDuplicates,
    submitQuick, submitPhotoRecheck, createIssue, addDiscoveryPhoto, routineState, submitRoutine,
    setVerification, expirePending, claimWelcome, couponView, requestCouponUse, confirmCouponUse,
    sessionAgeRule, exposureCandidate, recordExposure, trackDistance, pace, paceText, couponUsable, obsReward,
  };
});
