// 날씨 상세: getWeather 응답의 현재값·대기질·수신 상태·출처. 값이 없으면 ‘정보 없음’으로 두고 만들어 채우지 않는다.
// 12시간 예보 그래프는 다음 단계에서 옮긴다.
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApi } from '../session';
import { kstTime, pmGrade, weatherView, type Weather } from '../core';
import { color } from '../theme';
import { Icon, LoadState, Micro, Num, Row, Rows, SecTitle, Screen, Txt } from '../ui';

export default function WeatherScreen() {
  const router = useRouter();
  const q = useApi<Weather>('getWeather');
  const v = weatherView(q.data);
  const units = q.data?.forecast?.current_units ?? {};
  const cur = q.data?.forecast?.current ?? {};
  const val = (x: unknown, unit: string, digits = 0) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(digits) + unit : '정보 없음');
  const pm = (kind: 'pm10' | 'pm2_5', x: number | null) => (x == null ? '정보 없음' : `${Math.round(x)} ${v?.airUnit} · ${pmGrade(kind, x)}`);

  return (
    <Screen title="우이천 날씨" close onClose={() => router.back()}>
      <Micro>파일럿 구간 중앙 좌표 기준</Micro>
      {!v ? (
        <LoadState loading={q.loading} error={q.error ?? (q.data ? { ok: false, errorCode: 'WEATHER_UNAVAILABLE', details: {}, retryable: true } : undefined)} onRetry={() => void q.reload()} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <Icon name={v.icon} s={48} w={1.6} c={color.blue} />
            <Num s={56}>{v.tempExact}°</Num>
            <View style={{ flex: 1 }}>
              <Txt w={700} s={17}>
                {v.label}
              </Txt>
              <Txt s={14} c={v.stale ? color.warn : color.sub}>
                {(v.stale ? '업데이트 지연 · ' : '정상 · ') + (v.fetchedAt ? kstTime(v.fetchedAt) + ' 수신' : '수신 시각 없음')}
              </Txt>
            </View>
          </View>
          <Rows style={{ marginTop: 16 }}>
            <Row title="체감" meta={typeof cur.apparent_temperature === 'number' ? v.sub[0].replace('체감 ', '') : '정보 없음'} />
            <Row title="습도" meta={val(cur.relative_humidity_2m, '%')} />
            <Row title="바람" meta={val(cur.wind_speed_10m, ' ' + (units.wind_speed_10m === 'km/h' ? 'km/h' : 'm/s'), 1)} />
            <Row title="강수(직전 15분)" meta={val(cur.precipitation, ' ' + (units.precipitation ?? 'mm'), 1)} />
          </Rows>
          <SecTitle>미세먼지</SecTitle>
          <Rows>
            <Row title="미세먼지 PM10" meta={pm('pm10', v.pm10)} />
            <Row title="초미세먼지 PM2.5" meta={pm('pm2_5', v.pm25)} />
          </Rows>
          <Micro>등급은 환경부 구간을 참고한 표시예요.</Micro>
          <SecTitle>출처</SecTitle>
          <Micro>{(v.source ?? '출처 미상') + (v.isModelEstimate ? ' 예보 모델 추정값 · 측정소 실측값이 아니에요' : '')}</Micro>
        </>
      )}
    </Screen>
  );
}
