import { CARD_PHOTOS } from './content';
import * as ImagePicker from 'expo-image-picker';
import { createCardPhotoFlow, type CardDraft, type CardJournal } from './card-photo';
import { getUid } from './session';
import { readJson, writeJson } from './store';
const listeners = new Set<() => void>();
const name = (uid: string) => `card-draft-${uid}.json`;
function read(uid: string): CardJournal | null {
  try {
    const draft = readJson<CardJournal | null>(name(uid), null);
    if (!draft || typeof draft.id !== 'string' || typeof draft.pending !== 'boolean' || !draft.view || !['light', 'dark'].includes(draft.tone)) return null;
    if (![draft.view.zoom, draft.view.fx, draft.view.fy].every(Number.isFinite)) return null;
    const pic = draft.pic;
    if (pic && pic.kind === 'default' && !(CARD_PHOTOS as readonly string[]).includes(pic.key)) return null;
    if (pic && pic.kind === 'user' && (typeof pic.uri !== 'string' || ![pic.w, pic.h].every(n => Number.isFinite(n) && n > 0))) return null;
    if (pic && !['default', 'user', 'none'].includes(pic.kind)) return null;
    return draft;
  } catch { return null; } // 저장 문제는 공통 StoreBanner에서 안내한다.
}
export function readCardDraft(id?: string): CardJournal | null {
  const uid = getUid();
  const draft = uid ? read(uid) : null;
  return draft && (!id || id === draft.id) ? draft : null;
}
const write = (uid: string, draft: CardJournal) => {
  const ok = writeJson(name(uid), draft);
  if (ok) listeners.forEach(fn => fn());
  return ok;
};
export const subscribeCardDraft = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function saveCardDraft(draft: CardDraft) {
  const uid = getUid();
  return !!uid && write(uid, { ...draft, pending: false });
}
export const cardPhotoFlow = createCardPhotoFlow({
  uid: getUid,
  read,
  write,
  // 기록카드 촬영을 저장한 경우에만 SDK 복구 결과를 가져온다.
  pending: async () => {
    const result = await ImagePicker.getPendingResultAsync();
    return result && 'canceled' in result ? result : null;
  },
});
