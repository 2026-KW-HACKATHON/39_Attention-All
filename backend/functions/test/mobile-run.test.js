// 모바일 오프라인 큐: pauseRun/resumeRun의 선택 입력 occurredAt(실제 조작 시각)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execute, initialState } = require("../src/service");
const t0 = Date.parse("2026-10-04T03:00:00Z");
const loc = (t) => ({ lat: 37.62, lng: 127.05, accuracyM: 8, measuredAt: t, precise: true });
function db() {
  const d = initialState();
  d.geometry.paths = [{ id: "L", corridorId: "W1", points: [[37.619, 127.05], [37.621, 127.05]] }];
  return d;
}
const call = (d, name, data, t) => execute(d, { uid: "u" }, name, { clientRequestId: crypto.randomUUID(), ...data }, t);

test("기기 시계가 1초 빨라도 저장된 위치 뒤의 일시정지·재개·종료를 기록한다", () => {
  const d = db();
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, t0);
  const { sessionId } = call(d, "startRun", { mode: "WALK", loc: loc(t0) }, t0);
  call(d, "appendTrack", { sessionId, points: [{ lat: 37.6195, lng: 127.05, accuracyM: 5, recordedAt: t0 + 61000 }] }, t0 + 60000);
  call(d, "pauseRun", { sessionId, occurredAt: t0 + 61500 }, t0 + 60500);
  assert.equal(d.sessions[sessionId].status, "PAUSED");
  assert.equal(d.sessions[sessionId].activeMs, 61500);
  call(d, "resumeRun", { sessionId, occurredAt: t0 + 71000 }, t0 + 70000);
  assert.equal(d.sessions[sessionId].status, "ACTIVE");
  const result = call(d, "finishRun", { sessionId, expectedTrackCount: 1, occurredAt: t0 + 81000 }, t0 + 80000);
  assert.equal(result.activeMs, 71500);
  assert.equal(d.sessions[sessionId].endedAt, t0 + 81000);
});

test("기기 시계의 2초 허용 범위를 넘거나 마지막 위치보다 이른 조작은 거절한다", () => {
  const d = db();
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, t0);
  const { sessionId } = call(d, "startRun", { mode: "RUN", loc: loc(t0) }, t0);
  call(d, "appendTrack", { sessionId, points: [{ lat: 37.6195, lng: 127.05, accuracyM: 5, recordedAt: t0 + 61000 }] }, t0 + 60000);
  assert.throws(() => call(d, "pauseRun", { sessionId, occurredAt: t0 + 61000 }, t0 + 60000), /INVALID_ARGUMENT/);
  assert.throws(() => call(d, "pauseRun", { sessionId, occurredAt: t0 + 62001 }, t0 + 60000), /INVALID_ARGUMENT/);
  call(d, "pauseRun", { sessionId, occurredAt: t0 + 62000 }, t0 + 60000);
  assert.throws(() => call(d, "resumeRun", { sessionId, occurredAt: t0 + 72001 }, t0 + 70000), /INVALID_ARGUMENT/);
  call(d, "resumeRun", { sessionId, occurredAt: t0 + 72000 }, t0 + 70000);
  assert.throws(() => call(d, "finishRun", { sessionId, occurredAt: t0 + 82001 }, t0 + 80000), /INVALID_ARGUMENT/);
});

test("시계 오차가 있는 재개 직후 시각을 생략해 종료해도 활동 시간은 음수가 되지 않는다", () => {
  const d = db();
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, t0);
  const { sessionId } = call(d, "startRun", { mode: "WALK", loc: loc(t0) }, t0);
  call(d, "pauseRun", { sessionId, occurredAt: t0 + 61000 }, t0 + 60000);
  call(d, "resumeRun", { sessionId, occurredAt: t0 + 72000 }, t0 + 70000);
  const result = call(d, "finishRun", { sessionId }, t0 + 70001);
  assert.equal(result.activeMs, 61000);
  assert.equal(d.sessions[sessionId].endedAt, t0 + 72000);
});

test("늦게 도착한 일시정지·재개는 실제 시각으로 기록되어 활동 시간이 부풀지 않는다", () => {
  const d = db();
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, t0);
  const { sessionId } = call(d, "startRun", { mode: "WALK", loc: loc(t0) }, t0);
  call(d, "appendTrack", { sessionId, points: [{ lat: 37.6195, lng: 127.05, accuracyM: 5, recordedAt: t0 + 60000 }] }, t0 + 61000);
  // 실제로는 2분에 멈췄지만 요청은 10분에 도착
  call(d, "pauseRun", { sessionId, occurredAt: t0 + 120000 }, t0 + 600000);
  assert.equal(d.sessions[sessionId].activeMs, 120000);
  call(d, "resumeRun", { sessionId, occurredAt: t0 + 700000 }, t0 + 800000);
  const r = call(d, "finishRun", { sessionId, expectedTrackCount: 1 }, t0 + 760000 + 100000);
  assert.equal(r.activeMs, 120000 + 160000);
});

