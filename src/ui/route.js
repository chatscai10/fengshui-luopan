// 路由規則(docs/EASY_SPEC.md 3.2):網址 hash 決定顯示簡單模式或完整功能的哪個分頁。
// 純函式,不讀 location、不碰 DOM;main.js 的 navigate() 依結果補正網址並寫入 ui.mode。

export const TABS = Object.freeze([
  Object.freeze({ id: 'compass', label: '羅盤', icon: 'compass' }),
  Object.freeze({ id: 'house', label: '住宅', icon: 'home' }),
  Object.freeze({ id: 'plan', label: '平面圖', icon: 'plan' }),
  Object.freeze({ id: 'wealth', label: '財位', icon: 'coin' }),
  Object.freeze({ id: 'report', label: '報告', icon: 'doc' }),
]);

export const EASY_VIEW = 'easy';
export const MODES = Object.freeze(['easy', 'pro']);

const isTab = (id) => TABS.some((t) => t.id === id);
const uiOf = (ui) => (ui && typeof ui === 'object' ? ui : {});

/** '#/plan?x' → 'plan';沒有或格式不對回 null(與 main.js 原本的 /^#\/(\w+)/ 相同) */
export function hashViewId(hash) {
  const m = /^#\/(\w+)/.exec(typeof hash === 'string' ? hash : '');
  return m ? m[1] : null;
}

/** 完整功能的起始分頁:ui.tab 合法就用它,否則羅盤 */
export function proHomeOf(ui) {
  const tab = uiOf(ui).tab;
  return isTab(tab) ? tab : 'compass';
}

/**
 * @param {string|null} hashId hashViewId(location.hash)
 * @param {object} ui store.get().ui
 * @returns {{view:string, mode:'easy'|'pro', canonicalHash:string}}
 */
export function resolveRoute(hashId, ui) {
  if (hashId === EASY_VIEW) return { view: EASY_VIEW, mode: 'easy', canonicalHash: '#/easy' };
  if (isTab(hashId)) return { view: hashId, mode: 'pro', canonicalHash: `#/${hashId}` };
  if (uiOf(ui).mode === 'pro') {
    const view = proHomeOf(ui);
    return { view, mode: 'pro', canonicalHash: `#/${view}` };
  }
  return { view: EASY_VIEW, mode: 'easy', canonicalHash: '#/easy' };
}

/** 標題列「完整功能 / 簡單模式」按鈕要去的網址 */
export function modeToggleTarget(mode, ui) {
  return mode === 'easy' ? `#/${proHomeOf(ui)}` : '#/easy';
}
