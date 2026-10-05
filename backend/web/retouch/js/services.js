/* 외부 연동 어댑터. 공급자 교체 지점은 이 파일에 모은다.
 *  Weather  : Open-Meteo 실제 호출(키 없음). 운영 전환 시 서버 environmentCache(KMA·AirKorea) 조회로 교체.
 *  MapKit   : Leaflet + 밝은 베이스맵. localhost는 Stadia Alidade Smooth(키 없는 개발 접속 허용),
 *             CARTO Positron은 window.UIRUN_MAP.cartoKey가 있을 때만, 그 밖에는 OSM 표준 타일(타일 층만 밝게 보정).
 *  Camera   : getUserMedia 실제 카메라. 네이티브는 CameraX.
 *  RouteArt : 경로 미리보기 SVG(지도 타일 없이 그리는 선).
 */
(function () {
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    failWrites: false, // 체험 패널: 기기 저장 실패 재현
    set(k, v) { if (store.failWrites && k.startsWith('uirun.state')) return false; try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; /* 용량 초과·저장 불가 환경 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } },
    keys() { try { return Object.keys(localStorage); } catch (e) { return []; } },
  };

  // ---------- 날씨: Open-Meteo ----------
  const center = window.UIRUN_DATA.PILOT.center;
  const W = {
    lat: +center[0].toFixed(4), lng: +center[1].toFixed(4),
    ttl: 15 * 60e3,   // Open-Meteo current 값은 15분 간격 → 15분 안에는 다시 부르지 않는다
    stale: 90 * 60e3, // 이보다 오래된 캐시는 '업데이트 지연'으로 표시
  };
  const SRC = {
    forecast: () => 'https://api.open-meteo.com/v1/forecast?latitude=' + W.lat + '&longitude=' + W.lng +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day' +
      '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code&timezone=Asia%2FSeoul&wind_speed_unit=ms&forecast_days=2',
    air: () => 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + W.lat + '&longitude=' + W.lng +
      '&current=pm10,pm2_5&hourly=pm10,pm2_5&timezone=Asia%2FSeoul&forecast_days=2',
  };
  const inflight = {};

  // 출처마다 따로 불러온다: 대기질이 늦어도 받은 기상 정보는 바로 보여준다. 10초 안에 답이 없으면 실패로 본다.
  async function loadSource(name, { force, simulateFail, forceStale }) {
    const key = 'uirun.wx.' + name, cached = store.get(key);
    const mark = r => { if (r.fetchedAt && (forceStale || Date.now() - r.fetchedAt > W.stale)) { r.status = 'stale'; if (forceStale) r.fetchedAt -= 3 * 3600e3; } return r; };
    if (!force && !simulateFail && !forceStale && cached && Date.now() - cached.fetchedAt < W.ttl) return { status: 'ok', ...cached };
    try {
      if (simulateFail) throw new Error('체험 패널에서 실패를 켰어요');
      if (forceStale) throw new Error('체험 패널에서 지연을 켰어요');
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl && setTimeout(() => ctl.abort(), 10e3);
      inflight[name] = inflight[name] || fetch(SRC[name](), { cache: 'no-store', signal: ctl && ctl.signal }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).finally(() => clearTimeout(timer));
      const data = await inflight[name];
      if (data.error) throw new Error(data.reason || '응답 오류');
      const v = { data, fetchedAt: Date.now() };
      store.set(key, v);
      return { status: 'ok', ...v };
    } catch (e) {
      if (cached && !simulateFail) return mark({ status: 'stale', ...cached, error: e.message }); // 실패해도 받아 둔 값은 지우지 않는다
      return { status: 'error', error: e.message };
    } finally { delete inflight[name]; }
  }

  const Weather = {
    W, SRC, source: loadSource,
    // WMO weather code → 한국어
    label(code) {
      const m = { 0: '맑음', 1: '대체로 맑음', 2: '구름 조금', 3: '흐림', 45: '안개', 48: '안개', 51: '약한 이슬비', 53: '이슬비', 55: '강한 이슬비', 56: '어는 이슬비', 57: '어는 이슬비',
        61: '약한 비', 63: '비', 65: '강한 비', 66: '어는 비', 67: '어는 비', 71: '약한 눈', 73: '눈', 75: '강한 눈', 77: '싸락눈', 80: '소나기', 81: '소나기', 82: '강한 소나기', 85: '눈 소나기', 86: '눈 소나기', 95: '뇌우', 96: '우박 동반 뇌우', 99: '우박 동반 뇌우' };
      return code == null ? null : (m[code] || '날씨 코드 ' + code);
    },
    // WMO 코드 → 아이콘 이름(index.html 스프라이트). 밤에는 해 대신 달.
    icon(code, isDay) {
      if (code == null) return 'cloud';
      if (code >= 95) return 'wx-storm';
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'wx-snow';
      if (code >= 51) return 'wx-rain';
      if (code === 45 || code === 48) return 'wx-fog';
      if (code === 3) return 'wx-cloud';
      if (code >= 1) return isDay === 0 ? 'wx-cloud-moon' : 'wx-cloud-sun';
      return isDay === 0 ? 'wx-moon' : 'wx-sun';
    },
    // 환경부 등급 구간(참고). 값이 없으면 null — 0이나 '좋음'으로 바꾸지 않는다.
    grade(kind, v) {
      if (v == null || Number.isNaN(v)) return null;
      const cut = kind === 'pm10' ? [30, 80, 150] : [15, 35, 75];
      return v <= cut[0] ? '좋음' : v <= cut[1] ? '보통' : v <= cut[2] ? '나쁨' : '매우 나쁨';
    },
    // 현재 시각부터 n시간의 hourly 슬라이스
    hours(data, keys, n) {
      if (!data || !data.hourly) return [];
      const h = data.hourly, cur = (data.current && data.current.time || '').slice(0, 13);
      let i = h.time.findIndex(t => t.slice(0, 13) === cur);
      if (i < 0) i = 0;
      return h.time.slice(i, i + n).map((t, k) => { const o = { time: t }; keys.forEach(key => { o[key] = h[key] ? h[key][i + k] : null; }); return o; });
    },
  };

  // ---------- 지도: Leaflet + OpenStreetMap ----------
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 기여자';
  const cfg = window.UIRUN_MAP || {};
  const localDev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // 공급자 선택: 키나 허용 조건이 없는 공급자를 쓰지 않는다(조건 없이 부르면 워터마크·401 응답).
  const PROVIDERS = {
    carto: { name: 'CARTO Positron', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=' + encodeURIComponent(cfg.cartoKey || ''), attribution: OSM_ATTR + ', &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>', maxZoom: 20, subdomains: 'abcd' },
    stadia: { name: 'Stadia Maps Alidade Smooth', url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' + OSM_ATTR, maxZoom: 20 },
    osm: { name: 'OpenStreetMap 표준(타일만 밝게 보정)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTR, maxZoom: 19, soften: true },
  };
  const TILE = PROVIDERS[cfg.cartoKey ? 'carto' : localDev || cfg.stadiaDomain ? 'stadia' : 'osm'];
  const MapKit = {
    TILE,
    available: () => typeof window.L !== 'undefined',
    // file://로 열면 브라우저가 Referer를 보내지 않아 OSM 서버가 'Access blocked' 이미지를 돌려준다(타일 이용 정책).
    // 이 경우 타일을 요청하지 않고 핀·하천선만 그린다. serve.py(localhost)나 https 배포에서는 정상 타일.
    fileMode: location.protocol === 'file:',
    create(el, opts) {
      const map = L.map(el, Object.assign({ zoomControl: false, attributionControl: true, minZoom: 13, maxZoom: 19 }, opts));
      map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>' + (MapKit.fileMode ? ' | ' + OSM_ATTR + ' 데이터' : '')); // 타일이 없어도 하천선·시설은 OSM 데이터
      if (TILE.soften) el.classList.add('tiles-soft'); // CSS 보정은 타일 층(.leaflet-tile-pane)에만 적용
      const layer = L.tileLayer(TILE.url, { attribution: TILE.attribution, maxZoom: TILE.maxZoom, subdomains: TILE.subdomains || 'abc', crossOrigin: false });
      if (!MapKit.fileMode) layer.addTo(map);
      map._uirunTiles = layer;
      return map;
    },
    icon(html, size, anchor, cls) {
      return L.divIcon({ html, className: 'pin-wrap ' + (cls || ''), iconSize: size, iconAnchor: anchor || [size[0] / 2, size[1] / 2] });
    },
  };

  // ---------- 카메라 ----------
  const Camera = {
    stream: null,
    supported: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext,
    async start(video) {
      Camera.stop();
      Camera.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      video.srcObject = Camera.stream;
      await video.play().catch(() => {});
    },
    attach(video) { if (Camera.stream && video && video.srcObject !== Camera.stream) { video.srcObject = Camera.stream; video.play().catch(() => {}); } },
    stop() { if (Camera.stream) Camera.stream.getTracks().forEach(t => t.stop()); Camera.stream = null; },
    // canvas 재인코딩으로 EXIF가 남지 않는다. 프로토타입은 기기 저장 용량 때문에 긴 변 640px(실서비스 1920px).
    capture(video) {
      const s = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(video.videoWidth * s); c.height = Math.round(video.videoHeight * s);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.66);
    },
    demoFrame(title) {
      const c = document.createElement('canvas'); c.width = 540; c.height = 720;
      const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 720);
      grd.addColorStop(0, '#9fb7c0'); grd.addColorStop(0.55, '#6f8f6a'); grd.addColorStop(1, '#4a5a45');
      g.fillStyle = grd; g.fillRect(0, 0, 540, 720);
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; g.setLineDash([14, 10]); g.strokeRect(24, 24, 492, 672);
      g.setLineDash([]); g.fillStyle = '#fff'; g.font = '700 34px sans-serif'; g.fillText('시연용 촬영 이미지', 40, 90);
      g.font = '500 24px sans-serif'; g.fillText(title || '', 40, 132); g.fillText(new Date().toLocaleString('ko-KR'), 40, 168);
      return c.toDataURL('image/jpeg', 0.72);
    },
  };

  // ---------- 경로 SVG ----------
  // lines: [{pts:[[lat,lng]...], cls}], dots: [{pt, cls, r}], labels: [{pt, text, dx, dy, anchor}] (기준점 이름처럼 짧은 글자만)
  function routeSvg({ lines, dots, labels, w, h, pad, fit }) {
    pad = pad == null ? 12 : pad;
    const all = (fit || lines.flatMap(l => l.pts)).filter(Boolean);
    if (!all.length) return '<svg viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"></svg>';
    const k = Math.cos(all[0][0] * Math.PI / 180);
    const xs = all.map(p => p[1] * k), ys = all.map(p => -p[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const s = Math.min((w - 2 * pad) / (maxX - minX || 1e-9), (h - 2 * pad) / (maxY - minY || 1e-9));
    const ox = (w - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2;
    const P = p => [((p[1] * k - minX) * s + ox).toFixed(1), ((-p[0] - minY) * s + oy).toFixed(1)];
    const path = pts => pts.length ? 'M' + pts.map(p => P(p).join(' ')).join('L') : '';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      lines.map(l => '<path class="' + l.cls + '" d="' + path(l.pts) + '"/>').join('') +
      (dots || []).filter(d => d.pt).map(d => { const [x, y] = P(d.pt); return '<circle class="' + d.cls + '" cx="' + x + '" cy="' + y + '" r="' + (d.r || 5) + '"/>'; }).join('') +
      (labels || []).map(l => { const [x, y] = P(l.pt); return '<text class="art-label" x="' + (+x + (l.dx || 0)).toFixed(1) + '" y="' + (+y + (l.dy || 0)).toFixed(1) + '" text-anchor="' + (l.anchor || 'start') + '">' + l.text + '</text>'; }).join('') +
      '</svg>';
  }

  window.Services = { store, Weather, MapKit, Camera, routeSvg };
})();
