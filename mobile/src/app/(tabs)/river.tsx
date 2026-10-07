import { useParticipationAccess } from '../../proximity';
import { OUTSIDE_PARTICIPATION_TEXT } from '../../pilot-proximity';
// 우리 우이천: 현장 관찰(지금 보이는 관찰·지난 기록)과 우이천 소식. getRiverFeed의 목록마다 커서를 따로 쓴다.
// 소식 날짜는 셋을 섞지 않는다: 자료 날짜(pub+pubKind), 앱 게시일(publishedAt), 팀 확인일(checked).
import { useState } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { refresh, useApi } from '../../session';
import { usePaged } from '../../paged';
import { kstDateTime, type Home, type Issue, type News } from '../../core';
import { PHOTOS } from '../../content';
import { ObservationGuide } from '../../observation-guide';
import { color, space } from '../../theme';
import { Btn, Icon, LinkBtn, LoadState, Micro, Row, Rows, SecTitle, Seg, Txt } from '../../ui';

const TOPIC: Record<string, string> = { eco: '생태·하천 정보', proposal: '개선 제안', plan: '사업 계획' };
const KIND: Record<string, string> = { unknown: '출처 유형 미지정', official: '공식 자료', council: '의회 회의록', press: '언론 보도', citizen: '시민기자 기사' };
const ymd = (d: string) => d.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, (_, y, m, dd) => `${y}. ${+m}. ${+dd}.`);

function IssueList({ field, cursor, title }: { field: 'current' | 'past'; cursor: string; title: string }) {
  const router = useRouter();
  const list = usePaged<Issue>('getRiverFeed', field, cursor);
  return (
    <View>
      <SecTitle>{title}</SecTitle>
      <Rows>
        {list.items.map(i => (
          <Row key={i.id} title={i.categoryLabel ?? i.categoryCode} titleColor={field === 'past' ? color.sub : undefined} sub={`${field === 'current' ? '최근 확인' : '마지막 확인'} ${kstDateTime(i.lastPhotoObservedAt || i.createdAt)} · 오늘 간단 응답 ${i.todaySignalAccountCount}명`} onPress={() => router.push(('/issue/' + i.id) as never)} />
        ))}
      </Rows>
      <LoadState loading={list.loading} error={list.error} onRetry={list.reload} empty={list.done && !list.items.length ? (field === 'current' ? '지금 보이는 관찰이 없어요' : '지난 기록이 없어요') : undefined} />
      {list.next && !list.loading ? <LinkBtn label="더 보기" onPress={list.more} /> : null}
    </View>
  );
}

