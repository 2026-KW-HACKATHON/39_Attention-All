// 공용 화면 부품. 모양은 웹 프로토타입 클래스(.btn, .row, .seg, .sec-title, .appbar …)를 그대로 따른다.
import { createContext, useContext, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, ScrollView, Switch, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, size, space, type Weight } from './theme';
import { errorText, type Failure } from './core';

// 아이콘: 웹 index.html 스프라이트(24×24 선 아이콘)의 path를 그대로 옮겼다.
const ICONS: Record<string, string> = {
  home: '<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z"/>',
  map: '<path d="M9 4 3.5 6.2V20L9 18l6 2 5.5-2.2V4L15 6z"/><path d="M9 4v14M15 6v14"/>',
  records: '<path d="M5 20v-8M12 20V5M19 20v-9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5"/>',
  river: '<path d="M7 13.5C7 8.6 10.6 4.6 17 4c.5 6-2.8 9.8-7.6 9.8-.9 0-1.7-.1-2.4-.3z"/><path d="M7 13.5 12 9"/><path d="M3 18.5c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  up: '<path d="M6 14.5l6-6 6 6"/>',
  warn: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11"/>',
  ticket: '<path d="M3.5 7.5h17v3a1.8 1.8 0 0 0 0 3.5v3h-17v-3a1.8 1.8 0 0 0 0-3.5z"/><path d="M14.5 8v9" stroke-dasharray="2 2"/>',
  coins: '<ellipse cx="9.5" cy="7" rx="5.5" ry="2.5"/><path d="M4 7v4c0 1.4 2.5 2.5 5.5 2.5S15 12.4 15 11V7"/><path d="M9 15.4V17c0 1.4 2.5 2.5 5.5 2.5S20 18.4 20 17v-4c0-1.4-2.5-2.5-5.5-2.5"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9c-1.5-3.5-5.5-4-5.5-1.5S9.5 9 12 9zm0 0c1.5-3.5 5.5-4 5.5-1.5S14.5 9 12 9z"/>',
  out: '<path d="M14 5h5v5M19 5l-8 8M17 14v5H5V7h5"/>',
  wc: '<path d="M7 4h4.5v6.5H7zM4.5 10.5h15A7.5 7.5 0 0 1 12 18a7.5 7.5 0 0 1-7.5-7.5zM9 18l-.8 2.5h7.6L15 18"/>',
  logout: '<path d="M10 5H5v14h5M14.5 8l4 4-4 4M18.5 12H9"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  camera: '<path d="M3.5 8h3.2l1.8-2.5h7L17.3 8h3.2v11h-17z"/><circle cx="12" cy="13.2" r="3.4"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  locate: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  drop: '<path d="M12 3.5s6 6.6 6 10.9a6 6 0 0 1-12 0C6 10.1 12 3.5 12 3.5z"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  leaf: '<path d="M5 19c0-8.5 6-14 15-14 0 9-5.5 15-14 15"/><path d="M5 19c3-4 6-6.5 9.5-8.5"/>',
  bench: '<path d="M3.5 10h17M5 10V7.5h14V10M5.5 10v8M18.5 10v8M3.5 14h17"/>',
  wave: '<path d="M2.5 9c2.2-2 4.3-2 6.4 0s4.3 2 6.4 0 4.3-2 6.2 0M2.5 15c2.2-2 4.3-2 6.4 0s4.3 2 6.4 0 4.3-2 6.2 0"/>',
  wind: '<path d="M3 8.5h11a2.8 2.8 0 1 0-2.8-2.8M3 12.5h15.5a2.8 2.8 0 1 1-2.8 2.8M3 16.5h8"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5.3 4.8L4.5 16 8 19.5l4.7-4.7a4 4 0 0 0 4.8-5.3l-2.6 2.6-2.4-.5-.5-2.4z"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l3.5-7h6L18 16M9.5 9 12 16H6M13.5 6.5H16"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6.5a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  shield: '<path d="M12 3.5 19.5 6v5.5c0 4.6-3.2 8-7.5 9-4.3-1-7.5-4.4-7.5-9V6z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6M12 16.6v.3"/>',
  bell: '<path d="M6 16.5v-5a6 6 0 1 1 12 0v5l1.5 1.5h-15zM10 20.5h4"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v4.2h4.2"/><path d="M12 8v4.3l3 1.8"/>',
  repeat: '<path d="M17 3.5l3 3-3 3M4 11.5v-2a3 3 0 0 1 3-3h13M7 20.5l-3-3 3-3M20 12.5v2a3 3 0 0 1-3 3H4"/>',
  tap: '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3l2.6 2.6 4.9-5.1"/>',
  dash: '<path d="M7 12h10"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>',
  share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V20h14v-7.5"/>',
  'wifi-off': '<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 6.4-.6M5 12.8a10 10 0 0 1 5-2.6M19 12.8a10 10 0 0 0-3.2-2.2M2 9a14.5 14.5 0 0 1 4.5-2.7M12 5.5A14.5 14.5 0 0 1 22 9"/>',
  'wx-sun': '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  'wx-moon': '<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z"/>',
  'wx-cloud': '<path d="M7 18.5h10.3a3.7 3.7 0 0 0 .4-7.4 5.5 5.5 0 0 0-10.6 1.2A3.1 3.1 0 0 0 7 18.5z"/>',
  'wx-cloud-sun': '<path d="M8.6 7.4a3.4 3.4 0 0 1 5.7-1.3M8.4 2.6v1.6M3.6 7.4h1.6M4.9 3.9l1.1 1.1M11.9 3.9l-1.1 1.1"/><path d="M7.5 20h9.8a3.4 3.4 0 0 0 .4-6.8 5 5 0 0 0-9.7 1.1A2.9 2.9 0 0 0 7.5 20z"/>',
  'wx-cloud-moon': '<path d="M12.6 7.6a4.6 4.6 0 0 1-5.4-5.3 4.6 4.6 0 1 0 5.4 5.3z"/><path d="M7.5 20h9.8a3.4 3.4 0 0 0 .4-6.8 5 5 0 0 0-9.7 1.1A2.9 2.9 0 0 0 7.5 20z"/>',
  'wx-rain': '<path d="M7 15h10.3a3.7 3.7 0 0 0 .4-7.4 5.5 5.5 0 0 0-10.6 1.2A3.1 3.1 0 0 0 7 15z"/><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
  'wx-snow': '<path d="M7 14.5h10.3a3.7 3.7 0 0 0 .4-7.4 5.5 5.5 0 0 0-10.6 1.2A3.1 3.1 0 0 0 7 14.5z"/><path d="M8.5 18.5h.01M12 20h.01M15.5 18.5h.01" stroke-width="3"/>',
  'wx-fog': '<path d="M4 9h16M3 13h18M5 17h14"/>',
  'wx-storm': '<path d="M7 14.5h10.3a3.7 3.7 0 0 0 .4-7.4 5.5 5.5 0 0 0-10.6 1.2A3.1 3.1 0 0 0 7 14.5z"/><path d="M12.5 15.5l-2 3h3l-2 3"/>',
};

