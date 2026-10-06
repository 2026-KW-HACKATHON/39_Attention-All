// 혜택: getBenefits(Welcome 진행·제휴처·상품·내 쿠폰). 발급은 claimWelcome의 서버 판단(기여 3회·운영자 승인·재고·제휴처)만 따른다.
// 상품이나 제휴처가 등록되지 않았으면 ‘준비 중’으로 두고 발급하지 않는다. 포인트 교환 상품은 없다.
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApi, useCloseOnAccountChange, mutate, refresh } from '../session';
import { errorText, kstDateTime, welcomeText, WELCOME_TARGET, type Benefits, type Failure } from '../core';
import { color } from '../theme';
import { Btn, LoadState, Micro, Notice, Num, Row, Rows, Screen, SecTitle, Txt } from '../ui';

const STATE: Record<string, string> = { ISSUED: '사용 가능', USE_REQUESTED: '사용 중', USED: '사용 완료', EXPIRED: '기간 만료', REVOKED: '철회됨' };
const CLAIM_TEXT: Record<string, string> = {
  REWARD_NOT_CONFIGURED: '혜택 운영(제휴처·상품)이 아직 준비되지 않았어요.',
  REWARD_SOLD_OUT: '준비된 수량이 모두 소진됐어요.',
  WELCOME_ADMIN_REQUIRED: '운영자 확인 뒤 받을 수 있어요.',
  WELCOME_NOT_ELIGIBLE: '아직 받을 수 있는 조건이 아니에요.',
};

export default function BenefitsScreen() {
  useCloseOnAccountChange();
  const router = useRouter();
  const q = useApi<Benefits>('getBenefits', {}, true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const b = q.data;
  if (!b) return <Screen title="혜택" onClose={() => router.back()}><LoadState loading={q.loading} error={q.error} onRetry={() => void q.reload()} /></Screen>;
  const n = Math.min(WELCOME_TARGET, b.welcomeCount), cat = b.catalog[0], merchant = b.merchants.find(m => m.id === cat?.merchantId);
  const usable = b.coupons.filter(c => c.status === 'ISSUED' || c.status === 'USE_REQUESTED'), past = b.coupons.filter(c => !usable.includes(c));
  const status = b.user.welcomeStatus;
  const claim = async () => {
    setBusy(true);
    setMsg(null);
    const r = await mutate<{ couponId: string }>('claimWelcome', {}, 'claimWelcome');
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: CLAIM_TEXT[r.errorCode] ?? errorText(r as Failure) });
    setMsg({ ok: true, text: '혜택을 받았어요.' });
    void refresh('getBenefits', 'getMy', 'getHome');
  };
  return (
    <Screen title="혜택" onClose={() => router.back()}>
      <SecTitle first right={`${usable.length}장`}>사용 가능</SecTitle>
      <Rows>
        {usable.map(c => (
          <Row key={c.id} icon="ticket" title={(cat?.title ?? '웰컴 혜택') + (merchant ? ' · ' + merchant.name : '')} sub={`${STATE[c.status]} · ${kstDateTime(c.expiresAt)}까지${merchant?.isDemo ? ' · 예시 혜택' : ''}`} onPress={() => router.push(('/coupon/' + c.id) as never)} />
        ))}
      </Rows>
      {!usable.length ? <Micro>지금 쓸 수 있는 혜택이 없어요.</Micro> : null}

      <SecTitle>웰컴 혜택</SecTitle>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Num s={44} c={color.deep}>{n}</Num>
        <Txt w={800} s={18} c={color.deep}>/{WELCOME_TARGET}</Txt>
      </View>
      <Txt s={15}>{welcomeText(status, n)}</Txt>
      {cat ? <Micro>{cat.title} · {cat.condition} · 받은 날부터 {cat.validDays}일 · 남은 수량 {cat.stock}{cat.isDemo ? ' · 제휴 전 예시 혜택' : ''}</Micro> : <Micro>혜택 운영(제휴처·상품)을 준비하고 있어요.</Micro>}
      {status === 'APPROVED' || status === 'SOLD_OUT' ? <Btn kind="ink" label={status === 'SOLD_OUT' ? '수량 다시 확인' : '혜택 받기'} busy={busy} disabled={!cat} onPress={() => void claim()} style={{ marginTop: 8 }} /> : null}
      {msg ? <View style={{ marginTop: 8 }}><Notice kind={msg.ok ? 'ok' : 'err'} text={msg.text} /></View> : null}
      <Micro>인정되는 기여: 다른 사람 관찰에 처음 남긴 사진, 검토된 새 제보 사진, 정기 관찰 사진(하루 1회). 간단 응답은 포함되지 않아요.</Micro>

      {past.length ? (
        <>
          <SecTitle>지난 혜택</SecTitle>
          <Rows>
            {past.map(c => (
              <Row key={c.id} icon="ticket" title={cat?.title ?? '웰컴 혜택'} sub={`${STATE[c.status]} · ${c.usedAt ? kstDateTime(c.usedAt) + ' 사용' : kstDateTime(c.expiresAt) + '까지'}`} />
            ))}
          </Rows>
        </>
      ) : null}
    </Screen>
  );
}
