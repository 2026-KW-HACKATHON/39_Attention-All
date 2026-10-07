// 홈: 사진 + 날씨 + 운동 시작 패널(접힘/펼침). 웹 프로토타입 viewHome/viewHomeSimple과 같은 구성.
// 실제 조회: getHome(코스), getWeather(날씨), 로그인 시 getMy(포인트·웰컴). 운동 시작은 준비 화면을 거쳐 서버 세션을 만든다.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Easing, Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useApi, useSession } from '../../session';
import { kstTime, routePath, weatherView, welcomeText, WELCOME_TARGET, type Course, type Home, type My, type Settings, type Weather } from '../../core';
import { coursePhoto, MODE_LABEL, PHOTOS, type Photo } from '../../content';
import { type Run } from '../../run';
import { ready } from '../../gate';
import { useStart } from '../../start';
import { color, size } from '../../theme';
import { Btn, Icon, LinkBtn, LoadState, Num, Row, Rows, SecTitle, Seg, Txt } from '../../ui';

const LOGO = require('../../../assets/brand/uirun-wordmark.png');

export default function HomeTab() {
  const settings = useApi<Settings>('getSettings', {}, true);
  return settings.data?.uiMode === 'SIMPLE' ? <SimpleHome /> : <DefaultHome />;
}

// 사진을 화면 크기에 맞춰 채우고 기준점(px·py)으로 자른다(웹 object-fit: cover + object-position).
function Cover({ photo, w, h }: { photo: Photo; w: number; h: number }) {
  const s = Math.max(w / photo.w, h / photo.h), rw = photo.w * s, rh = photo.h * s;
  return (
    <View style={{ width: w, height: h, overflow: 'hidden', backgroundColor: color.photoFallback }}>
      <Image source={photo.src} accessibilityIgnoresInvertColors style={{ position: 'absolute', width: rw, height: rh, left: (w - rw) * photo.px, top: (h - rh) * photo.py }} />
    </View>
  );
}

function useWeather() {
  const q = useApi<Weather>('getWeather');
  return { ...q, view: weatherView(q.data) };
}

// 날씨: 위 줄은 아이콘·큰 기온·‘지금 우이천’+상태, 아래 줄은 체감·바람·습도(고정 항목). 상태와 관계없이 높이가 같다.
function WeatherBand({ width, onLayout }: { width: number; onLayout: (h: number) => void }) {
  const router = useRouter();
  const wx = useWeather(), v = wx.view;
  const tempSize = Math.min(72, Math.max(57.6, width * 0.17));
  const where = (
    <Txt w={800} s={15} c={color.deep} lh={1.3}>
      지금 우이천
    </Txt>
  );
  const sub = (items: string[] | null, warn?: string) => (
    // 줄이 바뀌어도 줄 앞에 ‘·’가 남지 않게 첫 항목의 점을 왼쪽 바깥으로 밀어 가린다(웹 .wx-sub-in과 같은 방법).
    <View style={{ overflow: 'hidden', marginTop: 2 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginLeft: -13 }}>
        {warn ? (
          <View style={{ paddingLeft: 13, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="clock" s={15} c={color.warn} />
            <Txt w={600} s={14} c={color.warn} lh={1.45}>
              {warn}
            </Txt>
          </View>
        ) : (
          (items ?? [' ']).map((t, i) => (
            <View key={i} style={{ paddingLeft: 13 }}>
              {items ? (
                <Txt w={600} s={14} c={color.sub} lh={1.45} style={{ position: 'absolute', left: 3 }}>
                  ·
                </Txt>
              ) : null}
              <Txt w={600} s={14} c={color.sub} lh={1.45}>
                {t}
              </Txt>
            </View>
          ))
        )}
      </View>
    </View>
  );
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 };
  const pad = { paddingTop: 4, paddingRight: 16, paddingBottom: 14, paddingLeft: 20 };
  const measure = (e: { nativeEvent: { layout: { height: number } } }) => onLayout(e.nativeEvent.layout.height);
  if (!v && wx.loading)
    return (
      <View style={pad} onLayout={measure} accessibilityLabel="날씨를 불러오는 중" accessibilityState={{ busy: true }}>
        <View style={row}>
          <View style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: color.bg }} />
          <View style={{ borderRadius: 10, backgroundColor: color.bg }}>
            <Num s={tempSize} c="transparent">
              00°
            </Num>
          </View>
          <View style={{ flex: 1 }}>
            {where}
            <Txt w={700} s={size.cond} lh={1.3}>
              날씨를 불러오는 중
            </Txt>
          </View>
        </View>
        {sub(null)}
      </View>
    );
  // 실패(서버 status=error, 호출 실패, 기온 없음): 지어낸 값 없이 다시 시도만 둔다.
  if (!v)
    return (
      <View style={pad} onLayout={measure}>
        <View style={row}>
          <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="warn" s={40} w={1.6} c={color.blue} />
          </View>
          <View style={{ flex: 1 }}>
            {where}
            <Txt w={700} s={size.cond} lh={1.3}>
              날씨를 불러오지 못했어요
            </Txt>
          </View>
          <Btn label="다시 시도" onPress={() => void wx.reload()} style={{ minHeight: 44, paddingHorizontal: 14 }} />
        </View>
        {sub(null)}
      </View>
    );
  return (
    <Pressable onPress={() => router.push('/weather')} onLayout={measure} accessibilityRole="button" accessibilityLabel="우이천 날씨 자세히 보기" style={pad}>
      <View style={row}>
        <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={v.icon} s={48} w={1.6} c={color.blue} />
        </View>
        <Num s={tempSize}>{v.temp}°</Num>
        <View style={{ flex: 1, minWidth: 0 }}>
          {where}
          <Txt w={700} s={size.cond} lh={1.3}>
            {v.label}
          </Txt>
        </View>
        <Icon name="chev" c={color.sub} />
      </View>
      {v.stale ? sub(null, '업데이트 지연 · ' + (v.fetchedAt ? kstTime(v.fetchedAt) + ' 수신' : '수신 시각 없음')) : sub(v.sub)}
    </Pressable>
  );
}

