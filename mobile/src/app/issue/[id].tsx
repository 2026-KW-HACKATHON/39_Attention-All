import { useParticipationAccess } from '../../proximity';
import { OUTSIDE_PARTICIPATION_TEXT } from '../../pilot-proximity';
// 관찰 상세: getIssueDetail(공개 정보·공개 참여 이력) + 공개 승인된 사진만. 숨김·삭제된 관찰은 NOT_FOUND로 안내한다.
// 참여: 지금도 보여요(QUICK), 사진으로 재확인, 내 제보면 사진 보완. 가능 여부·보상은 서버가 판단한다.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useApi } from '../../session';
import { issueCurrent, kstDateTime, ROLE_LABEL, type Category, type Issue, type Page } from '../../core';
import { ServerPhoto } from '../../photos';
import { color } from '../../theme';
import { Btn, LoadState, Micro, Row, Rows, Screen, SecTitle, Txt } from '../../ui';

const LEVEL: Record<string, string> = { NONE: '검토 전', PEER: '다른 사람 사진으로 확인', ADMIN: '운영자 확인' };

export default function IssueDetail() {
  const access = useParticipationAccess();
  const router = useRouter();
  const { id, exposure } = useLocalSearchParams<{ id: string; exposure?: string }>();
  const q = useApi<{ issue: Issue; observations: Page<{ id: string; modality: string; role: string; observedAt: number }>; own: boolean }>('getIssueDetail', { issueId: id });
  const pilot = useApi<{ categories: Record<string, Category> }>('getPilotData');
  const i = q.data?.issue;
  if (!i)
    return (
      <Screen title="관찰" onClose={() => router.back()}>
        {q.error?.errorCode === 'NOT_FOUND' ? <Micro>숨김·삭제됐거나 볼 수 없는 관찰이에요.</Micro> : <LoadState loading={q.loading} error={q.error} onRetry={() => void q.reload()} />}
      </Screen>
    );
  const cur = issueCurrent(i, pilot.data?.categories[i.categoryCode]?.staleH ?? 72);
  const go = (kind: string) => void access.open(`/report?kind=${kind}&target=${i.id}${exposure ? '&exposure=' + exposure : ''}`);
  return (
    <Screen title={i.categoryLabel ?? '관찰'} onClose={() => router.back()}>
      <Txt w={700} s={15} c={cur ? color.blue : color.sub}>
        {cur ? '지금 보이는 관찰' : '지난 기록'} · {LEVEL[i.verificationLevel] ?? i.verificationLevel}
      </Txt>
      <Micro>
        처음 접수 {kstDateTime(i.createdAt)}
        {i.lastPhotoObservedAt ? ' · 최근 사진 ' + kstDateTime(i.lastPhotoObservedAt) : ''} · 사진 기록 {i.photoObservationCount}건 · 오늘 간단 응답 {i.todaySignalAccountCount}명
      </Micro>
      <View style={{ marginTop: 8 }}>
        <ServerPhoto photoId={i.publicPhoto?.id} takenAt={i.publicPhoto?.takenAt} />
      </View>
      {access.restricted ? <Micro>{OUTSIDE_PARTICIPATION_TEXT}</Micro> : null}
      {cur ? (
        q.data?.own ? (
          // 내가 올린 제보는 재확인할 수 없다(서버 OWN_ISSUE_RECHECK). 사진 보완만 보인다.
          <View style={{ gap: 10, marginTop: 16 }}>
            <Btn kind="blue" icon="camera" label="내 제보에 사진 보완" disabled={access.restricted} onPress={() => go('add')} />
            <Micro>내가 올린 제보예요. 다른 사람의 확인으로 검증돼요.</Micro>
          </View>
        ) : (
          <View style={{ gap: 10, marginTop: 16 }}>
            <Btn kind="blue" label="지금도 보여요" disabled={access.restricted} onPress={() => go('quick')} />
            <Btn label="사진으로 재확인" icon="camera" disabled={access.restricted} onPress={() => go('recheck')} />
          </View>
        )
      ) : (
        <Micro>지난 기록이라 참여할 수 없어요. 같은 문제가 다시 보이면 새로 제보해 주세요.</Micro>
      )}
      <SecTitle>참여 기록</SecTitle>
      <Rows>
        {q.data!.observations.items.map(o => (
          <Row key={o.id} title={`${ROLE_LABEL[o.role] ?? o.role} · ${o.modality === 'PHOTO' ? '사진' : '간단 응답'}`} sub={kstDateTime(o.observedAt)} />
        ))}
      </Rows>
      {q.data!.observations.nextCursor ? <Micro>최근 기록만 보여요.</Micro> : null}
      <Micro>다른 사람이 찍은 원본 사진과 참여자 정보는 보여주지 않아요.</Micro>
    </Screen>
  );
}
