'use strict';
/* =============================================================================
 *  Bubble Grid Game — 데디케이트 게임 서버 (Node.js, 외부 패키지 없음)
 *
 *  실행:   node server.js            →  http://localhost:8080
 *
 *  구조
 *    Channel(서버 1,2,3...) : 접속자가 모이는 "로비". 서버마다 접속 정원이 있어 한쪽으로 몰려도
 *                             다른 서버는 영향을 받지 않음 (서버 선택 화면에서 혼잡도 표시)
 *    Queue(매칭 대기열)     : 채널마다 1:1 / 2:2 / 3:3 대기열. 인원이 차면 자동 매칭
 *    Room(게임 방)          : 매칭되면 로비에서 빠져나와 방으로 "흩어짐". 방마다 독립된 GameCore를
 *                             서버가 돌림 (서버 권위 방식 — 클라이언트는 입력만 보내고 상태만 받음)
 *
 *  서버를 더 늘리는 방법
 *    1) 한 프로세스에서 채널 수 늘리기 :  CHANNELS=5 node server.js
 *    2) 프로세스/컴퓨터를 나눠서 실행  :  CHANNEL_START=4 CHANNELS=3 PORT=8081 node server.js
 *       → public/config.js 의 servers 목록에 그 주소를 추가하면 서버 선택 화면에 같이 표시됨
 *
 *  환경변수 (모두 선택)
 *    PORT(8080) HOST(0.0.0.0) CHANNELS(3) CHANNEL_START(1) CHANNEL_CAP(100) MAX_PER_IP(8)
 *    ALLOWED_ORIGINS(쉼표 구분, 비우면 모두 허용) TRUST_PROXY(1이면 X-Forwarded-For 사용)
 *    ROOM_WINS(2) BOT_FILL_AFTER_MS(8000) HOST_STALL_MS(3000)
 * ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { acceptWebSocket } = require('./wslite.js');
const BG = require('./public/core.js');
const { GameCore, BotController, MODES, SKIN_COUNT, DIR_NAMES } = BG;

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);
const PORT = env('PORT', 8080);
const HOST = process.env.HOST || '0.0.0.0';
const CHANNELS = Math.max(1, env('CHANNELS', 3));
const CHANNEL_START = env('CHANNEL_START', 1);
const CHANNEL_CAP = Math.max(2, env('CHANNEL_CAP', 100));
const MAX_PER_IP = env('MAX_PER_IP', 8);
const ROOM_WINS = env('ROOM_WINS', 2);
const BOT_FILL_AFTER_MS = env('BOT_FILL_AFTER_MS', 8000);
const HOST_STALL_MS = env('HOST_STALL_MS', 3000);   // 방장이 이 시간 동안 상태를 안 보내면 다음 사람에게 방장을 넘김
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const SNAP_MS = 40;                       // 상태 전송 주기 (25Hz)
const MAX_ROOMS = Math.ceil(CHANNEL_CAP / 2);
const ROOM_LINGER_MS = 30000;             // 매치 종료 후 결과 화면 대기 최대 시간
const PUBLIC_DIR = path.join(__dirname, 'public');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ----------------------------------------------------------------------------
 * 유틸
 * -------------------------------------------------------------------------- */
function cleanText(s, max, fallback = '') {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return t || fallback;
}

/* ----------------------------------------------------------------------------
 * 클라이언트(접속자)
 * -------------------------------------------------------------------------- */
let nextClientId = 1;
class Client {
  constructor(conn, ip, channel) {
    this.id = nextClientId++;
    this.conn = conn;
    this.ip = ip;
    this.channel = channel;
    this.name = '손님' + this.id;
    this.skin = 0;
    this.state = 'new';          // new → lobby → queue → room → lobby
    this.mode = null;
    this.queuedAt = 0;
    this.room = null;
    this.pid = -1;
    this.alive = true;
    this.tokens = 60;            // 메시지 속도 제한(토큰 버킷)
    this.lastToken = Date.now();
    this.strikes = 0;
    this.lastChat = 0;
    this.hroom = null;           // 방장 방식 방
    this.hpid = -1;
  }
  send(obj) { this.conn.send(JSON.stringify(obj)); }
}

