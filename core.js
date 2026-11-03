'use strict';
/* =============================================================================
 *  core.js  —  Bubble Grid Game 공용 게임 로직 (브라우저 + Node.js 서버 공용)
 *
 *  DOM / Canvas / 네트워크를 전혀 모르는 "순수 로직"입니다.
 *    - 서버(server.js)가 이 코드를 그대로 불러와 방마다 GameCore를 돌립니다 (서버 권위 방식).
 *    - 클라이언트는 서버가 보낸 스냅샷을 applySnapshot()으로 반영하고,
 *      스냅샷 사이에는 같은 로직으로 update()를 돌려 부드럽게 보여줍니다.
 *    - 연습 게임(오프라인)은 브라우저에서 이 코어를 직접 돌립니다.
 *
 *  규칙 요약
 *    - 격자 이동, 물풍선(2초 후 십자 폭발, 상자에서 멈춤, 연쇄 폭발)
 *    - 물줄기에 닿으면 즉시 탈락이 아니라 "물방울에 갇힘" → 팀원이 닿으면 구출,
 *      상대가 닿으면 탈락, 일정 시간이 지나면 탈락
 *    - 팀전(1:1, 2:2, 3:3): 한쪽 팀이 전멸하면 라운드 승리, 먼저 N승하면 매치 승리
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BG = factory();
})(typeof self !== 'undefined' ? self : this, function () {

const CONFIG = Object.freeze({
  COLS: 15,
  ROWS: 13,
  TILE_SIZE: 48,            // 렌더링 전용 (로직은 타일 좌표만 사용)

  STEP_MS: 1000 / 60,       // 고정 시뮬레이션 간격 (서버/클라이언트 결정성)
  FUSE_MS: 2000,
  FLAME_MS: 450,

  BASE_MOVE_MS: 150,
  MIN_MOVE_MS: 80,
  SPEED_STEP_MS: 14,

  START_BOMBS: 1,
  START_RANGE: 2,
  MAX_BOMBS: 6,
  MAX_RANGE: 8,
  MAX_SPEED: 5,

  SOFT_DENSITY: 0.72,
  ITEM_CHANCE: 0.3,

  TRAP_MS: 4500,            // 물방울에 갇혀 있을 수 있는 시간
  TRAP_MOVE_MS: 520,        // 갇힌 상태의 이동 속도(느림)
  RESCUE_INVULN_MS: 1200,   // 구출 직후 무적 시간

  START_FREEZE_MS: 2800,    // 라운드 시작 READY 시간
  ROUND_TIME_MS: 150000,    // 라운드 제한 시간 (끝나면 생존자 수 비교)
  ROUND_END_MS: 3000,
  WINS_TO_MATCH: 2,

  SCORE_BLOCK: 10,
  SCORE_KILL: 100,
  SCORE_ITEM: 20,
  SCORE_RESCUE: 50,
});

const T = Object.freeze({ EMPTY: 0, WALL: 1, BLOCK: 2 });
const ITEM = Object.freeze({ BOMB: 'bomb', RANGE: 'range', SPEED: 'speed' });
const ITEM_LIST = [ITEM.BOMB, ITEM.RANGE, ITEM.SPEED];
const DIRS = Object.freeze({
  up:    { dx: 0,  dy: -1 },
  down:  { dx: 0,  dy: 1 },
  left:  { dx: -1, dy: 0 },
  right: { dx: 1,  dy: 0 },
});
const DIR_NAMES = ['up', 'down', 'left', 'right'];

const MODES = Object.freeze({
  '1v1': { perTeam: 1, label: '1 : 1' },
  '2v2': { perTeam: 2, label: '2 : 2' },
  '3v3': { perTeam: 3, label: '3 : 3' },
});
const SKIN_COUNT = 6;

// 팀별 시작 위치 (점대칭이라 양 팀이 공평함). 인원이 적으면 앞에서부터 사용
const SPAWNS = Object.freeze([
  [[1, 1], [1, 11], [7, 1]],
  [[13, 11], [13, 1], [7, 11]],
]);

const key = (x, y) => x + ',' + y;

/** 시드 기반 난수 (mulberry32). 상태(s)를 스냅샷에 담아 동기화 */
class RNG {
  constructor(seed) { this.s = seed >>> 0; }
  next() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}


