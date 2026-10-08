import { useParticipationAccess } from '../../proximity';
// 지도(웹 프로토타입 지도 탭): 전체·코스·관찰·시설 보기. 관찰은 서버 페이지를 끝까지 이어 받는다(50건 넘어도 빠지지 않게).
// 관찰 보기에서만 ‘지난 기록 포함’(회색 핀). 내 위치 버튼은 권한을 받은 뒤 카메라를 내 위치로 옮긴다.
// 핀을 누르면 근처(30m)에 겹친 대상이 둘 이상이면 목록(스크롤)으로, 하나면 요약 카드로. 코스는 고르면 전체가 보이게 맞춘다.
// 간편 화면: 목적(코스·시설·관찰)을 먼저 고르고 큰 행 목록 + 보조 그림, ‘지도 크게 보기’로 지도.
// 지도 키(GOOGLE_MAPS_API_KEY)가 없으면 같은 데이터를 목록과 경로 그림으로 보여준다(지도 SDK 화면은 키가 있어야 확인 가능).
import { useContext, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { useApi } from '../../session';
import { usePaged } from '../../paged';
import { useStart } from '../../start';
import { ObservationGuide } from '../../observation-guide';
import { hasMapsKey } from '../../routemap';
import { clusterPins, directionArrows, pilotMapRegion, type Region } from '../../map-display';
import { nearestM } from '../../exposure';
import { distM } from '../../runlogic';
import { issueCurrent, linePath, projector, type Category, type Course, type Facility, type Issue, type LatLng, type MapData, type Routine } from '../../core';
import { MODE_LABEL } from '../../content';
import { ServerPhoto } from '../../photos';
import { color, space } from '../../theme';
import { Btn, Icon, LinkBtn, LoadState, Micro, Notice, Scale, Sheet, Txt } from '../../ui';

type Mode = 'all' | 'course' | 'issue' | 'fac';
type Item = { key: string; kind: 'course' | 'issue' | 'routine' | 'fac'; id: string; icon: string; title: string; meta: string; at: LatLng; pts: LatLng[]; old?: boolean; nophoto?: boolean; issue?: Issue; course?: Course };
type Here = { lat: number; lng: number } | null;
const MODES: [Mode, string][] = [['all', '전체'], ['course', '코스'], ['issue', '관찰'], ['fac', '시설']];
const ll = (p: LatLng) => ({ latitude: p[0], longitude: p[1] });
const CAT_ICON: Record<string, string> = { LITTER: 'trash', BULKY_WASTE: 'trash', DUMPING_SUSPECT: 'trash', RIVER_WASTE: 'trash', FOAM: 'wave', WATER_COLOR: 'drop', TURBID: 'drop', OIL_LIKE: 'drop', FLOATING_MATERIAL: 'wave', LOW_FLOW: 'drop', DRY_BED: 'drop', ALGAE_LIKE: 'leaf', DEAD_FISH: 'leaf', BIO_ANOMALY: 'leaf', VEGETATION_DAMAGE: 'leaf', ODOR_NOW: 'wind', ODOR_REPEAT: 'wind', BENCH: 'bench' };
const ago = (t: number, now: number) => {
  const m = Math.max(0, Math.round((now - t) / 60000));
  return m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};
const fmtDist = (m: number) => (m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`);

// 지도·목록이 함께 쓰는 항목(서버 자료만)
function useItems(old: boolean) {
  const map = useApi<MapData & { pilot?: { paths?: { points: LatLng[] }[] } }>('getMapData', { limit: 1 });
  const iss = usePaged<Issue>('getMapData', 'issues', 'cursor', { limit: 50 }, false, true);
  const pilot = useApi<{ categories: Record<string, Category> }>('getPilotData');
  const [now] = useState(() => Date.now()); // ponytail: 화면을 연 시각 기준(목록을 다시 받으면 새로 계산하지 않는다)
  const cats = pilot.data?.categories ?? {};
  const d = map.data;
  const courses: Item[] = (d?.courses ?? []).map(c => ({ key: 'course:' + c.id, kind: 'course', id: c.id, icon: 'route', title: c.name, meta: `${((c.distanceM ?? 0) / 1000).toFixed(1)}km 왕복${c.start ? ' · ' + c.start + ' 출발' : ''}`, at: c.out[0], pts: c.out, course: c }));
  const allIssues: Item[] = iss.items.map(i => {
    const cur = issueCurrent(i, cats[i.categoryCode]?.staleH ?? 72, now), c = cats[i.categoryCode];
    return {
      key: 'issue:' + i.id, kind: 'issue', id: i.id, icon: CAT_ICON[i.categoryCode] ?? 'wrench',
      title: (i.categoryLabel ?? c?.label ?? '관찰') + (cur ? '' : i.lifecycleStatus === 'ARCHIVED' ? ' · 보관된 기록' : ' · 지난 기록'),
      meta: (c?.scope === 'CORRIDOR' ? '하천' : '둑길') + ' · ' + (i.eventEndsAt && now >= i.eventEndsAt ? '참여 종료' : i.lastPhotoObservedAt ? '사진 ' + ago(i.lastPhotoObservedAt, now) : '사진 없음'),
      at: i.anchor, pts: i.observationAnchors?.length ? i.observationAnchors : [i.anchor], old: !cur, nophoto: !i.availablePhotoCount, issue: i,
    };
  });
  const issues = allIssues.filter(i => old || !i.old);
  const routines: Item[] = (d?.routines ?? []).filter((r: Routine) => r.enabled && r.anchors.length).map(r => ({ key: 'routine:' + r.id, kind: 'routine', id: r.id, icon: 'repeat', title: '정기 관찰 · ' + r.name, meta: `${r.roundHours}시간마다 같은 구도로 남기는 지점`, at: r.anchors[0], pts: r.anchors }));
  const facs: Item[] = (d?.facilities ?? []).map((f: Facility) => ({ key: 'fac:' + f.id, kind: 'fac', id: f.id, icon: f.type === 'toilets' ? 'wc' : 'bike', title: f.name, meta: '현장 확인 전 위치(OSM 등록)', at: [f.lat, f.lng], pts: [[f.lat, f.lng]] }));
  return { map, iss, courses, issues, hasOld: allIssues.some(i => i.old), routines, facs, paths: d?.pilot?.paths ?? [] };
}

// 내 위치: 권한을 받으면 현재 위치. 거절하면 null(거리를 지어내지 않는다).
async function locate(): Promise<Here> {
  const p = await Location.requestForegroundPermissionsAsync();
  if (!p.granted) return null;
  const pos = (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null)) ?? (await Location.getLastKnownPositionAsync({ maxAge: 60000 }));
  return pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null;
}

export default function MapTab() {
  const simple = useContext(Scale) !== 1;
  const [full, setFull] = useState(false);
  if (simple && !full) return <SimpleMap onFull={() => setFull(true)} />;
  return <FullMap onBack={simple ? () => setFull(false) : undefined} />;
}

function FullMap({ onBack }: { onBack?: () => void }) {
  const access = useParticipationAccess();
  const router = useRouter();
  const inset = useSafeAreaInsets();
  const st = useStart();
  const [mode, setMode] = useState<Mode>('all');
  const [old, setOld] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [group, setGroup] = useState<Item[] | null>(null);
  const [here, setHere] = useState<Here>(null);
  const [viewport, setViewport] = useState<Region | null>(null);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const mapRef = useRef<MapView>(null);
  const x = useItems(mode === 'issue' && old);
  const showC = mode === 'all' || mode === 'course', showI = mode === 'all' || mode === 'issue', showF = mode === 'all' || mode === 'fac';
  const pins = [...(showI ? [...x.issues, ...x.routines] : []), ...(showF ? x.facs : [])];
  const all = [...x.courses, ...pins];
  const picked = all.find(i => i.key === sel) ?? null;
  const dist = (pts: LatLng[]) => nearestM(here, pts);

  const fit = (i: Item) => {
    if (!mapRef.current) return;
    if (i.kind === 'course') mapRef.current.fitToCoordinates(i.pts.map(ll), { edgePadding: { top: 160, right: 60, bottom: 260, left: 40 }, animated: true });
    else mapRef.current.animateToRegion({ ...ll(i.at), latitudeDelta: 0.004, longitudeDelta: 0.004 }, 300);
  };
  const choose = (i: Item) => {
    setGroup(null);
    setSel(i.key);
    fit(i);
  };
  const tapPin = (i: Item) => {
    const near = pins.filter(p => distM(p.at, i.at) < 30);
    if (near.length > 1) setGroup(near);
    else choose(i);
  };
  const myLocation = async () => {
    const h = await locate();
    if (!h) return Alert.alert('내 위치를 보여줄 수 없어요', '위치 권한을 허용하거나 위치 설정을 켜 주세요. 공개 정보는 그대로 볼 수 있어요.');
    setHere(h);
    mapRef.current?.animateToRegion({ latitude: h.lat, longitude: h.lng, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 400);
  };
  const setModeKeep = (m: Mode) => {
    setMode(m);
    setSel(null);
    if (m !== 'issue') setOld(false);
  };

  if (!x.map.data) return <View style={{ flex: 1, padding: space.page, paddingTop: 20 + inset.top, backgroundColor: color.bg }}><LoadState loading={x.map.loading} error={x.map.error} onRetry={() => void x.map.reload()} /></View>;

  const listItems = mode === 'course' ? x.courses : mode === 'fac' ? x.facs : [...x.issues, ...x.routines];
  const sorted = here ? [...listItems].sort((a, b) => (dist(a.pts) ?? 0) - (dist(b.pts) ?? 0)) : listItems;
  const top = (
    <View style={{ gap: 8 }}>
      {onBack ? <Btn kind="white" icon="back" label="목록으로" onPress={onBack} style={{ alignSelf: 'flex-start', minHeight: 44, elevation: 3 }} /> : null}
      <View style={{ borderRadius: 24, backgroundColor: color.panel, elevation: 4, shadowColor: color.deep, shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, overflow: 'hidden' }}>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 4 }}>
          {MODES.map(([k, l]) => (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: mode === k }} onPress={() => setModeKeep(k)} style={{ flex: 1, minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === k ? color.blue : 'transparent' }}>
              <Txt w={700} s={15} c={mode === k ? color.white : color.sub}>{l}</Txt>
            </Pressable>
          ))}
        </View>
        {mode === 'issue' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, minHeight: 40, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: color.line }}>
            <Txt w={700} s={13} c={color.sub}>지난 기록 포함</Txt>
            <Switch accessibilityLabel="지난 기록 포함" value={old} onValueChange={setOld} trackColor={{ false: color.lineStrong, true: color.blue }} thumbColor={color.white} />
          </View>
        ) : null}
      </View>
      {mode === 'issue' ? <ObservationGuide /> : null}
      {mode === 'issue' && old ? (
        <View style={{ padding: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: color.panel, elevation: 3, marginRight: 52 }}>
          <Txt s={14}>회색 핀은 참여가 끝났거나 사진이 오래된 지난 기록이에요. 해결 여부와는 관계없어요.</Txt>
        </View>
      ) : null}
      {x.iss.loading && x.iss.items.length ? <Micro>관찰을 더 불러오는 중이에요 ({x.iss.items.length}건)</Micro> : null}
      {x.iss.error ? <Notice kind="err" text="관찰 목록 일부를 불러오지 못했어요." /> : null}
      {x.iss.next && !x.iss.loading && !x.iss.error ? <Micro>관찰이 많아 최근 {x.iss.items.length}건까지 보여요.</Micro> : null}
    </View>
  );

  const sheet = picked ? (
    <SelCard i={picked} dist={dist(picked.pts)} onClose={() => setSel(null)} onOpen={() => router.push((picked.kind === 'issue' ? '/issue/' : '/routine/') + picked.id as never)} onStart={c => void st.start(c.modes?.includes('RUN') ? 'RUN' : 'WALK', c.id)} starting={st.starting} />
  ) : mode === 'all' ? null : (
    <View style={sheetStyle}>
      <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled>
        {sorted.map(i => <ItemRow key={i.key} i={i} d={dist(i.pts)} onPress={() => choose(i)} />)}
        {!sorted.length ? <Txt s={15} c={color.sub} style={{ paddingVertical: 14 }}>{x.iss.loading ? '불러오는 중이에요' : mode === 'issue' && !old && x.hasOld ? '지금 보이는 관찰이 없어요. 지난 기록을 포함해 볼 수 있어요.' : '보여줄 항목이 없어요'}</Txt> : null}
      </ScrollView>
    </View>
  );

  if (!hasMapsKey)
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <ScrollView contentContainerStyle={{ padding: space.page, paddingTop: 20 + inset.top, paddingBottom: 40, gap: 12 }}>
          <Txt w={700} s={28} lh={1.25}>지도</Txt>
          <Micro>지도 키(GOOGLE_MAPS_API_KEY)가 없어 배경 지도 대신 경로 그림과 목록으로 보여줘요.</Micro>
          {top}
          <MapArt paths={x.paths} courses={showC ? x.courses : []} sel={sel} pins={pins} here={here} />
          <LinkBtn label="내 위치 기준으로 보기" onPress={() => void myLocation()} />
          {picked ? sheet : null}
          {(mode === 'all' ? [...x.courses, ...pins] : sorted).map(i => <ItemRow key={i.key} i={i} d={dist(i.pts)} onPress={() => choose(i)} />)}
        </ScrollView>
      </View>
    );

  const initial = pilotMapRegion(x.paths.map(p => p.points), x.courses.map(c => c.pts));
  const clusters = clusterPins(pins, viewport ?? initial, mapSize.width, mapSize.height);
  return (
    <View style={{ flex: 1 }}>
      <MapView key={JSON.stringify(initial)} ref={mapRef} provider={PROVIDER_GOOGLE} style={{ flex: 1 }} initialRegion={initial} onRegionChangeComplete={setViewport} onLayout={e => setMapSize(e.nativeEvent.layout)} showsUserLocation={!!here} showsMyLocationButton={false} toolbarEnabled={false} onPress={() => setSel(null)}>
        {x.paths.map((p, i) => <Polyline key={'w' + i} coordinates={p.points.map(ll)} strokeColor="rgba(216,230,243,0.9)" strokeWidth={14} />)}
        {showC
          ? x.courses.map(c => {
              const on = c.key === sel;
              return [
                <Polyline key={c.key + 'c'} coordinates={c.pts.map(ll)} strokeColor={color.white} strokeWidth={on ? 11 : 6} zIndex={on ? 4 : 1} />,
                <Polyline key={c.key + 'r'} coordinates={c.pts.map(ll)} strokeColor={on ? color.blue : sel?.startsWith('course:') ? 'rgba(56,75,240,0.3)' : 'rgba(56,75,240,0.5)'} strokeWidth={on ? 6 : 3} zIndex={on ? 5 : 2} tappable onPress={() => choose(c)} />,
                ...(on ? directionArrows(c.pts).map((a, j) => <Marker key={c.key + 'arrow' + j} coordinate={ll(a.at)} flat rotation={a.bearing} anchor={{ x: 0.5, y: 0.5 }} zIndex={6} onPress={() => choose(c)}><View style={{ backgroundColor: color.white, borderRadius: 14, padding: 3 }}><Txt w={800} s={16} c={color.blue}>↑</Txt></View></Marker>) : []),
                on ? null : <Marker key={c.key + 'd'} coordinate={ll(c.at)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} onPress={() => choose(c)}><View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color.white, borderWidth: 3, borderColor: color.blue }} /></Marker>,
              ];
            })
          : null}
        {picked?.kind === 'course' ? (
          <>
            <Marker coordinate={ll(picked.pts.at(-1)!)} anchor={{ x: 0.17, y: 0.5 }} zIndex={6}><EndTag icon="repeat" label="반환점" bg={color.deep} fg={color.white} /></Marker>
            <Marker coordinate={ll(picked.pts[0])} anchor={{ x: 0.15, y: 0.5 }} zIndex={7}><EndTag icon="play" label="출발·도착" bg={color.lime} fg={color.black} /></Marker>
          </>
        ) : null}
        {clusters.map(g => g.members.length > 1 ? (
          <Marker key={'cluster:' + g.key} coordinate={ll(g.at)} zIndex={5} onPress={() => setGroup(g.members)}>
            <View accessibilityLabel={`관찰 ${g.members.length}건`} style={{ minWidth: 44, minHeight: 44, paddingHorizontal: 10, borderRadius: 22, backgroundColor: color.deep, borderWidth: 3, borderColor: color.white, alignItems: 'center', justifyContent: 'center' }}><Txt w={800} s={17} c={color.white}>{g.members.length}</Txt></View>
          </Marker>
        ) : (
          <Marker key={g.key} coordinate={ll(g.at)} anchor={g.members[0].kind === 'issue' ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }} zIndex={g.key === sel ? 9 : g.members[0].kind === 'fac' ? 1 : 3} onPress={() => tapPin(g.members[0])}>
            <Pin i={g.members[0]} on={g.key === sel} />
          </Marker>
        ))}
      </MapView>
      <View style={{ position: 'absolute', top: inset.top + 12, left: 12, right: 12 }} pointerEvents="box-none">{top}</View>
      <Pressable accessibilityRole="button" accessibilityLabel="내 위치로 이동" onPress={() => void myLocation()} style={{ position: 'absolute', right: 12, top: inset.top + (mode === 'issue' ? 112 : 72) + (onBack ? 52 : 0), width: 44, height: 44, borderRadius: 22, backgroundColor: color.panel, alignItems: 'center', justifyContent: 'center', elevation: 4 }}>
        <Icon name="locate" c={color.blue} />
      </Pressable>
      {sheet ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>{sheet}</View> : mode === 'all' ? (
        <Btn kind="blue" icon="flag" label={access.restricted ? '환경 제보 · 범위 밖' : '환경 제보'} disabled={access.restricted} onPress={() => void access.open('/report')} style={{ position: 'absolute', right: 12, bottom: 24, elevation: 6 }} />
      ) : null}
      <Sheet open={!!group} onClose={() => setGroup(null)} title={`이 근처 ${group?.length ?? 0}곳`}>
        {(group ?? []).map(i => <ItemRow key={i.key} i={i} d={dist(i.pts)} onPress={() => choose(i)} />)}
      </Sheet>
    </View>
  );
}

const sheetStyle = { paddingTop: 6, paddingHorizontal: 20, paddingBottom: 26, backgroundColor: color.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, elevation: 8, shadowColor: color.deep, shadowOpacity: 0.14, shadowRadius: 18 } as const;

function ItemRow({ i, d, onPress }: { i: Item; d: number | null; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.line }, pressed && { backgroundColor: color.bg }]}>
      <Icon name={i.icon} c={i.old ? color.sub : color.deep} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt w={700} c={i.old ? color.sub : color.black}>{i.title}</Txt>
        <Txt s={14} c={color.sub}>{i.meta}{d != null ? ` · 직선 ${fmtDist(d)}` : ''}</Txt>
      </View>
      <Icon name="chev" s={18} c={color.sub} />
    </Pressable>
  );
}

function SelCard({ i, dist, onClose, onOpen, onStart, starting }: { i: Item; dist: number | null; onClose: () => void; onOpen: () => void; onStart: (c: Course) => void; starting: boolean }) {
  const photo = i.issue?.publicPhoto?.id;
  return (
    <View style={sheetStyle} accessibilityLabel="선택한 항목">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 10 }}>
        {photo ? (
          <View style={{ width: 56, height: 56, borderRadius: 28, overflow: 'hidden', borderWidth: 2, borderColor: color.blue }}>
            <ServerPhoto photoId={photo} height={56} />
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt w={800} s={20} lh={1.3}>{i.title}</Txt>
          <Txt s={15} c={color.sub}>{i.meta}{dist != null ? ` · 직선 ${fmtDist(dist)}` : ''}</Txt>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="선택 해제" onPress={onClose} style={{ width: 44, height: 44, marginTop: -6, marginRight: -10, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" />
        </Pressable>
      </View>
      {i.kind === 'course' && i.course ? (
        <>
          <Txt s={13} c={color.sub} style={{ marginTop: 6, marginBottom: 12 }}>현장 확인 전 경로예요. 하천선을 따라 그린 선이라 실제 길과 다를 수 있어요.{i.course.modes?.length ? ` · ${i.course.modes.map(m => MODE_LABEL[m as 'RUN' | 'WALK'] ?? m).join(' · ')}` : ''}</Txt>
          <Btn kind="start" icon="play" label="이 코스로 시작" busy={starting} onPress={() => onStart(i.course!)} />
        </>
      ) : i.kind === 'fac' ? (
        <Txt s={13} c={color.sub} style={{ marginTop: 6 }}>현장 확인 전 위치예요. 운영 시간·이용 가능 여부는 확인하지 않았어요.</Txt>
      ) : (
        <Btn kind="blue" label="자세히 보기" onPress={onOpen} style={{ marginTop: 12 }} />
      )}
    </View>
  );
}

// 브랜드 핀(웹 pin-obs·mk-routine·mk-fac): 관찰은 끝이 실제 좌표를 가리키는 물방울, 사진 없음은 흰 바탕, 지난 기록은 회색, 선택은 블루+라임 테두리
function Pin({ i, on }: { i: Item; on: boolean }) {
  if (i.kind !== 'issue') {
    const routine = i.kind === 'routine';
    return (
      <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 30, height: 30, borderRadius: routine ? 8 : 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.blue : color.white, borderWidth: on ? 3 : routine ? 2.5 : 1.5, borderColor: on ? color.lime : routine ? color.deep : color.lineStrong }}>
          <Icon name={i.icon} s={17} c={on ? color.white : color.deep} />
        </View>
      </View>
    );
  }
  const s = on ? 46 : 36;
  const bg = on ? color.blue : i.old ? '#9AA0B4' : i.nophoto ? color.white : color.deep;
  const fg = !on && i.nophoto && !i.old ? color.deep : color.white;
  return (
    <View style={{ width: s + 8, height: s * 1.22 + 14, alignItems: 'center', justifyContent: 'flex-end' }}>
      {i.old ? (
        <View style={{ position: 'absolute', top: 0, paddingHorizontal: 5, borderRadius: 4, backgroundColor: color.white }}>
          <Txt w={800} s={10} c={color.sub}>{i.issue?.lifecycleStatus === 'ARCHIVED' ? '보관' : '지난'}</Txt>
        </View>
      ) : null}
      <View style={{ width: s, height: s, marginBottom: s * 0.21, borderTopLeftRadius: s / 2, borderTopRightRadius: s / 2, borderBottomRightRadius: s / 2, borderBottomLeftRadius: 0, transform: [{ rotate: '-45deg' }], backgroundColor: bg, borderWidth: on ? 3 : 2, borderColor: on ? color.lime : i.nophoto && !i.old ? color.deep : color.white, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ transform: [{ rotate: '45deg' }] }}>
          <Icon name={i.icon} s={on ? 22 : 17} c={fg} />
        </View>
      </View>
    </View>
  );
}

function EndTag({ icon, label, bg, fg }: { icon: string; label: string; bg: string; fg: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: bg, borderWidth: 2.5, borderColor: color.white, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} s={15} c={fg} w={2.2} />
      </View>
      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: color.white }}>
        <Txt w={800} s={12}>{label}</Txt>
      </View>
    </View>
  );
}

// 지도 키가 없을 때·간편 화면의 보조 그림(웹 routeSvg): 산책로, 코스(선택은 진하게), 핀 위치 점, 내 위치
function MapArt({ paths, courses, sel, pins, here, h = 150 }: { paths: { points: LatLng[] }[]; courses: Item[]; sel: string | null; pins: Item[]; here: Here; h?: number }) {
  const [w, setW] = useState(0);
  const fit = paths.flatMap(p => p.points);
  const f = w && fit.length > 1 ? projector(fit, w, h, 16) : null;
  const on = courses.find(c => c.key === sel);
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height: h, borderRadius: 14, backgroundColor: '#EEF0F5', overflow: 'hidden' }} accessibilityLabel="파일럿 구간 그림">
      {f ? (
        <Svg width={w} height={h}>
          {paths.map((p, i) => <Path key={'p' + i} d={linePath(p.points, f)} stroke={color.water} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {courses.filter(c => c !== on).map(c => <Path key={c.key} d={linePath(c.pts, f)} stroke="#A3ADEB" strokeWidth={2.5} strokeLinecap="round" fill="none" />)}
          {on ? <Path d={linePath(on.pts, f)} stroke={color.white} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
          {on ? <Path d={linePath(on.pts, f)} stroke={color.blue} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
          {pins.map(p => (
            <Circle key={p.key} cx={f(p.at)[0]} cy={f(p.at)[1]} r={p.key === sel ? 8 : 6} fill={p.kind === 'fac' ? color.white : p.old ? '#9AA0B4' : color.deep} stroke={p.kind === 'fac' ? color.blue : p.key === sel ? color.lime : color.white} strokeWidth={p.key === sel ? 3 : 2} />
          ))}
          {on ? <Circle cx={f(on.pts.at(-1)!)[0]} cy={f(on.pts.at(-1)!)[1]} r={6} fill={color.deep} stroke={color.white} strokeWidth={2} /> : null}
          {on ? <Circle cx={f(on.pts[0])[0]} cy={f(on.pts[0])[1]} r={7} fill={color.lime} stroke={color.black} strokeWidth={2} /> : null}
          {here ? <Circle cx={f([here.lat, here.lng])[0]} cy={f([here.lat, here.lng])[1]} r={7} fill={color.blue} stroke={color.white} strokeWidth={2.5} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

// 간편 화면 지도: 목적 → 보조 그림 → 큰 행. 위치 권한이 없으면 거리를 지어내지 않는다.
function SimpleMap({ onFull }: { onFull: () => void }) {
  const router = useRouter();
  const inset = useSafeAreaInsets();
  const st = useStart();
  const [pur, setPur] = useState<'course' | 'fac' | 'issue'>('course');
  const [old, setOld] = useState(false);
  const [here, setHere] = useState<Here>(null);
  const [course, setCourse] = useState<string | null>(null);
  const x = useItems(old);
  const sc = x.courses.find(c => c.id === course) ?? x.courses[0];
  const items = pur === 'course' ? x.courses : pur === 'fac' ? x.facs : [...x.issues, ...x.routines];
  const d = (i: Item) => nearestM(here, pur === 'course' ? [i.at] : i.pts);
  const list = here && pur !== 'course' ? [...items].sort((a, b) => (d(a) ?? 0) - (d(b) ?? 0)) : items;
  const ask = async () => {
    const h = await locate();
    if (!h) Alert.alert('위치를 받지 못했어요', '위치 권한을 허용하거나 위치 설정을 켜 주세요.');
    setHere(h);
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ padding: space.page, paddingTop: 20 + inset.top, paddingBottom: 40, gap: 12 }}>
      <Txt w={700} s={28} lh={1.25}>지도</Txt>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 8 }}>
        {([['course', '산책 코스', 'route'], ['fac', '주변 시설', 'wc'], ['issue', '환경 관찰', 'eye']] as const).map(([k, l, ic]) => (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: pur === k }} onPress={() => setPur(k)} style={{ flex: 1, minHeight: 84, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: pur === k ? color.blue : color.panel, borderWidth: pur === k ? 0 : 1.5, borderColor: color.line }}>
            <Icon name={ic} s={26} c={pur === k ? color.white : color.blue} />
            <Txt w={800} c={pur === k ? color.white : color.black}>{l}</Txt>
          </Pressable>
        ))}
      </View>
      {here ? null : (
        <View style={{ gap: 4 }}>
          <Txt s={15} c={color.sub}>내 위치를 쓰면 가까운 순으로 보여줘요. 쓰기 전에는 거리를 계산하지 않아요.</Txt>
          <LinkBtn label="내 위치 쓰기" onPress={() => void ask()} />
        </View>
      )}
      <MapArt paths={x.paths} courses={pur === 'course' ? x.courses : []} sel={pur === 'course' ? sc?.key ?? null : null} pins={pur === 'course' ? [] : items} here={here} />
      <Txt s={14} c={color.sub}>{pur === 'course' ? `${sc?.title ?? ''} · 라임 점 출발 · 남색 점 반환점` : [here ? '파란 점이 내 위치' : '파일럿 구간 하천', pur === 'issue' && old ? '회색 점은 지난 기록' : ''].filter(Boolean).join(' · ')}</Txt>
      <Btn kind="line" big icon="map" label="지도 크게 보기" onPress={onFull} />
      {here ? <Micro>거리는 길찾기 거리가 아니라 직선거리예요.</Micro> : null}
      <View style={{ borderTopWidth: 1, borderTopColor: color.line }}>
        {list.map(i => {
          const dd = d(i), on = pur === 'course' && i.key === sc?.key;
          return (
            <View key={i.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 76, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.line, backgroundColor: on ? color.blueSoft : 'transparent' }}>
              <Pressable accessibilityRole={pur === 'course' ? 'radio' : undefined} accessibilityState={pur === 'course' ? { checked: on } : undefined} disabled={pur !== 'course'} onPress={() => setCourse(i.id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Icon name={i.icon} c={i.old ? color.sub : color.deep} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt w={700} c={i.old ? color.sub : color.black}>{i.title}</Txt>
                  <Txt s={14} c={color.sub}>{i.meta}{dd != null ? ` · ${pur === 'course' ? '출발점까지 ' : ''}직선 ${fmtDist(dd)}` : ''}</Txt>
                </View>
                {on ? <Icon name="check" c={color.blue} /> : null}
              </Pressable>
              {i.kind === 'course' ? (
                <Btn kind="start" label="시작" busy={st.starting} onPress={() => void st.start(i.course?.modes?.includes('WALK') ? 'WALK' : 'RUN', i.id)} style={{ minHeight: 44, paddingHorizontal: 14 }} />
              ) : i.kind === 'fac' ? null : (
                <Btn kind="blue" label="자세히" onPress={() => router.push((i.kind === 'issue' ? '/issue/' : '/routine/') + i.id as never)} style={{ minHeight: 44, paddingHorizontal: 14 }} />
              )}
            </View>
          );
        })}
        {!list.length ? <Txt s={15} c={color.sub} style={{ paddingVertical: 14 }}>{x.iss.loading ? '불러오는 중이에요' : '보여줄 항목이 없어요'}</Txt> : null}
      </View>
      {pur === 'issue' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 }}>
          <View style={{ flex: 1 }}>
            <Txt w={700}>지난 기록 포함</Txt>
            <Txt s={14} c={color.sub}>참여가 끝났거나 사진이 오래됐거나 보관된 관찰</Txt>
          </View>
          <Switch accessibilityLabel="지난 기록 포함" value={old} onValueChange={setOld} trackColor={{ false: color.lineStrong, true: color.blue }} thumbColor={color.white} />
        </View>
      ) : null}
      {x.iss.next && !x.iss.loading ? <Micro>관찰이 많아 최근 {x.iss.items.length}건까지 보여요.</Micro> : null}
    </ScrollView>
  );
}
