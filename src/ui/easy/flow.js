// 簡單模式的流程判斷(docs/EASY_SPEC.md 8.6):該停在哪一步、結果頁「想讓結果更準?」要問哪一項、建成年份(可填民國年)。
// 純函式,不碰 DOM。年份規則沿用住宅頁(views/house.js 的 parseYear、yearBounds)。
import { parseYear, yearBounds } from '../views/house.js';

export const EASY_STEPS = Object.freeze(['facing', 'layout', 'result']);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 進入簡單模式時要停的步驟 */
export function resumeStep(state) {
  const s = isObj(state) ? state : {};
  const facing = isObj(s.facing) ? s.facing : {};
  const ui = isObj(s.ui) ? s.ui : {};
  if (!isNum(facing.bearing)) return 'facing';
  if (ui.easyStep === 'facing') return 'facing';
  if (s.plan) return ui.easyStep === 'layout' ? 'layout' : 'result';
  return ui.easyStep === 'result' ? 'result' : 'layout';
}

/** 結果頁「想讓結果更準?」只列第一個缺的項目:平面圖 → 建成年份 → 住戶;都有回 null */
export function nextHint(state) {
  const s = isObj(state) ? state : {};
  if (!s.plan) return 'plan';
  const built = isObj(s.building) ? s.building.builtYear : null;
  if (!Number.isInteger(built)) return 'year';
  if (!Array.isArray(s.residents) || s.residents.length === 0) return 'residents';
  return null;
}

/**
 * 建成年份,接受西元或民國年(1 到 3 位數、或前面加「民國」)。全形轉半形、去空白、可帶「年」字。
 * @returns {{ok:true, value:number|null, roc?:number}|{ok:false, message:string}}
 *   例:'94' → {ok:true, value:2005, roc:94};'民國94' → 同;'2005' → {ok:true, value:2005};'12345' → ok:false
 */
export function parseYearLoose(text, nowMs) {
  const t = (typeof text === 'string' ? text : '').normalize('NFKC').replace(/[\s​-‍﻿]/g, '');
  const body = t.replace(/^民國/, '').replace(/年$/, '');
  const { min, max } = yearBounds(nowMs);
  if (body === '') return t === '' ? { ok: true, value: null } : { ok: false, message: `年份要在 ${min} 到 ${max} 年之間。` };
  if (/^\d{1,3}$/.test(body)) {
    const roc = Number(body);
    const y = roc + 1911;
    if (roc < 1 || y < min || y > max) return { ok: false, message: `年份要在 ${min} 到 ${max} 年之間。` };
    return { ok: true, value: y, roc };
  }
  const res = parseYear(body, { max, label: '建成年份' });
  return res.ok ? { ok: true, value: res.value } : { ok: false, message: res.message };
}