/* ============================================================================
 * GameCore
 *   입력 API  : setInput(pid, dir|null)   queueBomb(pid)
 *   진행 API  : update(dtMs)
 *   동기화 API: getSnapshot(withGrid)   applySnapshot(snap)
 *   이벤트    : onEvent({type, ...})  (효과음/연출용)
 * ========================================================================== */
class GameCore {
  /** opts: { seed, players:[{name, team(0|1), skin}], winsToMatch, onEvent } */
  constructor(opts = {}) {
    this.seed = ((opts.seed ?? Date.now()) >>> 0);
    this.defs = opts.players || [
      { name: 'P1', team: 0, skin: 0 },
      { name: 'P2', team: 1, skin: 1 },
    ];
    this.winsToMatch = opts.winsToMatch ?? CONFIG.WINS_TO_MATCH;
    this.onEvent = opts.onEvent || (() => {});
    this.acc = 0;
    this.resetMatch();
  }

  resetMatch() {
    this.round = 0;
    this.tick = 0;
    this.nextId = 1;
    this.teamWins = [0, 0];
    const slotCount = [0, 0];
    this.players = this.defs.map((d, i) => {
      const team = d.team ? 1 : 0;
      return {
        id: i, name: d.name, team, skin: (d.skin | 0) % SKIN_COUNT, slot: slotCount[team]++,
        score: 0, kills: 0, input: null,
        x: 0, y: 0, px: 0, py: 0, moveTimer: 0, curDur: CONFIG.BASE_MOVE_MS,
        facing: 'down', alive: true, trapped: false, trapTimer: 0, trappedBy: -1, invuln: 0,
        maxBombs: 1, range: 2, speed: 0, bombQueued: false,
      };
    });
    this.newRound();
  }

  spawnOf(p) {
    const list = SPAWNS[p.team];
    return list[Math.min(p.slot, list.length - 1)];
  }

  newRound() {
    this.round++;
    this.rng = new RNG(this.seed + this.round * 7919);
    this.grid = this._buildGrid();
    this.bombs = [];
    this.flames = [];
    this.items = [];
    for (const p of this.players) {
      const [sx, sy] = this.spawnOf(p);
      Object.assign(p, {
        x: sx, y: sy, px: sx, py: sy, moveTimer: 0, curDur: CONFIG.BASE_MOVE_MS,
        facing: 'down', alive: true, trapped: false, trapTimer: 0, trappedBy: -1, invuln: 0,
        bombQueued: false, maxBombs: CONFIG.START_BOMBS, range: CONFIG.START_RANGE, speed: 0,
      });
    }
    this.state = 'playing';      // 'playing' | 'roundOver' | 'matchOver'
    this.stateTimer = 0;
    this.winnerTeam = null;      // 0 | 1 | -1(무승부)
    this.freeze = CONFIG.START_FREEZE_MS;
    this.roundTimer = CONFIG.ROUND_TIME_MS;
    this.onEvent({ type: 'round_start', round: this.round });
  }