/** 팀별 사람 목록 → 슬롯 배열(팀0 먼저, 팀1 나중). 빈 자리는 봇, 같은 캐릭터는 겹치지 않게 조정 */
function buildSlots(mode, lists) {
  const per = MODES[mode].perTeam;
  const used = new Set();
  const pick = want => {
    let sk = want;
    if (used.has(sk)) for (let k = 0; k < SKIN_COUNT; k++) if (!used.has(k)) { sk = k; break; }
    used.add(sk);
    return sk;
  };
  const out = [[], []];
  for (const t of [0, 1]) for (const c of lists[t]) out[t].push({ client: c, name: c.name, skin: pick(c.skin), bot: false });
  let botNo = 1;
  for (const t of [0, 1]) {
    while (out[t].length < per) out[t].push({ client: null, name: '봇' + botNo++, skin: pick((used.size + 1) % SKIN_COUNT), bot: true });
  }
  return [...out[0].map(x => ({ ...x, team: 0 })), ...out[1].map(x => ({ ...x, team: 1 }))];
}

/* ----------------------------------------------------------------------------
 * 게임 방 — 매칭되면 이 안에서 한 판이 진행됨
 * -------------------------------------------------------------------------- */
class Room {
  constructor(channel, mode, humans) {
    this.channel = channel;
    this.mode = mode;
    this.events = [];
    this.lastSnap = 0;
    this.lastGrid = null;
    this.overAt = 0;
    this.destroyed = false;

    this.slots = buildSlots(mode, [humans.filter((_, i) => i % 2 === 0), humans.filter((_, i) => i % 2 === 1)]);

    this.core = new GameCore({
      seed: (Math.random() * 4294967296) >>> 0,
      players: this.slots.map(s => ({ name: s.name, team: s.team, skin: s.skin })),
      winsToMatch: ROOM_WINS,
      onEvent: e => this.events.push(e),
    });
    this.bots = this.slots.map((s, pid) => (s.bot ? new BotController(this.core, pid) : null));

    const players = this.slots.map(s => ({ name: s.name, team: s.team, skin: s.skin, bot: s.bot }));
    this.slots.forEach((s, pid) => {
      if (!s.client) return;
      s.client.state = 'room';
      s.client.room = this;
      s.client.pid = pid;
      s.client.send({ t: 'start', mode, you: pid, seed: this.core.seed, players, winsToMatch: ROOM_WINS });
    });
    channel.rooms.add(this);
    channel.dirty();
    log(`[${channel.name}] 방 생성 ${mode} 사람 ${humans.length}명 / 봇 ${this.slots.length - humans.length}명 (방 ${channel.rooms.size}개)`);
  }

  humans() { return this.slots.filter(s => s.client).length; }

  update(dt, now) {
    for (const b of this.bots) if (b) b.update(dt);
    this.core.update(dt);
    if (now - this.lastSnap >= SNAP_MS) this.broadcast(now);
    if (this.core.state === 'matchOver') {
      if (!this.overAt) this.overAt = now;
      else if (now - this.overAt > ROOM_LINGER_MS) this.destroy();
    }
  }

  broadcast(now) {
    this.lastSnap = now;
    const g = this.core.grid.join('');
    const snap = this.core.getSnapshot(false);
    if (g !== this.lastGrid) { snap.g = g; this.lastGrid = g; }
    const msg = JSON.stringify({ t: 's', s: snap, ev: this.events });
    this.events = [];
    for (const s of this.slots) if (s.client) s.client.conn.send(msg);
  }

  input(client, dir) { if (this.core.state === 'playing') this.core.setInput(client.pid, dir); }
  bomb(client) { if (this.core.state === 'playing') this.core.queueBomb(client.pid); }

