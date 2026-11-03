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
 *    ROOM_WINS(2) BOT_FILL_AFTER_MS(8000)
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
  }
  send(obj) { this.conn.send(JSON.stringify(obj)); }
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

    const per = MODES[mode].perTeam;
    const teams = [[], []];
    const usedSkins = new Set();
    // 같은 캐릭터를 고른 사람이 있으면 구분되도록 비어 있는 캐릭터로 바꿔 줌
    const pickSkin = want => {
      let s = want;
      if (usedSkins.has(s)) for (let k = 0; k < SKIN_COUNT; k++) if (!usedSkins.has(k)) { s = k; break; }
      usedSkins.add(s);
      return s;
    };
    humans.forEach((h, i) => teams[i % 2].push({ client: h, name: h.name, skin: pickSkin(h.skin), bot: false }));
    let botNo = 1;
    for (const t of [0, 1]) {
      while (teams[t].length < per) {
        teams[t].push({ client: null, name: '봇' + botNo++, skin: pickSkin((usedSkins.size + 1) % SKIN_COUNT), bot: true });
      }
    }
    this.slots = [...teams[0].map(s => ({ ...s, team: 0 })), ...teams[1].map(s => ({ ...s, team: 1 }))];

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
    this.lobbyDirty = false;
    this.lastLobby = 0;
  }

  status() {
    const queue = {};
    for (const m of Object.keys(MODES)) queue[m] = this.queues[m].length;
    return { id: this.id, name: this.name, online: this.clients.size, cap: CHANNEL_CAP, rooms: this.rooms.size, queue };
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
    const msg = JSON.stringify({ t: 'lobby', online: this.clients.size, rooms: this.rooms.size, players: list });
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
    if (this.rooms.size >= MAX_ROOMS) {          // 방이 너무 많으면 새로 만들지 않음 (서버 보호)
      for (const c of humans) { c.state = 'lobby'; c.mode = null; c.send({ t: 'error', code: 'busy', msg: '지금은 방이 가득 찼습니다. 잠시 후 다시 시도해 주세요.' }); }
      return;
    }
    try { new Room(this, mode, humans); }
    catch (e) {
      console.error('방 생성 실패', e);
      for (const c of humans) { c.state = 'lobby'; c.mode = null; c.send({ t: 'error', code: 'room', msg: '방을 만들지 못했습니다.' }); }
    }
  }

  add(client) { this.clients.add(client); this.dirty(); }

  remove(client) {
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
      if (!client.room) return;
      const dir = DIR_NAMES.includes(msg.dir) ? msg.dir : null;
      client.room.input(client, dir);
      break;
    }
    case 'bomb': if (client.room) client.room.bomb(client); break;
    case 'leave': {
      if (client.room) { client.room.removeClient(client); client.state = 'lobby'; ch.dirty(); }
      break;
    }
    case 'chat': {
      if (client.state === 'room' || now - client.lastChat < 700) return;
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

  acceptWebSocket(req, socket, { maxPayload: 1024 }, conn => {
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