  _buildGrid() {
    const { COLS, ROWS } = CONFIG;
    const g = new Array(COLS * ROWS).fill(T.EMPTY);
    const clear = new Set();
    for (const p of this.players) {
      const [sx, sy] = this.spawnOf(p);
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) clear.add(key(sx + dx, sy + dy));
    }
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = y * COLS + x;
        const border = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
        const pillar = x % 2 === 0 && y % 2 === 0;
        if (border || pillar) { g[i] = T.WALL; continue; }
        if (clear.has(key(x, y))) { g[i] = T.EMPTY; continue; }
        const mi = (ROWS - 1 - y) * COLS + (COLS - 1 - x);   // 점대칭 칸
        g[i] = mi < i ? g[mi] : (this.rng.next() < CONFIG.SOFT_DENSITY ? T.BLOCK : T.EMPTY);
      }
    }
    return g;
  }

  /* ---------- 조회 ---------- */
  tileAt(x, y) {
    const { COLS, ROWS } = CONFIG;
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return T.WALL;
    return this.grid[y * COLS + x];
  }
  bombAt(x, y) { return this.bombs.find(b => b.x === x && b.y === y) || null; }
  countBombs(pid) { return this.bombs.filter(b => b.owner === pid).length; }

  canEnter(p, x, y) {
    if (this.tileAt(x, y) !== T.EMPTY) return false;
    const b = this.bombAt(x, y);
    if (b && !b.ignore.includes(p.id)) return false;
    return true;
  }

  blastCells(x, y, range) {
    const cells = [{ x, y }];
    for (const d of Object.values(DIRS)) {
      for (let i = 1; i <= range; i++) {
        const nx = x + d.dx * i, ny = y + d.dy * i;
        const t = this.tileAt(nx, ny);
        if (t === T.WALL) break;
        cells.push({ x: nx, y: ny });
        if (t === T.BLOCK) break;
      }
    }
    return cells;
  }

  computeDanger() {
    const s = new Set();
    for (const f of this.flames) s.add(key(f.x, f.y));
    for (const b of this.bombs) for (const c of this.blastCells(b.x, b.y, b.range)) s.add(key(c.x, c.y));
    return s;
  }

  /* ---------- 입력 API ---------- */
  setInput(pid, dir) {
    const p = this.players[pid];
    if (p) p.input = dir && DIRS[dir] ? dir : null;
  }
  queueBomb(pid) {
    const p = this.players[pid];
    if (p && p.alive && !p.trapped) p.bombQueued = true;
  }

  /* ---------- 시뮬레이션 ---------- */
  update(dtMs) {
    this.acc += Math.min(dtMs, 100);
    while (this.acc >= CONFIG.STEP_MS) {
      this.step(CONFIG.STEP_MS);
      this.acc -= CONFIG.STEP_MS;
    }
  }

  step(dt) {
    this.tick++;
    if (this.state !== 'playing') {
      this._updateFlames(dt);
      if (this.state === 'roundOver') {
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) this.newRound();
      }
      return;
    }
    if (this.freeze > 0) {               // READY 시간: 아무도 움직일 수 없음
      this.freeze = Math.max(0, this.freeze - dt);
      return;
    }
    this.roundTimer -= dt;
    for (const p of this.players) this._updatePlayer(p, dt);
    this._updateBombs(dt);
    this._updateFlames(dt);
    this._checkDeaths(dt);
    if (this.state !== 'playing') return;
    if (this.roundTimer <= 0) this._timeUp();
    else this._checkRoundEnd();
  }

  _moveDur(p) {
    if (p.trapped) return CONFIG.TRAP_MOVE_MS;
    return Math.max(CONFIG.MIN_MOVE_MS, CONFIG.BASE_MOVE_MS - p.speed * CONFIG.SPEED_STEP_MS);
  }

  _updatePlayer(p, dt) {
    if (!p.alive) return;
    if (p.bombQueued) {
      p.bombQueued = false;
      if (!p.trapped) this._placeBomb(p);
    }
    if (p.moveTimer > 0) p.moveTimer = Math.max(0, p.moveTimer - dt);
    if (p.moveTimer === 0 && p.input) {
      const d = DIRS[p.input];
      p.facing = p.input;
      const nx = p.x + d.dx, ny = p.y + d.dy;
      if (this.canEnter(p, nx, ny)) {
        p.px = p.x; p.py = p.y;
        p.x = nx;   p.y = ny;
        p.curDur = this._moveDur(p);
        p.moveTimer = p.curDur;
        if (!p.trapped) this._pickup(p);
      }
    }
  }

  _placeBomb(p) {
    if (this.countBombs(p.id) >= p.maxBombs) return;
    if (this.bombAt(p.x, p.y)) return;
    const ignore = this.players.filter(q => q.alive && q.x === p.x && q.y === p.y).map(q => q.id);
    this.bombs.push({
      id: this.nextId++, owner: p.id, x: p.x, y: p.y,
      timer: CONFIG.FUSE_MS, range: p.range, ignore,
    });
    this.onEvent({ type: 'bomb_place', pid: p.id, x: p.x, y: p.y });
  }

  _updateBombs(dt) {
    for (const b of this.bombs) {
      b.timer -= dt;
      b.ignore = b.ignore.filter(id => {
        const q = this.players[id];
        return q && q.alive && q.x === b.x && q.y === b.y;
      });
    }
    const due = this.bombs.filter(b => b.timer <= 0);
    if (due.length) this._explodeChain(due);
  }

  _explodeChain(starting) {
    const { COLS } = CONFIG;
    const queue = [...starting];
    const done = new Set();
    const fresh = new Set();

    while (queue.length) {
      const b = queue.shift();
      if (done.has(b.id)) continue;
      done.add(b.id);
      const owner = this.players[b.owner];

      for (const c of this.blastCells(b.x, b.y, b.range)) {
        const k = c.y * COLS + c.x;
        this.flames.push({ x: c.x, y: c.y, timer: CONFIG.FLAME_MS, max: CONFIG.FLAME_MS, owner: b.owner });
        if (!fresh.has(k)) this.items = this.items.filter(it => !(it.x === c.x && it.y === c.y));

        if (this.grid[k] === T.BLOCK) {
          this.grid[k] = T.EMPTY;
          if (owner) owner.score += CONFIG.SCORE_BLOCK;
          if (this.rng.next() < CONFIG.ITEM_CHANCE) {
            const type = ITEM_LIST[Math.floor(this.rng.next() * ITEM_LIST.length)];
            this.items.push({ x: c.x, y: c.y, type });
            fresh.add(k);
          }
        }
        const other = this.bombs.find(o => o.x === c.x && o.y === c.y && !done.has(o.id));
        if (other) queue.push(other);
      }
      this.onEvent({ type: 'explode', x: b.x, y: b.y });
    }
    this.bombs = this.bombs.filter(b => !done.has(b.id));
  }

  _updateFlames(dt) {
    for (const f of this.flames) f.timer -= dt;
    this.flames = this.flames.filter(f => f.timer > 0);
  }

  _pickup(p) {
    const i = this.items.findIndex(it => it.x === p.x && it.y === p.y);
    if (i < 0) return;
    const it = this.items.splice(i, 1)[0];
    if (it.type === ITEM.BOMB)  p.maxBombs = Math.min(CONFIG.MAX_BOMBS, p.maxBombs + 1);
    if (it.type === ITEM.RANGE) p.range    = Math.min(CONFIG.MAX_RANGE, p.range + 1);
    if (it.type === ITEM.SPEED) p.speed    = Math.min(CONFIG.MAX_SPEED, p.speed + 1);
    p.score += CONFIG.SCORE_ITEM;
    this.onEvent({ type: 'item', pid: p.id, item: it.type });
  }

  _kill(p, byId) {
    p.alive = false;
    p.trapped = false;
    p.bombQueued = false;
    const killer = this.players[byId];
    if (killer && killer.team !== p.team) { killer.score += CONFIG.SCORE_KILL; killer.kills++; }
    this.onEvent({ type: 'death', pid: p.id, by: byId });
  }

  /** 물줄기 → 물방울에 갇힘 / 갇힌 사람에게 닿으면 구출(팀원) 또는 탈락(상대) / 시간 초과 시 탈락 */
  _checkDeaths(dt) {
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
      if (p.trapped) {
        p.trapTimer -= dt;
        if (p.trapTimer <= 0) this._kill(p, p.trappedBy);
        continue;
      }
      if (p.invuln > 0) continue;
      const f = this.flames.find(fl => fl.x === p.x && fl.y === p.y);
      if (f) {
        p.trapped = true;
        p.trapTimer = CONFIG.TRAP_MS;
        p.trappedBy = f.owner;
        p.bombQueued = false;
        this.onEvent({ type: 'trap', pid: p.id });
      }
    }
    for (const t of this.players) {
      if (!t.alive || !t.trapped) continue;
      for (const q of this.players) {
        if (q.id === t.id || !q.alive || q.trapped || q.x !== t.x || q.y !== t.y) continue;
        if (q.team === t.team) {
          t.trapped = false;
          t.invuln = CONFIG.RESCUE_INVULN_MS;
          q.score += CONFIG.SCORE_RESCUE;
          this.onEvent({ type: 'rescue', pid: t.id, by: q.id });
        } else {
          this._kill(t, q.id);
        }
        break;
      }
    }
  }

  _aliveByTeam() {
    const a = [0, 0];
    for (const p of this.players) if (p.alive) a[p.team]++;
    return a;
  }

  _checkRoundEnd() {
    const a = this._aliveByTeam();
    const has = [this.players.some(p => p.team === 0), this.players.some(p => p.team === 1)];
    if (!(has[0] && has[1])) return;
    if (a[0] > 0 && a[1] > 0) return;
    this._endRound(a[0] > 0 ? 0 : a[1] > 0 ? 1 : -1);
  }

  _timeUp() {
    const a = this._aliveByTeam();
    this._endRound(a[0] > a[1] ? 0 : a[1] > a[0] ? 1 : -1);
  }

  _endRound(w) {
    if (w >= 0) this.teamWins[w]++;
    this.winnerTeam = w;
    this.state = (w >= 0 && this.teamWins[w] >= this.winsToMatch) ? 'matchOver' : 'roundOver';
    this.stateTimer = CONFIG.ROUND_END_MS;
    this.onEvent({ type: 'round_end', winnerTeam: w, match: this.state === 'matchOver' });
  }

  /* ---------- 동기화 API ----------
   * 네트워크 전송용으로 배열 형태로 압축합니다. (격자는 바뀔 때만 g에 담아 보냄) */
  getSnapshot(withGrid = true) {
    const r = Math.round;
    const s = {
      tick: this.tick, state: this.state, stateTimer: r(this.stateTimer), round: this.round,
      winnerTeam: this.winnerTeam, freeze: r(this.freeze), roundTimer: r(this.roundTimer),
      teamWins: this.teamWins.slice(), nextId: this.nextId, rngS: this.rng.s,
      p: this.players.map(p => [
        p.x, p.y, p.px, p.py, r(p.moveTimer), r(p.curDur), DIR_NAMES.indexOf(p.facing),
        p.alive ? 1 : 0, p.trapped ? 1 : 0, r(p.trapTimer), r(p.invuln),
        p.maxBombs, p.range, p.speed, p.score, p.kills,
        p.input ? DIR_NAMES.indexOf(p.input) : -1, p.trappedBy,
      ]),
      b: this.bombs.map(b => [b.id, b.owner, b.x, b.y, r(b.timer), b.range, b.ignore]),
      f: this.flames.map(f => [f.x, f.y, r(f.timer), f.max, f.owner]),
      i: this.items.map(it => [it.x, it.y, ITEM_LIST.indexOf(it.type)]),
    };
    if (withGrid) s.g = this.grid.join('');
    return s;
  }

  applySnapshot(s) {
    this.tick = s.tick; this.state = s.state; this.stateTimer = s.stateTimer; this.round = s.round;
    this.winnerTeam = s.winnerTeam; this.freeze = s.freeze; this.roundTimer = s.roundTimer;
    this.teamWins = s.teamWins.slice(); this.nextId = s.nextId; this.rng.s = s.rngS;
    if (s.g) this.grid = s.g.split('').map(Number);
    s.p.forEach((a, i) => {
      const p = this.players[i];
      if (!p) return;
      p.x = a[0]; p.y = a[1]; p.px = a[2]; p.py = a[3]; p.moveTimer = a[4]; p.curDur = a[5];
      p.facing = DIR_NAMES[a[6]] || 'down';
      p.alive = !!a[7]; p.trapped = !!a[8]; p.trapTimer = a[9]; p.invuln = a[10];
      p.maxBombs = a[11]; p.range = a[12]; p.speed = a[13]; p.score = a[14]; p.kills = a[15];
      p.input = a[16] >= 0 ? DIR_NAMES[a[16]] : null; p.trappedBy = a[17];
    });
    this.bombs = s.b.map(a => ({ id: a[0], owner: a[1], x: a[2], y: a[3], timer: a[4], range: a[5], ignore: a[6] }));
    this.flames = s.f.map(a => ({ x: a[0], y: a[1], timer: a[2], max: a[3], owner: a[4] }));
    this.items = s.i.map(a => ({ x: a[0], y: a[1], type: ITEM_LIST[a[2]] }));
  }
}


