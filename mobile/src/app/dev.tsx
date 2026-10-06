// 개발용 연결 점검(개발 빌드에서만 열린다). backend/client/connection-check.js를 그대로 쓴다.
// 공개: getHome·getMapData / 로그인 후: getMy·getSettings 추가. 조회만 하며 동의·운동·제보 데이터를 만들지 않는다.
// 결과는 이 화면에만 보여주고, 토큰·응답 본문·UID 전체를 표시하거나 로그로 남기지 않는다.
import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { checkConnection, type ConnectionReport } from '../../../backend/client/connection-check';
import { appCheckStatus, APPLICATION_ID, call, CONFIG, EMULATOR_HOST, TARGET } from '../firebase';
import { useSession } from '../session';
import { color } from '../theme';
import { Btn, Micro, Row, Rows, SecTitle, Screen, Txt } from '../ui';

export default function Dev() {
  const router = useRouter();
  const { auth } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [appCheck, setAppCheck] = useState<{ ok: boolean; code?: string } | null>(null);
  const [report, setReport] = useState<ConnectionReport | null>(null);
  if (!__DEV__) return <Redirect href="/" />;

  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const check = (authenticated: boolean) => run(authenticated ? 'me' : 'public', async () => setReport(await checkConnection((name, payload) => call(name, payload), { authenticated })));
  const who = auth.status === 'in' ? `로그인 · ${auth.anonymous ? '익명 테스트 계정' : 'Google 계정'} · ${auth.uid.slice(0, 4)}…` : auth.status === 'out' ? '로그인 안 함' : auth.status;

  return (
    <Screen title="연결 점검" onClose={() => router.back()}>
      <Micro>개발 빌드 전용 화면이에요. 토큰과 응답 내용은 보여주지 않아요.</Micro>
      <Rows>
        <Row title="연결 대상" meta={TARGET === 'emulator' ? `Emulator · ${EMULATOR_HOST}` : TARGET === 'firebase' ? `Firebase · ${CONFIG.projectId}` : '미지정'} />
        <Row title="Functions 리전" meta={CONFIG.functionsRegion} />
        <Row title="동의 버전" meta={CONFIG.consentVersion} />
        <Row title="앱 ID" meta={APPLICATION_ID ?? '–'} />
        <Row title="App Check" meta={TARGET === 'firebase' ? 'debug provider(개발 빌드)' : '사용 안 함(Emulator)'} />
        <Row title="계정" meta={who} />
      </Rows>

      <SecTitle>점검</SecTitle>
      <View style={{ gap: 10 }}>
        <Btn label="App Check 토큰 발급 확인" busy={busy === 'ac'} onPress={() => void run('ac', async () => setAppCheck(await appCheckStatus()))} />
        <Btn label="공개 API 점검" busy={busy === 'public'} onPress={() => void check(false)} />
        <Btn label="로그인 API 점검" busy={busy === 'me'} disabled={auth.status !== 'in'} onPress={() => void check(true)} />
      </View>
      {appCheck ? (appCheck.code === 'EXCLUDED' ? <Result ok name="App Check 토큰" excluded /> : <Result ok={appCheck.ok} name="App Check 토큰" code={appCheck.code} />) : null}
      {report ? (
        <>
          <SecTitle right={report.authenticated ? '로그인 점검' : '공개 점검'}>{report.ok ? '모두 통과' : '실패 있음'}</SecTitle>
          {report.checks.map(c => (
            <Result key={c.name} ok={c.ok} name={c.name} code={c.code} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const Result = ({ ok, name, code, excluded }: { ok: boolean; name: string; code?: string; excluded?: boolean }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.line }}>
    <Txt w={700}>{name}</Txt>
    <Txt w={700} c={excluded ? color.sub : ok ? color.blue : color.err}>
      {excluded ? '검사 제외(Emulator)' : ok ? '통과' : '실패 · ' + (code ?? '알 수 없음')}
    </Txt>
  </View>
);
