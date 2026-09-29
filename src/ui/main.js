// 啟動與分頁路由。每個畫面是 views/<id>.js,匯出 mount(root, ctx) -> { destroy?() }。
import { h, clear } from './dom.js';
import { createStore } from './store.js';
import { icons } from './components/icons.js';
import { toast } from './components/toast.js';
import { openSheet } from './components/sheet.js';
import { installPunct } from './punct.js';

const TABS = [
  { id: 'compass', label: '羅盤', icon: 'compass' },
  { id: 'house', label: '住宅', icon: 'home' },
  { id: 'plan', label: '平面圖', icon: 'plan' },
  { id: 'wealth', label: '財位', icon: 'coin' },
  { id: 'report', label: '報告', icon: 'doc' },
];

const store = createStore();
const viewEl = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const subEl = document.getElementById('app-sub');
let current = { id: null, instance: null };
let navToken = 0;

const ctx = {
  store,
  toast,
  openSheet,
  icons,
  go: (id) => { location.hash = `#/${id}`; },
};

function applyTheme() {
  const t = store.get().ui.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0e0b09';
}

const YUN_ZH = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 標題列右側的一行摘要,例如「丑山未向 · 九運盤」。沒有結果就不顯示。 */
function headerSummary() {
  let r;
  try { r = store.report(); } catch { return ''; }
  if (!r || r.error || !r.summary) return '';
  const { headline, yun } = r.summary;
  return [headline, yun ? `${YUN_ZH[yun]}運盤` : null].filter(Boolean).join(' · ');
}

function renderTabs(activeId) {
  // 重畫分頁列會把按鈕換成新的;用鍵盤按 Enter 切分頁時,焦點要跟著留在同一個分頁按鈕上
  const a = document.activeElement;
  const keepId = a && tabbar.contains(a) ? a.id : null;
  clear(tabbar);
  for (const t of TABS) {
    tabbar.append(h('button', {
      type: 'button', class: 'tab', role: 'tab', id: `tab-${t.id}`,
      'aria-selected': t.id === activeId ? 'true' : 'false',
      'aria-controls': 'view',
      onclick: () => ctx.go(t.id),
    }, h('span', { html: icons[t.icon] }), t.label));
  }
  viewEl.setAttribute('aria-labelledby', `tab-${activeId}`);
  if (keepId) { const again = document.getElementById(keepId); if (again) again.focus(); }
}

// 分頁列的方向鍵:左右移動焦點(Home/End 跳頭尾),按 Enter 或空白鍵切換
tabbar.addEventListener('keydown', (e) => {
  const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
  if (!(e.key in keys)) return;
  const btns = [...tabbar.querySelectorAll('[role="tab"]')];
  const i = btns.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const to = keys[e.key];
  const next = to === 'first' ? 0 : to === 'last' ? btns.length - 1 : (i + to + btns.length) % btns.length;
  btns[next].focus();
});

function showFatal(err, where) {
  console.error(where, err);
  clear(viewEl).append(h('div', { class: 'card warn' },
    h('div', { class: 'card-title' }, '這個畫面暫時打不開'),
    h('p', null, '資料沒有遺失,重新整理一次通常就好了。若持續發生,請把下面這行文字回報給開發者:'),
    h('p', { class: 'mono faint' }, `${where}: ${(err && err.message) || err}`),
  ));
}

async function navigate() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const tab = TABS.find((t) => t.id === id) || TABS.find((t) => t.id === store.get().ui.tab) || TABS[0];
  const token = ++navToken;

  if (current.instance && current.instance.destroy) {
    try { current.instance.destroy(); } catch (e) { console.error('destroy', e); }
  }
  current = { id: tab.id, instance: null };
  renderTabs(tab.id);
  // .view 設了 smooth 捲動,直接改 scrollTop 會變成「慢慢滑回頂端」;換分頁要立刻回到頂端
  viewEl.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  clear(viewEl);
  store.update((d) => { d.ui.tab = tab.id; });

  // 畫面載入超過一瞬間才顯示「整理中」,避免快速切換時閃一下
  const loadingTimer = setTimeout(() => {
    if (token === navToken && !viewEl.firstChild) {
      viewEl.append(h('div', { class: 'view-loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), '整理中…'));
    }
  }, 180);

  try {
    const mod = await import(`./views/${tab.id}.js`);
    if (token !== navToken) return; // 使用者已切走
    const stale = viewEl.querySelector(':scope > .view-loading');
    if (stale) stale.remove();
    const instance = (await mod.mount(viewEl, ctx)) || null;
    if (token !== navToken) {
      // mount 期間使用者已切走:舊畫面沒人接手,必須自己收乾淨(感測器、監聽器、訂閱)
      if (instance && instance.destroy) {
        try { instance.destroy(); } catch (e) { console.error('destroy', e); }
      }
      return;
    }
    current.instance = instance;
    // 從畫面裡的按鈕(例如「去量朝向」)切走時,原本的按鈕已被移除、焦點掉到網頁最上層;
    // 把焦點放回內容區,鍵盤與讀屏使用者才不會從頭開始
    const active = document.activeElement;
    if (!active || active === document.body) viewEl.focus({ preventScroll: true });
  } catch (e) {
    if (token === navToken) showFatal(e, tab.id);
  } finally {
    clearTimeout(loadingTimer);
  }
}

function boot() {
  installPunct(document.body);
  // 請瀏覽器把資料標成持久儲存,降低被系統清掉的機會(不支援或被拒絕都無妨)
  // 等第一次點擊才問(Firefox 會跳出詢問視窗,開啟當下跳出很突兀)
  addEventListener('pointerdown', () => {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* 忽略 */ }
  }, { once: true });
  const gear = document.getElementById('btn-settings');
  gear.innerHTML = icons.gear;
  gear.addEventListener('click', async () => {
    try {
      const mod = await import('./views/settings.js');
      mod.openSettings(ctx);
    } catch (e) {
      toast('設定暫時打不開');
      console.error(e);
    }
  });

  store.subscribe(() => { subEl.textContent = headerSummary(); });
  subEl.textContent = headerSummary();
  applyTheme();
  store.subscribe(() => applyTheme());
  window.addEventListener('hashchange', navigate);
  navigate();
}

boot();