// 웹 news 카드: 분류·상태 → 제목 → 자료 날짜 → 요약(3줄, 펼치면 전체) → 출처·유형(펼치면 팀 확인일) → 요약 더 보기/원문 보기
function NewsItem({ n }: { n: News }) {
  const [open, setOpen] = useState(false);
  const summary = n.summary ?? n.body ?? '';
  const url = n.url ?? n.sourceUrl;
  return (
    <View style={{ paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: color.line }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {n.topic && TOPIC[n.topic] ? <Txt w={800} s={13} c={color.blue}>{TOPIC[n.topic]}</Txt> : null}
        {n.status ? (
          <View style={{ paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, borderWidth: 1, borderColor: color.deep }}>
            <Txt w={700} s={12} c={color.deep}>{n.status}</Txt>
          </View>
        ) : null}
      </View>
      <Txt w={700} s={18} lh={1.4} style={{ marginTop: 6, marginBottom: 6 }}>{n.title}</Txt>
      <Txt w={700} s={13} c={color.sub}>
        {n.pub ? `${ymd(n.pub)} ${n.pubKind ?? ''}` : n.pubKind ?? (n.publishedAt ? `앱 게시 ${kstDateTime(n.publishedAt)}` : '')}
        {n.event ? ' · ' + n.event : ''}
      </Txt>
      {summary ? (
        <Txt s={15} lh={1.65} lines={open ? undefined : 3} style={{ marginTop: 8, marginBottom: 2 }}>
          {summary}
        </Txt>
      ) : null}
      <Txt s={13} c={color.sub} style={{ marginTop: 4 }}>
        {[n.source, n.kind ? KIND[n.kind] ?? null : null].filter(Boolean).join(' · ')}
        {open ? ` · 팀 확인 ${n.checked ? ymd(n.checked) : '미등록'}` : ''}
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <LinkBtn label={open ? '접기' : '요약 더 보기'} onPress={() => setOpen(o => !o)} />
        {url ? (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Txt w={700} s={15}>원문 보기</Txt>
            <Icon name="out" s={16} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function RiverTab() {
  const access = useParticipationAccess();
  const inset = useSafeAreaInsets();
  const [pastOpen, setPastOpen] = useState(false);
  const [tab, setTab] = useState<'field' | 'news'>('field');
  const [topic, setTopic] = useState<'all' | 'eco' | 'proposal' | 'plan'>('all');
  const home = useApi<Home>('getHome');
  // 소식은 많지 않아 끝까지 받아 분류별로 거른다(다음 페이지가 남았는데 ‘소식 없음’이라고 하지 않는다)
  const news = usePaged<News>('getRiverFeed', 'news', 'newsCursor', {}, false, true);
  const s = home.data?.riverSummary;
  // 자료 날짜 순. 발행일이 없는 상시 페이지는 맨 뒤(팀 확인일을 최신 소식처럼 쓰지 않는다)
  const [pulling, setPulling] = useState(false);
  const pull = () => {
    setPulling(true);
    void refresh('getHome', 'getRiverFeed').finally(() => setPulling(false));
  };
  const shown = news.items.filter(n => topic === 'all' || n.topic === topic).sort((a, b) => (b.pub ?? '').localeCompare(a.pub ?? ''));
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ padding: space.page, paddingTop: 20 + inset.top, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} colors={[color.blue]} progressViewOffset={inset.top} />}>
      <Txt w={700} s={28} lh={1.25} style={{ marginTop: 4, marginBottom: 12 }}>
        우리 우이천
      </Txt>
      <View style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
        <Image source={PHOTOS.river.src} accessibilityLabel="우이천 분위기 사진" style={{ width: '100%', height: 148 }} resizeMode="cover" />
      </View>
      <Micro>우이천 초안교 부근 · 2020년 4월 사진. 지금 현장 모습은 아니에요. 출처: 서울연구원 서울연구데이터서비스(공공누리 제1유형).</Micro>
      <Seg label="우리 우이천 보기" value={tab} onChange={setTab} options={[['field', '현장 관찰'], ['news', '우이천 소식']]} />
      {tab === 'field' ? (
        <>
          {s ? <Micro>지금 보이는 관찰 {s.currentCount}건 · 지난 기록 {s.pastCount}건{s.updatedAt ? ' · 마지막 갱신 ' + kstDateTime(s.updatedAt) : ''}</Micro> : <LoadState loading={home.loading} error={home.error} onRetry={() => void home.reload()} />}
          <Btn kind="blue" icon="flag" label="환경 제보" disabled={access.restricted} onPress={() => void access.open('/report')} style={{ marginTop: 12 }} />
          {access.restricted ? <Micro>{OUTSIDE_PARTICIPATION_TEXT}</Micro> : null}
          <IssueList field="current" cursor="currentCursor" title="지금 보이는 관찰" />
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: pastOpen }} onPress={() => setPastOpen(v => !v)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
            <Txt w={700} s={19}>지난 기록{s ? ` ${s.pastCount}건` : ''}</Txt><Txt c={color.blue}>{pastOpen ? '접기' : '펼치기'}</Txt>
          </Pressable>
          {pastOpen ? <IssueList field="past" cursor="pastCursor" title="지난 기록 목록" /> : null}
          <ObservationGuide />
          <Micro>관찰은 그때 보인 모습의 기록이에요. 수질이나 안전을 판정하지 않고, 기관에 자동으로 전달되지 않아요.</Micro>
        </>
      ) : (
        <>
          {/* 분류 칩은 한 줄(넘치면 가로로 밀어 본다, 웹 .news-filter) */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="toolbar" accessibilityLabel="소식 분류" style={{ marginHorizontal: -space.page, marginTop: 14 }} contentContainerStyle={{ gap: 8, paddingHorizontal: space.page, paddingTop: 2, paddingBottom: 8 }}>
            {(['all', 'eco', 'proposal', 'plan'] as const).map(k => (
              <Pressable key={k} onPress={() => setTopic(k)} accessibilityRole="button" accessibilityState={{ selected: topic === k }} style={{ minHeight: 38, paddingHorizontal: 13, borderRadius: 999, justifyContent: 'center', backgroundColor: topic === k ? color.blue : color.panel, borderWidth: topic === k ? 0 : 1, borderColor: color.lineStrong }}>
                <Txt w={600} s={14} c={topic === k ? color.white : color.black} lines={1}>
                  {k === 'all' ? '전체' : TOPIC[k]}
                </Txt>
              </Pressable>
            ))}
          </ScrollView>
          {shown.map(n => (
            <NewsItem key={n.id} n={n} />
          ))}
          <LoadState loading={news.loading} error={news.error} onRetry={news.reload} empty={news.done && !news.loading && !news.next && !shown.length ? (news.items.length ? '이 분류의 소식이 없어요' : '게시된 소식이 없어요') : undefined} />
          {news.next && !news.loading ? <LinkBtn label="소식 더 불러오기" onPress={news.more} /> : null}
          <Micro>공식 자료·회의록·보도를 팀이 골라 요약했어요. 날짜는 자료의 발행·수정·회의 날짜이고, 팀이 확인한 날은 펼치면 보여요. 계획과 의회 발언은 확정·시행된 사업이 아니에요.</Micro>
        </>
      )}
    </ScrollView>
  );
}
