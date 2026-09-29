// 簡單模式的小圖(EASY_SPEC 8.7)與方向圈的純幾何(8.8)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, buildTemplate } from '../../src/ui/plan/templates.js';
import { DIR8 } from '../../src/core/geo.js';
import { withDoorSide } from '../../src/ui/easy/layout.js';
import { planPreviewSvg, directionDiagramSvg } from '../../src/ui/easy/svg.js';
import { DIAL_LABELS, dialGeometry } from '../../src/ui/components/dirDial.js';

const IDS = TEMPLATES.filter((t) => t.id !== 'custom');
const count = (s, needle) => s.split(needle).length - 1;
const HEX = /#[0-9a-fA-F]{3,8}\b/;

test('planPreviewSvg:4 範本 × 兩種大小,恰有一個大門、沒有寫死色碼', () => {
  for (const t of IDS) {
    const plan = buildTemplate(t.id).plan;
    for (const size of ['thumb', 'large']) {
      const svg = planPreviewSvg(plan, { size, label: t.label });
      assert.ok(svg.startsWith('<svg'), `${t.id} ${size}`);
      assert.ok(svg.endsWith('</svg>'));
      assert.equal(count(svg, 'c-pv-door'), 1, `${t.id} ${size} 大門數`);
      assert.equal(count(svg, 'class="c-pv-room'), plan.rooms.length);
      assert.equal(count(svg, 'c-pv-open'), plan.openings.length - 1);
      assert.ok(!HEX.test(svg), `${t.id} ${size} 有寫死的色碼`);
      assert.ok(!/style=/.test(svg));
      assert.match(svg, /role="img"/);
      assert.ok(svg.includes(`aria-label="${t.label} 預覽,大門在上方"`));
      assert.ok(!/NaN|undefined|Infinity/.test(svg));
    }
    const large = planPreviewSvg(plan, { size: 'large' });
    const thumb = planPreviewSvg(plan);
    for (const r of plan.rooms) {
      assert.ok(large.includes(`>${r.name}</text>`), `${t.id} large 缺房間名 ${r.name}`);
      assert.ok(!thumb.includes(r.name), 'thumb 不畫文字');
    }
    assert.ok(thumb.includes('aria-label="平面圖 預覽,大門在上方"'), '沒給名稱時寫「平面圖」');
  }
});

test('planPreviewSvg:大門畫在圖的上緣,左/右版左右對調', () => {
  const doorX = (svg) => {
    const m = /<line class="c-pv-door" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/.exec(svg);
    return { x: (Number(m[1]) + Number(m[3])) / 2, y: Number(m[2]), y2: Number(m[4]) };
  };
  const base = buildTemplate('studio').plan;
  const left = doorX(planPreviewSvg(withDoorSide(base, 'left').plan));
  const right = doorX(planPreviewSvg(withDoorSide(base, 'right').plan));
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(planPreviewSvg(base));
  const W = Number(vb[1]);
  assert.equal(left.y, left.y2, '大門是水平線');
  assert.ok(left.y < Number(vb[2]) * 0.2, '大門在上緣');
  assert.ok(left.x < W / 2 && right.x > W / 2);
  assert.ok(Math.abs(left.x + right.x - W) < 0.02, '以圖的中線對稱');
});

test('planPreviewSvg:使用者取的名字會被跳脫;壞平面圖回空字串', () => {
  const plan = buildTemplate('studio').plan;
  plan.rooms[0].name = '<b>客&廳"</b>';
  const svg = planPreviewSvg(plan, { size: 'large', label: '我的<家>' });
  assert.ok(svg.includes('&lt;b&gt;客&amp;廳&quot;&lt;/b&gt;'));
  assert.ok(svg.includes('我的&lt;家&gt; 預覽'));
  assert.ok(!svg.includes('<b>'));
  for (const bad of [null, {}, { rooms: [] }, 'x']) assert.equal(planPreviewSvg(bad), '');
});

test('directionDiagramSvg:8 個方位字都在、highlight 那塊有 c-dd-hl、上方標大門', () => {
  for (const up of [0, 45, 200, 359.5, -30]) {
    for (const hl of DIR8) {
      const svg = directionDiagramSvg({ upBearing: up, highlight: hl });
      assert.ok(svg.startsWith('<svg'));
      for (const d of DIR8) assert.ok(new RegExp(`>${d}</text>`).test(svg), `缺 ${d}`);
      assert.equal(count(svg, 'c-dd-sec c-dd-hl'), 1);
      assert.equal(count(svg, 'class="c-dd-sec'), 8);
      assert.ok(svg.includes('>大門</text>'));
      assert.ok(svg.includes(`aria-label="方位示意圖,比較有利的是${hl}方"`));
      assert.ok(!HEX.test(svg));
      assert.ok(!/NaN|undefined/.test(svg));
      assert.ok(!/rotate/.test(svg), '字保持正立,不旋轉');
    }
  }
  // highlight 可以帶「方」字
  const withFang = directionDiagramSvg({ upBearing: 0, highlight: '東北方' });
  assert.equal(count(withFang, 'c-dd-hl'), 1);
  assert.match(withFang, /c-dd-label--hl"[^>]*>東北</);
  assert.ok(withFang.includes('比較有利的是東北方"'));
});

test('directionDiagramSvg:圖面上方的方位 = upBearing(大門朝南時,「南」字在最上面)', () => {
  const pos = (svg, d) => {
    const m = new RegExp(`x="([\\d.]+)" y="([\\d.]+)"[^>]*>${d}</text>`).exec(svg);
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  const svg = directionDiagramSvg({ upBearing: 180, highlight: '北' });
  const ys = DIR8.map((d) => [d, pos(svg, d).y]).sort((a, b) => a[1] - b[1]);
  assert.equal(ys[0][0], '南');
  assert.equal(ys[ys.length - 1][0], '北');
  // 大門朝南時,東在圖的右邊還是左邊:站在屋內面向南,西在右手邊
  assert.ok(pos(svg, '西').x > pos(svg, '東').x);
  const north = directionDiagramSvg({ upBearing: 0, highlight: '北' });
  assert.ok(pos(north, '東').x > pos(north, '西').x);
  // upBearing 壞掉時當 0
  assert.equal(directionDiagramSvg({ upBearing: NaN, highlight: '北' }), north);
});

test('方向圈:DIAL_LABELS 順序同 geo.DIR8、四正方位較大;dialGeometry 北在上', () => {
  assert.deepEqual(DIAL_LABELS.map((l) => l.text), [...DIR8]);
  assert.deepEqual(DIAL_LABELS.map((l) => l.deg), [0, 45, 90, 135, 180, 225, 270, 315]);
  assert.deepEqual(DIAL_LABELS.filter((l) => l.major).map((l) => l.text), ['北', '東', '南', '西']);
  const g = dialGeometry(240);
  assert.ok(g.r > 0 && g.r < 120);
  assert.equal(g.labels.length, 8);
  const [n, , e, , s, , w] = g.labels;
  assert.ok(Math.abs(n.x - 120) < 1e-9 && n.y < 120);
  assert.ok(e.x > 120 && Math.abs(e.y - 120) < 1e-9);
  assert.ok(Math.abs(s.x - 120) < 1e-9 && s.y > 120);
  assert.ok(w.x < 120);
  for (const l of g.labels) assert.ok(Math.hypot(l.x - 120, l.y - 120) < g.r, '字在圈內');
  assert.equal(dialGeometry(-5).labels.length, 8, '壞尺寸退回預設');
});
