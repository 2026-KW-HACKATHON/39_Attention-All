// 사진 표시: 공개 화면은 운영자가 승인한 공개 사본(getPublicPhotoAccess)만, 내 기록은 내 원본(getPhotoAccess)만.
// 사진 ID가 없으면 서버를 부르지 않는다. URL은 5분이면 만료되므로 이미지 로드가 실패하면 한 번 다시 받고, 그래도 안 되면 ‘다시 시도’.
import { useState } from 'react';
import { Image, View } from 'react-native';
import { useApi } from './session';
import { kstDateTime } from './core';
import { color } from './theme';
import { LinkBtn, Micro, Txt } from './ui';

export function ServerPhoto({ photoId, own, takenAt, height = 200, emptyText = '공개된 사진 없음' }: { photoId: string | null | undefined; own?: boolean; takenAt?: number | null; height?: number; emptyText?: string }) {
  const q = useApi<{ url: string }>(own ? 'getPhotoAccess' : 'getPublicPhotoAccess', { photoId: photoId ?? '' }, !!own, !photoId);
  const [failed, setFailed] = useState(0);
  if (!photoId)
    return (
      <View style={{ height: 64, borderRadius: 12, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Txt s={14} c={color.sub}>
          {emptyText}
        </Txt>
      </View>
    );
  const broken = !!q.error || failed > 1;
  return (
    <View>
      {q.data?.url && !broken ? (
        <Image
          source={{ uri: q.data.url }}
          accessibilityLabel={own ? '내가 찍은 사진' : '공개 승인된 현장 사진'}
          style={{ width: '100%', height, borderRadius: 12, backgroundColor: color.water }}
          onError={() => {
            setFailed(n => n + 1);
            if (!failed) void q.reload(); // 만료된 URL일 수 있다: 한 번만 새로 받는다
          }}
        />
      ) : (
        <View style={{ height, borderRadius: 12, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Txt s={14} c={color.sub}>
            {broken ? (q.error?.errorCode === 'NOT_FOUND' ? '사진이 삭제됐거나 아직 처리 중이에요' : '사진을 불러오지 못했어요') : '사진을 불러오는 중'}
          </Txt>
          {broken && q.error?.errorCode !== 'NOT_FOUND' ? (
            <LinkBtn
              label="다시 시도"
              onPress={() => {
                setFailed(0);
                void q.reload();
              }}
            />
          ) : null}
        </View>
      )}
      {takenAt ? <Micro>{kstDateTime(takenAt)} 촬영</Micro> : null}
    </View>
  );
}