// 코스 카드: 분위기 사진 + 코스 모양(투명 바탕 블루 선 + 얇은 흰 외곽선) + 이름·거리·출발
function CourseCard({ c, width }: { c: Course; width: number }) {
  const router = useRouter();
  const d = routePath(c.out ?? [], 96, 72, 8);
  return (
    <Pressable onPress={() => router.navigate('/map')} accessibilityRole="button" accessibilityLabel={c.name + ' 지도에서 보기'} style={{ width, borderRadius: 14, overflow: 'hidden', backgroundColor: color.panel, borderWidth: 1, borderColor: color.line }}>
      <View style={{ height: 196 }}>
        <Cover photo={coursePhoto(c.id)} w={width - 2} h={196} />
        {d ? (
          <View style={{ position: 'absolute', top: 8, right: 8, width: width * 0.28, aspectRatio: 4 / 3 }} pointerEvents="none">
            <Svg viewBox="0 0 96 72" width="100%" height="100%">
              <Path d={d} stroke={color.white} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <Path d={d} stroke={color.blue} strokeWidth={3.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, gap: 2 }}>
        <Txt w={700} s={17}>
          {c.name}
        </Txt>
        <Txt s={14} c={color.sub}>
          <Num s={24}>{c.distanceM == null ? '–' : (c.distanceM / 1000).toFixed(1)}</Num>
          km 왕복{c.start ? ' · ' + c.start : ''}
        </Txt>
      </View>
      <View style={{ minHeight: 40, paddingHorizontal: 10, paddingBottom: 8, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
        <Txt w={800} s={14} c={color.blue}>
          지도에서 보기
        </Txt>
        <Icon name="chev" s={16} c={color.blue} />
      </View>
    </Pressable>
  );
}

// 포인트·혜택 요약: 마이페이지와 같은 getMy 값. 누르면 마이페이지로.
function PointSummary() {
  const { auth } = useSession();
  const router = useRouter();
  const my = useApi<My>('getMy', {}, true);
  if (auth.status !== 'in')
    return (
      <View>
        <Txt s={size.sub} c={color.sub} style={{ marginTop: 4, marginBottom: 12 }}>
          로그인하면 포인트와 혜택이 여기에 모여요.
        </Txt>
        <Btn label="로그인" onPress={() => router.push('/login')} />
      </View>
    );
  if (!my.data) return <LoadState loading={my.loading} error={my.error} onRetry={() => void my.reload()} />;
  const m = my.data, n = Math.min(WELCOME_TARGET, m.welcomeCount);
  return (
    <Rows>
      <Row icon="coins" title="내 포인트" sub={m.pointsPending ? `검토 중 ${m.pointsPending}P 별도` : null} right={<Num s={30} unit="P">{m.pointsBalance}</Num>} onPress={() => router.navigate('/my')} />
      <Row icon="gift" title={`웰컴 혜택 ${n}/${WELCOME_TARGET}`} sub={welcomeText(m.welcomeStatus, n)} onPress={() => router.push('/benefits' as never)} />
    </Rows>
  );
}

const liveLabel = (r: Run) => (r.status === 'ENDED' ? '끝난 운동 기록 보기' : r.status === 'ENDING' ? '저장 중인 운동 보기' : '진행 중인 ' + MODE_LABEL[r.mode] + '으로');
const toBenefits = async (router: ReturnType<typeof useRouter>) => {
  if (await ready('/benefits')) router.push('/benefits' as never);
};

function DefaultHome() {
  const router = useRouter();
  const { auth } = useSession();
  const inset = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const home = useApi<Home>('getHome');
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [peekH, setPeekH] = useState(230);
  const [wxH, setWxH] = useState(110);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'RUN' | 'WALK'>('RUN');
  const st = useStart();
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(anim, { toValue: open ? 1 : 0, duration: 300, easing: Easing.bezier(0.22, 0.8, 0.24, 1), useNativeDriver: true }).start();
  }, [anim, open]);
  // Android 뒤로 가기: 펼친 패널부터 접는다
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!open) return false;
        setOpen(false);
        return true;
      });
      return () => sub.remove();
    }, [open]),
  );

  // 사진 높이: 날씨·시작 패널을 먼저 확보한 나머지, 단 화면 폭의 1.04배까지. 남는 높이는 날씨 위아래로 나눈다(웹과 같은 식).
  const avail = box.h - peekH - wxH + 36;
  const photoH = Math.max(0, Math.min(avail, box.w * 1.04));
  const wxTop = photoH - 36 + (avail - photoH) / 2;
  const panelH = Math.max(0, box.h - 44);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [Math.max(0, panelH - peekH), 0] });
  const cardW = Math.min(320, screenW * 0.86);

  return (
    <View style={{ flex: 1, backgroundColor: color.panel, overflow: 'hidden' }} onLayout={e => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {box.w > 0 ? (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: photoH }}>
            <Cover photo={PHOTOS.hero} w={box.w} h={photoH} />
            <Svg style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} width={box.w} height={44}>
              <Defs>
                <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#fff" stopOpacity="0" />
                  <Stop offset="1" stopColor="#fff" stopOpacity="1" />
                </LinearGradient>
              </Defs>
              <Rect width={box.w} height={44} fill="url(#fade)" />
            </Svg>
            <Animated.View pointerEvents={open ? 'none' : 'auto'} style={{ position: 'absolute', top: inset.top, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: 14, paddingRight: 10, paddingLeft: 16, opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
              <Image source={LOGO} accessibilityLabel="우이런" style={{ width: 104, height: (104 * 142) / 480 }} />
              {auth.status === 'out' ? (
                <Pressable onPress={() => router.push('/login')} accessibilityRole="button" style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.88)', justifyContent: 'center' }}>
                  <Txt w={700} s={15}>
                    로그인
                  </Txt>
                </Pressable>
              ) : null}
            </Animated.View>
          </View>
          <View style={{ position: 'absolute', left: 0, right: 0, top: wxTop }}>
            <WeatherBand width={box.w} onLayout={setWxH} />
          </View>
          <Animated.View
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: panelH, transform: [{ translateY }], backgroundColor: color.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 2, borderColor: color.line, elevation: 8, shadowColor: color.deep, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -10 } }}>
            <View onLayout={e => setPeekH(e.nativeEvent.layout.height)} style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
              <Pressable onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ minHeight: 44, paddingTop: 6, paddingBottom: 8, alignItems: 'center', gap: 2 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: color.lineStrong }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
                    <Icon name="up" s={16} c={color.blue} />
                  </View>
                  <Txt w={800} s={14} c={color.blue}>
                    {open ? '접기' : '코스 보기'}
                  </Txt>
                </View>
              </Pressable>
              <Seg label="운동 종류" value={mode} onChange={setMode} options={[['RUN', MODE_LABEL.RUN], ['WALK', MODE_LABEL.WALK]]} />
              <Btn kind="start" icon="play" label={st.live ? liveLabel(st.live) : MODE_LABEL[mode] + ' 시작'} busy={st.starting} onPress={() => void st.start(mode)} style={{ marginTop: 12 }} />
              <View style={{ flexDirection: 'row', marginTop: 4 }}>
                <Pressable onPress={() => router.push('/report' as never)} accessibilityRole="button" style={{ flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Icon name="flag" c={color.blue} />
                  <Txt w={700}>환경 제보</Txt>
                </Pressable>
                <View style={{ width: 1, backgroundColor: color.line, marginVertical: 12 }} />
                <Pressable onPress={() => void toBenefits(router)} accessibilityRole="button" style={{ flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Icon name="ticket" c={color.blue} />
                  <Txt w={700}>내 혜택</Txt>
                </Pressable>
              </View>
            </View>
            <ScrollView style={{ flex: 1, borderTopWidth: 1, borderTopColor: color.line }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 36 }} scrollEnabled={open}>
              <View style={{ marginTop: 10 }}>
                <SecTitle>우이천 코스</SecTitle>
              </View>
              {home.data?.courses?.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardW + 14} decelerationRate="fast" style={{ marginHorizontal: -20, marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 14 }}>
                  {home.data.courses.map(c => (
                    <CourseCard key={c.id} c={c} width={cardW} />
                  ))}
                </ScrollView>
              ) : (
                <LoadState loading={home.loading} error={home.error} onRetry={() => void home.reload()} empty="등록된 코스가 없어요" />
              )}
              <SecTitle>포인트·혜택</SecTitle>
              <PointSummary />
            </ScrollView>
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

// 간편 화면 홈: 펼침 패널 없이 날씨·운동·제보·혜택이 바로 보이고 전체가 스크롤된다.
function SimpleHome() {
  const router = useRouter();
  const st = useStart();
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { auth, mutate, refresh } = useSession();
  const wx = useWeather(), v = wx.view;
  const my = useApi<My>('getMy', {}, true);
  const [busy, setBusy] = useState(false);
  const toDefault = async () => {
    setBusy(true);
    const r = await mutate('updateSettings', { uiMode: 'DEFAULT' }, 'settings.uiMode');
    setBusy(false);
    if (r.ok) void refresh('getSettings', 'getMy', 'getHome');
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ height: 150 + inset.top }}>
        <Cover photo={{ ...PHOTOS.hero, py: 0.45 }} w={width} h={150 + inset.top} />
        <Image source={LOGO} accessibilityLabel="우이런" style={{ position: 'absolute', top: 14 + inset.top, left: 16, width: 104, height: (104 * 142) / 480 }} />
      </View>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <Pressable onPress={() => (v ? router.push('/weather') : void wx.reload())} accessibilityRole="button" accessibilityLabel="우이천 날씨 자세히 보기" style={{ paddingTop: 14, paddingBottom: 6, gap: 2 }}>
          <Txt w={800} s={16} c={color.deep}>
            지금 우이천
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {v ? (
              <>
                <Icon name={v.icon} s={40} w={1.6} c={color.blue} />
                <Num s={48}>{v.temp}°</Num>
                <Txt w={700} s={17}>
                  {v.label + (v.stale ? ' · 업데이트 지연' : '')}
                </Txt>
              </>
            ) : wx.loading ? (
              <ActivityIndicator color={color.sub} />
            ) : (
              <>
                <Icon name="warn" c={color.sub} />
                <Txt w={700} s={17}>
                  날씨 정보 없음 · 눌러서 다시 시도
                </Txt>
              </>
            )}
          </View>
        </Pressable>
        {st.live ? (
          <Btn kind="start" icon="play" label={liveLabel(st.live)} onPress={() => void st.start(st.live!.mode)} style={{ minHeight: 72 }} />
        ) : (
          <>
            <Btn kind="start" icon="play" label="산책 시작" busy={st.starting} onPress={() => void st.start('WALK')} style={{ minHeight: 72 }} />
            <Btn icon="play" label="달리기 시작" big busy={st.starting} onPress={() => void st.start('RUN')} />
          </>
        )}
        <Rows style={{ marginTop: 6 }}>
          <Row icon="flag" title="환경 제보" onPress={() => router.push('/report' as never)} />
          <Row icon="records" title="기록" onPress={() => router.navigate('/records')} />
          <Row
            icon="ticket"
            title="포인트·혜택"
            sub={auth.status === 'in' ? (my.data ? `적립 ${my.data.pointsBalance}P · 혜택 ${my.data.couponCount}장` : '불러오는 중') : '로그인 필요'}
            onPress={() => void toBenefits(router)}
          />
          <Row icon="wc" title="주변 시설" onPress={() => router.navigate('/map')} />
        </Rows>
        <View style={{ alignSelf: 'flex-start' }}>{busy ? <ActivityIndicator color={color.blue} /> : <LinkBtn label="일반 화면으로" onPress={() => void toDefault()} />}</View>
      </View>
    </ScrollView>
  );
}
