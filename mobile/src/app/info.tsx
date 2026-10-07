// 정보 및 출처: 확인된 출처·이용 조건만 적는다(웹 정보 및 출처와 같은 기준).
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { PHOTOS } from '../content';
import { Micro, Row, Rows, SecTitle, Screen } from '../ui';

export default function Info() {
  const router = useRouter();
  return (
    <Screen title="정보 및 출처" onClose={() => router.back()}>
      <SecTitle first>사진</SecTitle>
      <Micro>사진마다 확인된 출처와 이용 조건만 적어요. 분위기 사진이며 코스의 정확한 지점이나 지금 모습이 아니에요.</Micro>
      <Rows>
        {Object.values(PHOTOS).map(p => (
          <Row
            key={p.use}
            icon={p.url ? 'out' : undefined}
            title={p.use}
            sub={[p.place, p.credit, p.license, p.note, `${p.w}×${p.h}px`].filter(Boolean).join(' · ')}
            onPress={p.url ? () => void Linking.openURL(p.url!) : undefined}
          />
        ))}
      </Rows>
      <SecTitle>글꼴</SecTitle>
      <Micro>IBM Plex Sans KR (SIL Open Font License 1.1). 숫자는 Archivo(SIL Open Font License 1.1)를 기울임·폭 78%·굵기 800으로 고정한 정적 사본이에요.</Micro>
      <SecTitle>로고</SecTitle>
      <Micro>우이런 로고 11-A(팀 시안).</Micro>
      <SecTitle>날씨</SecTitle>
      <Micro>Open-Meteo 예보·대기질 모델 값을 우이런 서버가 받아 전달해요.</Micro>
      <SecTitle>이 개발 버전의 범위</SecTitle>
      <Micro>홈·지도·운동 기록·환경 제보·마이페이지가 서버와 연결돼 있어요. 혜택은 운영 중인 상품이 있을 때 이용할 수 있어요. 실제 기기에서 로그인·사진·위치 동작은 최종 확인 중이에요. 관찰은 구청이나 기관에 자동으로 전달되지 않아요.</Micro>
    </Screen>
  );
}
