// 簡單模式結果卡要顯示的摘要句、現況檢查與第一條補救。引擎的卡片是給完整功能看的,這裡換掉兩種:
// 1.「接近兩個方位的交界」:方向差幾度會不會換財位,結果頁已用 wealthStability 重算並用白話說明;
//    再列一次只會重複,還可能和那句互相矛盾,而且「確認平面圖尺寸」對套用範本的人做不到。
// 2. 流年凶星落在角落:原文有星名與宮名,改用 copy.js 的白話版。
import { BORDERLINE_SENTENCE, EASY_ANNUAL_REMEDY } from '../../core/copy.js';

const idOf = (r) => (r && typeof r.id === 'string' ? r.id : '');

/**
 * @param {{checks?:Array<{ok:boolean,text:string,kind?:string}>, remedies?:Array<{id?:string,headline:string,body:string,level?:string}>}|null} entry
 *   views/wealth.js buildWealthModel 的 best
 * @param {{sentences?:string[]}|null} summary copy.js renderEasySummary 的輸出
 * @returns {{sentences:string[], checks:Array<{ok:boolean,text:string}>, remedy:{headline:string,body:string}|null}}
 */
export function easyResultParts(entry, summary) {
  const checks = (entry && Array.isArray(entry.checks) ? entry.checks : []).filter((c) => c && c.kind !== 'borderline');
  const remedies = (entry && Array.isArray(entry.remedies) ? entry.remedies : [])
    .filter((r) => r && !idOf(r).startsWith('wealth.borderline.'))
    .map((r) => (idOf(r).startsWith('wealth.annual.bad_on_ming.') ? { ...r, ...EASY_ANNUAL_REMEDY } : r));
  const sentences = (summary && Array.isArray(summary.sentences) ? summary.sentences : []).filter((t) => t !== BORDERLINE_SENTENCE);
  return { sentences, checks, remedy: remedies[0] || null };
}
