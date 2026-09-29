import { h } from '../dom.js';
import { icons } from './icons.js';

// 同時開著的面板(最後開的在最上面)。Esc 一次只關最上面那一個。
const stack = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function focusablesIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('.hidden') && !el.closest('[hidden]') && el.getClientRects().length > 0);
}

/** 面板開著時,背景不能被 Tab 到,也不該被讀屏軟體讀到(inert)。用計數,疊多層也不會提早還原。 */
function setBackgroundInert(on) {
  const app = document.getElementById('app');
  if (!app) return;
  if (on) app.setAttribute('inert', '');
  else app.removeAttribute('inert');
}

/**
 * 底部面板。回傳 { el, close }。內容可傳節點或字串陣列。
 * 點背景、按 Esc、按右上角關閉鈕都會關閉;開著時焦點被關在面板內(Tab 循環),
 * 關閉後焦點還給開啟前的元素。
 */
export function openSheet({ title, content, onClose } = {}) {
  const opener = document.activeElement;
  const scrim = h('div', { class: 'scrim' });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '面板', tabindex: '-1' },
    h('div', { class: title ? 'sheet-head has-title' : 'sheet-head' },
      h('div', { class: 'sheet-grip' }),
      title ? h('h2', { class: 'sheet-title' }, title) : null,
      h('button', { type: 'button', class: 'icon-btn sheet-close', 'aria-label': '關閉', onclick: () => close(), html: icons.x })),
    content,
  );
  let closed = false;
  const entry = { close: () => close() };
  const onKey = (e) => {
    if (stack[stack.length - 1] !== entry) return; // 不是最上面那一層
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    // 焦點循環:Shift+Tab 在第一個 → 最後一個;Tab 在最後一個 → 第一個;焦點跑到面板外 → 拉回來
    const items = focusablesIn(sheet);
    if (!items.length) { e.preventDefault(); sheet.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!sheet.contains(active) || active === sheet) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    scrim.remove();
    sheet.remove();
    if (!stack.length) setBackgroundInert(false);
    // 開啟前的元素可能已被畫面重建拿掉,這時把焦點放回主要內容,不要掉到網頁最上面
    if (opener && opener.focus && document.contains(opener)) opener.focus();
    else if (!stack.length) { const v = document.getElementById('view'); if (v) v.focus(); }
    if (onClose) onClose();
  }
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  stack.push(entry);
  document.body.append(scrim, sheet);
  setBackgroundInert(true);
  sheet.focus();
  return { el: sheet, close };
}
