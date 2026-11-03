'use strict';
/* 게임 코어 규칙 테스트:  node test/core-test.js */
const { GameCore, CONFIG, BotController } = require('../public/core.js');
let failed = 0;
const ok = (c, l) => { console.log((c ? '  PASS ' : '  FAIL ') + l); if (!c) failed++; };
const run = (core, ms) => { for (let t = 0; t < ms; t += CONFIG.STEP_MS) core.step(CONFIG.STEP_MS); };
const fresh = (n = 2) => {
  const defs = [];
  for (let i = 0; i < n; i++) defs.push({ name: 'A' + i, team: 0, skin: i });
  for (let i = 0; i < n; i++) defs.push({ name: 'B' + i, team: 1, skin: i });
  const c = new GameCore({ seed: 7, players: defs, winsToMatch: 2 });
  run(c, CONFIG.START_FREEZE_MS + 50);      // READY 끝내기
  return c;
};
const clearAround = c => { c.grid = c.grid.map((t, i) => (t === 2 ? 0 : t)); };

console.log('1) 맵/스폰');
{
  const c = fresh(3);
  ok(c.players.length === 6, '3:3 → 6명');
  ok(new Set(c.players.map(p => p.x + ',' + p.y)).size === 6, '모두 다른 시작 위치');
  let sym = true;
  for (let y = 0; y < CONFIG.ROWS; y++) for (let x = 0; x < CONFIG.COLS; x++)
    if (c.grid[y * CONFIG.COLS + x] !== c.grid[(CONFIG.ROWS - 1 - y) * CONFIG.COLS + (CONFIG.COLS - 1 - x)]) sym = false;
  ok(sym, '맵이 점대칭 (양 팀 공평)');
  ok(c.players.every(p => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => c.tileAt(p.x + dx, p.y + dy) !== 2)), '시작 위치 주변은 비어 있음');
}

console.log('2) READY 동안은 움직일 수 없음');
{
  const defs = [{ name: 'a', team: 0, skin: 0 }, { name: 'b', team: 1, skin: 1 }];
  const c = new GameCore({ seed: 1, players: defs });
  c.setInput(0, 'right'); run(c, 1000);
  ok(c.players[0].x === 1, 'freeze 중 이동 불가');
  run(c, CONFIG.START_FREEZE_MS);
  run(c, 300);
  ok(c.players[0].x > 1, 'freeze 후 이동');
}

console.log('3) 물풍선 → 물방울에 갇힘 → 구출 / 처치');
{
  const c = fresh(2);
  clearAround(c);
  const [a0, a1, b0] = c.players;
  // a0 를 (5,5)로, 팀원 a1 을 (5,7)에, 적 b0 를 (9,5)로 옮겨 놓고 시작
  Object.assign(a0, { x: 5, y: 5, px: 5, py: 5 });
  Object.assign(a1, { x: 5, y: 7, px: 5, py: 7 });
  Object.assign(b0, { x: 9, y: 5, px: 9, py: 5 });
  c.players[3].alive = false;               // B1 은 제외 (라운드가 끝나지 않게 B0 는 유지)
  c.flames.push({ x: 5, y: 5, timer: 60, max: 60, owner: 2 });
  run(c, 100);
  ok(a0.trapped && a0.alive, '물줄기에 닿으면 즉사가 아니라 물방울에 갇힘');
  a0.moveTimer = 0;
  c.setInput(a1.id, 'up'); run(c, 400); c.setInput(a1.id, null);
  ok(a1.x === 5 && a1.y === 5 ? true : a1.y <= 6, '팀원이 다가감');
  run(c, 400);
  ok(!a0.trapped && a0.alive && a0.invuln > 0, '팀원이 닿으면 구출 + 잠시 무적');
  // 적에게 갇힌 경우
  a0.invuln = 0;
  c.flames.push({ x: a0.x, y: a0.y, timer: 60, max: 60, owner: 2 });
  run(c, 100);
  ok(a0.trapped, '다시 갇힘');
  Object.assign(b0, { x: a0.x, y: a0.y, px: a0.x, py: a0.y });
  run(c, 50);
  ok(!a0.alive && b0.kills === 1, '적이 닿으면 탈락 + 처치 점수');
}