export function Icon({ name, s = 20, c = color.black, w = 1.8 }: { name: string; s?: number; c?: string; w?: number }) {
  const xml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
  return <SvgXml xml={xml} width={s} height={s} color={c} />;
}

// 간편 화면 글자 배율(웹 html[data-ui=simple] 118%)
export const Scale = createContext(1);

// fit: 한 줄(lines)에 안 들어가면 글자를 최대 80%까지 줄인다(큰 글자 설정·좁은 화면에서 버튼·탭 이름이 잘리거나 두 줄이 되지 않게)
type TxtProps = { w?: Weight; s?: number; c?: string; lh?: number; style?: StyleProp<TextStyle>; children?: ReactNode; lines?: number; center?: boolean; fit?: boolean };
export function Txt({ w = 400, s = size.body, c = color.black, lh = 1.5, style, children, lines, center, fit }: TxtProps) {
  const k = useContext(Scale);
  return (
    <Text numberOfLines={lines} adjustsFontSizeToFit={fit} minimumFontScale={fit ? 0.8 : undefined} style={[{ fontFamily: font[w], fontSize: s * k, lineHeight: Math.round(s * k * lh), color: c, includeFontPadding: false }, center && { textAlign: 'center' }, style]}>
      {children}
    </Text>
  );
}

// 큰 숫자: 기울어진 압축체(웹 .num, line-height .92). 단위는 본문 글꼴 0.4em(웹 .num i).
// fixed: 이미 화면 폭에 맞춘 크기(웹 clamp(…cqi…))라 간편 화면 배율을 다시 곱하지 않는다.
export function Num({ s, c = color.black, unit, upright, children, style, fixed }: { s: number; c?: string; unit?: string; upright?: boolean; children: ReactNode; style?: StyleProp<TextStyle>; fixed?: boolean }) {
  const scale = useContext(Scale), k = fixed ? 1 : scale;
  return (
    // 기울어진 숫자는 오른쪽 끝 글자가 잘리지 않게 글자 크기의 8%만큼 여백을 둔다
    <Text style={[{ fontFamily: upright ? font.numUpright : font.num, fontSize: s * k, lineHeight: Math.round(s * k * (upright ? 1.2 : 0.98)), color: c, letterSpacing: -0.01 * s, fontVariant: ['tabular-nums'], includeFontPadding: false, paddingRight: upright ? 0 : Math.ceil(s * k * 0.08) }, style]}>
      {children}
      {unit ? <Text style={{ fontFamily: font[700], fontSize: Math.max(12, s * k * 0.4), letterSpacing: 0 }}> {unit}</Text> : null}
    </Text>
  );
}

