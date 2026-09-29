// 「手機指北針準嗎?」說明面板(docs/EASY_SPEC.md 5.4),簡單模式與羅盤分頁共用。
// 文字全部來自 copy.js 的 compassHonesty;這裡只負責依目前北基準與設定組參數、畫成 <dl>,細節收在摺疊區。
import { h } from '../dom.js';
import { basisOf } from '../basis.js';
import { compassHonesty } from '../../core/copy.js';
import { DEFAULT_SETTINGS } from '../../core/settings.js';

const list = (items) => h('dl', { class: 'c-help-list' },
  items.map((it) => [
    h('dt', { class: 'c-help-head' }, it.head),
    h('dd', { class: 'c-help-body' }, it.body),
  ]));

/**
 * @param {{openSheet:Function}} ctx
 * @param {object} state store.get()
 * @param {{opener?:HTMLElement|null}} [opts] 關閉後要把焦點還給誰(預設是開啟當下有焦點的元素)
 * @returns {{el:HTMLElement, close:Function}} openSheet 的回傳值
 */
export function openCompassHelp(ctx, state, { opener = null } = {}) {
  let basis = { trueMode: false, declination: null };
  try { basis = basisOf(state); } catch { /* 壞資料時當作磁北、不知道磁偏角 */ }
  const mu = state && state.settings && Number.isFinite(state.settings.measureUncertainty)
    ? state.settings.measureUncertainty
    : DEFAULT_SETTINGS.measureUncertainty;
  const easy = Boolean(state && state.ui && state.ui.mode === 'easy');
  const cityName = state && state.facing && typeof state.facing.cityId === 'string' ? state.facing.cityId : null;
  const info = compassHonesty({ trueMode: basis.trueMode, declinationDeg: basis.declination, measureUncertainty: mu, easy, cityName });
  const content = h('div', { class: 'c-help' },
    list(info.items),
    h('details', { class: 'c-help-more disclosure' },
      h('summary', null, info.details.title),
      list(info.details.items)));
  // 面板關閉後焦點回到開啟它的按鈕(Safari 點按鈕不會給焦點,所以由呼叫端傳入)
  const back = opener || (typeof document !== 'undefined' ? document.activeElement : null);
  return ctx.openSheet({
    title: info.title,
    content,
    onClose: () => {
      if (back && back.isConnected && typeof back.focus === 'function') back.focus();
    },
  });
}
