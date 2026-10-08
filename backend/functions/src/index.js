const { initializeApp, getApps } = require("firebase-admin/app");
if (!getApps().length) initializeApp();
const { getAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const sharp = require("sharp");
const { randomUUID } = require("node:crypto");
const { readModel, READS, MUTATIONS } = require("./service");
const V = require("./validation");
const P = require("./policy.cjs");
const Store = require("./store");
const Life = require("./lifecycle");
const { cleanupAccountBatch } = require("./service");
const REGION = "asia-northeast3";
const emulator = process.env.FUNCTIONS_EMULATOR === "true";
const options = {
  region: REGION,
  serviceAccount: emulator ? undefined : "uirun-runtime@uirun-92539.iam.gserviceaccount.com",
  enforceAppCheck: !emulator,
  maxInstances: 5,
  memory: "512MiB",
  timeoutSeconds: 120,
};
function context(req) {
  return { uid: req.auth?.uid, admin: req.auth?.token?.admin === true };
}
function error(e) {
  if (e instanceof HttpsError) return e;
  if (e instanceof V.DomainError)
    return new HttpsError(
      e.code === "UNAUTHENTICATED"
        ? "unauthenticated"
        : e.code === "PERMISSION_DENIED"
          ? "permission-denied"
          : e.code === "NOT_FOUND"
            ? "not-found"
            : "failed-precondition",
      e.code,
      e.details,
    );
  console.error("uirun backend failure", e.message);
  return new HttpsError("internal", "SERVER_ERROR");
}
function data(req) {
  const d = req.data;
  if (
    !d ||
    typeof d !== "object" ||
    Array.isArray(d) ||
    JSON.stringify(d).length > 200000
  )
    throw new HttpsError("invalid-argument", "INVALID_ARGUMENT");
  return d;
}
for (const name of READS)
  exports[name] = onCall(options, async (req) => {
    try {
      const x = data(req);
      return await Store.read((d) =>
        readModel(d, context(req), name, x, Date.now()),
      );
    } catch (e) {
      throw error(e);
    }
  });
for (const name of MUTATIONS)
  exports[name] = onCall(options, async (req) => {
    try {
      if (name === "setPhotoPublication") return await require("./photo-callables").publish(context(req),data(req));
      return await Store.mutate(context(req), name, data(req));
    } catch (e) {
      throw error(e);
    }
  });
// GPS client coordinates remain assertions, not cryptographic proof. Auth, App Check,
// server time, ticket ownership and exact Scope provide basic enforcement only.
exports.getPhotoAccess = onCall(options, async (req) => {
  try {
    const x = data(req);
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "UNAUTHENTICATED");
    const photo = await Store.read((d) => {
      if (d.deletionJobs[uid]) V.fail("ACCOUNT_DELETING");
      const p = d.photos[x.photoId];
      if (p && d.deletionJobs[p.uid]) V.fail("NOT_FOUND");
      if (!p || p.status !== "READY") V.fail("NOT_FOUND");
      if (p.uid !== uid && req.auth.token.admin !== true) V.fail("PERMISSION_DENIED");
      return {
        path:
          p.uid === uid || req.auth.token.admin === true
            ? p.processedPath
            : p.thumbnailPath,
      };
    });
    if (emulator && process.env.GCLOUD_PROJECT === "demo-uirun") {
      const token = require("./local-photo").signLocalPhoto(uid, x.photoId);
      return {url: `${require("./local-photo").localPhotoBase(req)}/demo-uirun/${REGION}/localPhoto?token=${encodeURIComponent(token)}`, expiresInSec:300};
    }
    const [url] = await getStorage()
      .bucket()
      .file(photo.path)
      .getSignedUrl({ action: "read", expires: Date.now() + 5 * 60000 });
    return { url, expiresInSec: 300 };
  } catch (e) {
    throw error(e);
  }
});
// Local emulation cannot call IAM signBlob. This route exists only in demo-uirun.
if (emulator && process.env.GCLOUD_PROJECT === "demo-uirun") exports.localPhoto = onRequest({region:REGION,cors:true},async(req,res)=>{
  try {
    const claim=require("./local-photo").verifyLocalPhoto(req.query.token);
    const path=await Store.read(d=>{if(claim.kind==="PUBLIC")return require("./public-photo").access(d,claim.photoId,Date.now()).path;const p=d.photos[claim.photoId];if(!p||p.status!=="READY"||d.deletionJobs[p.uid]||d.deletionJobs[claim.uid])throw Error("DENIED");return p.processedPath});
    const [bytes]=await getStorage().bucket().file(path).download();res.set("Cache-Control","no-store").type("image/jpeg").send(bytes);
  }catch{res.status(403).send("PHOTO_ACCESS_DENIED")}
});
exports.getPublicPhotoAccess=onCall(options,async req=>{try{const x=data(req);return await require("./photo-callables").access(V.text(x.photoId,100),req);}catch(e){throw error(e)}});
exports.processEvidence = onObjectFinalized(
  { region: REGION, serviceAccount: emulator ? undefined : "uirun-runtime@uirun-92539.iam.gserviceaccount.com", memory: "1GiB", timeoutSeconds: 120, maxInstances: 3 },
  async (event) => {
    const obj = event.data,
      name = obj.name || "";
    const m = /^evidence\/([^/]+)\/([^/]+)\/original\.jpg$/.exec(name);
    if (!m) return;
    const [, uid, id] = m;
    const bucket = getStorage().bucket(obj.bucket),
      file = bucket.file(name, { generation: obj.generation });
    const state = await Store.read((d) => {
      const ticket = d.tickets[id],
        photo = d.photos[id];
      return {
        ready:
          photo?.uid === uid &&
          photo.status === "READY" &&
          !d.deletionJobs[uid],
        valid:
          !!ticket &&
          !d.deletionJobs[uid] &&
          photo?.status !== "DELETE_PENDING" &&
          ticket.uid === uid &&
          !!ticket.shutterAt &&
          Date.now() <= ticket.shutterAt + 60 * 60000 &&
          !ticket.consumed,
      };
    });
    if (state.ready) return;
    if (
      !state.valid ||
      Number(obj.size) > 5 * 1024 * 1024 ||
      obj.contentType !== "image/jpeg"
    ) {
      await file.delete({ ignoreNotFound: true });
      return;
    }
    try {
      const [bytes] = await file.download();
      const input = sharp(bytes, { limitInputPixels: 40000000 });
      const metadata = await input.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format))
        throw Error("INVALID_IMAGE");
      const processed = await input
        .rotate()
        .resize({
          width: 1920,
          height: 1920,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82 })
        .toBuffer();
      const thumb = await sharp(processed)
        .resize(240, 240, { fit: "cover" })
        .jpeg({ quality: 75 })
        .toBuffer();
      const processedPath = `processed/${uid}/${id}.jpg`,
        thumbnailPath = `thumbnails/${id}.jpg`;
      await bucket.file(processedPath).save(processed, {
        metadata: {
          contentType: "image/jpeg",
          cacheControl: "private,max-age=0",
        },
      });
      await bucket.file(thumbnailPath).save(thumb, {
        metadata: {
          contentType: "image/jpeg",
          cacheControl: "private,max-age=0",
        },
      });
      const saved = await Store.transact((d) => ({
        ok: Life.commitPhoto(d, {
          id,
          uid,
          status: "READY",
          publicApproved: false,
          originalPath: name,
          processedPath,
          thumbnailPath,
          capturedAt: d.tickets[id]?.shutterAt,
          createdAt: Date.now(),
          generation: obj.generation,
        }),
      }));
      if (!saved.ok) {
        for (const path of [name, processedPath, thumbnailPath])
          await bucket.file(path).delete({ ignoreNotFound: true });
      }
    } catch (e) {
      console.error("evidence processing failed", id, e.message);
      await Store.transact((d) => ({
        ok: Life.failPhoto(d, {
          id,
          uid,
          publicApproved: false,
          originalPath: name,
          processedPath: `processed/${uid}/${id}.jpg`,
          thumbnailPath: `thumbnails/${id}.jpg`,
          createdAt: Date.now(),
        }),
      }));
    }
  },
);
exports.hourlyMaintenance = onSchedule(
  {
    serviceAccount: emulator ? undefined : "uirun-runtime@uirun-92539.iam.gserviceaccount.com",
    schedule: "every 60 minutes",
    timeZone: "Asia/Seoul",
    region: REGION,
    timeoutSeconds: 540,
  },
  async () => {
    const deadline = Date.now() + 480000;
    for (let pass = 0; pass < 20 && Date.now() < deadline; pass++) {
      const result = await Store.transact((d) =>
        Life.retentionBatch(d, Date.now()),
      );
      if (result.done) break;
    }
    const accounts = await Store.read((d) =>
      Object.values(d.deletionJobs).filter((j) => j.status === "PENDING"),
    );
    for (const job of accounts) {
      for (let pass = 0; pass < 20 && Date.now() < deadline; pass++) {
        const result = await Store.transact((d) =>
          cleanupAccountBatch(d, job.uid),
        );
        if (result.done) break;
      }
    }
    const retired=await Store.read(d=>Object.values(d.photos).filter(p=>p.retiredPublicPaths?.length).map(p=>p.id));
    for(const id of retired)await require("./photo-callables").cleanupRetired(id);
    await require("./photo-callables").cleanupOrphans(deadline);
    const photos = await Store.read((d) =>
      Object.values(d.photos).filter((p) => p.status === "DELETE_PENDING"),
    );
    for (const p of photos) {
      if (Date.now() >= deadline) break;
      try {
        for (const path of [
          p.originalPath,
          p.processedPath,
          p.thumbnailPath,
          p.publicPath,
          ...(p.retiredPublicPaths||[]),
        ].filter(Boolean))
          await getStorage()
            .bucket()
            .file(path)
            .delete({ ignoreNotFound: true });
        await Store.transact((d) => {
          if (d.photos[p.id]?.status === "DELETE_PENDING")
            delete d.photos[p.id];
          return { ok: true };
        });
      } catch (e) {
        console.error("photo cleanup will retry", p.id, e.message);
      }
    }
    for (const job of accounts) {
      if (Date.now() >= deadline) break;
      const ready = await Store.read(
        (d) =>
          !!d.deletionJobs[job.uid]?.dataCleaned &&
          !Object.values(d.photos).some((p) => p.uid === job.uid),
      );
      if (!ready) continue;
      try {
        await getAuth().deleteUser(job.uid);
      } catch (e) {
        if (e.code !== "auth/user-not-found") {
          console.error("account cleanup will retry", e.message);
          continue;
        }
      }
      await Store.transact((d) => {
        d.deletionJobs[job.uid].status = "COMPLETE";
        return { ok: true };
      });
    }
  },
);
exports.getWeather = onCall(
  { ...options, enforceAppCheck: !emulator },
  async () => require("./weather").getWeather(),
);
exports.getPhotoStatus = onCall(options, async (req) => {
  try {
    if (!req.auth?.uid)
      throw new HttpsError("unauthenticated", "UNAUTHENTICATED");
    return await Store.read((d) => {
      if (d.deletionJobs[req.auth.uid]) V.fail("ACCOUNT_DELETING");
      const id = data(req).ticketId;
      const ticket = d.tickets[id];
      if (!ticket || ticket.uid !== req.auth.uid) V.fail("NOT_FOUND");
      return { status: d.photos[id]?.status || "AWAITING_UPLOAD" };
    });
  } catch (e) {
    throw error(e);
  }
});

