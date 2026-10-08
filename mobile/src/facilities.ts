import type { Facility } from './core';

export const FACILITY_ICONS: Record<string, string> = {
  bridge: 'bridge', stepping_stones: 'stepping-stones', emergency_exit: 'emergency-exit',
  entrance: 'entrance', toilets: 'wc', fitness: 'fitness', bench: 'bench',
  bicycle_parking: 'bike', shelter: 'shelter', garden: 'leaf', photo_spot: 'camera',
  construction: 'construction', cafe: 'cafe',
};
export const DEFAULT_FACILITIES = new Set(['bridge', 'stepping_stones', 'emergency_exit', 'entrance', 'toilets']);
export const facilityIcon = (type: string) => FACILITY_ICONS[type] ?? 'map';
export const visibleFacilities = (rows: Facility[], all: boolean) => all ? rows : rows.filter(f => DEFAULT_FACILITIES.has(f.type));