  /** 나가기/접속 끊김: 그 자리는 봇이 이어받아 남은 사람들의 경기를 유지 */
  removeClient(client) {
    const slot = this.slots[client.pid];
    if (slot && slot.client === client) {
      slot.client = null;
      slot.bot = true;
      if (this.core.state !== 'matchOver') this.bots[client.pid] = new BotController(this.core, client.pid);
    }
    client.room = null;
    client.pid = -1;
    if (this.humans() === 0) this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const s of this.slots) {
      if (!s.client) continue;
      const c = s.client;
      c.room = null; c.pid = -1;
      if (c.state === 'room') { c.state = 'lobby'; c.send({ t: 'room_closed' }); }
      s.client = null;
    }
    this.channel.rooms.delete(this);
    this.channel.dirty();
  }
}

/* ----------------------------------------------------------------------------
 * 방장 방식 방 — 방장의 브라우저가 게임을 계산하고, 서버는 "중계"만 한다
 *   - 방을 만든(첫 입장) 사람이 방장. 방장이 나가거나 멈추면 먼저 들어온 다음 사람이 방장이 됨
 *   - 서버는 게임 규칙을 모름: 참가자 입력 → 방장에게 / 방장이 만든 상태 → 참가자들에게 전달
 *   - 모든 참가자의 화면에는 항상 최신 상태가 있어서, 새 방장이 그 상태 그대로 이어받아 진행
 * -------------------------------------------------------------------------- */
let nextHostRoomId = 1;
class HostRoom {
  constructor(channel, host, mode, title) {
    this.id = nextHostRoomId++;
    this.channel = channel;
    this.mode = mode;
    this.title = title;
    this.state = 'waiting';          // waiting | playing
    this.members = [];               // 들어온 순서 = 방장 승계 순서
    this.team = new Map();           // client → 0|1
    this.host = host;
    this.slots = null;
    this.lastHostSnap = 0;
    this.destroyed = false;
    channel.hrooms.set(this.id, this);
    this.add(host);
    log(`[${channel.name}] 방 #${this.id} "${title}" ${mode} 생성 — 방장 ${host.name}`);
  }

  get cap() { return MODES[this.mode].perTeam * 2; }
  teamCount(t) { let n = 0; for (const m of this.members) if (this.team.get(m) === t) n++; return n; }
  canJoin() { return this.state === 'waiting' && this.members.length < this.cap; }

  add(client) {
    const t = this.teamCount(0) <= this.teamCount(1) ? 0 : 1;      // 인원이 적은 팀으로
    this.members.push(client);
    this.team.set(client, t);
    client.state = 'hroom';
    client.hroom = this;
    client.hpid = -1;
    this.broadcastRoom();
  }

  broadcastRoom() {
    const list = this.members.map(m => ({ n: m.name, skin: m.skin, team: this.team.get(m), host: m === this.host }));
    this.members.forEach((m, i) => m.send({
      t: 'room', id: this.id, title: this.title, mode: this.mode, state: this.state, cap: this.cap, me: i, members: list,
    }));
  }

  switchTeam(client) {
    if (this.state !== 'waiting') return;
    const cur = this.team.get(client), other = 1 - cur;
    if (this.teamCount(other) >= MODES[this.mode].perTeam) return;
    this.team.set(client, other);
    this.broadcastRoom();
  }

  botPids() { return this.slots ? this.slots.map((s, i) => (s.client ? -1 : i)).filter(i => i >= 0) : []; }

  start(client) {
    if (client !== this.host || this.state !== 'waiting') return;
    const lists = [0, 1].map(t => this.members.filter(m => this.team.get(m) === t));
    this.slots = buildSlots(this.mode, lists);
    this.slots.forEach((s, pid) => { if (s.client) s.client.hpid = pid; });
    this.state = 'playing';
    this.lastHostSnap = Date.now();
    const seed = (Math.random() * 4294967296) >>> 0;
    const players = this.slots.map(s => ({ name: s.name, team: s.team, skin: s.skin, bot: s.bot }));
    const bots = this.botPids();
    for (const m of this.members) {
      m.send({ t: 'hstart', mode: this.mode, you: m.hpid, hostPid: this.host.hpid, seed, players, winsToMatch: ROOM_WINS, bots });
    }
    this.channel.dirty();
    log(`[${this.channel.name}] 방 #${this.id} 게임 시작 (사람 ${this.members.length}명 / 봇 ${bots.length}명)`);
  }