/* ============================================================================
 * BotController — 빈 자리를 채우는 AI (사람과 같은 입력 API만 사용)
 *   위험 회피 → 갇힌 팀원 구출/갇힌 적 처치 → 상자·적 근처에서 물풍선 → 이동
 * ========================================================================== */
class BotController {
  constructor(core, pid) {
    this.core = core;
    this.pid = pid;
    this.timer = Math.random() * 200;
    this.lx = -1; this.ly = -1;
    this.clock = 0;
    this.hunt = false;
    this.reroll = 0;
  }

  update(dt) {
    this.clock += dt;
    this.timer -= dt;
    const c = this.core, me = c.players[this.pid];
    if (!me) return;
    // 한 칸 이동이 시작될 때마다(= 도착할 칸이 정해질 때마다) 다음 행동을 다시 판단.
    // 판단 주기보다 이동이 빨라서 예전 입력이 남아 위험한 칸으로 걸어 들어가는 것을 막음
    const moved = me.moveTimer > 0 && (me.x !== this.lx || me.y !== this.ly);
    this.lx = me.x; this.ly = me.y;
    if (moved || this.timer <= 0) {
      this.timer = 120 + Math.random() * 100;
      this.think();
    } else if (me.alive && me.input && me.moveTimer < 40 && c.state === 'playing') {
      // 안전장치: 곧 들어가려는 칸이 위험하면 취소
      const d = DIRS[me.input];
      const danger = c.computeDanger();
      if (danger.has(key(me.x + d.dx, me.y + d.dy)) && !danger.has(key(me.x, me.y))) c.setInput(this.pid, null);
    }
  }