console.log('4) 갇힌 시간이 지나면 탈락, 팀 전멸 시 라운드 종료');
{
  const c = fresh(1);
  const [a, b] = c.players;
  c.flames.push({ x: a.x, y: a.y, timer: 400, max: 400, owner: 1 });
  run(c, 100);
  ok(a.trapped, '갇힘');
  run(c, CONFIG.TRAP_MS + 200);
  ok(!a.alive, '시간 초과 → 탈락');
  ok(c.state === 'roundOver' && c.winnerTeam === 1 && c.teamWins[1] === 1, '라운드 종료: 블루 승리');
  run(c, CONFIG.ROUND_END_MS + 100);
  ok(c.state === 'playing' && c.round === 2 && c.players.every(p => p.alive), '다음 라운드 시작 (모두 부활)');
  run(c, CONFIG.START_FREEZE_MS + 50);
  c.players[0].alive = false; run(c, 50);
  ok(c.state === 'matchOver' && c.teamWins[1] === 2, '2승하면 매치 종료');
}

console.log('5) 제한 시간 종료 → 생존자 수 비교');
{
  const c = fresh(2);
  c.players[0].alive = false;
  c.roundTimer = 10; run(c, 100);
  ok(c.state === 'roundOver' && c.winnerTeam === 1, '생존자가 더 많은 팀 승리');
}

console.log('6) 스냅샷 직렬화 → 복원');
{
  const a = fresh(2);
  const bots = a.players.map((_, i) => new BotController(a, i));
  for (let i = 0; i < 600; i++) { bots.forEach(b => b.update(16.7)); a.step(CONFIG.STEP_MS); }
  for (const p of a.players) { p.moveTimer = Math.round(p.moveTimer); p.curDur = Math.round(p.curDur); p.trapTimer = Math.round(p.trapTimer); p.invuln = Math.round(p.invuln); p.bombQueued = false; }
  for (const x of a.bombs) x.timer = Math.round(x.timer);
  for (const x of a.flames) x.timer = Math.round(x.timer);
  a.stateTimer = Math.round(a.stateTimer); a.freeze = Math.round(a.freeze); a.roundTimer = Math.round(a.roundTimer);
  const snap = JSON.parse(JSON.stringify(a.getSnapshot(true)));
  const b = new GameCore({ seed: 7, players: a.defs, winsToMatch: 2 });
  b.applySnapshot(snap);
  const same = JSON.stringify(b.getSnapshot(true)) === JSON.stringify(snap);
  ok(same, '스냅샷 왕복 후 동일');
  // 복원된 상태에서 같은 입력으로 계속 진행하면 서버와 결과가 같아야 함(결정성)
  for (let i = 0; i < 300; i++) { a.step(CONFIG.STEP_MS); b.step(CONFIG.STEP_MS); }
  ok(JSON.stringify(a.getSnapshot(true)) === JSON.stringify(b.getSnapshot(true)), '복원 후에도 서버와 같은 결과로 진행 (결정성)');
}

console.log('7) 봇 6명 장시간 시뮬레이션 (예외/멈춤 없음)');
{
  const c = new GameCore({ seed: 99, players: [0, 1, 2].map(i => ({ name: 'a' + i, team: 0, skin: i })).concat([0, 1, 2].map(i => ({ name: 'b' + i, team: 1, skin: i }))), winsToMatch: 2 });
  const bots = c.players.map((_, i) => new BotController(c, i));
  let rounds = 0, matches = 0;
  c.onEvent = e => { if (e.type === 'round_end') { rounds++; if (e.match) matches++; } };
  const t0 = Date.now();
  for (let i = 0; i < 60 * 600; i++) {            // 게임 시간 10분
    bots.forEach(b => b.update(16.7)); c.step(CONFIG.STEP_MS);
    if (c.state === 'matchOver') c.resetMatch();
  }
  ok(rounds > 3, `라운드가 계속 진행됨 (${rounds}라운드, ${matches}매치)`);
  console.log(`  (10분치 시뮬레이션 ${Date.now() - t0}ms)`);
}

console.log(failed ? `\n실패 ${failed}건` : '\n모든 테스트 통과');
process.exit(failed ? 1 : 0);