// Credentials are supplied only to this function from Firebase Secret Manager.
const { defineSecret } = require('firebase-functions/params');
const adminId = defineSecret('UIRUN_ADMIN_ID');
const adminPassword = defineSecret('UIRUN_ADMIN_PASSWORD');
exports.adminLogin = onCall({...options, enforceAppCheck:false, secrets:[adminId, adminPassword]}, async req=>{
  const {validAdminCredentials}=require('./admin-login');
  const {createHash}=require('node:crypto');
  const f=require('firebase-admin/firestore').getFirestore();
  const key=createHash('sha256').update(req.rawRequest.ip||'unknown').digest('hex');
  const attempt=f.doc('adminLoginAttempts/'+key), now=Date.now();
  await f.runTransaction(async tx=>{
    const old=(await tx.get(attempt)).data();
    const count=old&&now-old.startedAt<60000?old.count:0;
    if(count>=10)throw new HttpsError('resource-exhausted','잠시 후 다시 로그인해주세요.');
    tx.set(attempt,{count:count+1,startedAt:count?old.startedAt:now});
  });
  if(!validAdminCredentials(req.data))throw new HttpsError('unauthenticated','아이디 또는 비밀번호가 올바르지 않습니다.');
  return {token:await getAuth().createCustomToken('uirun-fixed-admin',{admin:true})};
});