type BtnKind = 'start' | 'blue' | 'ink' | 'line' | 'white' | 'ghost';
const BTN: Record<BtnKind, { bg: string; fg: string; border?: string }> = {
  start: { bg: color.lime, fg: color.black, border: 'rgba(17,17,17,0.08)' },
  blue: { bg: color.blue, fg: color.white },
  ink: { bg: color.black, fg: color.white },
  line: { bg: color.panel, fg: color.black, border: color.lineStrong },
  white: { bg: color.white, fg: color.black }, // 어두운 화면(웹 .btn-white)
  ghost: { bg: 'transparent', fg: color.white, border: 'rgba(255,255,255,0.6)' }, // 어두운 화면(웹 .btn-ghost-light)
};
// 웹 .btn: 높이 52(시작 버튼 60), 완전한 둥근 모서리, 누르면 0.98배
export function Btn({ kind = 'line', label, icon, onPress, disabled, busy, style, big }: { kind?: BtnKind; label: string; icon?: string; onPress?: () => void; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; big?: boolean }) {
  const k = BTN[kind], tall = kind === 'start' || big;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        { minHeight: tall ? 60 : 52, paddingHorizontal: 20, borderRadius: 999, backgroundColor: k.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
        k.border ? { borderWidth: 1.5, borderColor: k.border } : null,
        (disabled || busy) && { opacity: 0.4 },
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}>
      {busy ? <ActivityIndicator size="small" color={k.fg} /> : icon ? <Icon name={icon} c={k.fg} /> : null}
      <Txt w={kind === 'start' ? 800 : 700} s={kind === 'start' ? 19 : 16} c={k.fg} lh={1.2} lines={1} fit style={{ flexShrink: 1 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function LinkBtn({ label, onPress, c = color.blue, chev }: { label: string; onPress: () => void; c?: string; chev?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Txt w={700} s={15} c={c}>
        {label}
      </Txt>
      {chev ? <Icon name="chev" s={16} c={c} /> : null}
    </Pressable>
  );
}

// 웹 .rows/.row: 위·아래 1px 구분선, 최소 높이 64, 왼쪽 아이콘은 딥, 오른쪽 화살표는 보조색
export const Rows = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[{ borderTopWidth: 1, borderTopColor: color.line }, style]}>{children}</View>;

export function Row({ icon, title, sub, meta, right, onPress, chev = !!onPress, titleColor, label }: { icon?: string; title: string; sub?: string | null; meta?: string | null; right?: ReactNode; onPress?: () => void; chev?: boolean; titleColor?: string; label?: string }) {
  const body = (
    <>
      {icon ? <Icon name={icon} c={color.deep} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt w={700} s={size.row} c={titleColor}>
          {title}
        </Txt>
        {sub ? (
          <Txt s={size.rowSub} c={color.sub}>
            {sub}
          </Txt>
        ) : null}
      </View>
      {meta ? (
        <Txt s={15} c={color.sub}>
          {meta}
        </Txt>
      ) : null}
      {right}
      {chev ? <Icon name="chev" s={18} c={color.sub} /> : null}
    </>
  );
  const st = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14, minHeight: space.rowMin, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.line };
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [st, pressed && { backgroundColor: color.bg }]}>
      {body}
    </Pressable>
  ) : (
    <View style={st}>{body}</View>
  );
}

export function SwitchRow({ title, sub, value, onChange, disabled }: { title: string; sub?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Row
      title={title}
      sub={sub}
      chev={false}
      right={<Switch accessibilityLabel={title} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ false: color.lineStrong, true: color.blue }} thumbColor={color.white} />}
    />
  );
}

export function SecTitle({ children, right, first }: { children: string; right?: ReactNode; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: first ? 8 : 30, marginBottom: 6 }}>
      <Txt w={700} s={size.sec} lh={1.4}>
        {children}
      </Txt>
      {typeof right === 'string' ? (
        <Txt w={500} s={13} c={color.sub}>
          {right}
        </Txt>
      ) : (
        right
      )}
    </View>
  );
}

