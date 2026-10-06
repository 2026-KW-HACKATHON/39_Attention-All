// 앱에 들어가는 고정 자료와 출처. 확인된 정보만 적는다(웹 프로토타입 js/data.js PHOTOS와 같은 내용).
const SI = { credit: '서울연구원 서울연구데이터서비스', license: '공공누리 제1유형(출처표시)', base: 'https://data.si.re.kr/photo/' };

// w·h: 원본 픽셀 크기, px·py: 화면 크롭 기준점(웹 object-position)
export const PHOTOS = {
  // 팀이 전달한 사진(387×516, EXIF 없음). 촬영자·촬영일·위치·이용 조건 확인 전. 대표 분위기 사진으로만 쓰고
  // 파일럿 코스의 출발점이나 지금 모습으로 표시하지 않는다.
  hero: { src: require('../assets/photos/home-hero.jpg'), w: 387, h: 516, px: 0.5, py: 0.06, use: '홈 대표 사진', place: '하천 산책로 풍경', credit: '팀 제공 사진', license: '이용 조건 확인 필요', note: '촬영자·촬영일·촬영 위치 미확인', url: null },
  c1: { src: require('../assets/photos/uicheon-06C03527Bb80000.jpg'), w: 600, h: 900, px: 0.5, py: 0.58, use: '우이천 왕복 3K 코스 분위기 사진', place: '우이천 월계2교교차로 부근 산책로 · 2020년 3월 촬영', credit: SI.credit, license: SI.license, note: null, url: SI.base + '06C03527Bb80000' },
  river: { src: require('../assets/photos/uicheon-06C03536Bb80000.jpg'), w: 900, h: 600, px: 0.5, py: 0.5, use: '사진 기록카드 기본 배경', place: '우이천 초안교 부근 · 2020년 4월 촬영', credit: SI.credit, license: SI.license, note: null, url: SI.base + '06C03536Bb80000' },
  c2: { src: require('../assets/photos/uicheon-06C03532Bb80000.jpg'), w: 900, h: 600, px: 0.5, py: 0.6, use: '광운로 다리 짧은 걷기 코스 분위기 사진', place: '우이천 초안교 부근 · 2020년 3월 촬영', credit: SI.credit, license: SI.license, note: null, url: SI.base + '06C03532Bb80000' },
};
export type Photo = (typeof PHOTOS)[keyof typeof PHOTOS];
export const coursePhoto = (id: string): Photo => (id === 'c1' || id === 'c2' ? PHOTOS[id] : PHOTOS.hero);

// 사진 기록카드 기본 배경: 출처가 확인된 사진만(홈 대표 사진은 이용 조건 확인 전이라 뺀다)
export const CARD_PHOTOS = ['c1', 'c2', 'river'] as const;
export const LOGO = { dark: require('../assets/brand/uirun-wordmark.png'), light: require('../assets/brand/uirun-wordmark-light.png') };

export const MODE_LABEL = { RUN: '달리기', WALK: '산책' } as const;
