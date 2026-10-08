const Participation=require('./participation');
const PublicPhoto=require('./public-photo');
const P = require("./policy.cjs");
const V = require("./validation");
const W = require("./workouts");
const Admin = require("./admin");
const { trackDistance } = W;
const { randomUUID } = require("node:crypto");
const READS = [
  "getHome",
  "getMapData",
  "getRiverFeed",
  "getIssueDetail",
  "getRoutineDetail",
  "getRecords",
  "getRunDetail",
  "getMy",
  "getLedger",
  "getBenefits",
  "getSettings",
  "getPilotData",
  "getWorkoutStats", "getAdminDashboard", "getAdminQueue", "getAdminIssue", "getDeletionJob",
];
const POLICY = [
  "submitQuick",
  "submitPhotoRecheck",
  "createIssue",
  "addDiscoveryPhoto",
  "submitRoutine",
  "claimWelcome",
  "requestCouponUse",
  "confirmCouponUse",
];
const MUTATIONS = [
  "setPhotoPublication",
  "recordConsent",
  "updateProfile",
  "updateSettings",
  "startRun",
  "appendTrack",
  "pauseRun",
  "resumeRun",
  "finishRun",
  "discardRun",
  "recordMissionExposure",
  "issueCaptureTicket",
  "sealCapture",
  ...POLICY,
  "adminDecision",
  "configurePilot",
  "configureMerchant",
  "approveWelcome",
  "withdrawContribution",
  "deleteMyAccountData",
  ...Admin.MUTATIONS,
];
function initialState() {
  const d = P.emptyDb();
  d.catalog = {};
  d.merchants = {};
  return Object.assign(d, {
    receipts: {},
    consents: {},
    sessions: {},
    tickets: {},
    photos: {},
    news: {},
    courses: {},
    facilities: {},
    geometry: { paths: [] },
    deletionJobs: {},
    adminAudits: {},
  });
}
function own(table, id, uid) {
  const x = table[id];
  if (!x || x.uid !== uid) V.fail("NOT_FOUND");
  return x;
}
const clean = (x) => JSON.parse(JSON.stringify(x));
function issueDTO(d, i,now=Date.now()) {
  return {
    id: i.id,
    categoryCode: i.categoryCode,
    categoryLabel: P.CAT[i.categoryCode]?.label,
    anchor: i.anchor,
    verificationLevel: i.verificationLevel,
    createdAt: i.createdAt,
    lastPhotoObservedAt: i.lastPhotoObservedAt || null,
    observationAnchors: i.observationAnchors || [i.anchor],
    pathSegmentId: i.pathSegmentId || null,
    corridorSegmentId: i.corridorSegmentId || null,
    eventEndsAt: i.eventEndsAt || null,
    availablePhotoCount: i.availablePhotoCount || 0,
    signalDayKey: i.signalDayKey || null,
    todaySignalAccountCount: i.todaySignalAccountCount || 0,
    creatorPhotoDeadlineAt: i.creatorPhotoDeadlineAt || null,
    signalCount: i.signalCount || 0,
    photoObservationCount: i.photoObservationCount || 0,
    visibility: i.visibility || "PUBLIC",
    lifecycleStatus: i.lifecycleStatus || "OPEN",
    photos: [],
    publicPhoto: PublicPhoto.forIssue(d,i.id,now),
  };
}
const publicIssue = (i) =>
  i.visibility === "PUBLIC" && ["OPEN", "CLOSED", "RESOLVED"].includes(i.lifecycleStatus || "OPEN");
