// 운동 경로 지도(웹 결과 지도 res-map): 흰 테두리 + 파란 경로, 일시정지 뒤 재개 지점, 출발·종료 표시.
// 지도 키(GOOGLE_MAPS_API_KEY)가 있으면 Google 지도 위에, 없으면 배경 지도 없이 같은 경로 모양만 그린다.
// 기록된 경로가 없으면 경로를 지어내지 않고 이유만 적는다.
import { useState } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Circle as MapCircle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import { linePath, projector, type LatLng } from './core';
import { color, font } from './theme';
import { Micro, Txt } from './ui';

export const hasMapsKey = !!(Constants.expoConfig?.extra as { hasMapsKey?: boolean } | undefined)?.hasMapsKey;
const ll = (p: LatLng) => ({ latitude: p[0], longitude: p[1] });

export function region(pts: LatLng[], pad = 1.35) {
  const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1]);
  const minA = Math.min(...lats), maxA = Math.max(...lats), minO = Math.min(...lngs), maxO = Math.max(...lngs);
  return { latitude: (minA + maxA) / 2, longitude: (minO + maxO) / 2, latitudeDelta: Math.max(0.002, (maxA - minA) * pad), longitudeDelta: Math.max(0.002, (maxO - minO) * pad) };
}

export function RouteMap({ segs, height = 240, empty }: { segs: LatLng[][]; height?: number; empty: string }) {
  const [w, setW] = useState(0);
  const lines = segs.filter(s => s.length > 1);
  if (!lines.length)
    return (
      <View style={{ height: 120, marginTop: 4, marginBottom: 14, borderRadius: 14, backgroundColor: '#EEF0F5', alignItems: 'center', justifyContent: 'center' }}>
        <Txt s={15} c={color.sub}>{empty}</Txt>
      </View>
    );
  const first = lines[0][0], last = lines.at(-1)!.at(-1)!, resumes = lines.slice(1).map(s => s[0]);
  if (hasMapsKey)
    return (
      <View style={{ height, marginTop: 4, marginBottom: 14, borderRadius: 14, overflow: 'hidden', backgroundColor: '#EEF0F5' }}>
        <MapView provider={PROVIDER_GOOGLE} liteMode style={{ flex: 1 }} initialRegion={region(lines.flat())} toolbarEnabled={false} accessibilityLabel="운동 경로 지도">
          {lines.map((s, i) => <Polyline key={'c' + i} coordinates={s.map(ll)} strokeColor={color.white} strokeWidth={10} />)}
          {lines.map((s, i) => <Polyline key={'r' + i} coordinates={s.map(ll)} strokeColor={color.blue} strokeWidth={5} zIndex={2} />)}
          {resumes.map((p, i) => <MapCircle key={'g' + i} center={ll(p)} radius={4} strokeColor={color.deep} strokeWidth={2} fillColor={color.white} zIndex={3} />)}
          <Marker coordinate={ll(first)} title="출발" pinColor="yellow" tracksViewChanges={false} />
          <Marker coordinate={ll(last)} title="종료" pinColor="navy" tracksViewChanges={false} />
        </MapView>
      </View>
    );
  const f = w ? projector(lines.flat(), w, height, 28) : null;
  // 출발·종료가 가까우면(왕복) 종료 이름표를 왼쪽에 둬 겹치지 않게 한다
  const near = f ? Math.hypot(f(first)[0] - f(last)[0], f(first)[1] - f(last)[1]) < 60 : false;
  const label = (p: LatLng, text: string, fill: string, fg: string, left = false) => {
    const [x, y] = f!(p);
    const lx = left ? x - 48 : x + 10;
    return (
      <>
        <Rect x={lx} y={y - 11} width={38} height={22} rx={11} fill={fill} stroke={fill === color.lime ? color.black : color.white} strokeWidth={1.5} />
        <SvgText x={lx + 19} y={y + 4} fontSize={11} fontFamily={font[700]} fill={fg} textAnchor="middle">{text}</SvgText>
        <Circle cx={x} cy={y} r={7} fill={fill} stroke={fill === color.lime ? color.black : color.white} strokeWidth={2} />
      </>
    );
  };
  return (
    <View style={{ marginTop: 4, marginBottom: 14 }}>
      <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height, borderRadius: 14, overflow: 'hidden', backgroundColor: '#EEF0F5' }}>
        {f ? (
          <Svg width={w} height={height} accessibilityLabel="운동 경로 모양">
            {lines.map((s, i) => <Path key={'c' + i} d={linePath(s, f)} stroke={color.white} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
            {lines.map((s, i) => <Path key={'r' + i} d={linePath(s, f)} stroke={color.blue} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
            {resumes.map((p, i) => <Circle key={'g' + i} cx={f(p)[0]} cy={f(p)[1]} r={4} fill={color.white} stroke={color.deep} strokeWidth={2} />)}
            {label(last, '종료', color.deep, color.white, near)}
            {label(first, '출발', color.lime, color.black)}
          </Svg>
        ) : null}
      </View>
      <Micro>지도 키가 없어 배경 지도 없이 경로 모양만 보여요.{resumes.length ? ' 흰 점은 일시정지 뒤 다시 시작한 곳이에요.' : ''}</Micro>
    </View>
  );
}
