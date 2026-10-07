// sw.js - 放在網站根目錄(和 index.html 同層)。scope 自動等於它所在資料夾,
// 例如 https://chatscai10.github.io/fengshui-luopan/ ,所以所有路徑都用相對路徑,不要寫開頭的 "/"。
// 發版前執行 node tools/gen-sw.mjs:自動重寫 VERSION(內容雜湊)與 PRECACHE 清單,舊快取會在 activate 時被清掉。
const VERSION = 'ada4fe4ba5';
const CACHE = `fengshui-${VERSION}`;

const PRECACHE = [
  // <PRECACHE>
  './',
  'css/base.css',
  'css/c-easy.css',
  'css/tokens.css',
  'css/v-compass.css',
  'css/v-easy.css',
  'css/v-house.css',
  'css/v-plan.css',
  'css/v-report.css',
  'css/v-settings.css',
  'css/v-wealth.css',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'index.html',
  'manifest.webmanifest',
  'src/core/analyze.js',
  'src/core/annual.js',
  'src/core/bazhai.js',
  'src/core/calendar.js',
  'src/core/copy.js',
  'src/core/data/vsop87d_earth.js',
  'src/core/geo.js',
  'src/core/luopan.js',
  'src/core/luopan/data.js',
  'src/core/nine.js',
  'src/core/placement.js',
  'src/core/plan.js',
  'src/core/sensor-core.js',
  'src/core/sensor.js',
  'src/core/settings.js',
  'src/core/wealth.js',
  'src/core/wealth/constants.js',
  'src/core/wealth/findings.js',
  'src/core/wealth/geometry.js',
  'src/core/wealth/layers.js',
  'src/core/wealth/score.js',
  'src/core/wealth/seat.js',
  'src/core/xuankong.js',
  'src/core/xuankong/assess.js',
  'src/core/xuankong/chart.js',
  'src/core/xuankong/findings.js',
  'src/core/xuankong/specials.js',
  'src/core/xuankong/tables.js',
  'src/ui/basis.js',
  'src/ui/canvas/canvasUtil.js',
  'src/ui/canvas/gestures.js',
  'src/ui/canvas/luopanRenderer.js',
  'src/ui/canvas/miniPlan.js',
  'src/ui/canvas/planRenderer.js',
  'src/ui/canvas/starGrid.js',
  'src/ui/components/compassHelp.js',
  'src/ui/components/dirDial.js',
  'src/ui/components/icons.js',
  'src/ui/components/sheet.js',
  'src/ui/components/toast.js',
  'src/ui/dom.js',
  'src/ui/easy/direction.js',
  'src/ui/easy/flow.js',
  'src/ui/easy/layout.js',
  'src/ui/easy/measure.js',
  'src/ui/easy/result.js',
  'src/ui/easy/stability.js',
  'src/ui/easy/svg.js',
  'src/ui/easy/text.js',
  'src/ui/main.js',
  'src/ui/plan/coords.js',
  'src/ui/plan/editor.js',
  'src/ui/plan/labels.js',
  'src/ui/plan/layers.js',
  'src/ui/plan/summary.js',
  'src/ui/plan/templates.js',
  'src/ui/punct.js',
  'src/ui/repair.js',
  'src/ui/route.js',
  'src/ui/sensorSession.js',
  'src/ui/sensorText.js',
  'src/ui/store.js',
  'src/ui/views/compass.js',
  'src/ui/views/easy.js',
  'src/ui/views/house.js',
  'src/ui/views/plan.js',
  'src/ui/views/report.js',
  'src/ui/views/settings.js',
  'src/ui/views/wealth.js',
  // </PRECACHE>
];

const abs = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache:'reload' 跳過瀏覽器 HTTP 快取(GitHub Pages 預設 max-age=600),確保預載的是「這一版」。
    // 任何一個檔案失敗整批就失敗,舊 SW 繼續服務,不會留下半套快取。
    await cache.addAll(PRECACHE.map((p) => new Request(abs(p), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('fengshui-') && k !== CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (!req.url.startsWith(self.registration.scope)) return; // 只管自己資料夾底下
  event.respondWith(cacheFirst(req));
});

// 預載清單綁定版本號(內容雜湊),所以有快取就直接用:啟動快、離線可用、同一階段不會混到兩個版本。
// 新版由 sw.js 本身的變動觸發安裝;頁面偵測到換手後會重新載入一次(見 index.html)。
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    return await fetch(req);
  } catch {
    // 離線且沒快取:只有「開 App 首頁」才退回 index.html,其他網址(說明文件等)就讓它失敗
    if (req.mode === 'navigate') {
      const p = new URL(req.url).pathname;
      if (/\/(index\.html)?$/.test(p)) {
        const shell = await cache.match(abs('index.html'));
        if (shell) return shell;
      }
    }
    return Response.error();
  }
}