  bfs(me, goalFn, avoid, maxDepth) {
    const c = this.core;
    const seen = new Set([key(me.x, me.y)]);
    const q = [{ x: me.x, y: me.y, first: null, d: 0 }];
    while (q.length) {
      const cur = q.shift();
      if (cur.first !== null && goalFn(cur.x, cur.y)) return cur.first;
      if (cur.d >= maxDepth) continue;
      for (const [name, d] of Object.entries(DIRS)) {
        const nx = cur.x + d.dx, ny = cur.y + d.dy, k = key(nx, ny);
        if (seen.has(k) || !c.canEnter(me, nx, ny)) continue;
        if (avoid && avoid.has(k) && !goalFn(nx, ny)) continue;
        seen.add(k);
        q.push({ x: nx, y: ny, first: cur.first || name, d: cur.d + 1 });
      }
    }
    return null;
  }

  nextToBlock(x, y) {
    return Object.values(DIRS).some(d => this.core.tileAt(x + d.dx, y + d.dy) === T.BLOCK);
  }

  /** 지금 지나가면 안 되는 칸: 현재 물줄기 + 곧(0.7초 이내) 터질 물풍선의 범위 */
  hotTiles() {
    const c = this.core, s = new Set();
    for (const f of c.flames) s.add(key(f.x, f.y));
    for (const b of c.bombs) if (b.timer < 700) for (const cc of c.blastCells(b.x, b.y, b.range)) s.add(key(cc.x, cc.y));
    return s;
  }

