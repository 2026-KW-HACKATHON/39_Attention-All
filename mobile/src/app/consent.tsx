// 약관 동의: getSettings.consent가 서버 현재 버전이 아닐 때만 연다. 사용자가 모두 확인해야 recordConsent를 보낸다.
// 문안은 출시 전 확정할 시안이다(FRONTEND.md §3). 닫으면 나중에 다시 묻는다(이번 실행 중에는 다시 열지 않는다).
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCloseOnAccountChange, useSession } from '../session';
import { CONFIG } from '../firebase';
import { errorText, type Failure } from '../core';
import { color } from '../theme';
import { Btn, Icon, Micro, Notice, Screen, Txt } from '../ui';

const TERMS: [string, string, string | null][] = [
  ['tos', '서비스 이용약관', null],
  ['privacy', '개인정보 수집·이용', '운동 경로, 촬영·참여 위치, 관찰 사진을 모아요. 보관 기간과 삭제 방식은 출시 전 문안에서 확정해요.'],
  ['lbs', '위치기반서비스 이용약관', null],
];

function Check({ on, label, desc, strong, onPress }: { on: boolean; label: string; desc?: string | null; strong?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 16, borderBottomWidth: strong ? 2 : 1, borderBottomColor: strong ? color.black : color.line }}>
      <View style={{ width: 22, height: 22, marginTop: 2, borderRadius: 4, borderWidth: 2, borderColor: on ? color.blue : color.lineStrong, backgroundColor: on ? color.blue : color.panel, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Icon name="check" s={16} w={2.6} c={color.white} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Txt w={strong ? 800 : 700} s={strong ? 17 : 16}>
          {label}
        </Txt>
        {desc ? <Micro>{desc}</Micro> : null}
      </View>
    </Pressable>
  );
}

export default function Consent() {
  useCloseOnAccountChange();
  const router = useRouter();
  const { then } = useLocalSearchParams<{ then?: string }>();
  const { mutate, refresh } = useSession();
  const [agree, setAgree] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const all = TERMS.every(([k]) => agree[k]);

  const submit = async () => {
    if (!all || busy) return;
    setBusy(true);
    setError(null);
    const r = await mutate('recordConsent', { version: CONFIG.consentVersion, accepted: true }, 'consent');
    setBusy(false);
    if (!r.ok) return setError(r);
    void refresh('getSettings');
    router.back();
    if (then) router.navigate(then as Href);
  };

  return (
    <Screen title="약관 동의" close onClose={() => router.back()} foot={<Btn kind="ink" label="동의하고 계속" onPress={() => void submit()} disabled={!all} busy={busy} style={{ flex: 1 }} />}>
      <Micro>문안은 출시 전에 확정할 시안이에요. 동의 버전 {CONFIG.consentVersion}</Micro>
      <Check strong on={all} label="모두 동의" onPress={() => setAgree(Object.fromEntries(TERMS.map(([k]) => [k, !all])))} />
      {TERMS.map(([k, label, desc]) => (
        <Check key={k} on={!!agree[k]} label={'(필수) ' + label} desc={desc} onPress={() => setAgree(a => ({ ...a, [k]: !a[k] }))} />
      ))}
      <Micro>알림과 카메라 권한은 필요한 순간에 따로 물어봐요.</Micro>
      {error ? (
        <View style={{ marginTop: 8 }}>
          <Notice kind="err" text={errorText(error)} />
        </View>
      ) : null}
    </Screen>
  );
}
