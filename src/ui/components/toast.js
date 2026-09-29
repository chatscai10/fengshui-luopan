import { h } from '../dom.js';

let host;

/**
 * 短暫提示。role=status 讓讀屏軟體念出。
 * toast('文字')、toast('文字', 4000)、或 toast('文字', { ms, action: { label: '復原', onClick } })。
 * 有動作按鈕時預設停留久一點,按下後立刻收起。
 */
export function toast(message, opts) {
  if (!host) {
    host = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const o = typeof opts === 'number' ? { ms: opts } : (opts || {});
  const action = o.action && o.action.label ? o.action : null;
  const ms = o.ms || (action ? 6000 : 2600);
  const el = h('div', { class: action ? 'toast has-action' : 'toast' }, message);
  let timer = 0;
  const dismiss = () => { clearTimeout(timer); el.remove(); };
  if (action) {
    el.append(h('button', {
      type: 'button', class: 'toast-action',
      onclick: () => { dismiss(); try { action.onClick && action.onClick(); } catch (e) { console.error(e); } },
    }, action.label));
  }
  host.append(el);
  timer = setTimeout(dismiss, ms);
  return { dismiss };
}