  /** 한 판이 끝나면 방장이 알려 줘서 모두 대기방으로 돌아감 */
  end(client) {
    if (client !== this.host || this.state !== 'playing') return;
    this.state = 'waiting';
    this.slots = null;
    for (const m of this.members) m.hpid = -1;
    this.broadcastRoom();
    this.channel.dirty();
  }

  /** 참가자 입력 → 방장에게 전달 */
  fromGuest(client, type, dir) {
    if (this.state !== 'playing' || client === this.host || client.hpid < 0) return;
    this.host.send(type === 'in' ? { t: 'r_in', pid: client.hpid, dir } : { t: 'r_bomb', pid: client.hpid });
  }

  /** 방장의 게임 상태 → 나머지 참가자에게 전달 (현재 방장이 보낸 것만 받음) */
  hostSnapshot(client, msg) {
    if (client !== this.host || this.state !== 'playing') return;
    if (!msg.s || typeof msg.s !== 'object') return;
    this.lastHostSnap = Date.now();
    const out = JSON.stringify({ t: 's', s: msg.s, ev: Array.isArray(msg.ev) ? msg.ev.slice(0, 60) : [] });
    for (const m of this.members) if (m !== this.host) m.conn.send(out);
  }

  /** 나가기/접속 끊김. 방장이었다면 다음 사람이 방장이 됨 */
  leave(client) {
    const i = this.members.indexOf(client);
    if (i < 0) return;
    this.members.splice(i, 1);
    this.team.delete(client);
    const wasHost = this.host === client;
    const pid = client.hpid;
    client.hroom = null;
    client.hpid = -1;
    if (client.state === 'hroom') client.state = 'lobby';
    if (this.members.length === 0) { this.destroy(); return; }
    if (this.state === 'playing' && pid >= 0 && this.slots[pid]) {      // 그 자리는 봇이 이어받음
      this.slots[pid].client = null;
      this.slots[pid].bot = true;
    }
    if (wasHost) this.promote('방장 나감');
    else if (this.state === 'playing') this.host.send({ t: 'peer_left', pid });
    else this.broadcastRoom();
    this.channel.dirty();
  }

  promote(reason) {
    const next = this.members[0];
    if (!next) { this.destroy(); return; }
    this.host = next;
    this.lastHostSnap = Date.now();
    log(`[${this.channel.name}] 방 #${this.id} 방장 변경 → ${next.name} (${reason})`);
    if (this.state === 'playing') {
      const msg = { t: 'host_change', hostPid: next.hpid, name: next.name, bots: this.botPids() };
      for (const m of this.members) m.send(msg);
    } else {
      this.broadcastRoom();
    }
  }

  /** 방장이 멈춘 경우(탭이 백그라운드, 네트워크 끊김 등) 다음 사람에게 방장을 넘김 */
  checkHost(now) {
    if (this.state !== 'playing') return;
    const stalled = now - this.lastHostSnap;
    if (stalled > 120000) { this.destroy(); return; }
    if (stalled > HOST_STALL_MS && this.members.length > 1) {
      const old = this.host;
      this.members.splice(this.members.indexOf(old), 1);
      this.members.push(old);                       // 멈춘 사람은 승계 순서 맨 뒤로
      this.promote('응답 없음');
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const m of this.members) {
      m.hroom = null; m.hpid = -1;
      if (m.state === 'hroom') { m.state = 'lobby'; m.send({ t: 'room_closed' }); }
    }
    this.members = [];
    this.channel.hrooms.delete(this.id);
    this.channel.dirty();
    log(`[${this.channel.name}] 방 #${this.id} 종료`);
  }
}

