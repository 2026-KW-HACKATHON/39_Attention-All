import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { facilityIcon, visibleFacilities } from './facilities.ts';
import type { Facility } from './core';
const rows: Facility[] = JSON.parse(readFileSync(new URL('../../backend/data/uicheon-facilities.json', import.meta.url), 'utf8'));
test('시설 조사 전체를 보존하고 기본 표시만 분리한다', () => {
  assert.equal(rows.length, 126);
  assert.equal(new Set(rows.map(f=>f.id)).size, rows.length);
  assert.equal(visibleFacilities(rows,true).length,126);
  assert.ok(visibleFacilities(rows,false).every(f=>['bridge','stepping_stones','entrance','emergency_exit','toilets'].includes(f.type)));
  assert.ok(rows.every(f=>f.lat>37.61 && f.lat<37.64 && f.lng>127.04 && f.lng<127.08));
});
test('다리·징검다리·비상로·진입로를 구분하고 같은 징검다리 중복만 합친다', () => {
  assert.notEqual(facilityIcon('bridge'),facilityIcon('stepping_stones'));
  assert.notEqual(facilityIcon('emergency_exit'),facilityIcon('entrance'));
  assert.equal(facilityIcon('fitness'),'fitness');
  assert.equal(rows.filter(f=>f.type==='stepping_stones' && Math.abs(f.lat-37.6177458)<.00002).length,1);
});

test('우이마루 공유 링크의 정확한 좌표를 반영한다', () => {
  const cafe=rows.find(f=>f.id==='naver-1-022');
  assert.equal(cafe?.name,'노원우이마루');
  assert.equal(cafe?.lat,37.6280526);
  assert.equal(cafe?.lng,127.0468939);
  assert.equal(facilityIcon(cafe!.type),'cafe');
});
