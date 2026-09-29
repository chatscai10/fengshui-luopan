// 平面圖編輯的純邏輯測試:吸附、命中、手把縮放、重疊、開口沿牆放置、新增/刪除、還原堆疊、驗證。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../../src/core/plan.js';
import { buildTemplate } from '../../src/ui/plan/templates.js';
import {
  snap, rectOfPolygon, polygonOfRect, isAxisRect, rectsOverlap, findOverlaps, outlineRectOf, fitOutline, roomsOutsideOutline,
  hitRoom, hitOpening, hitHandle, handlePoints, wallCandidates, moveRect, resizeRect, reflowOpenings, applyRoomRect,
  placeOpening, moveOpening, resizeOpening, setMainDoor, changeOpeningKind, removeOpening,
  addRoom, removeRoom, setRoomType, fitOnWall, setRoomName, findFreeSpot, setTaijiManual, setTaijiAuto,
  checkEditedPlan, describeProblems, describeWarnings, enginePlanOf, createHistory, openingGeom, wallPointAt, wallLength,
  MIN_ROOM, MAX_ROOM,
} from '../../src/ui/plan/editor.js';
import { roomDisplayName } from '../../src/ui/plan/labels.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const two = () => clone(buildTemplate('two').plan);
const simple = () => clone(buildTemplate('custom', { width: 6, depth: 5 }).plan);
/** 只留大門,沒有窗的單一房間,方便測放置 */
const bare = () => { const p = simple(); p.openings = p.openings.filter((o) => o.kind === 'entrance'); return p; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

test('snap:吸附 0.1 公尺,去掉浮點雜訊,壞值回 0', () => {
  assert.equal(snap(0.34), 0.3);
  assert.equal(snap(0.35), 0.4);
  assert.equal(snap(-0.34), -0.3);
  assert.equal(snap(0.1 * 3), 0.3);
  assert.equal(String(snap(1.0000000001)), '1');
  assert.equal(snap(2.26, 0.05), 2.25);
  for (const bad of [NaN, Infinity, undefined, null, '3']) assert.equal(snap(bad), 0);
  assert.equal(snap(1, 0), 0);
});

test('矩形與多邊形互轉;isAxisRect 只認軸向矩形', () => {
  const r = { x0: 1, y0: 2, x1: 4, y1: 6 };
  const poly = polygonOfRect(r);
  assert.deepEqual(rectOfPolygon(poly), r);
  assert.ok(isAxisRect(poly));
  assert.ok(isAxisRect([...poly, poly[0]]), '首尾重複的閉合環也算');
  assert.equal(isAxisRect([[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]), false, 'L 型不算');
  assert.equal(isAxisRect([[0, 0], [4, 1], [4, 4], [0, 4]]), false, '斜邊不算');
  assert.equal(rectOfPolygon([[0, 0], [1, NaN], [2, 2]]), null);
  assert.equal(rectOfPolygon(null), null);
  assert.equal(rectOfPolygon([[0, 0]]), null);
});

test('重疊:貼邊不算重疊,有面積才算;findOverlaps 找出配對', () => {
  const a = { x0: 0, y0: 0, x1: 2, y1: 2 };
  assert.equal(rectsOverlap(a, { x0: 2, y0: 0, x1: 4, y1: 2 }), false);
  assert.equal(rectsOverlap(a, { x0: 1.9, y0: 0, x1: 4, y1: 2 }), true);
  assert.equal(rectsOverlap(a, { x0: 2, y0: 2, x1: 3, y1: 3 }), false, '只碰到角');
  assert.deepEqual(findOverlaps(two()), []);
  const p = two();
  p.rooms.find((r) => r.id === 'bed2').polygon = polygonOfRect({ x0: 3, y0: 0, x1: 8, y1: 2.8 });
  assert.deepEqual(findOverlaps(p), [['bed1', 'bed2'], ['hall', 'bed2']]);
});

test('外框:等於非陽台房間的外接矩形;陽台不撐大外框', () => {
  const p = simple();
  addRoom(p, 'balcony');
  const before = outlineRectOf(p);
  assert.deepEqual(before, { x0: 0, y0: 0, x1: 6, y1: 5 });
  fitOutline(p);
  assert.deepEqual(rectOfPolygon(p.outline), { x0: 0, y0: 0, x1: 6, y1: 5 });
  const q = simple();
  addRoom(q, 'bedroom');
  assert.ok(rectOfPolygon(q.outline).x1 > 6 || rectOfPolygon(q.outline).y1 > 5 || rectOfPolygon(q.outline).x0 < 0 || rectOfPolygon(q.outline).y0 < 0);
  assert.deepEqual(roomsOutsideOutline(q), []);
  // 手動把外框縮小 → 抓得到超出外框的房間
  q.outline = polygonOfRect({ x0: 0, y0: 0, x1: 2, y1: 2 });
  assert.ok(roomsOutsideOutline(q).length >= 1);
});

test('命中測試:房間取最小面積、門窗、手把、牆', () => {
  const p = two();
  assert.equal(hitRoom(p, [1, 6]), 'living');
  assert.equal(hitRoom(p, [7, 6]), 'kitchen');
  assert.equal(hitRoom(p, [20, 20]), null);
  assert.equal(hitRoom(p, [NaN, 1]), null);
  assert.equal(hitRoom(p, null), null);
  // 大門在客廳上牆 x=1.6
  assert.equal(hitOpening(p, [1.6, 8], 0.2), 'd1');
  assert.equal(hitOpening(p, [1.6, 8.15], 0.2), 'd1');
  assert.equal(hitOpening(p, [3.5, 8], 0.2), null);
  assert.equal(hitOpening(p, [1.6, 8], NaN), null);
  // 手把
  const rc = { x0: 0, y0: 0, x1: 4, y1: 3 };
  assert.equal(hitHandle(rc, [4, 3], 0.2), 'ne');
  assert.equal(hitHandle(rc, [0, 0.05], 0.2), 'sw');
  assert.equal(hitHandle(rc, [2, 3], 0.2), 'n');
  assert.equal(hitHandle(rc, [4, 1.5], 0.2), 'e');
  assert.equal(hitHandle(rc, [2, 1.5], 0.2), null);
  assert.equal(Object.keys(handlePoints(rc)).length, 8);
  // 牆
  const c = wallCandidates(p, [2, 8.05], 0.2);
  assert.ok(c.length >= 1 && c[0].roomId === 'living' && c[0].wall === 'top');
  assert.ok(near(c[0].along, 2));
  assert.deepEqual(wallCandidates(p, [2, 6], 0.2), []);
});

test('移動與縮放:吸附 0.1,對邊不動,最小/最大限制', () => {
  const r = { x0: 0, y0: 0, x1: 4, y1: 3 };
  assert.deepEqual(moveRect(r, 1.04, -0.26), { x0: 1, y0: -0.3, x1: 5, y1: 2.7 });
  assert.deepEqual(moveRect(r, NaN, 0), r);
  assert.deepEqual(resizeRect(r, 'e', [5.26, 9]), { x0: 0, y0: 0, x1: 5.3, y1: 3 });
  assert.deepEqual(resizeRect(r, 'w', [-1.04, 9]), { x0: -1, y0: 0, x1: 4, y1: 3 });
  assert.deepEqual(resizeRect(r, 'n', [9, 4.44]), { x0: 0, y0: 0, x1: 4, y1: 4.4 });
  assert.deepEqual(resizeRect(r, 's', [9, -2]), { x0: 0, y0: -2, x1: 4, y1: 3 });
  assert.deepEqual(resizeRect(r, 'ne', [6, 5]), { x0: 0, y0: 0, x1: 6, y1: 5 });
  assert.deepEqual(resizeRect(r, 'sw', [-1, -1]), { x0: -1, y0: -1, x1: 4, y1: 3 });
  // 拖過對邊:夾在最小尺寸
  const tiny = resizeRect(r, 'e', [-10, 0]);
  assert.ok(near(tiny.x1 - tiny.x0, MIN_ROOM));
  const huge = resizeRect(r, 'e', [1e6, 0]);
  assert.ok(near(huge.x1 - huge.x0, MAX_ROOM));
  // 壞輸入原樣回傳副本
  assert.deepEqual(resizeRect(r, 'zz', [1, 1]), r);
  assert.deepEqual(resizeRect(r, 'e', [NaN, 1]), r);
});

test('applyRoomRect:門窗留在同一個絕對位置;放不下就縮窄再移除;外框跟著走', () => {
  const p = simple();
  // 大門在上牆 x=1.8(寬 1.0)。把房間左緣往右縮 1 公尺,門的絕對位置不變 → pos 從 1.8 變 0.8
  const door = () => p.openings.find((o) => o.id === 'd1');
  assert.equal(door().pos, 1.8);
  let res = applyRoomRect(p, 'space', { x0: 1, y0: 0, x1: 6, y1: 5 });
  assert.ok(res.ok, res.error);
  assert.ok(near(door().pos, 0.8));
  assert.deepEqual(rectOfPolygon(p.outline), { x0: 1, y0: 0, x1: 6, y1: 5 });
  // 縮到門放不下:寬度被壓縮
  res = applyRoomRect(p, 'space', { x0: 1, y0: 0, x1: 1.8, y1: 5 });
  assert.ok(res.ok);
  assert.ok(door().width <= 0.8 + 1e-9);
  // 縮到 0.6 以下不允許
  const bad = applyRoomRect(p, 'space', { x0: 1, y0: 0, x1: 1.3, y1: 5 });
  assert.match(bad.error, /至少/);
  // 超大
  const big = applyRoomRect(simple(), 'space', { x0: 0, y0: 0, x1: MAX_ROOM + 5, y1: 5 });
  assert.match(big.error, /最大/);
  // 壞座標
  assert.ok(applyRoomRect(simple(), 'space', { x0: NaN, y0: 0, x1: 3, y1: 3 }).error);
  assert.ok(applyRoomRect(simple(), 'nope', { x0: 0, y0: 0, x1: 3, y1: 3 }).error);
  // 離原點太遠
  assert.ok(applyRoomRect(simple(), 'space', { x0: 900, y0: 0, x1: 903, y1: 3 }).error);
});

test('applyRoomRect:重疊會被擋下並說出是哪兩間', () => {
  const p = two();
  const res = applyRoomRect(p, 'bed2', { x0: 3, y0: 0, x1: 8, y1: 2.8 });
  assert.match(res.error, /不能和/);
  assert.match(res.error, /次臥/);
});

test('reflowOpenings:縮到很短的牆會移除開口,主門被移除時 mainDoor 清空', () => {
  const p = simple();
  const old = { x0: 0, y0: 0, x1: 6, y1: 5 };
  const removed = reflowOpenings(p, 'space', old, { x0: 0, y0: 0, x1: 0.3, y1: 5 });
  assert.ok(removed.includes('d1'));
  assert.equal(p.mainDoor, null);
});

test('沿牆放置開口:落在點擊位置、吸附、夾在牆內、寬度預設、id 不重複', () => {
  const p = bare();
  const r = placeOpening(p, 'window', [3.04, -0.05], { tol: 0.4 });
  assert.ok(r.ok, r.error);
  assert.equal(r.opening.wall, 'bottom');
  assert.equal(r.opening.roomId, 'space');
  assert.ok(near(r.opening.pos, 3));
  assert.equal(r.opening.width, 1.6);
  // 貼近牆角:夾在牆內
  const corner = placeOpening(p, 'floorWindow', [5.9, 2.5], { tol: 0.4 });
  assert.ok(corner.ok);
  assert.equal(corner.opening.wall, 'right');
  assert.ok(corner.opening.pos - corner.opening.width / 2 >= -1e-9);
  assert.ok(corner.opening.pos + corner.opening.width / 2 <= 5 + 1e-9);
  // id 不重複
  assert.equal(new Set(p.openings.map((o) => o.id)).size, p.openings.length);
  assert.ok(validatePlan(enginePlanOf(p)).ok);
  // 離牆太遠
  assert.match(placeOpening(p, 'door', [3, 2.5], { tol: 0.4 }).error, /牆/);
  // 不認得的種類
  assert.ok(placeOpening(p, 'gate', [3, 0], {}).error);
  // 壞座標
  assert.ok(placeOpening(p, 'door', [NaN, 0], {}).error);
});

test('沿牆放置:想放的地方被佔住時挪到最近的空隙,不會重疊;沒空隙才拒絕', () => {
  const p = bare();
  const first = placeOpening(p, 'window', [3, 0], {});
  assert.ok(first.ok);
  // 點在同一個窗上:挪到旁邊的空隙(下牆長 6,窗佔 2.2~3.8)
  const dup = placeOpening(p, 'window', [3.3, 0], {});
  assert.ok(dup.ok, dup.error);
  assert.deepEqual(openingsOnWall(p, 'space', 'bottom').length, 2);
  // 整面牆塞滿之後才會拒絕
  const q = bare();
  const big = placeOpening(q, 'window', [3, 0], { width: 6 });
  assert.ok(big.ok);
  assert.equal(big.opening.width, 6);
  assert.match(placeOpening(q, 'window', [3, 0], {}).error, /已經有/);
  // 空隙比預設窄:新開口縮窄去配合
  const r = bare();
  placeOpening(r, 'window', [0.9, 0], { width: 1.6 }); // 0.1~1.7
  placeOpening(r, 'window', [5.0, 0], { width: 1.6 }); // 4.2~5.8
  const mid = placeOpening(r, 'floorWindow', [3, 0], {}); // 空隙 1.7~4.2 = 2.5,寬 2.0 放得下
  assert.ok(mid.ok && mid.opening.width === 2);
  const tight = placeOpening(r, 'window', [1.8, 0], {}); // 剩下的縫都小於 0.4 公尺
  assert.match(tight.error, /已經有/);
  assert.equal(validatePlan(enginePlanOf(p)).warnings.length, 0);
  assert.equal(validatePlan(enginePlanOf(r)).warnings.length, 0);
});

const openingsOnWall = (p, roomId, wall) => p.openings.filter((o) => o.roomId === roomId && o.wall === wall);

test('沿牆放置:太短的牆放不下', () => {
  const p = buildTemplate('two').plan;
  // 走道寬 1.2、上牆長 1.2;窗預設 1.6 會被縮到牆長,但小於 0.4 的才拒絕
  const tiny = clone(p);
  tiny.rooms.push({ id: 'closet', type: 'other', polygon: polygonOfRect({ x0: 8.1, y0: 0, x1: 8.4, y1: 2 }) });
  const r = placeOpening(tiny, 'door', [8.25, 0], {});
  assert.match(r.error, /太短/);
});

test('共用牆上的室內門歸給比較私密的房間;窗偏好外牆', () => {
  const p = two();
  // bed1 的上牆與客廳的下牆在 y=4.6 共用
  const door = placeOpening(p, 'door', [2.6, 4.6], { tol: 0.2 });
  assert.ok(door.ok, door.error);
  assert.equal(door.opening.roomId, 'bed1');
  assert.equal(door.opening.wall, 'top');
  // 指定偏好房間時聽偏好
  const p2 = two();
  const d2 = placeOpening(p2, 'door', [2.6, 4.6], { tol: 0.2, preferRoomId: 'living' });
  assert.equal(d2.opening.roomId, 'living');
});

test('大門:新增大門會讓原本的大門降為室內門;整張圖只有一個大門', () => {
  const p = two();
  const r = placeOpening(p, 'entrance', [0.5, 0], { tol: 0.3 });
  assert.ok(r.ok, r.error);
  assert.equal(p.openings.filter((o) => o.kind === 'entrance').length, 1);
  assert.equal(p.mainDoor, r.opening.id);
  assert.equal(p.openings.find((o) => o.id === 'd1').kind, 'door');
  // setMainDoor 換回去
  assert.ok(setMainDoor(p, 'd1').ok);
  assert.equal(p.mainDoor, 'd1');
  assert.equal(p.openings.filter((o) => o.kind === 'entrance').length, 1);
  assert.ok(setMainDoor(p, 'nope').error);
  assert.ok(validatePlan(enginePlanOf(p)).ok);
});

test('換種類:大門被換成窗時清掉 mainDoor;換成大門等於設為大門', () => {
  const p = two();
  assert.ok(changeOpeningKind(p, 'd1', 'window').ok);
  assert.equal(p.mainDoor, null);
  assert.equal(p.openings.filter((o) => o.kind === 'entrance').length, 0);
  assert.ok(changeOpeningKind(p, 'd2', 'entrance').ok);
  assert.equal(p.mainDoor, 'd2');
  assert.ok(changeOpeningKind(p, 'd2', 'zzz').error);
  assert.ok(changeOpeningKind(p, 'nope', 'door').error);
});

test('移動與調整開口寬度:沿牆、不越界、不撞到別的開口', () => {
  const p = bare();
  const m = moveOpening(p, 'd1', [4.04, 5]);
  assert.ok(m.ok);
  assert.ok(near(p.openings[0].pos, 4));
  // 拖出牆外 → 夾在牆內
  moveOpening(p, 'd1', [99, 5]);
  assert.ok(near(p.openings[0].pos + p.openings[0].width / 2, 6));
  moveOpening(p, 'd1', [-99, 5]);
  assert.ok(near(p.openings[0].pos - p.openings[0].width / 2, 0));
  // 撞到窗
  placeOpening(p, 'window', [3, 5], { tol: 0.3 }); // 上牆另放一個窗
  const w = p.openings.find((o) => o.kind === 'window');
  const before = p.openings.find((o) => o.id === 'd1').pos;
  const bump = moveOpening(p, 'd1', [w.pos, 5]);
  assert.match(bump.error, /已經有/);
  assert.equal(p.openings.find((o) => o.id === 'd1').pos, before);
  // 寬度
  const q = simple();
  assert.ok(resizeOpening(q, 'd1', 1.5).ok);
  assert.equal(q.openings[0].width, 1.5);
  assert.equal(resizeOpening(q, 'd1', 0.1).opening.width, 0.4, '下限 0.4');
  assert.ok(resizeOpening(q, 'd1', 99).opening.width <= 4);
  assert.ok(resizeOpening(q, 'd1', NaN).error);
  assert.ok(resizeOpening(q, 'nope', 1).error);
  assert.ok(moveOpening(q, 'nope', [0, 0]).error);
  assert.ok(moveOpening(q, 'd1', null).error);
});

test('刪除開口', () => {
  const p = two();
  const n = p.openings.length;
  assert.ok(removeOpening(p, 'd1').ok);
  assert.equal(p.openings.length, n - 1);
  assert.equal(p.mainDoor, null);
  assert.ok(removeOpening(p, 'd1').error);
});

test('新增房間:不重疊、貼著現有房間、類型正確、外框跟著更新;陽台不撐大外框', () => {
  const p = two();
  const types = ['living', 'bedroom', 'kitchen', 'toilet', 'study', 'entry', 'stair', 'other'];
  for (const t of types) {
    const r = addRoom(p, t);
    assert.ok(r.ok, r.error);
    assert.equal(r.room.type, t);
    assert.deepEqual(findOverlaps(p), [], `新增 ${t} 後不可重疊`);
  }
  assert.equal(new Set(p.rooms.map((r) => r.id)).size, p.rooms.length);
  assert.deepEqual(roomsOutsideOutline(p), []);
  assert.ok(checkEditedPlan(p).ok, checkEditedPlan(p).message);
  const q = two();
  const before = rectOfPolygon(q.outline);
  const b = addRoom(q, 'balcony');
  assert.ok(b.ok);
  assert.deepEqual(rectOfPolygon(q.outline), before, '陽台不進外框');
  assert.deepEqual(findOverlaps(q), []);
  assert.ok(addRoom(q, 'castle').error);
});

test('新增房間:房間數上限 40;沒有房間時放在原點', () => {
  const p = simple();
  let last;
  for (let i = 0; i < 60; i += 1) { last = addRoom(p, 'toilet'); if (last.error) break; }
  assert.match(last.error, /40/);
  assert.equal(p.rooms.length, 40);
  assert.deepEqual(findOverlaps(p), []);
  const empty = { version: 1, outline: polygonOfRect({ x0: 0, y0: 0, x1: 3, y1: 3 }), rooms: [], openings: [] };
  assert.deepEqual(findFreeSpot(empty, 3, 2), { x0: 0, y0: 0, x1: 3, y1: 2 });
});

test('刪除房間:連同它的門窗一起移除;至少留一間;主門一起清掉', () => {
  const p = two();
  const r = removeRoom(p, 'living');
  assert.ok(r.ok);
  assert.ok(!p.rooms.some((x) => x.id === 'living'));
  assert.ok(!p.openings.some((o) => o.roomId === 'living'));
  assert.equal(p.mainDoor, null);
  assert.ok(checkEditedPlan(p).ok);
  assert.ok(removeRoom(p, 'nope').error);
  const s = simple();
  assert.match(removeRoom(s, 'space').error, /至少/);
});

test('改類型與名稱:控制字元與過長會被清掉,空字串回到預設名稱', () => {
  const p = two();
  assert.ok(setRoomType(p, 'bed2', 'study').ok);
  assert.equal(p.rooms.find((r) => r.id === 'bed2').type, 'study');
  assert.ok(setRoomType(p, 'bed2', 'xx').error);
  assert.ok(setRoomType(p, 'nope', 'study').error);
  setRoomName(p, 'bed2', '  很長很長很長很長很長很長很長很長的名字\u0007  ');
  const nm = p.rooms.find((r) => r.id === 'bed2').name;
  assert.equal(nm.length, 12);
  assert.ok(!/[\u0000-\u001f]/.test(nm));
  setRoomName(p, 'bed2', '   ');
  assert.equal('name' in p.rooms.find((r) => r.id === 'bed2'), false);
  assert.equal(roomDisplayName(p, p.rooms.find((r) => r.id === 'bed2')), '書房');
  assert.ok(setRoomName(p, 'nope', 'x').error);
  // 改成陽台 → 不再算進外框
  const q = two();
  setRoomType(q, 'bed2', 'balcony');
  assert.ok(rectOfPolygon(q.outline).x1 <= 8);
});

test('顯示名稱:同類型有多間時加編號', () => {
  const p = { rooms: [{ id: 'a', type: 'bedroom', polygon: [] }, { id: 'b', type: 'bedroom', polygon: [] }, { id: 'c', type: 'kitchen', polygon: [] }] };
  assert.equal(roomDisplayName(p, p.rooms[0]), '臥室 1');
  assert.equal(roomDisplayName(p, p.rooms[1]), '臥室 2');
  assert.equal(roomDisplayName(p, p.rooms[2]), '廚房');
  assert.equal(roomDisplayName(p, { id: 'x', type: 'weird' }), '房間');
  assert.equal(roomDisplayName(p, null), '');
});

test('太極點:手動與自動', () => {
  const p = simple();
  assert.ok(setTaijiManual(p, [3.04, 2.46]).ok);
  assert.deepEqual(p.taiji, { mode: 'manual', manual: [3, 2.5] });
  assert.ok(validatePlan(enginePlanOf(p)).ok);
  assert.ok(setTaijiManual(p, [NaN, 1]).error);
  assert.ok(setTaijiManual(p, null).error);
  setTaijiManual(p, [1e9, -1e9]);
  assert.deepEqual(p.taiji.manual, [200, -200], '夾在座標上限內');
  setTaijiAuto(p, 'bbox');
  assert.deepEqual(p.taiji, { mode: 'bbox', manual: null });
  setTaijiAuto(p);
  assert.deepEqual(p.taiji, { mode: 'centroid', manual: null });
  // 手動點放在外框外 → 引擎給警告,不是錯誤
  setTaijiManual(p, [50, 50]);
  const v = validatePlan(enginePlanOf(p));
  assert.ok(v.ok);
  assert.ok(v.warnings.some((w) => w.code === 'taijiOutsideOutline'));
  assert.ok(describeWarnings(v).includes('太極點落在外框之外'));
});

test('驗證:壞資料回白話原因,不丟例外', () => {
  const ok = checkEditedPlan(two());
  assert.ok(ok.ok);
  const bad = two();
  bad.rooms[0].polygon = [[0, 0], [1, 1], [2, 2]];
  const r = checkEditedPlan(bad);
  assert.equal(r.ok, false);
  assert.match(r.message, /形狀/);
  const bad2 = two();
  bad2.openings.push({ id: 'zz', kind: 'window', roomId: 'nope', wall: 'top', pos: 1, width: 1 });
  assert.equal(checkEditedPlan(bad2).ok, false);
  const bad3 = two();
  bad3.openings[0].pos = 999;
  assert.match(checkEditedPlan(bad3).message, /牆/);
  assert.equal(checkEditedPlan(null).ok, false);
  assert.equal(checkEditedPlan({}).ok, false);
  assert.equal(checkEditedPlan(undefined).ok, false);
  assert.equal(checkEditedPlan('abc').ok, false);
  // 重疊
  const ov = two();
  ov.rooms.find((x) => x.id === 'bed2').polygon = polygonOfRect({ x0: 3, y0: 0, x1: 8, y1: 2.8 });
  assert.match(checkEditedPlan(ov).message, /重疊/);
  assert.equal(describeProblems({ errors: [] }), '');
  assert.ok(describeProblems({ errors: [{ reason: 'whatever' }] }).length > 0);
});

test('enginePlanOf:移除 UI 欄位,補上 planUpBearing 佔位值,不改動原物件', () => {
  const p = two();
  p.upMode = 'north';
  p.upOffset = 12;
  const e = enginePlanOf(p);
  assert.equal('upMode' in e, false);
  assert.equal('upOffset' in e, false);
  assert.equal(e.planUpBearing, 0);
  assert.equal(p.upMode, 'north');
  assert.equal(enginePlanOf({ planUpBearing: 33 }).planUpBearing, 33);
});

test('還原堆疊:單步與多步、重做、上限、新動作清掉重做', () => {
  const h = createHistory(3);
  assert.equal(h.canUndo(), false);
  assert.equal(h.undo('x'), null);
  h.push('A'); // 現在是 B
  h.push('B'); // 現在是 C
  assert.equal(h.canUndo(), true);
  assert.deepEqual(h.undo('C'), { value: 'B' });
  assert.equal(h.canRedo(), true);
  assert.deepEqual(h.redo('B'), { value: 'C' });
  assert.deepEqual(h.undo('C'), { value: 'B' });
  assert.deepEqual(h.undo('B'), { value: 'A' });
  assert.equal(h.undo('A'), null);
  h.push('X');
  assert.equal(h.canRedo(), false, '新動作清掉重做');
  // 上限
  const g = createHistory(2);
  g.push(1); g.push(2); g.push(3);
  assert.deepEqual(g.undo(4), { value: 3 });
  assert.deepEqual(g.undo(3), { value: 2 });
  assert.equal(g.undo(2), null);
  // null 也是合法快照(還原到「沒有平面圖」)
  const n = createHistory();
  n.push(null);
  assert.deepEqual(n.undo({ a: 1 }), { value: null });
  n.clear();
  assert.equal(n.canUndo(), false);
});

test('openingGeom / wallPointAt:座標語意與引擎一致(pos 自房間外接框左下角起算)', () => {
  const p = two();
  const rc = rectOfPolygon(p.rooms.find((r) => r.id === 'bed2').polygon);
  const o = p.openings.find((x) => x.id === 'd3'); // bed2 左牆
  const g = openingGeom(p, o);
  assert.deepEqual(g.center, wallPointAt(rc, 'left', o.pos));
  assert.equal(g.center[0], rc.x0);
  assert.ok(near(g.center[1], rc.y0 + o.pos));
  assert.equal(g.length, wallLength(rc, 'left'));
  assert.deepEqual(g.normal, [1, 0]);
  assert.equal(openingGeom(p, { ...o, roomId: 'nope' }), null);
  assert.equal(openingGeom(p, { ...o, pos: 'x' }), null);
});

test('拖曳的完整流程模擬:移動房間 → 檢查 → 引擎仍合法', () => {
  const p = two();
  const rc = rectOfPolygon(p.rooms.find((r) => r.id === 'kitchen').polygon);
  // 往右移 0.5:與外框無關的合法位置
  const rect = moveRect(rc, 0.5, 0);
  const res = applyRoomRect(p, 'kitchen', rect);
  assert.ok(res.ok, res.error);
  assert.ok(checkEditedPlan(p).ok);
  assert.ok(near(rectOfPolygon(p.outline).x1, 8.5));
  // 廚房的門(客廳側)跟著房間走,仍落在牆上
  const v = validatePlan(enginePlanOf(p));
  assert.ok(v.ok, JSON.stringify(v.errors));
});