/* ----------------------------------------------------------------------------
 * 채널(서버 1,2,3...) — 로비 + 매칭 대기열
 * -------------------------------------------------------------------------- */
class Channel {
  constructor(id) {
    this.id = id;
    this.name = '서버 ' + id;
    this.clients = new Set();
    this.queues = {};
    for (const m of Object.keys(MODES)) this.queues[m] = [];
    this.rooms = new Set();
    this.hrooms = new Map();             // 방장 방식 방
    this.lobbyDirty = false;
    this.lastLobby = 0;
  }

  status() {
    const queue = {};
    for (const m of Object.keys(MODES)) queue[m] = this.queues[m].length;
    return { id: this.id, name: this.name, online: this.clients.size, cap: CHANNEL_CAP, rooms: this.rooms.size + this.hrooms.size, queue };
  }

  dirty() { this.lobbyDirty = true; }

  /** 로비 접속자 목록을 모아서 가끔 한 번씩만 방송 (접속이 몰려도 서버 부담이 일정) */
  flushLobby(now) {
    this.lobbyDirty = false;
    this.lastLobby = now;
    const list = [];
    for (const c of this.clients) {
      if (c.state === 'new') continue;
      if (list.length < 80) list.push({ n: c.name, s: c.state === 'lobby' ? 0 : c.state === 'queue' ? 1 : 2 });
    }
    const hr = [];
    for (const r of this.hrooms.values()) {
      if (hr.length >= 30) break;
      hr.push({ id: r.id, title: r.title, mode: r.mode, n: r.members.length, cap: r.cap, st: r.state === 'waiting' ? 0 : 1, host: r.host.name });
    }
    const msg = JSON.stringify({ t: 'lobby', online: this.clients.size, rooms: this.rooms.size + this.hrooms.size, players: list, hrooms: hr });
    for (const c of this.clients) if (c.state === 'lobby' || c.state === 'queue') c.conn.send(msg);
  }

  enqueue(client, mode) {
    if (!MODES[mode] || client.state !== 'lobby') return;
    client.state = 'queue';
    client.mode = mode;
    client.queuedAt = Date.now();
    this.queues[mode].push(client);
    this.tryMatch(mode);
    this.pushQueue(mode);
    this.dirty();
  }

  dequeue(client) {
    if (client.state !== 'queue') return;
    const q = this.queues[client.mode];
    const i = q.indexOf(client);
    if (i >= 0) q.splice(i, 1);
    const mode = client.mode;
    client.state = 'lobby';
    client.mode = null;
    this.pushQueue(mode);
    this.dirty();
  }

  pushQueue(mode) {
    const q = this.queues[mode];
    const need = MODES[mode].perTeam * 2;
    for (const c of q) c.send({ t: 'queue', mode, count: q.length, need });
  }

  tryMatch(mode) {
    const need = MODES[mode].perTeam * 2;
    const q = this.queues[mode];
    while (q.length >= need) this.openRoom(mode, q.splice(0, need));
  }

  /** 대기 중이던 사람들 + 부족한 자리는 봇으로 채워 시작 */
  fillWithBots(client) {
    if (client.state !== 'queue') return;
    if (Date.now() - client.queuedAt < BOT_FILL_AFTER_MS - 500) return;
    const mode = client.mode;
    const group = this.queues[mode].splice(0);
    this.openRoom(mode, group);
  }

  openRoom(mode, humans) {
    if (this.rooms.size + this.hrooms.size >= MAX_ROOMS) {          // 방이 너무 많으면 새로 만들지 않음 (서버 보호)
      for (const c of humans) { c.state = 'lobby'; c.mode = null; c.send({ t: 'error', code: 'busy', msg: '지금은 방이 가득 찼습니다. 잠시 후 다시 시도해 주세요.' }); }
      return;
    }
    try { new Room(this, mode, humans); }
    catch (e) {
      console.error('방 생성 실패', e);
      for (const c of humans) { c.state = 'lobby'; c.mode = null; c.send({ t: 'error', code: 'room', msg: '방을 만들지 못했습니다.' }); }
    }
  }

