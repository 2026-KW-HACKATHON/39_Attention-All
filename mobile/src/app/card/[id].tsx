// 사진 기록카드(웹 프로토타입 card): 사진 + 핵심 숫자 + 작은 우이런 로고. 4:5, 저장 이미지는 1080×1350.
// 고른 사진(촬영·앨범)은 이 기기에서 카드를 만드는 데만 쓰고 어디에도 올리지 않는다. 환경 제보 증거 사진과 무관하다
// (제보 사진은 capture.ts의 촬영 티켓·현장 촬영만). 기본 사진은 출처가 확인된 공공누리 사진만 쓰고 카드에 출처를 넣는다.
import { useRef, useState } from 'react';
import { Alert, Image, Pressable, View, useWindowDimensions, type GestureResponderEvent, type ImageSourcePropType } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy'; // SDK 57: 기본 경로의 함수형 API는 실행 시 예외(새 클래스 API로 이전 전까지 legacy 사용)
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useApi } from '../../session';
import { dur, km, pace } from '../../core';
import { CARD_PHOTOS, LOGO, MODE_LABEL, PHOTOS, coursePhoto } from '../../content';
import { color, font } from '../../theme';
import { Btn, Icon, LoadState, Micro, Notice, Num, Row, Rows, Screen, Seg, Sheet, Txt } from '../../ui';

