// 프로필 수정: 이름 하나. 서버와 같은 기준(trim 후 Unicode 문자 30자, 빈 값이면 이름 초기화).
// 저장 전에 뒤로 가면 바뀌지 않고, 실패하면 입력을 그대로 둔다. 로그인할 때 Google 이름으로 덮어쓰지 않는다(이 화면에서만 바꾼다).
import { useState } from 'react';
import { Platform, TextInput, ToastAndroid, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApi, useCloseOnAccountChange, useSession } from '../session';
import { checkName, errorText, NAME_MAX, type Failure, type Settings } from '../core';
import { color, font } from '../theme';
import { Btn, LoadState, Micro, Notice, Screen, Txt } from '../ui';

export default function Profile() {
  useCloseOnAccountChange();
  const router = useRouter();
  const { mutate, refresh } = useSession();
  const settings = useApi<Settings>('getSettings', {}, true);
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const text = value ?? settings.data?.displayName ?? '';
  const name = checkName(text);

  const save = async () => {
    if (busy || !name.ok) return;
    setBusy(true);
    setError(null);
    const r = await mutate<{ displayName: string }>('updateProfile', { displayName: name.value }, 'profile');
    setBusy(false);
    if (!r.ok) return setError(r);
    void refresh('getSettings', 'getMy', 'getHome');
    if (Platform.OS === 'android') ToastAndroid.show(r.value.displayName ? '이름을 저장했어요' : '이름을 비웠어요', ToastAndroid.SHORT);
    router.back();
  };

  return (
    <Screen title="프로필 수정" onClose={() => router.back()} foot={<Btn kind="blue" label={busy ? '저장하는 중' : '저장'} onPress={() => void save()} busy={busy} disabled={!settings.data || !name.ok} style={{ flex: 1 }} />}>
      {settings.data ? (
        <View style={{ marginTop: 12, gap: 6 }}>
          <Txt w={700} s={15}>
            이름
          </Txt>
          <TextInput
            value={text}
            onChangeText={setValue}
            autoFocus
            maxLength={120}
            autoComplete="nickname"
            accessibilityLabel="이름"
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            style={{ minHeight: 52, paddingHorizontal: 14, borderWidth: 1, borderColor: name.ok ? color.lineStrong : color.err, borderRadius: 12, backgroundColor: color.panel, fontFamily: font[400], fontSize: 17, color: color.black }}
          />
          <Micro c={name.ok ? color.sub : color.err}>
            {name.length}/{NAME_MAX}자 · 비워 두면 ‘이름 없음’으로 보여요 · 다른 이용자에게는 보이지 않아요
          </Micro>
        </View>
      ) : (
        <LoadState loading={settings.loading} error={settings.error} onRetry={() => void settings.reload()} />
      )}
      {error ? (
        <View style={{ marginTop: 12 }}>
          <Notice kind="err" text={errorText(error)} />
        </View>
      ) : null}
    </Screen>
  );
}