test("occurredAt은 마지막 위치점 이전·미래·일시정지 이전으로 보낼 수 없다", () => {
  const d = db();
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, t0);
  const { sessionId } = call(d, "startRun", { mode: "RUN", loc: loc(t0) }, t0);
  call(d, "appendTrack", { sessionId, points: [{ lat: 37.6195, lng: 127.05, accuracyM: 5, recordedAt: t0 + 60000 }] }, t0 + 61000);
  assert.throws(() => call(d, "pauseRun", { sessionId, occurredAt: t0 + 30000 }, t0 + 90000), /INVALID_ARGUMENT/);
  assert.throws(() => call(d, "pauseRun", { sessionId, occurredAt: t0 + 999999 }, t0 + 90000), /INVALID_ARGUMENT/);
  call(d, "pauseRun", { sessionId, occurredAt: t0 + 80000 }, t0 + 90000);
  assert.throws(() => call(d, "resumeRun", { sessionId, occurredAt: t0 + 70000 }, t0 + 95000), /INVALID_ARGUMENT/);
  // 생략하면 기존처럼 서버 수신 시각
  call(d, "resumeRun", { sessionId }, t0 + 95000);
  assert.equal(d.sessions[sessionId].lastResumeAt, t0 + 95000);
});

test("오프라인에서 1분에 종료하고 10분 뒤 도착해도 활동 시간은 1분이다", () => {
  const d = db();
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, t0);
  const { sessionId } = call(d, "startRun", { mode: "RUN", loc: loc(t0) }, t0);
  call(d, "appendTrack", { sessionId, points: [{ lat: 37.6195, lng: 127.05, accuracyM: 5, recordedAt: t0 + 50000 }] }, t0 + 51000);
  const r = call(d, "finishRun", { sessionId, expectedTrackCount: 1, occurredAt: t0 + 60000 }, t0 + 600000);
  assert.equal(r.activeMs, 60000);
  assert.equal(r.status, "COMPLETED");
  assert.equal(d.sessions[sessionId].endedAt, t0 + 60000);
  // 마지막 위치점 이전·미래 시각은 거절
  const s2 = call(d, "startRun", { mode: "RUN", loc: loc(t0 + 700000) }, t0 + 700000).sessionId;
  call(d, "appendTrack", { sessionId: s2, points: [{ lat: 37.6195, lng: 127.05, accuracyM: 5, recordedAt: t0 + 760000 }] }, t0 + 761000);
  assert.throws(() => call(d, "finishRun", { sessionId: s2, occurredAt: t0 + 750000 }, t0 + 800000), /INVALID_ARGUMENT/);
  assert.throws(() => call(d, "discardRun", { sessionId: s2, occurredAt: t0 + 900000 }, t0 + 800000), /INVALID_ARGUMENT/);
});

test("일시정지 중 늦게 도착한 종료는 일시정지 시작 이후 시각만 받고 활동 시간을 늘리지 않는다", () => {
  const d = db();
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, t0);
  const { sessionId } = call(d, "startRun", { mode: "WALK", loc: loc(t0) }, t0);
  call(d, "pauseRun", { sessionId, occurredAt: t0 + 120000 }, t0 + 121000);
  assert.throws(() => call(d, "finishRun", { sessionId, occurredAt: t0 + 100000 }, t0 + 900000), /INVALID_ARGUMENT/);
  const r = call(d, "finishRun", { sessionId, occurredAt: t0 + 180000 }, t0 + 900000);
  assert.equal(r.activeMs, 120000);
  const s = d.sessions[sessionId];
  assert.deepEqual(s.pauses.at(-1), { from: t0 + 120000, to: t0 + 180000 });
  assert.equal(s.endedAt, t0 + 180000);
});

test("같은 요청 ID로 종료를 재시도하면 같은 결과, 내용이 다르면 REQUEST_CONFLICT", () => {
  const d = db();
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, t0);
  const { sessionId } = call(d, "startRun", { mode: "RUN", loc: loc(t0) }, t0);
  const id = crypto.randomUUID();
  const fin = (data, t) => execute(d, { uid: "u" }, "finishRun", { clientRequestId: id, ...data }, t);
  const a = fin({ sessionId, expectedTrackCount: 0, occurredAt: t0 + 60000 }, t0 + 300000);
  const b = fin({ sessionId, expectedTrackCount: 0, occurredAt: t0 + 60000 }, t0 + 900000);
  assert.deepEqual(b, a);
  assert.equal(d.sessions[sessionId].activeMs, 60000);
  assert.throws(() => fin({ sessionId, expectedTrackCount: 0, occurredAt: t0 + 70000 }, t0 + 900000), /REQUEST_CONFLICT/);
  assert.equal(d.sessions[sessionId].status, "COMPLETED");
});

test("Emulator 사진 URL 호스트는 요청 Host(형식 검사)만 따르고, 이상하면 기본값", () => {
  const { localPhotoBase } = require("../src/local-photo");
  assert.equal(localPhotoBase({ rawRequest: { headers: { host: "10.0.2.2:5001" } } }), "http://10.0.2.2:5001");
  assert.equal(localPhotoBase({ rawRequest: { headers: { host: "evil.example/x?y=:5001" } } }), "http://127.0.0.1:5001");
  assert.equal(localPhotoBase(undefined), "http://127.0.0.1:5001");
});

