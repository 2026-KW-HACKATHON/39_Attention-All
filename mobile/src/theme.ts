// 디자인 토큰: 최신 웹 프로토타입(uirun-prototype/css/app.css :root, 브랜드 11-A)의 값을 그대로 옮겼다.
// 대표 블루: 활성 탭·선택·주요 인터랙션 / 딥: 강한 대비 / 라임: 운동 시작처럼 가장 중요한 행동에만(글자는 늘 짙게).
export const color = {
  blue: '#384BF0',
  bluePress: '#2A3BD6',
  blueSoft: '#ECEEFE',
  deep: '#222759',
  lime: '#CAFF42',
  black: '#111111',
  white: '#FFFFFF',
  bg: '#F5F6FA',
  panel: '#FFFFFF',
  line: '#E2E4EC',
  lineStrong: '#C7CAD8',
  sub: '#5B6075', // 보조 글자(흰 바탕 6:1)
  err: '#C2341F',
  warn: '#8A5A00',
  water: '#D8E6F3',
  photoFallback: '#9FB8E0',
  deepLine: 'rgba(34, 39, 89, 0.14)',
};

// 본문: IBM Plex Sans KR(400·500·600·700). 웹의 800은 Bold로 그린다(웹도 700 파일을 굵게 합성했다).
// 숫자: Archivo 기울임·폭 78%·800(웹 .num과 같은 축 값으로 만든 정적 파일). 포인트 목록(.pts)은 기울이지 않는다.
// Android는 파일 이름이 글꼴 이름이다. 굵기는 글꼴 이름으로만 고르고 fontWeight를 쓰지 않는다.
export const font = {
  400: 'IBMPlexSansKR-Regular',
  500: 'IBMPlexSansKR-Medium',
  600: 'IBMPlexSansKR-SemiBold',
  700: 'IBMPlexSansKR-Bold',
  800: 'IBMPlexSansKR-Bold',
  num: 'ArchivoNum-ExtraBoldItalic',
  numUpright: 'ArchivoNum-ExtraBold',
} as const;
export type Weight = 400 | 500 | 600 | 700 | 800;

// 글자 크기(px, 웹 rem×16). 간편 화면은 웹과 같이 1.18배.
export const size = { title: 28, h2: 20, sec: 18, body: 16, cond: 17, sub: 15, row: 16, rowSub: 14, micro: 13, tab: 12 };
export const SIMPLE_SCALE = 1.18;

export const space = { page: 20, rowMin: 64, tabH: 70, appbarH: 56, radius: 14 };