// 웹 .seg: 회색 바탕 알약 안에서 선택한 항목만 대표 블루
export function Seg<T extends string>({ options, value, onChange, label, disabled }: { options: [T, string][]; value: T; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999, backgroundColor: color.bg }}>
      {options.map(([k, l]) => {
        const on = k === value;
        return (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: on, disabled }} disabled={disabled} onPress={() => onChange(k)} style={{ flex: 1, minHeight: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.blue : 'transparent' }}>
            <Txt w={700} s={17} c={on ? color.white : color.sub} lh={1.2}>
              {l}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// 하위 화면 공통: 웹 .appbar(높이 56, 가운데 제목) + 스크롤 본문(.pad) + 선택 하단 버튼(.screen-foot)
export function Screen({ title, onClose, close, children, foot }: { title: string; onClose: () => void; close?: boolean; children: ReactNode; foot?: ReactNode }) {
  const inset = useSafeAreaInsets();
  return (
    // 키보드가 저장·제출 버튼을 가리지 않게(Android edge-to-edge에서는 창 크기 조정이 되지 않는다)
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: color.bg, paddingTop: inset.top }}>
      <View style={{ height: space.appbarH, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={close ? '닫기' : '뒤로'} onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={close ? 'close' : 'back'} />
        </Pressable>
        <Txt w={800} s={17} center style={{ flex: 1 }} lines={1}>
          {title}
        </Txt>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space.page, paddingTop: 8, paddingBottom: foot ? 24 : 40 + inset.bottom }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {foot ? <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 + inset.bottom, backgroundColor: color.bg, borderTopWidth: 1, borderTopColor: color.line }}>{foot}</View> : null}
    </KeyboardAvoidingView>
  );
}

// 조회 상태: 불러오는 중 / 실패(+다시 시도) / 비어 있음. 설명은 짧게(웹 .empty).
export function LoadState({ loading, error, onRetry, empty, loadingText = '불러오는 중이에요' }: { loading?: boolean; error?: Failure; onRetry?: () => void; empty?: string; loadingText?: string }) {
  if (error)
    return (
      <View style={{ paddingVertical: 14, gap: 6 }}>
        <Notice kind="err" text={errorText(error, 'load')} />
        {onRetry ? <LinkBtn label="다시 시도" onPress={onRetry} /> : null}
      </View>
    );
  if (loading)
    return (
      <View style={{ paddingVertical: 14, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <ActivityIndicator size="small" color={color.sub} />
        <Txt s={15} c={color.sub}>
          {loadingText}
        </Txt>
      </View>
    );
  return empty ? (
    <Txt s={15} c={color.sub} style={{ paddingVertical: 14 }}>
      {empty}
    </Txt>
  ) : null;
}

export function Notice({ kind, text }: { kind: 'err' | 'warn' | 'ok'; text: string }) {
  const c = kind === 'err' ? color.err : kind === 'warn' ? color.warn : color.blue;
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <View style={{ marginTop: 2 }}>
        <Icon name={kind === 'ok' ? 'check' : 'warn'} s={18} c={c} />
      </View>
      <Txt w={700} s={15} c={c} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

export const Micro = ({ children, c = color.sub }: { children: ReactNode; c?: string }) => (
  <Txt s={size.micro} c={c} lh={1.45} style={{ marginVertical: 6 }}>
    {children}
  </Txt>
);

// 웹 clamp(min rem, cqi, max rem): 폰 폭(w)에 비례하되 최소·최대 사이. rem은 간편 화면 배율(k)을 따른다.
export const clampW = (minRem: number, cqi: number, maxRem: number, w: number, k = 1) => Math.min(maxRem * 16 * k, Math.max(minRem * 16 * k, (cqi / 100) * w));

// 웹 .sheet: 아래에서 올라오는 패널(제목·부제·닫기, 본문 스크롤, 아래 버튼 세로 배치)
export function Sheet({ open, onClose, title, sub, children, foot }: { open: boolean; onClose: () => void; title: string; sub?: string | null; children?: ReactNode; foot?: ReactNode }) {
  const inset = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel="닫기" onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(17,20,40,0.42)' }} />
        <View style={{ maxHeight: '90%', backgroundColor: color.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: inset.bottom }}>
          <View style={{ height: 20, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: color.lineStrong }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingLeft: 20, paddingRight: 10, paddingBottom: 4 }}>
            <View style={{ flex: 1, paddingTop: 6, minWidth: 0 }}>
              <Txt w={700} s={size.h2} lh={1.32}>
                {title}
              </Txt>
              {sub ? (
                <Txt s={15} c={color.sub} style={{ marginTop: 2 }}>
                  {sub}
                </Txt>
              ) : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" />
            </Pressable>
          </View>
          {children ? <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 }}>{children}</ScrollView> : null}
          {foot ? <View style={{ gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: color.line }}>{foot}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

// 웹 .btn-text: 배경 없는 글자 버튼(위험 동작은 빨강)
export function TextBtn({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [{ minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 999 }, pressed && { backgroundColor: color.bg }, disabled && { opacity: 0.4 }]}>
      <Txt w={700} s={16} c={danger ? color.err : color.black}>
        {label}
      </Txt>
    </Pressable>
  );
}