test("만료된 촬영 티켓·봉인 전·처리 전 사진은 유효한 사진 참여로 제출되지 않는다", () => {
  const d = db();
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, t0);
  const a = call(d, "issueCaptureTicket", { purpose: "DISCOVERY", categoryCode: "LITTER", loc: loc(t0) }, t0);
  // 15분이 지난 뒤 봉인 → 만료
  assert.throws(() => call(d, "sealCapture", { ticketId: a.ticketId, loc: loc(t0 + 16 * 60000) }, t0 + 16 * 60000), /CAPTURE_TICKET_EXPIRED/);
  const photo = { categoryCode: "LITTER", modality: "PHOTO", pin: [37.62, 127.05] };
  assert.throws(() => call(d, "createIssue", { ...photo, ticketId: a.ticketId }, t0 + 16 * 60000), /PHOTO_REQUIRED/);
  // 봉인은 됐지만 서버가 사진을 확인(READY)하기 전
  const b = call(d, "issueCaptureTicket", { purpose: "DISCOVERY", categoryCode: "LITTER", loc: loc(t0) }, t0);
  call(d, "sealCapture", { ticketId: b.ticketId, loc: loc(t0 + 1000) }, t0 + 1000);
  assert.throws(() => call(d, "createIssue", { ...photo, ticketId: b.ticketId }, t0 + 2000), /PHOTO_NOT_READY/);
  // 같은 티켓을 새 요청으로 다시 봉인할 수 없다(응답을 잃으면 같은 요청 ID로만 복구)
  assert.throws(() => call(d, "sealCapture", { ticketId: b.ticketId, loc: loc(t0 + 3000) }, t0 + 3000), /CAPTURE_TICKET_EXPIRED/);
});

test("봉인 응답을 잃어도 같은 요청 ID·같은 위치로 다시 보내면 같은 촬영 시각을 돌려받는다", () => {
  const d = db();
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, t0);
  const { ticketId } = call(d, "issueCaptureTicket", { purpose: "DISCOVERY", categoryCode: "LITTER", loc: loc(t0) }, t0);
  const seal = { ticketId, loc: loc(t0 + 1000), clientRequestId: "seal-1" };
  const first = execute(d, { uid: "u" }, "sealCapture", seal, t0 + 1000);
  const again = execute(d, { uid: "u" }, "sealCapture", seal, t0 + 5000);
  assert.deepEqual(again, first);
  assert.equal(d.tickets[ticketId].shutterAt, t0 + 1000);
});

test("테스트 소식: 게시한 글만 getRiverFeed에 나오고, 같은 ID로 다시 넣어도 늘지 않으며 다른 소식은 그대로", () => {
  const { readModel } = require("../src/service");
  const d = db();
  const admin = { uid: "a", admin: true };
  const run = (name, x) => execute(d, admin, name, { clientRequestId: crypto.randomUUID(), ...x }, t0);
  d.news.keep = { id: "keep", title: "기존 소식", body: "", published: true, publishedAt: t0 - 1, createdAt: t0 - 1, updatedAt: t0 - 1 };
  run("upsertNews", { id: "test-news-eco", title: "[테스트] 생태", body: "긴 요약", summary: "긴 요약", topic: "eco", status: "테스트" });
  let feed = readModel(d, { uid: "u" }, "getRiverFeed", { limit: 50 }, t0).news.items.map((n) => n.id);
  assert.deepEqual(feed, ["keep"]);
  run("setNewsPublished", { id: "test-news-eco", published: true });
  run("upsertNews", { id: "test-news-eco", title: "[테스트] 생태(수정)", body: "긴 요약", summary: "긴 요약", topic: "eco", status: "테스트" });
  feed = readModel(d, { uid: "u" }, "getRiverFeed", { limit: 50 }, t0).news.items;
  assert.equal(feed.length, 2);
  assert.equal(feed.find((n) => n.id === "test-news-eco").title, "[테스트] 생태(수정)");
  assert.equal(d.news.keep.title, "기존 소식");
  assert.throws(() => execute(d, { uid: "u" }, "upsertNews", { id: "x", title: "t", body: "b", clientRequestId: "n1" }, t0), /PERMISSION_DENIED/);
});

test("참여 기록 목록·운동 상세의 참여 행에 관찰 종류(categoryCode)가 붙는다", () => {
  const { readModel } = require("../src/service");
  const d = db();
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, t0);
  const { sessionId } = call(d, "startRun", { mode: "WALK", loc: loc(t0) }, t0);
  call(d, "createIssue", { categoryCode: "LITTER", modality: "QUICK", pin: [37.62, 127.05], loc: loc(t0 + 1000), sessionId }, t0 + 1000);
  const rec = readModel(d, { uid: "u" }, "getRecords", {}, t0 + 2000).participations.items[0];
  assert.equal(rec.categoryCode, "LITTER");
  const run = readModel(d, { uid: "u" }, "getRunDetail", { sessionId }, t0 + 2000).participations.items[0];
  assert.equal(run.categoryCode, "LITTER");
});
