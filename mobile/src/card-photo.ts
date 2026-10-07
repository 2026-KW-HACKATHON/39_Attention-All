// 카메라가 Android Activity를 다시 만들더라도 돌아갈 운동과 사진을 잃지 않는다.
import type { CARD_PHOTOS } from './content';
export type CardPic = { kind: 'default'; key: (typeof CARD_PHOTOS)[number] } | { kind: 'user'; uri: string; w: number; h: number } | { kind: 'none' };
export type CardDraft = { id: string; pic: CardPic | null; tone: 'light' | 'dark'; view: { zoom: number; fx: number; fy: number } };
export type CardJournal = CardDraft & { pending: boolean };
type PickerResult = { canceled?: boolean; assets?: { uri: string; width: number; height: number }[] | null } | null;
type Dependencies = { uid: () => string | null; read: (uid: string) => CardJournal | null; write: (uid: string, journal: CardJournal) => boolean; pending: () => Promise<PickerResult> };
function selected(draft: CardDraft, result: PickerResult): CardDraft {
  const asset = result && result.canceled === false ? result.assets?.[0] : null;
  if (!asset || !asset.uri || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) return draft;
  return { ...draft, pic: { kind: 'user', uri: asset.uri, w: asset.width, h: asset.height }, view: { zoom: 1, fx: .5, fy: .5 } };
}
export function createCardPhotoFlow(deps: Dependencies) {
  let active = false;
  const save = (uid: string, value: CardJournal) => { if (!deps.write(uid, value)) throw Error('CARD_SAVE_FAILED'); };
  return {
    async pick(draft: CardDraft, launch: () => Promise<PickerResult>): Promise<CardDraft | null> {
      const uid = deps.uid();
      if (!uid || active) return null;
      active = true;
      try {
        save(uid, { ...draft, pending: true });
        const result = await launch();
        const next = deps.uid() === uid ? selected(draft, result) : draft;
        save(uid, { ...next, pending: false });
        return deps.uid() === uid ? next : null;
      } catch (error) {
        deps.write(uid, { ...draft, pending: false });
        throw error;
      } finally { active = false; }
    },
    async recover(): Promise<CardDraft | null> {
      const uid = deps.uid();
      if (!uid || active) return null;
      const journal = deps.read(uid);
      if (!journal?.pending) return null;
      active = true;
      const draft: CardDraft = { id: journal.id, pic: journal.pic, tone: journal.tone, view: journal.view };
      try {
        // 정상 복귀는 pick에서 처리하고, JS가 다시 만들어진 경우만 여기서 복구한다.
        const result = await deps.pending();
        const next = deps.uid() === uid ? selected(draft, result) : draft;
        save(uid, { ...next, pending: false });
        return deps.uid() === uid ? next : null;
      } finally { active = false; }
    },
  };
}