  /** 도망 경로: 위험한 칸을 피해서 먼저 찾고, 길이 없으면 어쩔 수 없이 통과 */
  escapeDir(me, safeFn, maxDepth) {
    const hot = this.hotTiles();
    return this.bfs(me, safeFn, hot, maxDepth) || this.bfs(me, safeFn, null, maxDepth);
  }

  clearLine(a, b) {
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    let x = a.x + dx, y = a.y + dy;
    while (x !== b.x || y !== b.y) {
      if (this.core.tileAt(x, y) !== T.EMPTY) return false;
      x += dx; y += dy;
    }
    return true;
  }

  nearestEnemy(me) {
    let best = null, bd = 1e9;
    for (const p of this.core.players) {
      if (!p.alive || p.team === me.team || p.trapped) continue;
      const d = Math.abs(p.x - me.x) + Math.abs(p.y - me.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  shouldBomb(me) {
    if (this.nextToBlock(me.x, me.y)) return true;
    const foe = this.nearestEnemy(me);
    if (!foe) return false;
    const dist = Math.abs(foe.x - me.x) + Math.abs(foe.y - me.y);
    if (dist <= 2) return true;
    return (foe.x === me.x || foe.y === me.y) && dist <= me.range && this.clearLine(me, foe);
  }

  think() {
    const c = this.core, me = c.players[this.pid];
    if (!me || c.state !== 'playing' || c.freeze > 0 || !me.alive) { c.setInput(this.pid, null); return; }

    if (me.trapped) {      // 갇힌 동안은 천천히 안전한 쪽으로 떠다니며 구출을 기다림
      const opts = Object.entries(DIRS)
        .filter(([, d]) => c.canEnter(me, me.x + d.dx, me.y + d.dy)).map(([n]) => n);
      c.setInput(this.pid, Math.random() < 0.4 && opts.length ? opts[Math.floor(Math.random() * opts.length)] : null);
      return;
    }

    const danger = c.computeDanger();

    // 1) 위험하면 가장 가까운 안전한 칸으로
    if (danger.has(key(me.x, me.y))) {
      c.setInput(this.pid, this.escapeDir(me, (x, y) => !danger.has(key(x, y)), 12));
      return;
    }

    // 2) 갇힌 팀원 구출 / 갇힌 적 처치
    const targets = c.players.filter(p => p.alive && p.trapped && p.id !== me.id);
    if (targets.length) {
      const dir = this.bfs(me, (x, y) => !danger.has(key(x, y)) && targets.some(t => t.x === x && t.y === y), danger, 22);
      if (dir) { c.setInput(this.pid, dir); return; }
    }

    // 3) 물풍선 (놓은 뒤 도망칠 길이 있을 때만)
    if (c.countBombs(me.id) < me.maxBombs && !c.bombAt(me.x, me.y) && this.shouldBomb(me)) {
      const unsafe = new Set(danger);
      for (const cc of c.blastCells(me.x, me.y, me.range)) unsafe.add(key(cc.x, cc.y));
      const hot = this.hotTiles();
      const esc = this.bfs(me, (x, y) => !unsafe.has(key(x, y)), hot, 8);
      if (esc) { c.queueBomb(me.id); c.setInput(me.id, esc); return; }
    }

    // 4) 상자를 찾아가거나 적을 추격
    if (this.clock > this.reroll) {
      this.hunt = Math.random() < 0.45;
      this.reroll = this.clock + 3000 + Math.random() * 2000;
    }
    const foe = this.nearestEnemy(me);
    const goal = (this.hunt && foe)
      ? (x, y) => !danger.has(key(x, y)) && Math.abs(x - foe.x) + Math.abs(y - foe.y) <= 1
      : (x, y) => !danger.has(key(x, y)) && this.nextToBlock(x, y);

    if (goal(me.x, me.y) && Math.random() < 0.6) { c.setInput(this.pid, null); return; }

    let dir = this.bfs(me, goal, danger, 30);
    if (!dir) {
      const opts = Object.entries(DIRS)
        .filter(([, d]) => c.canEnter(me, me.x + d.dx, me.y + d.dy) && !danger.has(key(me.x + d.dx, me.y + d.dy)))
        .map(([n]) => n);
      dir = opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;
    }
    c.setInput(this.pid, dir);
  }
}

return { CONFIG, T, ITEM, ITEM_LIST, DIRS, DIR_NAMES, MODES, SKIN_COUNT, SPAWNS, RNG, GameCore, BotController, key };
});
