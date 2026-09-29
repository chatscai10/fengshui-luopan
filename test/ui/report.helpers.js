// 報告與財位畫面測試共用的情境產生器(不是測試檔,檔名不符合 *.test.js)。
import { analyzeHouse } from '../../src/core/analyze.js';
import { renderReport } from '../../src/core/copy.js';

export const NOW = 1790654400000; // 2026-09-29 12:00 台灣時間,與 docs/API.md 範例相同

export function baseInput() {
  return {
    nowMs: NOW,
    utcOffsetMinutes: 480,
    facing: { bearing: 210, doorBearing: null, declination: -5.06, uncertainty: null },
    building: { type: 'apartment', builtYear: 2025, moveInYear: null, renovation: 'none', floor: null },
    residents: [{ id: 'p1', name: '本人', gender: 'M', birth: '1990-05-15 10:30', utcOffsetMinutes: null }],
    mainResidentId: 'p1',
    plan: {
      version: 1,
      unit: 'm',
      planUpBearing: 30,
      outline: [[0, 0], [10, 0], [10, 8], [0, 8]],
      rooms: [
        { id: 'living', type: 'living', polygon: [[0, 0], [6, 0], [6, 5], [0, 5]] },
        { id: 'bed', type: 'bedroom', polygon: [[6, 0], [10, 0], [10, 8], [6, 8]] },
        { id: 'bed2', type: 'bedroom', polygon: [[0, 5], [3, 5], [3, 8], [0, 8]] },
      ],
      openings: [{ id: 'd1', kind: 'entrance', roomId: 'living', wall: 'bottom', pos: 1, width: 0.9 }],
      mainDoor: 'd1',
      taiji: { mode: 'centroid', manual: null },
    },
  };
}

export const CASES = {
  full: () => {},
  windowCorner: (i) => { i.plan.openings.push({ id: 'w1', kind: 'floorWindow', roomId: 'living', wall: 'right', pos: 3.5, width: 1.2 }); },
  noPlan: (i) => { i.plan = null; },
  noDoor: (i) => { i.plan.mainDoor = null; i.plan.openings = []; },
  noYear: (i) => { i.building.builtYear = null; },
  noResidents: (i) => { i.residents = []; i.mainResidentId = null; },
  twoResidents: (i) => { i.residents.push({ id: 'p2', name: '小美', gender: 'F', birth: '1992-08-01', utcOffsetMinutes: null }); },
  badResident: (i) => { i.residents.push({ id: 'p9', name: '', gender: 'X', birth: 'abc' }); },
  invalidPlan: (i) => { i.plan.outline = [[0, 0], [1, 1]]; },
  minimal: (i) => { i.plan = null; i.residents = []; i.building = { type: 'apartment', builtYear: null }; },
};

/** 產生 { input, report, page, state }。state 是 store.get() 的簡化版(畫面模型只讀 plan/building/residents) */
export function scenario(name, bearing = 210) {
  const input = baseInput();
  input.facing.bearing = bearing;
  CASES[name](input);
  const report = analyzeHouse(input, {});
  const page = renderReport(report);
  const state = { plan: input.plan, building: input.building, residents: input.residents };
  return { input, report, page, state };
}
