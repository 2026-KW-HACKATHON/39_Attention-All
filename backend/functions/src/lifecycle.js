const P = require("./policy.cjs");
function commitPhoto(d, photo) {
  const ticket = d.tickets[photo.id],
    current = d.photos[photo.id];
  if (
    !ticket ||
    ticket.uid !== photo.uid ||
    d.deletionJobs[photo.uid] ||
    current?.status === "DELETE_PENDING"
  )
    return false;
  if (current?.status === "READY") return true;
  if (ticket.consumed) return false;
  d.photos[photo.id] = photo;
  return true;
}
function failPhoto(d, photo) {
  const current = d.photos[photo.id];
  if (
    d.deletionJobs[photo.uid] ||
    !d.tickets[photo.id] ||
    ["READY", "DELETE_PENDING"].includes(current?.status)
  )
    return false;
  d.photos[photo.id] = { ...photo, status: "FAILED" };
  return true;
}
function retentionBatch(d, now, limit = 80) {
  let changed = P.expirePending(d, now, limit);
  const act = (fn) => {
    if (changed >= limit) return;
    fn();
    changed++;
  };
  for (const p of Object.values(d.photos))
    if (now - p.createdAt > 90 * P.DAY && p.status !== "DELETE_PENDING")
      act(() => {
        p.status = "DELETE_PENDING";
        p.publicApproved = false;
      });
  for (const s of Object.values(d.sessions))
    if (now - s.startedAt > 90 * P.DAY && s.track.length)
      act(() => {
        s.track = [];
      });
  for (const [key, t] of Object.entries(d.tickets))
    if (now - (t.shutterAt || t.issuedAt) > 90 * P.DAY)
      act(() => delete d.tickets[key]);
  for (const [key, r] of Object.entries(d.receipts))
    if (now - r.createdAt > 30 * P.DAY) act(() => delete d.receipts[key]);
  return { changed, done: changed < limit };
}
module.exports = { commitPhoto, failPhoto, retentionBatch };