  createHostRoom(client, msg) {
    if (client.state !== 'lobby') return;
    const mode = MODES[msg.mode] ? msg.mode : '1v1';
    if (this.rooms.size + this.hrooms.size >= MAX_ROOMS) {
      client.send({ t: 'error', code: 'busy', msg: '지금은 방이 가득 찼습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    new HostRoom(this, client, mode, cleanText(msg.title, 16, client.name + '의 방'));
    this.dirty();
  }

  joinHostRoom(client, id) {
    if (client.state !== 'lobby') return;
    const room = this.hrooms.get(id);
    if (!room) { client.send({ t: 'error', code: 'noroom', msg: '방을 찾을 수 없습니다.' }); return; }
    if (!room.canJoin()) { client.send({ t: 'error', code: 'full', msg: '방이 가득 찼거나 이미 게임이 진행 중입니다.' }); return; }
    room.add(client);
    this.dirty();
  }

  add(client) { this.clients.add(client); this.dirty(); }

  remove(client) {
    if (client.hroom) client.hroom.leave(client);
    this.dequeue(client);
    if (client.room) client.room.removeClient(client);
    this.clients.delete(client);
    this.dirty();
  }
}

const channels = new Map();
for (let i = 0; i < CHANNELS; i++) channels.set(CHANNEL_START + i, new Channel(CHANNEL_START + i));
const ipCount = new Map();

/* ----------------------------------------------------------------------------
 * 메시지 처리
 * -------------------------------------------------------------------------- */
function onMessage(client, raw) {
  const now = Date.now();
  // 방장의 상태 전송만 큰 메시지를 허용
  if (raw.length > 1024 && !(client.hroom && client.hroom.host === client && client.hroom.state === 'playing')) {
    client.strikes++;
    return;
  }
  client.tokens = Math.min(60, client.tokens + (now - client.lastToken) * 0.05);   // 초당 50개
  client.lastToken = now;
  if (client.tokens < 1) {
    if (++client.strikes > 300) client.conn.terminate();
    return;
  }
  client.tokens -= 1;

  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg.t !== 'string') return;
  const ch = client.channel;

  if (msg.t === 'hello') {
    if (client.state !== 'new') return;
    client.name = cleanText(msg.name, 10, client.name);
    client.skin = Math.max(0, Math.min(SKIN_COUNT - 1, msg.skin | 0));
    client.state = 'lobby';
    client.send({ t: 'welcome', id: client.id, you: client.name, server: ch.status(), modes: Object.keys(MODES) });
    ch.dirty();
    return;
  }
  if (client.state === 'new') return;

  switch (msg.t) {
    case 'queue': ch.enqueue(client, msg.mode); break;
    case 'cancel': ch.dequeue(client); break;
    case 'fillbots': ch.fillWithBots(client); break;
    case 'in': {
      const dir = DIR_NAMES.includes(msg.dir) ? msg.dir : null;
      if (client.room) client.room.input(client, dir);
      else if (client.hroom) client.hroom.fromGuest(client, 'in', dir);
      break;
    }
    case 'bomb':
      if (client.room) client.room.bomb(client);
      else if (client.hroom) client.hroom.fromGuest(client, 'bomb');
      break;
    // ----- 방장 방식 -----
    case 'room_create': ch.createHostRoom(client, msg); break;
    case 'room_join': ch.joinHostRoom(client, msg.id | 0); break;
    case 'room_leave': if (client.hroom) client.hroom.leave(client); break;
    case 'team': if (client.hroom) client.hroom.switchTeam(client); break;
    case 'room_start': if (client.hroom) client.hroom.start(client); break;
    case 'room_end': if (client.hroom) client.hroom.end(client); break;
    case 'hs': if (client.hroom) client.hroom.hostSnapshot(client, msg); break;
    case 'leave': {
      if (client.room) { client.room.removeClient(client); client.state = 'lobby'; ch.dirty(); }
      break;
    }
    case 'chat': {
      if (client.state === 'room' || client.state === 'hroom' || now - client.lastChat < 700) return;
      const text = cleanText(msg.text, 60);
      if (!text) return;
      client.lastChat = now;
      const out = JSON.stringify({ t: 'chat', name: client.name, text });
      for (const c of ch.clients) if (c.state === 'lobby' || c.state === 'queue') c.conn.send(out);
      break;
    }
    default: break;
  }
}

/* ----------------------------------------------------------------------------
 * HTTP (정적 파일 + 상태 API) / WebSocket 업그레이드
 * -------------------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function clientIp(req) {
  if (TRUST_PROXY) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '?';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/servers') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify([...channels.values()].map(c => c.status())));
    return;
  }
  if (url.pathname === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }

  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => {});
  const url = new URL(req.url, 'http://x');
  const m = /^\/ws\/(\d+)$/.exec(url.pathname);
  const ch = m && channels.get(Number(m[1]));
  if (!ch) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
  if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(req.headers.origin || '')) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  const ip = clientIp(req);
  if ((ipCount.get(ip) || 0) >= MAX_PER_IP) { socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return; }

  acceptWebSocket(req, socket, { maxPayload: 16384 }, conn => {
    if (ch.clients.size >= CHANNEL_CAP) {                   // 정원 초과: 안내 후 종료
      conn.send(JSON.stringify({ t: 'full', msg: '서버가 가득 찼습니다. 다른 서버를 선택해 주세요.' }));
      setTimeout(() => conn.close(1013), 100);
      return;
    }
    ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
    const client = new Client(conn, ip, ch);
    ch.add(client);

    let alive = true;
    conn.on('pong', () => { alive = true; });
    client.hb = setInterval(() => {
      if (!alive) { conn.terminate(); return; }
      alive = false;
      conn.ping();
    }, 25000);
    // hello를 보내지 않는 유령 연결 정리
    client.helloTimer = setTimeout(() => { if (client.state === 'new') conn.terminate(); }, 8000);

    conn.on('message', raw => {
      try { onMessage(client, raw); } catch (e) { console.error('메시지 처리 오류', e); }
    });
    conn.on('close', () => {
      clearInterval(client.hb);
      clearTimeout(client.helloTimer);
      const n = (ipCount.get(ip) || 1) - 1;
      if (n <= 0) ipCount.delete(ip); else ipCount.set(ip, n);
      try { ch.remove(client); } catch (e) { console.error('정리 오류', e); }
    });
  });
});

/* ----------------------------------------------------------------------------
 * 메인 루프 (60Hz 시뮬레이션 + 로비 방송)
 * -------------------------------------------------------------------------- */
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(now - last, 100);
  last = now;
  for (const ch of channels.values()) {
    for (const room of [...ch.rooms]) {
      try { room.update(dt, now); }
      catch (e) { console.error('방 처리 오류 — 방 종료', e); room.destroy(); }
    }
    for (const hr of [...ch.hrooms.values()]) hr.checkHost(now);
    if (ch.lobbyDirty && now - ch.lastLobby >= 500) ch.flushLobby(now);
  }
}, 16);

// 예기치 못한 오류가 나도 서버 전체가 죽지 않도록 로그만 남김
process.on('uncaughtException', e => console.error('uncaughtException', e));
process.on('unhandledRejection', e => console.error('unhandledRejection', e));

function shutdown() {
  log('서버 종료 중...');
  for (const ch of channels.values()) for (const c of ch.clients) c.conn.close(1001);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  log(`Bubble Grid Game 서버 시작  http://localhost:${PORT}`);
  for (const ch of channels.values()) log(`  - ${ch.name}  (ws path: /ws/${ch.id}, 정원 ${CHANNEL_CAP}명)`);
});
