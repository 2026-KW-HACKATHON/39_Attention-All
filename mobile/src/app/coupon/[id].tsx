// 쿠폰 사용: requestCouponUse가 준 10분 사용창(서버 시각) 안에서 점포 직원이 PIN을 입력하면 confirmCouponUse.
// 화면을 다시 열어도 서버의 기존 사용창을 그대로 쓴다(연장 없음). PIN은 앞자리 0을 지키는 문자열이며 로그로 남기지 않는다.
// 남은 시간이 0이 돼도 앱이 ‘사용 완료’로 바꾸지 않는다(서버 응답만 반영).
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApi, useCloseOnAccountChange, mutate, refresh } from '../../session';
import { errorText, kstDateTime, type Benefits, type Failure } from '../../core';
import { color, font } from '../../theme';
import { Btn, LoadState, Micro, Notice, Num, Screen, Txt } from '../../ui';

const ERR: Record<string, string> = {
  INVALID_MERCHANT_PIN: 'PIN이 맞지 않아요.',
  COUPON_LOCKED: '여러 번 틀려 잠시 잠겼어요. 잠금이 풀린 뒤 다시 시도해 주세요.',
  USE_WINDOW_EXPIRED: '사용 시간이 지났어요. 다시 사용하기를 눌러 주세요.',
  COUPON_EXPIRED: '기간이 지난 쿠폰이에요.',
  COUPON_UNAVAILABLE: '이미 사용했거나 쓸 수 없는 쿠폰이에요.',
  MERCHANT_DAILY_LIMIT: '이 점포에서 오늘은 더 사용할 수 없어요.',
};

export default function CouponScreen() {
  useCloseOnAccountChange();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi<Benefits>('getBenefits', {}, true);
  const [win, setWin] = useState<{ useSessionId: string; endsAt: number } | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Failure | null>(null);
  const [usedAt, setUsedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const c = q.data?.coupons.find(x => x.id === id);
  const merchant = q.data?.merchants.find(m => m.id === c?.merchantId);
  const window = win ?? (c?.window && c.window.endsAt > now ? c.window : null);
  if (!c) return <Screen title="쿠폰" onClose={() => router.back()}><LoadState loading={q.loading} error={q.error} onRetry={() => void q.reload()} empty="쿠폰을 찾을 수 없어요" /></Screen>;
  const left = window ? Math.max(0, Math.round((window.endsAt - now) / 1000)) : 0;

  const request = async () => {
    setBusy(true);
    setErr(null);
    const r = await mutate<{ useSessionId: string; expiresAt: number }>('requestCouponUse', { couponId: c.id }, 'couponUse:' + c.id);
    setBusy(false);
    if (!r.ok) return setErr(r);
    setWin({ useSessionId: r.value.useSessionId, endsAt: r.value.expiresAt });
  };
  const confirm = async () => {
    if (!window || !/^\d{6}$/.test(pin) || busy) return;
    setBusy(true);
    setErr(null);
    const r = await mutate<{ usedAt: number }>('confirmCouponUse', { couponId: c.id, useSessionId: window.useSessionId, pin }, 'couponConfirm:' + c.id);
    setBusy(false);
    setPin('');
    if (!r.ok) {
      setErr(r);
      void refresh('getBenefits');
      return;
    }
    setUsedAt(r.value.usedAt);
    void refresh('getBenefits', 'getMy');
  };

  return (
    <Screen title="쿠폰 사용" onClose={() => router.back()}>
      <Txt w={700} s={20}>{merchant?.name ?? '제휴처'}</Txt>
      <Micro>{kstDateTime(c.expiresAt)}까지{merchant?.isDemo ? ' · 제휴 전 예시 혜택이라 실제 점포에서 쓸 수 없어요' : ''}</Micro>
      {usedAt || c.status === 'USED' ? (
        <Notice kind="ok" text={`사용 완료 · ${kstDateTime(usedAt ?? c.usedAt ?? now)}`} />
      ) : c.status === 'EXPIRED' || c.status === 'REVOKED' ? (
        <Notice kind="err" text={c.status === 'EXPIRED' ? '기간이 지난 쿠폰이에요.' : '철회된 쿠폰이에요.'} />
      ) : window && left > 0 ? (
        <View style={{ gap: 10, marginTop: 12 }}>
          <Num s={56} c={color.deep}>{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</Num>
          <Micro>점포 직원에게 이 화면을 보여주고 직원이 PIN 6자리를 입력해요.</Micro>
          <TextInput value={pin} onChangeText={v => setPin(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6} accessibilityLabel="직원 PIN" placeholder="PIN 6자리" style={{ minHeight: 52, paddingHorizontal: 14, borderWidth: 1, borderColor: color.lineStrong, borderRadius: 12, backgroundColor: color.panel, fontFamily: font[400], fontSize: 20, letterSpacing: 6, color: color.black }} />
          <Btn kind="ink" label="사용 확인" busy={busy} disabled={pin.length !== 6} onPress={() => void confirm()} />
        </View>
      ) : (
        <View style={{ gap: 10, marginTop: 12 }}>
          {window ? <Micro>사용 시간이 지났어요.</Micro> : null}
          <Btn kind="ink" label="사용하기(10분)" busy={busy} onPress={() => void request()} />
        </View>
      )}
      {err ? <View style={{ marginTop: 8 }}><Notice kind="err" text={ERR[err.errorCode] ?? errorText(err)} /></View> : null}
    </Screen>
  );
}