type Run = { id: string; mode: 'RUN' | 'WALK'; startedAt: number; courseId: string | null; distanceM: number; activeMs: number };
type Pic = { kind: 'default'; key: (typeof CARD_PHOTOS)[number] } | { kind: 'user'; uri: string; w: number; h: number } | { kind: 'none' };
const kstDate = (t: number) => {
  const d = new Date(t + 9 * 3600000);
  return `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.`;
};
// 사진 배치: 화면 미리보기와 저장 이미지가 같은 값(zoom, fx, fy)을 쓴다(웹 coverBox)
const coverBox = (W: number, H: number, iw: number, ih: number, zoom: number, fx: number, fy: number) => {
  const k = Math.max(W / iw, H / ih) * zoom, dw = iw * k, dh = ih * k;
  return { dw, dh, x: (W - dw) * fx, y: (H - dh) * fy };
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const defaultPic = (courseId: string | null): Pic => {
  const p = coursePhoto(courseId ?? '');
  const key = (Object.keys(PHOTOS) as (keyof typeof PHOTOS)[]).find(k => PHOTOS[k] === p);
  return key && (CARD_PHOTOS as readonly string[]).includes(key) ? { kind: 'default', key: key as (typeof CARD_PHOTOS)[number] } : { kind: 'default', key: 'river' };
};

export default function CardScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi<Run>('getRunDetail', { sessionId: id }, true);
  const [pic, setPic] = useState<Pic | null>(null);
  const [tone, setTone] = useState<'light' | 'dark'>('light');
  const [view, setView] = useState({ zoom: 1, fx: 0.5, fy: 0.5 });
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const shot = useRef<View>(null);
  const W = width - 40, H = W * 1.25;
  const r = q.data;
  const cur = pic ?? (r ? defaultPic(r.courseId) : null);
  const src: ImageSourcePropType | null = !cur || cur.kind === 'none' ? null : cur.kind === 'user' ? { uri: cur.uri } : PHOTOS[cur.key].src;
  const size = !cur || cur.kind === 'none' ? null : cur.kind === 'user' ? { w: cur.w, h: cur.h } : { w: PHOTOS[cur.key].w, h: PHOTOS[cur.key].h };
  const box = size ? coverBox(W, H, size.w, size.h, view.zoom, view.fx, view.fy) : null;
  // 끌어서 위치 맞추기(웹 pointer 드래그와 같은 식)
  const [drag, setDrag] = useState<{ x: number; y: number; fx: number; fy: number; ox: number; oy: number } | null>(null);
  const dragProps = {
    onStartShouldSetResponder: () => !!box,
    onMoveShouldSetResponder: () => !!box,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => box && setDrag({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, fx: view.fx, fy: view.fy, ox: W - box.dw, oy: H - box.dh }),
    onResponderMove: (e: GestureResponderEvent) => {
      if (!drag) return;
      const dx = e.nativeEvent.pageX - drag.x, dy = e.nativeEvent.pageY - drag.y;
      setView(v => ({ ...v, fx: drag.ox < 0 ? clamp01(drag.fx + dx / drag.ox) : v.fx, fy: drag.oy < 0 ? clamp01(drag.fy + dy / drag.oy) : v.fy }));
    },
    onResponderRelease: () => setDrag(null),
  };

  if (!r || !cur)
    return (
      <Screen title="사진 기록카드" onClose={() => router.back()}>
        <LoadState loading={q.loading} error={q.error} onRetry={() => void q.reload()} />
      </Screen>
    );

  const choose = (p: Pic) => {
    setPic(p);
    setView({ zoom: 1, fx: 0.5, fy: 0.5 });
    if (p.kind === 'none') setTone('light');
    setSheet(false);
  };
  const pickUser = async (camera: boolean) => {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('카메라 권한이 없어 촬영할 수 없어요.');
    }
    const res = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, exif: false })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, exif: false });
    const a = !res.canceled ? res.assets[0] : null;
    if (a) choose({ kind: 'user', uri: a.uri, w: a.width, h: a.height }); // 고르지 않고 닫으면 그대로
  };
  const render = () => captureRef(shot, { format: 'png', width: 1080, height: 1350, result: 'tmpfile' });
  const save = async () => {
    setBusy('save');
    setMsg(null);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) throw new Error('PERMISSION');
      await MediaLibrary.saveToLibraryAsync(await render());
      setMsg({ kind: 'ok', text: '기록카드 이미지를 사진 앱에 저장했어요.' });
    } catch (e) {
      if (__DEV__) console.warn('[uirun] 기록카드 저장 실패', String((e as Error)?.message ?? e));
      setMsg({ kind: 'err', text: (e as Error)?.message === 'PERMISSION' ? '사진 저장 권한이 없어 저장하지 못했어요.' : '이미지를 만들지 못했어요. 다시 시도해 주세요.' });
    }
    setBusy(null);
  };
  const share = async () => {
    setBusy('share');
    setMsg(null);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('UNAVAILABLE');
      await Sharing.shareAsync(await render(), { mimeType: 'image/png', dialogTitle: '우이런 기록' });
    } catch (e) {
      if (__DEV__) console.warn('[uirun] 기록카드 공유 실패', String((e as Error)?.message ?? e));
      setMsg({ kind: 'err', text: (e as Error)?.message === 'UNAVAILABLE' ? '이 기기에서는 공유를 쓸 수 없어요. 저장을 이용해 주세요.' : '공유하지 못했어요.' });
    }
    setBusy(null);
  };

  const light = tone === 'light', ink = light ? color.white : color.black;
  const credit = cur.kind === 'default' ? `사진: ${PHOTOS[cur.key].credit}(${PHOTOS[cur.key].license})` : null;
  const pad = W * 0.067;
  return (
    <Screen
      title="사진 기록카드"
      onClose={() => router.back()}
      foot={
        <>
          <Btn kind="line" icon="download" label="저장" busy={busy === 'save'} disabled={!!busy} onPress={() => void save()} />
          <Btn kind="blue" icon="share" label="공유" busy={busy === 'share'} disabled={!!busy} onPress={() => void share()} style={{ flex: 1 }} />
        </>
      }>
      <View style={{ width: W, height: H, borderRadius: 16, overflow: 'hidden' }} {...dragProps}>
        <View ref={shot} collapsable={false} style={{ width: W, height: H, backgroundColor: color.deep }} accessibilityLabel="사진 기록카드 미리보기">
          {src && box ? (
            <Image source={src} accessibilityLabel="기록카드 배경 사진" style={{ position: 'absolute', width: box.dw, height: box.dh, left: box.x, top: box.y }} />
          ) : (
            <Svg width={W} height={H} style={{ position: 'absolute' }}>
              <Defs>
                <LinearGradient id="plain" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={color.blue} />
                  <Stop offset="1" stopColor={color.deep} />
                </LinearGradient>
              </Defs>
              <Rect width={W} height={H} fill="url(#plain)" />
            </Svg>
          )}
          {src ? (
            <Svg width={W} height={H * 0.58} style={{ position: 'absolute', top: H * 0.42 }}>
              <Defs>
                <LinearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={light ? '#111111' : '#FFFFFF'} stopOpacity={0} />
                  <Stop offset="1" stopColor={light ? '#111111' : '#FFFFFF'} stopOpacity={light ? 0.62 : 0.78} />
                </LinearGradient>
              </Defs>
              <Rect width={W} height={H * 0.58} fill="url(#shade)" />
            </Svg>
          ) : null}
          <Image source={light ? LOGO.light : LOGO.dark} accessibilityLabel="우이런" style={{ position: 'absolute', left: pad, top: pad, width: W * 0.24, height: (W * 0.24 * 142) / 480 }} />
          <View style={{ position: 'absolute', left: pad, right: pad, bottom: W * 0.05 }}>
            <Txt w={700} s={15} c={ink}>{kstDate(r.startedAt)} {MODE_LABEL[r.mode]}</Txt>
            <View style={{ marginTop: 4, marginBottom: 8 }}>
              <Num fixed s={Math.min(80, Math.max(60, W * 0.21))} c={ink} unit="km">{km(r.distanceM)}</Num>
            </View>
            <View style={{ flexDirection: 'row', gap: 20, alignItems: 'baseline' }}>
              <Txt w={600} s={13} c={ink}>
                <Txt s={24} c={ink} style={{ fontFamily: font.num }}>{dur(r.activeMs)} </Txt>시간
              </Txt>
              <Txt w={600} s={13} c={ink}>
                <Txt s={24} c={ink} style={{ fontFamily: font.num }}>{pace(r.activeMs, r.distanceM)} </Txt>/km
              </Txt>
            </View>
            {credit ? <Txt s={11} c={ink} style={{ opacity: 0.85, marginTop: 6 }}>{credit}</Txt> : null}
          </View>
        </View>
      </View>

      <View style={{ gap: 10, marginTop: 14 }}>
        <Btn kind="line" icon="image" label="사진 바꾸기" onPress={() => setSheet(true)} />
        <Seg label="글자 색" value={tone} onChange={setTone} options={[['light', '밝은 글자'], ['dark', '어두운 글자']]} />
        {src ? (
          <>
            <ZoomSlider value={view.zoom} onChange={zoom => setView(v => ({ ...v, zoom }))} />
            <Micro>사진을 끌어 위치를 맞춰요.</Micro>
          </>
        ) : null}
        <Micro>
          {cur.kind === 'user' ? '고른 사진은 이 기기에서 카드를 만드는 데만 쓰고, 어디에도 올리지 않아요.' : cur.kind === 'default' ? '기본 사진은 서울연구원 공공누리 사진이라 카드에 출처가 작게 들어가요.' : ''}
        </Micro>
        {msg ? <Notice kind={msg.kind} text={msg.text} /> : null}
      </View>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="사진 바꾸기">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, marginBottom: 12 }}>
          {CARD_PHOTOS.map(k => (
            <Pressable key={k} accessibilityRole="button" accessibilityLabel={PHOTOS[k].place} onPress={() => choose({ kind: 'default', key: k })} style={{ width: (W - 16) / 3, aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: color.bg }}>
              <Image source={PHOTOS[k].src} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={() => choose({ kind: 'none' })} style={{ width: (W - 16) / 3, aspectRatio: 1, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: color.blue }}>
            <Txt w={700} c={color.white}>사진 없이</Txt>
          </Pressable>
        </View>
        <Rows>
          <Row icon="camera" title="사진 촬영" onPress={() => void pickUser(true)} chev={false} />
          <Row icon="image" title="앨범에서 선택" onPress={() => void pickUser(false)} chev={false} />
        </Rows>
        <Micro>여기서 고른 사진은 기록카드에만 쓰여요. 환경 제보 사진으로는 쓸 수 없어요.</Micro>
      </Sheet>
    </Screen>
  );
}

// 확대 1~2.5배(웹 range input). 막대를 누르거나 끌어서 정한다.
function ZoomSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const set = (e: GestureResponderEvent) => w && onChange(Math.round((1 + 1.5 * clamp01(e.nativeEvent.locationX / w)) * 20) / 20);
  const pos = ((value - 1) / 1.5) * w;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Txt w={700}>확대</Txt>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="사진 확대"
        accessibilityValue={{ min: 100, max: 250, now: Math.round(value * 100), text: `${value.toFixed(2)}배` }}
        onAccessibilityAction={e => onChange(Math.min(2.5, Math.max(1, value + (e.nativeEvent.actionName === 'increment' ? 0.25 : -0.25))))}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onLayout={e => setW(e.nativeEvent.layout.width)}
        style={{ flex: 1, height: 44, justifyContent: 'center' }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={set}
        onResponderMove={set}>
        <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: color.line }}>
          <View style={{ width: pos, height: 4, borderRadius: 2, backgroundColor: color.blue }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: Math.max(0, pos - 11), width: 22, height: 22, borderRadius: 11, backgroundColor: color.blue, borderWidth: 3, borderColor: color.white }} />
      </View>
      <Icon name="plus" s={18} c={color.sub} />
    </View>
  );
}