function userDTO(d, uid) {
  const u = d.users[uid] || {};
  return {
    displayName: u.displayName || "",
    uiMode: u.uiMode || "DEFAULT",
    repeatObservationNotifications: !!u.repeatObservationNotifications,
    pointsBalance: P.balance(d, uid),
    pointsPending: P.pendingSum(d, uid),
    welcomeStatus: u.welcomeStatus || "LOCKED",
  };
}
function page(rows, data, key = "createdAt") {
  const limit = Number.isInteger(data.limit)
    ? Math.min(50, Math.max(1, data.limit))
    : 20;
  const sorted = rows.sort(
    (a, b) =>
      (b[key] || 0) - (a[key] || 0) || String(a.id).localeCompare(String(b.id)),
  );
  const start = data.cursor
    ? sorted.findIndex((r) => r.id === data.cursor) + 1
    : 0;
  if (data.cursor && start === 0) V.fail("INVALID_CURSOR");
  const items = sorted.slice(start, start + limit);
  return {
    items,
    nextCursor: start + limit < sorted.length ? items.at(-1).id : null,
  };
}
function readModel(d, auth, name, data = {}, now = Date.now()) {
  if (!READS.includes(name)) V.fail("INVALID_ARGUMENT");
  const uid = auth.uid;
  const publicNames = [
    "getHome",
    "getMapData",
    "getRiverFeed",
    "getIssueDetail",
    "getRoutineDetail",
    "getPilotData",
  ];
  if (!uid && !publicNames.includes(name)) V.fail("UNAUTHENTICATED");
  if (name === "getDeletionJob") {
    const job = d.deletionJobs[uid];
    return job ? { status: job.status, createdAt: job.createdAt, dataCleaned: !!job.dataCleaned } : { status: "NONE" };
  }
  if (uid && d.deletionJobs[uid]) V.fail("ACCOUNT_DELETING");
  if (name === "getAdminDashboard") {
    if (!auth.admin) V.fail("PERMISSION_DENIED");
    const issues = Object.values(d.issues).filter(i=>!d.deletionJobs[i.creatorUid]);
    const photos = Object.values(d.photos).filter(p=>!d.deletionJobs[p.uid]&&p.status!=="DELETE_PENDING");
    const coupons = d.coupons.filter(c=>!d.deletionJobs[c.uid]).map(c=>({...c,status:P.couponView(c,now),displayName:d.users[c.uid]?.displayName||c.uid}));
    return {updatedAt:now,stats:{issues:issues.length,pendingIssues:issues.filter(i=>i.visibility==="PUBLIC"&&(i.verificationLevel||"NONE")==="NONE").length,photos:photos.length,coupons:coupons.length,usedCoupons:coupons.filter(c=>c.status==="USED").length,availableCoupons:coupons.filter(c=>c.status==="ISSUED").length},
      issues:page(issues.map(i=>({...issueDTO(d,i,now),creatorUid:i.creatorUid})),data.table&&data.table!=="issues"?{limit:data.limit}:data),
      photos:page(photos.map(p=>({id:p.id,issueId:p.issueId||null,uid:p.uid,status:p.status,createdAt:p.createdAt||p.capturedAt||0,publicApproved:p.publicApproved===true})),data.table&&data.table!=="photos"?{limit:data.limit}:data),
      coupons:page(coupons,data.table&&data.table!=="coupons"?{limit:data.limit}:data),audits:page(Object.values(d.adminAudits),{limit:data.limit},"at")};
  }
  if (["getAdminQueue", "getAdminIssue"].includes(name)) {
    if (!auth.admin) V.fail("PERMISSION_DENIED");
    if (name === "getAdminQueue") return {
      issues: page(Object.values(d.issues).filter(i => !d.deletionJobs[i.creatorUid] && i.visibility === "PUBLIC" && (i.verificationLevel || "NONE") === "NONE"), data),
      welcome:Object.entries(d.users).filter(([id,u])=>u.welcomeStatus==="PENDING_ADMIN"&&!d.deletionJobs[id]).map(([id,u])=>({uid:id,displayName:u.displayName,welcomeCount:P.welcomeCount(d,id)})),
      deletions: Object.values(d.deletionJobs).map(j => ({uid:j.uid,status:j.status,createdAt:j.createdAt})),
    };
    const issue = d.issues[data.issueId]; if (!issue || d.deletionJobs[issue.creatorUid]) V.fail("NOT_FOUND");
    return { issue: clean(issue), observations: page(Object.values(d.obs).filter(o=>o.issueId===issue.id),data,"observedAt"), photos: Object.values(d.photos).filter(p=>p.issueId===issue.id).map(p=>({id:p.id,status:p.status,capturedAt:p.capturedAt||null,publicApproved:p.publicApproved===true,publicPublishedAt:p.publicPublishedAt||null,redactionCount:(p.publicRedactions||[]).length})) };
  }
  if (name === "getWorkoutStats") return W.workoutStats(d.sessions, uid, data.range || "week", now);
  const issues = Object.values(d.issues)
    .filter((i) => publicIssue(i) && !d.deletionJobs[i.creatorUid])
    .map((i) => issueDTO(d, i,now));
  const current = issues.filter(i => {
    const raw = d.issues[i.id], cat = P.CAT[i.categoryCode];
    return i.lifecycleStatus === "OPEN" && !(raw.eventEndsAt && now >= raw.eventEndsAt) && now - (i.lastPhotoObservedAt || i.createdAt) <= (cat?.staleH || 72) * P.H;
  });
  const riverSummary = {currentCount:current.length,pastCount:issues.length-current.length,latest:page(current,{limit:1}).items[0]||null,updatedAt:issues.reduce((n,i)=>Math.max(n,i.lastPhotoObservedAt||i.createdAt||0),0)||null};
  if (name === "getHome")
    return {
      riverSummary,
      pilot: d.geometry,
      courses: Object.values(d.courses),
      recentIssues: page(issues, { limit: 5 }),
      my: uid ? userDTO(d, uid) : null,
      config: { ...P.P, source: "uirun-latest" },
    };
  if (name === "getMapData")
    return {
      issues: page(issues, data),
      facilities: Object.values(d.facilities),
      routines: Object.values(d.routines).map(
        ({ id, name, anchors, roundHours, enabled }) => ({
          id,
          name,
          anchors,
          roundHours,
          enabled,
        }),
      ),
      courses: Object.values(d.courses),
      pilot: d.geometry,
    };
  if (name === "getPilotData")
    return {
      paths: d.geometry.paths,
      participationRadiusM: V.PARTICIPATION_RADIUS_M,
      facilities: Object.values(d.facilities),
      courses: Object.values(d.courses),
      categories: P.CAT,
      policy: P.P,
    };
  if (name === "getRiverFeed")
    return {
      summary:riverSummary,
      current:page(current,{...data,cursor:data.currentCursor}),
      past:page(issues.filter(i=>!current.some(c=>c.id===i.id)),{...data,cursor:data.pastCursor}),
      issues: page(issues, { ...data, cursor: data.issuesCursor }),
      news: page(
        Object.values(d.news).filter((n) => n.published === true),
        { ...data, cursor: data.newsCursor },
        "publishedAt",
      ),
    };
  if (name === "getIssueDetail") {
    const i = d.issues[data.issueId];
    if (!i || !publicIssue(i) || d.deletionJobs[i.creatorUid])
      V.fail("NOT_FOUND");
    return {
      issue: issueDTO(d, i,now),
      observations: page(
        Object.values(d.obs)
          .filter(
            (o) =>
              o.issueId === i.id &&
              o.visibility !== "PRIVATE" &&
              o.visibility !== "HIDDEN" &&
              !d.deletionJobs[o.uid],
          )
          .map((o) => ({
            id: o.id,
            modality: o.modality,
            observedAt: o.observedAt,
            acceptedAt: o.acceptedAt || null,
            role: o.role,
          })),
        data,
        "observedAt",
      ),
      own: uid ? i.creatorUid === uid : false,
    };
  }
  if (name === "getRoutineDetail") {
    const m = d.routines[data.missionId];
    if (!m || !m.enabled) V.fail("NOT_FOUND");
    return {
      id: m.id,
      name: m.name,
      anchors: m.anchors,
      roundHours: m.roundHours,
      state: uid ? P.routineState(d, uid, m.id, now) : null,
    };
  }
  if (name === "getRecords")
    return {
      runs: page(
        Object.values(d.sessions)
          .filter(
            (s) =>
              s.uid === uid && ["COMPLETED", "RECOVERED"].includes(s.status),
          )
          .map(({ track, ...s }) => s),
        { ...data, cursor: data.runsCursor },
        "startedAt",
      ),
      participations: page(
        Object.values(d.obs)
          .filter((o) => o.uid === uid)
          .map((o) => {
            const reward = P.obsReward(d, o.id);
            return {
              ...o,
              // 관찰 종류(공개 정보): 참여 기록에 없으면 관찰의 종류를 붙인다(목록 제목용)
              categoryCode: o.categoryCode ?? d.issues[o.issueId]?.categoryCode ?? null,
              reward,
              points: reward.status === "CONFIRMED" ? reward.amount : 0,
              pointsPending: reward.status === "PENDING" ? reward.amount : 0,
            };
          }),
        { ...data, cursor: data.participationsCursor },
        "observedAt",
      ),
      issues: page(
        Object.values(d.issues)
          .filter((i) => i.creatorUid === uid)
          .map((i) => issueDTO(d, i,now)),
        { ...data, cursor: data.issuesCursor },
      ),
    };
  if (name === "getRunDetail")
    { const stored=own(d.sessions,data.sessionId,uid),session={...stored,activeMs:stored.activeMs+(stored.status==='ACTIVE'?Math.max(0,now-stored.lastResumeAt):0)}; return {...clean(session),exposures:(session.exposureIds||[]).map(id=>d.exposures[id]).filter(e=>e?.uid===uid).map(clean),metrics:W.runMetrics(session),participationStats:Participation.stats(Participation.rows(d,uid,session.id)),participations:page(Participation.rows(d,uid,session.id).map(o=>({...o,categoryCode:o.categoryCode??d.issues[o.issueId]?.categoryCode??null})),data,"observedAt")}; }
  if (name === "getMy")
    return {
      ...userDTO(d, uid),
      activity:W.workoutStats(d.sessions,uid,"week",now).totals,
      participationStats:Participation.stats(Participation.rows(d,uid)),
      participationCount:Object.values(d.obs).filter(o=>o.uid===uid&&o.visibility!=="HIDDEN").length,
      couponCount:d.coupons.filter(c=>c.uid===uid&&["ISSUED","USE_REQUESTED"].includes(P.couponView(c,now))).length,
      budget: P.budget(clean(d), uid, now),
      welcomeCount: P.welcomeCount(d, uid),
      activeSession:
        Object.values(d.sessions).find(
          (s) => s.uid === uid && ["ACTIVE", "PAUSED"].includes(s.status),
        )?.id || null,
    };
  if (name === "getSettings")
    return { ...userDTO(d, uid), consent: d.consents[uid] || null };
  if (name === "getLedger")
    return page(
      d.ledger.filter(
        (x) => x.uid === uid && (!data.status || x.status === data.status),
      ),
      data,
    );
  if (name === "getBenefits")
    return {
      user: userDTO(d, uid),
      contributions:Object.values(d.contributions).filter(c=>c.uid===uid).map(clean),
      routineDays:Object.keys(d.routineWelcomeDays).filter(k=>k.startsWith(uid+"|")).map(k=>k.slice(uid.length+1)),
      welcomeCount: P.welcomeCount(d, uid),
      merchants:Object.values(d.merchants).map(m=>({id:m.id,name:m.name,isDemo:m.isDemo===true})),
      catalog: Object.values(d.catalog).map(({ pin, ...c }) => c),
      coupons: d.coupons
        .filter((c) => c.uid === uid)
        .map((c) => ({ ...c, status: P.couponView(c, now) })),
    };
}
function execute(d, auth, name, data, now = Date.now()) {
  if (!auth.uid) V.fail("UNAUTHENTICATED");
  if (!MUTATIONS.includes(name)) V.fail("INVALID_ARGUMENT");
  const uid = auth.uid;
  if (d.deletionJobs[uid] && name !== "deleteMyAccountData")
    V.fail("ACCOUNT_DELETING");
  const requestId = V.text(data.clientRequestId, 100);
  const key = V.digest([uid, name, requestId]);
  const hash = V.digest(data);
  const old = d.receipts[key];
  if (old) {
    if (old.hash !== hash) V.fail("REQUEST_CONFLICT");
    return clean(old.result);
  }
  if (d.deletionJobs[uid] && name !== "deleteMyAccountData")
    V.fail("ACCOUNT_DELETING");
  if (
    name !== "recordConsent" &&
    !name.startsWith("admin") &&
    !Admin.MUTATIONS.includes(name) &&
    name !== "setPhotoPublication" &&
    name !== "configurePilot" &&
    name !== "configureMerchant" &&
    name !== "approveWelcome" &&
    !["updateProfile", "updateSettings", "deleteMyAccountData"].includes(
      name,
    ) &&
    d.consents[uid]?.version !== "v2-2026-10"
  )
    V.fail("CONSENT_REQUIRED");
  P.ensureUser(d, uid);
  P.expirePending(d, now);
  const result = perform(d, { ...auth, uid }, name, data, now);
  d.receipts[key] = {
    id: key,
    uid,
    name,
    hash,
    result: clean(result),
    createdAt: now,
  };
  return result;
}
function perform(d, auth, name, x, t) {
  const uid = auth.uid;
  const success = (v = {}) => ({ ok: true, ...v });
  if (name === "setPhotoPublication") return PublicPhoto.publish(d,auth,x,t);
  if (Admin.MUTATIONS.includes(name)) return Admin.mutate(d,auth,name,x,t);
  if (name === "recordConsent") {
    if (x.accepted !== true || x.version !== "v2-2026-10")
      V.fail("INVALID_ARGUMENT");
    d.consents[uid] = { uid, version: x.version, acceptedAt: t };
    return success({ acceptedAt: t });
  }
  if (name === "updateProfile") {
    if (typeof x.displayName !== "string")
      V.fail("INVALID_ARGUMENT", { field: "displayName" });
    const displayName = x.displayName.trim();
    if ([...displayName].length > 30)
      V.fail("INVALID_ARGUMENT", { field: "displayName" });
    d.users[uid].displayName = displayName;
    return success({ displayName });
  }
  if (name === "updateSettings") {
    if (x.uiMode !== undefined && !["DEFAULT", "SIMPLE"].includes(x.uiMode))
      V.fail("INVALID_ARGUMENT");
    if (
      x.repeatObservationNotifications !== undefined &&
      typeof x.repeatObservationNotifications !== "boolean"
    )
      V.fail("INVALID_ARGUMENT");
    if (x.uiMode !== undefined) d.users[uid].uiMode = x.uiMode;
    if (x.repeatObservationNotifications !== undefined)
      d.users[uid].repeatObservationNotifications =
        x.repeatObservationNotifications;
    return success();
  }
  if (name === "startRun") {
    if (!["RUN", "WALK"].includes(x.mode)) V.fail("INVALID_ARGUMENT");
    const l = V.location(x.loc, t);
    if (x.allowOutsidePilot !== undefined && typeof x.allowOutsidePilot !== "boolean") V.fail("INVALID_ARGUMENT");
    const distanceToPilotM = V.pilotDistance(d, l);
    if (distanceToPilotM > V.PARTICIPATION_RADIUS_M + 1e-6 && x.allowOutsidePilot !== true)
      V.fail("OUTSIDE_PILOT", { participationRadiusM: V.PARTICIPATION_RADIUS_M, distanceToPilotM: Math.round(distanceToPilotM) });
    if (
      Object.values(d.sessions).some(
        (s) => s.uid === uid && ["ACTIVE", "PAUSED"].includes(s.status),
      )
    )
      V.fail("ACTIVE_SESSION_EXISTS");
    if (x.courseId && !d.courses[x.courseId]) V.fail("NOT_FOUND");
    if(x.courseId&&!d.courses[x.courseId].modes?.includes(x.mode))V.fail("COURSE_MODE_NOT_SUPPORTED");
    const id = randomUUID();
    d.sessions[id] = {
      id,
      uid,
      mode: x.mode,
      courseId: x.courseId || null,
      status: "ACTIVE",
      startedAt: t,
      activeMs: 0,
      lastResumeAt: t,
      track: [],
      exposureIds: [],
      pauses: [],
      distanceM: 0,
    };
    return success({ sessionId: id, startedAt: t });
  }
  if (
    [
      "appendTrack",
      "pauseRun",
      "resumeRun",
      "finishRun",
      "discardRun",
      "recordMissionExposure",
    ].includes(name)
  ) {
    const s = own(d.sessions, x.sessionId, uid);
    if (!["ACTIVE", "PAUSED"].includes(s.status)) V.fail("INVALID_STATE");
    if (name === "appendTrack") {
      if (P.sessionAgeRule(s.startedAt, t) !== "RESUME")
        V.fail("SESSION_EXPIRED");
      if (!Array.isArray(x.points) || !x.points.length || x.points.length > 100)
        V.fail("INVALID_ARGUMENT");
      if (s.track.length + x.points.length > 5000)
        V.fail("SESSION_TRACK_LIMIT");
      let last = s.track.at(-1)?.recordedAt || s.startedAt - 1;
      for (const p of x.points) {
        const recordedAt = V.number(p.recordedAt, s.startedAt, t + V.CLOCK_SKEW_MS);
        if (recordedAt <= last) V.fail("OUT_OF_ORDER");
        if (
          s.pauses.some((a) => recordedAt >= a.from && recordedAt < (a.to || t))
        )
          V.fail("PAUSED_SAMPLE");
        const point = {
          lat: V.number(p.lat, -90, 90),
          lng: V.number(p.lng, -180, 180),
          acc: V.number(p.accuracyM, 0, 10000),
          recordedAt,
          t: recordedAt,
          altitudeM:
            p.altitudeM == null ? null : V.number(p.altitudeM, -500, 9000),
          altitudeAccuracyM:p.altitudeAccuracyM == null ? null : V.number(p.altitudeAccuracyM,0,10000),
          segment: s.pauses.filter((a) => a.to !== null && recordedAt >= a.to)
            .length,
        };
        if (p.mock === true) V.fail("REJECTED_MOCK");
        s.track.push(point);
        last = recordedAt;
      }
      s.distanceM = trackDistance(s.track);
      return success({ count: s.track.length, distanceM: s.distanceM });
    }
    // occurredAt(선택): 실제 조작 시각. GPS와 동일하게 기기 시계가 최대 2초 빠른 경우까지 허용.
    // 생략하면 서버 수신 시각(기존 동작). 늦게 도착한 요청이 활동 시간을 부풀리지 않게 한다.
    if (name === "pauseRun") {
      if (s.status !== "ACTIVE") V.fail("INVALID_STATE");
      const minAt = Math.max(s.lastResumeAt, (s.track.at(-1)?.recordedAt ?? 0) + 1);
      const at = x.occurredAt === undefined ? Math.max(t, minAt) : V.number(x.occurredAt, minAt, t + V.CLOCK_SKEW_MS);
      s.activeMs += at - s.lastResumeAt;
      s.pauses.push({ from: at, to: null });
      s.status = "PAUSED";
      return success();
    }
    if (name === "resumeRun") {
      if (
        s.status !== "PAUSED" ||
        P.sessionAgeRule(s.startedAt, t) !== "RESUME"
      )
        V.fail("INVALID_STATE");
      const at = x.occurredAt === undefined ? Math.max(t, s.pauses.at(-1).from) : V.number(x.occurredAt, s.pauses.at(-1).from, t + V.CLOCK_SKEW_MS);
      s.pauses.at(-1).to = at;
      s.lastResumeAt = at;
      s.status = "ACTIVE";
      return success();
    }
    if (name === "recordMissionExposure") {
      if (
        s.status !== "ACTIVE" ||
        P.sessionAgeRule(s.startedAt, t) !== "RESUME"
      )
        V.fail("INVALID_STATE");
      const l = V.location(x.loc, t);
      V.match(d, l);
      const matched = V.match(d, l);
      const eligible = {
        ...d,
        issues: Object.fromEntries(
          Object.entries(d.issues).filter(([, i]) =>
            P.CAT[i.categoryCode].scope === "PATH"
              ? i.pathSegmentId === matched.id
              : i.corridorSegmentId === matched.corridorId,
          ),
        ),
        routines: Object.fromEntries(
          Object.entries(d.routines).filter(
            ([, m]) =>
              !m.corridorSegmentId ||
              m.corridorSegmentId === matched.corridorId,
          ),
        ),
      };
      const cand = P.exposureCandidate(eligible, s, uid, l, t);
      if (!cand) return success({ exposure: null });
      const target =
        cand.kind === "ISSUE" ? d.issues[cand.id] : d.routines[cand.id];
      if (cand.kind === "ISSUE")
        V.scope(d, l, target, P.CAT[target.categoryCode]);
      else if (
        target.corridorSegmentId &&
        V.match(d, l).corridorId !== target.corridorSegmentId
      )
        V.fail("WRONG_SCOPE");
      return success({ exposure: P.recordExposure(d, s, uid, cand, t) });
    }
    if (
      name === "finishRun" &&
      x.expectedTrackCount !== undefined &&
      V.number(x.expectedTrackCount, 0, 5000) !== s.track.length
    )
      V.fail("TRACK_NOT_SYNCED", { storedCount: s.track.length });
    // occurredAt(선택): 종료·폐기를 실제로 누른 시각. ACTIVE면 마지막 재개·마지막 위치점 이후,
    // PAUSED면 일시정지 시작 이후 ~ 서버 현재 시각 + 2초를 허용(GPS와 같은 시계 오차).
    // 상태(COMPLETED/RECOVERED) 판정은 기기 시계가 아니라 서버 수신 시각으로 한다.
    const minAt = s.status === "ACTIVE"
      ? Math.max(s.lastResumeAt, (s.track.at(-1)?.recordedAt ?? 0) + 1)
      : s.pauses.at(-1).from;
    const at = x.occurredAt === undefined
      ? Math.max(t, minAt)
      : V.number(x.occurredAt, minAt, t + V.CLOCK_SKEW_MS);
    if (s.status === "ACTIVE") s.activeMs += at - s.lastResumeAt;
    else s.pauses.at(-1).to = at;
    s.status =
      name === "discardRun"
        ? "DISCARDED"
        : P.sessionAgeRule(s.startedAt, t) === "ABANDONED"
          ? "RECOVERED"
          : "COMPLETED";
    s.endedAt = at;
    s.distanceM = trackDistance(s.track);
    return success({
      sessionId: s.id,
      status: s.status,
      distanceM: s.distanceM,
      activeMs: s.activeMs,
    });
  }
  if (name === "issueCaptureTicket") {
    const l = V.location(x.loc, t);
    V.match(d, l);
    if (
      !["DISCOVERY", "DISCOVERY_PHOTO", "RECHECK", "ROUTINE"].includes(
        x.purpose,
      )
    )
      V.fail("INVALID_ARGUMENT");
    if (x.purpose === "DISCOVERY" && !Object.hasOwn(P.CAT, x.categoryCode))
      V.fail("INVALID_ARGUMENT");
    if (["RECHECK", "DISCOVERY_PHOTO"].includes(x.purpose)) {
      const i = d.issues[x.targetId];
      if (!i || !publicIssue(i) || d.deletionJobs[i.creatorUid])
        V.fail("NOT_FOUND");
      V.scope(d, l, i, P.CAT[i.categoryCode]);
    }
    if (x.purpose === "ROUTINE" && !d.routines[x.targetId]) V.fail("NOT_FOUND");
    const id = randomUUID();
    d.tickets[id] = {
      id,
      uid,
      purpose: x.purpose,
      targetId: x.targetId || null,
      categoryCode: x.categoryCode || null,
      issuedAt: t,
      expiresAt: t + 15 * P.MIN,
      consumed: false,
    };
    return success({
      ticketId: id,
      expiresAt: t + 15 * P.MIN,
      uploadPath: `evidence/${uid}/${id}/original.jpg`,
    });
  }
  if (name === "sealCapture") {
    const ticket = own(d.tickets, x.ticketId, uid);
    if (ticket.consumed || ticket.shutterAt || t >= ticket.expiresAt)
      V.fail("CAPTURE_TICKET_EXPIRED");
    ticket.shutterAt = t;
    ticket.shutterLoc = V.location(x.loc, t);
    V.match(d, ticket.shutterLoc);
    return success({ capturedAt: t });
  }
  if (POLICY.includes(name)) {
    if (
      name === "claimWelcome" &&
      (!d.catalog.WELCOME_500 || !d.merchants[d.catalog.WELCOME_500.merchantId])
    )
      V.fail("REWARD_NOT_CONFIGURED");
    let l, ticket, photo;
    if (["submitQuick", "createIssue"].includes(name) && x.modality !== "PHOTO")
      l = V.location(x.loc, t);
    if (
      ["submitPhotoRecheck", "addDiscoveryPhoto", "submitRoutine"].includes(
        name,
      ) ||
      x.modality === "PHOTO"
    ) {
      ticket = d.tickets[x.ticketId];
      if (!ticket || ticket.uid !== uid || !ticket.shutterAt)
        V.fail("PHOTO_REQUIRED");
      if (ticket.consumed) V.fail("PHOTO_ALREADY_CONSUMED");
      const expected =
        name === "submitPhotoRecheck"
          ? "RECHECK"
          : name === "submitRoutine"
            ? "ROUTINE"
            : name === "addDiscoveryPhoto"
              ? "DISCOVERY_PHOTO"
              : "DISCOVERY";
      if (
        ticket.purpose !== expected ||
        (ticket.targetId && ticket.targetId !== (x.issueId || x.missionId)) ||
        (name === "createIssue" && ticket.categoryCode !== x.categoryCode)
      )
        V.fail("INVALID_TICKET");
      const p = d.photos[x.ticketId];
      if (!p || p.uid !== uid || p.status !== "READY")
        V.fail("PHOTO_NOT_READY");
      photo = { id: p.id, path: p.processedPath };
      l = ticket.shutterLoc;
    }
    if (x.issueId) {
      const i = d.issues[x.issueId];
      if (!i || !publicIssue(i) || d.deletionJobs[i.creatorUid])
        V.fail("NOT_FOUND");
      if (l) V.scope(d, l, i, P.CAT[i.categoryCode]);
    }
    if (x.exposureId) {
      const ex = own(d.exposures, x.exposureId, uid);
      if (ex.targetId !== (x.issueId || x.missionId))
        V.fail("INVALID_ARGUMENT");
    }
    if (name === "submitRoutine") {
      const m = d.routines[x.missionId];
      if (!m || !m.enabled) V.fail("NOT_FOUND");
      const p = V.match(d, l);
      if (m.corridorSegmentId && p.corridorId !== m.corridorSegmentId)
        V.fail("WRONG_SCOPE");
    }
    let pin, resolution;
    if (name === "createIssue") {
      if (
        !Object.hasOwn(P.CAT, x.categoryCode) ||
        !["QUICK", "PHOTO"].includes(x.modality)
      )
        V.fail("INVALID_ARGUMENT");
      pin = V.coordinate(x.pin);
      const a = V.match(d, l),
        b = V.match(d, { lat: pin[0], lng: pin[1] });
      if (
        P.CAT[x.categoryCode].scope === "PATH"
          ? a.id !== b.id
          : a.corridorId !== b.corridorId
      )
        V.fail("WRONG_SCOPE");
      if (x.resolution) {
        if (!["CREATE_NEW", "ATTACH_EXISTING"].includes(x.resolution.action))
          V.fail("INVALID_ARGUMENT");
        resolution = {
          action: x.resolution.action,
          issueId: x.resolution.issueId,
        };
        if (resolution.action === "ATTACH_EXISTING") {
          const i = d.issues[resolution.issueId];
          if (
            !i ||
            !publicIssue(i) ||
            i.categoryCode !== x.categoryCode ||
            P.distM(i.anchor, pin) > 30
          )
            V.fail("INVALID_DUPLICATE_TARGET");
          V.scope(d, l, i, P.CAT[i.categoryCode]);
        }
      }
    }
    let checkedPin;
    if (name === "confirmCouponUse") {
      checkedPin = V.text(x.pin, 6);
      if (!/^\d{6}$/.test(checkedPin)) V.fail("INVALID_ARGUMENT");
      const cp = d.coupons.find((c) => c.id === x.couponId && c.uid === uid);
      if (!cp) V.fail("NOT_FOUND");
      const m = d.merchants[cp.merchantId];
      checkedPin = V.pinValid(checkedPin, m) ? m.pin : "INVALID";
    }
    const args = {
      uid,
      scopeMatch: name === "createIssue" ? V.match(d, l) : undefined,
      issueId: x.issueId,
      missionId: x.missionId,
      loc: l,
      ticket,
      photo,
      exposureId: x.exposureId,
      categoryCode: x.categoryCode,
      pin,
      modality: x.modality,
      resolution,
      reason: x.reason ? V.text(x.reason, 200) : undefined,
      couponId: x.couponId,
      useSessionId: x.useSessionId,
    };
    if (name === "confirmCouponUse") args.pin = checkedPin;
    const sessionId=["submitQuick","submitPhotoRecheck","createIssue","addDiscoveryPhoto","submitRoutine"].includes(name)?Participation.session(d,uid,x,ticket?.shutterAt||t,t):null;
    const r = P[name](d, args, t);
    if(r.ok&&r.saved!==false&&sessionId){const obsId=r.created?d.issues[r.resultId]?.creatorPhotoObsId||Object.values(d.obs).find(o=>o.issueId===r.resultId&&o.uid===uid&&o.role==="DISCOVERY")?.id:r.resultId;if(d.obs[obsId]&&d.obs[obsId].uid===uid)d.obs[obsId].sessionId=sessionId;}
    if (r.created) {
      const i = d.issues[r.resultId],
        p = V.match(d, l);
      if (P.CAT[i.categoryCode].scope === "CORRIDOR")
        i.observationAnchors = d.geometry.paths
          .filter((a) => a.corridorId === p.corridorId)
          .map((a) => V.nearestOnLine(pin, a.points));
      i.pathSegmentId = P.CAT[i.categoryCode].scope === "PATH" ? p.id : null;
      i.corridorSegmentId = p.corridorId;
      i.visibility = "PUBLIC";
      i.lifecycleStatus = "OPEN";
    }
    if (r.ok && name === "claimWelcome") {
      const cp = d.coupons.find((c) => c.id === r.couponId);
      cp.merchantId = d.catalog.WELCOME_500.merchantId;
      cp.expiresAt = t + d.catalog.WELCOME_500.validDays * P.DAY;
    }
    if (r.ok && ticket) {
      ticket.consumed = true;
      const p = d.photos[x.ticketId];
      p.issueId =
        x.issueId ||
        (r.created
          ? r.resultId
          : resolution?.action === "ATTACH_EXISTING"
            ? resolution.issueId
            : null);
      p.observationId = r.created
        ? d.issues[r.resultId].creatorPhotoObsId
        : r.resultId;
      p.attachedAt = t;
    }
    return r;
  }
  if (name === "approveWelcome") {
    if (!auth.admin) V.fail("PERMISSION_DENIED");
    const user = d.users[x.userId];
    if (
      !user ||
      d.deletionJobs[x.userId] ||
      user.welcomeStatus !== "PENDING_ADMIN"
    )
      V.fail("INVALID_STATE");
    user.welcomeStatus = "APPROVED";
    user.welcomeApprovalAt = t;
    return success();
  }
  if (name === "adminDecision") {
    if (!auth.admin) V.fail("PERMISSION_DENIED");
    const i = d.issues[x.issueId];
    if (!i) V.fail("NOT_FOUND");
    if (!["APPROVE", "REJECT", "HIDE", "APPROVE_WELCOME"].includes(x.decision))
      V.fail("INVALID_ARGUMENT");
    if (
      x.decision === "APPROVE" &&
      (!publicIssue(i) ||
        d.deletionJobs[i.creatorUid] ||
        i.lifecycleStatus !== "OPEN")
    )
      V.fail("INVALID_STATE");
    if (x.decision === "APPROVE") P.setVerification(d, i, "ADMIN", t);
    if (x.decision === "HIDE") i.visibility = "HIDDEN";
    if (x.decision === "REJECT") {
      i.visibility = "HIDDEN";
      i.creatorCreditStatus = "INELIGIBLE";
      for (const e of d.ledger.filter(
        (e) =>
          e.issueId === i.id &&
          e.uid === i.creatorUid &&
          ["PHOTO_NEW", "VERIFY_BONUS"].includes(e.type),
      ))
        revokeLedger(d, e);
      invalidateContributions(
        d,
        (c) => c.source === "NEWISSUE" && c.obsId === i.creatorPhotoObsId,
      );
    }

    if (x.decision === "APPROVE_WELCOME") {
      const u = d.users[i.creatorUid];
      if (u.welcomeStatus !== "PENDING_ADMIN") V.fail("INVALID_STATE");
      u.welcomeStatus = "APPROVED";
      u.welcomeApprovalAt = t;
    }
    const id = randomUUID();
    d.adminAudits[id] = { id, uid, issueId: i.id, decision: x.decision, at: t };
    return success();
  }
  if (name === "configureMerchant") {
    if (!auth.admin) V.fail("PERMISSION_DENIED");
    const id = V.text(x.id, 80),
      pin = V.text(x.pin, 6);
    if (!/^\d{6}$/.test(pin)) V.fail("INVALID_ARGUMENT");
    const hashed = V.pinHash(pin);
    const merchant = {
      id,
      name: V.text(x.name, 100),
      pin: "SERVER_VALIDATED",
      pinHash: hashed.hash,
      pinSalt: hashed.salt,
      isDemo: x.isDemo !== false,
    };
    let catalog;
    if (x.catalog) {
      const c = x.catalog;
      catalog = {
        stock: V.number(c.stock, 0, 100000),
        title: V.text(c.title, 100),
        condition: V.text(c.condition, 200),
        validDays: V.number(c.validDays, 1, 365),
        isDemo: x.isDemo !== false,
        merchantId: id,
      };
      if (!Number.isInteger(catalog.stock)) V.fail("INVALID_ARGUMENT");
    }
    d.merchants[id] = merchant;
    if (catalog) d.catalog.WELCOME_500 = catalog;
    return success();
  }
  if (name === "configurePilot") {
    if (!auth.admin) V.fail("PERMISSION_DENIED");
    if (!Array.isArray(x.paths) || x.paths.length > 200)
      V.fail("INVALID_ARGUMENT");
    const paths = x.paths.map((p) => {
      if (
        !Array.isArray(p.points) ||
        p.points.length < 2 ||
        p.points.length > 2000
      )
        V.fail("INVALID_ARGUMENT");
      return {
        id: V.text(p.id, 80),
        corridorId: V.text(p.corridorId, 80),
        points: p.points.map(V.coordinate),
      };
    });
    if (new Set(paths.map((p) => p.id)).size !== paths.length)
      V.fail("INVALID_ARGUMENT");
    const configs = {};
    for (const field of ["courses", "facilities", "news", "routines"])
      if (x[field] !== undefined) {
        if (!Array.isArray(x[field]) || x[field].length > 200)
          V.fail("INVALID_ARGUMENT");
        const rows = x[field].map((v) => {
          const id = V.text(v.id, 80);
          const row = { ...clean(v), id };
          if(field === "courses"){
            row.name=V.text(v.name,100);
            if(!Array.isArray(v.out)||v.out.length<2||v.out.length>2000||!Array.isArray(v.modes)||!v.modes.length||v.modes.some(m=>!["RUN","WALK"].includes(m)))V.fail("INVALID_ARGUMENT");
            row.out=v.out.map(V.coordinate);row.modes=[...new Set(v.modes)];
          }
          if(field === "facilities"){
            row.name=V.text(v.name,100);row.type=V.text(v.type,80);row.lat=V.number(v.lat,-90,90);row.lng=V.number(v.lng,-180,180);
          }
          if (field === "routines") {
            if (
              !Array.isArray(v.anchors) ||
              !v.anchors.length ||
              v.anchors.length > 100 ||
              typeof v.enabled !== "boolean"
            )
              V.fail("INVALID_ARGUMENT");
            row.anchors = v.anchors.map(V.coordinate);
            row.roundHours = V.number(v.roundHours || 6, 1, 24);
            if (!Number.isInteger(row.roundHours) || 24 % row.roundHours !== 0)
              V.fail("INVALID_ARGUMENT");
            row.name = V.text(v.name, 100);
            row.rounds = d.routines[id]?.rounds || {};
          }
          return row;
        });
        if (new Set(rows.map((v) => v.id)).size !== rows.length)
          V.fail("INVALID_ARGUMENT");
        configs[field] = Object.fromEntries(rows.map((v) => [v.id, v]));
      }
    d.geometry.paths = paths;
    Object.assign(d, configs);
    return success();
  }
  if (name === "withdrawContribution") {
    const o = own(d.obs, x.observationId, uid);
    if (o.visibility === "HIDDEN") return success();
    o.visibility = "HIDDEN";
    for (const e of d.ledger.filter(
      (e) =>
        e.uid === uid &&
        (e.sourceId === o.id ||
          (e.issueId === o.issueId &&
            ["DISCOVERY", "DISCOVERY_PHOTO"].includes(o.role))),
    ))
      revokeLedger(d, e);
    invalidateContributions(d, (c) => c.uid === uid && c.obsId === o.id);
    for (const p of Object.values(d.photos))
      if (p.observationId === o.id) {
        p.publicApproved = false;
        p.status = "DELETE_PENDING";
      }
    const i = d.issues[o.issueId];
    if (i) {
      if (i.creatorPhotoObsId === o.id) {
        i.creatorCreditStatus = "INELIGIBLE";
        i.creatorPhotoAt = null;
        i.creatorPhotoObsId = null;
      }
      refreshIssueEvidence(d, i);
      if (
        i.creatorUid === uid &&
        !Object.values(d.obs).some(
          (a) =>
            a.issueId === i.id && a.uid !== uid && a.visibility !== "HIDDEN",
        )
      )
        i.visibility = "HIDDEN";
    }
    refreshRoutineAccounts(d);
    return success();
  }
  if (name === "deleteMyAccountData") {
    if (x.confirm !== true) V.fail("INVALID_ARGUMENT");
    if (!d.deletionJobs[uid])
      d.deletionJobs[uid] = {
        uid,
        status: "PENDING",
        createdAt: t,
        dataCleaned: false,
      };
    cleanupAccountBatch(d, uid, 80);
    return success({ deletionPending: true });
  }
  V.fail("INVALID_ARGUMENT");
}
function revokeLedger(d, e) {
  if (e.status === "PENDING") {
    const b = d.budgets[e.uid + "|" + e.dayKey];
    if (b) b.base = Math.max(0, b.base - e.amount);
    e.status = "REJECTED";
  } else if (e.status === "CONFIRMED") e.status = "REVERSED";
}
function invalidateContributions(d, predicate) {
  const affected = new Set();
  for (const c of Object.values(d.contributions))
    if (predicate(c)) {
      c.status = "WITHDRAWN";
      affected.add(c.uid);
    }
  for (const uid of affected) {
    for (const [key, obsId] of Object.entries(d.routineWelcomeDays))
      if (
        key.startsWith(uid + "|") &&
        !Object.values(d.contributions).some(
          (c) =>
            c.uid === uid &&
            c.source === "ROUTINE" &&
            c.status === "VALID" &&
            key === uid + "|" + c.dayKey,
        )
      )
        delete d.routineWelcomeDays[key];
    const u = d.users[uid];
    if (
      u &&
      P.welcomeCount(d, uid) < P.P.welcomeTarget &&
      u.welcomeStatus !== "ISSUED"
    ) {
      u.welcomeStatus = "LOCKED";
      u.welcomeApprovalAt = null;
    }
  }
}
function refreshIssueEvidence(d, i) {
  const rows = Object.values(d.obs).filter(
    (o) =>
      o.issueId === i.id &&
      o.modality === "PHOTO" &&
      !o.late &&
      o.visibility !== "HIDDEN" &&
      !d.deletionJobs[o.uid],
  );
  const quick = Object.values(d.obs).filter(
    (o) =>
      o.issueId === i.id &&
      o.modality === "QUICK" &&
      o.role === "RECHECK" &&
      o.visibility !== "HIDDEN" &&
      !d.deletionJobs[o.uid],
  );
  i.signalCount = quick.length;
  i.lastSignalAt = quick.length
    ? Math.max(...quick.map((o) => o.observedAt))
    : null;
  i.signalDayKey = i.lastSignalAt ? P.kstDay(i.lastSignalAt) : null;
  i.todaySignalAccountCount = new Set(
    quick.filter((o) => o.dayKey === i.signalDayKey).map((o) => o.uid),
  ).size;
  i.availablePhotoCount = rows.length;
  i.photoObservationCount = rows.length;
  i.photoAccounts = [...new Set(rows.map((o) => o.uid))];
  i.lastPhotoObservedAt = rows.length
    ? Math.max(...rows.map((o) => o.observedAt))
    : null;
}
function refreshRoutineAccounts(d) {
  for (const m of Object.values(d.routines))
    for (const [r, uids] of Object.entries(m.rounds || {}))
      m.rounds[r] = uids.filter((uid) =>
        Object.values(d.obs).some(
          (o) =>
            o.missionId === m.id &&
            o.roundId === r &&
            o.uid === uid &&
            o.visibility !== "HIDDEN",
        ),
      );
}
// Bounded changes keep account erasure below the transaction write limit.
function cleanupAccountBatch(d, uid, limit = 80) {
  const job = d.deletionJobs[uid];
  if (!job) return { changed: 0, done: true };
  let changed = 0;
  const change = (fn) => {
    if (changed >= limit) return false;
    fn();
    changed++;
    return true;
  };
  for (const p of Object.values(d.photos))
    if (p.uid === uid && p.status !== "DELETE_PENDING")
      change(() => {
        p.status = "DELETE_PENDING";
        p.publicApproved = false;
      });
  for (const i of Object.values(d.issues)) {
    if (i.creatorUid === uid)
      change(() => {
        i.creatorUid = "deleted";
        i.creatorCreditStatus = "INELIGIBLE";
        i.visibility = "HIDDEN";
      });
    if ((i.photoAccounts || []).includes(uid))
      change(() => refreshIssueEvidence(d, i));
  }
  for (const m of Object.values(d.routines))
    if (Object.values(m.rounds || {}).some((users) => users.includes(uid)))
      change(() => {
        for (const r of Object.keys(m.rounds))
          m.rounds[r] = m.rounds[r].filter((u) => u !== uid);
      });
  for (const table of [
    "obs",
    "sessions",
    "tickets",
    "receipts",
    "exposures",
    "contributions",
  ])
    for (const [key, o] of Object.entries(d[table]))
      if (o.uid === uid)
        change(() => {
          delete d[table][key];
          if (table === "obs" && d.issues[o.issueId])
            refreshIssueEvidence(d, d.issues[o.issueId]);
        });
  for (const table of [
    "budgets",
    "bonusWeeks",
    "quickMarkers",
    "photoGuards",
    "routineKeys",
    "routineSlots",
    "routineWelcomeDays",
    "merchantFails",
    "merchantUses",
    "entitlements",
  ])
    for (const key of Object.keys(d[table]))
      if (key.split("|").includes(uid)) change(() => delete d[table][key]);
  for (const table of ["coupons", "ledger"])
    for (const o of [...d[table]])
      if (o.uid === uid)
        change(() => {
          d[table] = d[table].filter((a) => a.id !== o.id);
        });
  for (const table of ["users", "consents"])
    if (d[table][uid]) change(() => delete d[table][uid]);
  for (const a of Object.values(d.adminAudits))
    if (a.uid === uid)
      change(() => {
        a.uid = "deleted";
      });
  job.dataCleaned = changed < limit;
  return { changed, done: job.dataCleaned };
}
module.exports = {
  initialState,
  execute,
  readModel,
  READS,
  MUTATIONS,
  trackDistance,
  cleanupAccountBatch,
};
