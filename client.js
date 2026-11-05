'use strict';
/* =============================================================================
 *  client.js — Bubble Grid Game 클라이언트
 *
 *    1. 캐릭터/아이템 그리기 (Canvas 도형으로 직접 그린 오리지널 그래픽)
 *    2. Renderer  : 경기장 그리기
 *    3. Sfx       : WebAudio 효과음 (음원 파일 없음)
 *    4. Keys / TouchPad : 키보드, 모바일 가상 조이패드
 *    5. 세션      : OnlineSession(서버 접속) / OfflineSession(연습, 브라우저에서 봇과 대전)
 *    6. App       : 화면 전환(타이틀→서버선택→로비→매칭→게임), 네트워크, HUD
 *
 *  온라인에서는 "서버가 진짜 게임을 돌리고" 이 클라이언트는
 *    - 내 입력(방향/물풍선)만 서버로 보내고
 *    - 서버가 보내준 상태(스냅샷)를 화면에 그립니다. (스냅샷 사이는 같은 로직으로 보간)
 * ========================================================================== */
(function () {
const { CONFIG, ITEM, DIR_NAMES, DIRS, MODES, SKIN_COUNT, GameCore, BotController } = window.BG;
const $ = id => document.getElementById(id);
const S = CONFIG.TILE_SIZE;

const TEAM = [
  { name: '레드', color: '#e8473f', dark: '#9c2620' },
  { name: '블루', color: '#2f7be0', dark: '#1a4a94' },
];
const SKINS = [
  { body: '#ff9e80', dark: '#c4553a', acc: 'ears' },
  { body: '#7fd6ff', dark: '#2b87b8', acc: 'antenna' },
  { body: '#a5e86b', dark: '#4f9b25', acc: 'sprout' },
  { body: '#ffd95e', dark: '#c29412', acc: 'bow' },
  { body: '#d7a6ff', dark: '#8447b8', acc: 'horn' },
  { body: '#ffb3d1', dark: '#c9567f', acc: 'cap' },
];
const NAVY = '#0f2f5c';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};

/* ============================================================================
 * 1. 그리기 도구
 * ========================================================================== */
function circ(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 캐릭터 (u = 한 칸 크기 기준). 모든 모양은 도형으로 직접 그린 오리지널 디자인 */
function drawChar(ctx, cx, cy, u, skinIdx, facing, bob = 0) {
  const sk = SKINS[skinIdx % SKINS.length];
  const lw = Math.max(2, u * 0.065);
  cy += bob;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.fillStyle = sk.dark; ctx.strokeStyle = NAVY; ctx.lineWidth = lw;

  // 몸통 아래쪽(작은 발)
  for (const sx of [-1, 1]) { circ(ctx, cx + sx * u * 0.15, cy + u * 0.33, u * 0.1); ctx.fill(); ctx.stroke(); }

  // 머리 뒤 장식
  if (sk.acc === 'ears') {
    for (const sx of [-1, 1]) { circ(ctx, cx + sx * u * 0.24, cy - u * 0.26, u * 0.12); ctx.fill(); ctx.stroke(); }
  } else if (sk.acc === 'horn') {
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * u * 0.1, cy - u * 0.3);
      ctx.lineTo(cx + sx * u * 0.2, cy - u * 0.5);
      ctx.lineTo(cx + sx * u * 0.28, cy - u * 0.24);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  } else if (sk.acc === 'antenna') {
    ctx.beginPath(); ctx.moveTo(cx, cy - u * 0.3); ctx.lineTo(cx, cy - u * 0.47); ctx.stroke();
    circ(ctx, cx, cy - u * 0.5, u * 0.07); ctx.fillStyle = '#ffe14d'; ctx.fill(); ctx.stroke();
  } else if (sk.acc === 'sprout') {
    ctx.beginPath(); ctx.moveTo(cx, cy - u * 0.3); ctx.lineTo(cx, cy - u * 0.42); ctx.stroke();
    ctx.fillStyle = '#58bf4c';
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(cx + sx * u * 0.09, cy - u * 0.46, u * 0.1, u * 0.055, sx * -0.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
  }

  // 머리
  const g = ctx.createRadialGradient(cx - u * 0.1, cy - u * 0.14, u * 0.04, cx, cy, u * 0.36);
  g.addColorStop(0, '#fff'); g.addColorStop(0.18, sk.body); g.addColorStop(1, sk.body);
  ctx.fillStyle = sk.body;
  circ(ctx, cx, cy, u * 0.34); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath(); ctx.ellipse(cx - u * 0.12, cy - u * 0.2, u * 0.1, u * 0.05, -0.6, 0, Math.PI * 2); ctx.fill();

  // 머리 위 장식
  if (sk.acc === 'bow') {
    ctx.fillStyle = '#ff6b8a';
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(cx - u * 0.2, cy - u * 0.28);
      ctx.lineTo(cx - u * 0.2 + sx * u * 0.15, cy - u * 0.38);
      ctx.lineTo(cx - u * 0.2 + sx * u * 0.15, cy - u * 0.18);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    circ(ctx, cx - u * 0.2, cy - u * 0.28, u * 0.045); ctx.fillStyle = '#ffd1dc'; ctx.fill(); ctx.stroke();
  } else if (sk.acc === 'cap') {
    ctx.fillStyle = '#ff7a59';
    ctx.beginPath(); ctx.arc(cx, cy - u * 0.12, u * 0.33, Math.PI * 1.08, Math.PI * 1.92); ctx.closePath(); ctx.fill(); ctx.stroke();
    rrect(ctx, cx - u * 0.05, cy - u * 0.2, u * 0.4, u * 0.08, u * 0.04); ctx.fill(); ctx.stroke();
    circ(ctx, cx, cy - u * 0.42, u * 0.04); ctx.fillStyle = '#fff'; ctx.fill();
  }

  // 얼굴
  const d = DIRS[facing] || DIRS.down;
  const ex = d.dx * u * 0.05, ey = d.dy * u * 0.035;
  for (const sx of [-1, 1]) {
    ctx.fillStyle = '#fff';
    circ(ctx, cx + sx * u * 0.12 + ex, cy - u * 0.02 + ey, u * 0.088); ctx.fill();
    ctx.lineWidth = lw * 0.6; ctx.stroke(); ctx.lineWidth = lw;
    ctx.fillStyle = NAVY;
    circ(ctx, cx + sx * u * 0.12 + ex + d.dx * u * 0.03, cy - u * 0.02 + ey + d.dy * u * 0.025, u * 0.045); ctx.fill();
  }
  ctx.strokeStyle = NAVY; ctx.lineWidth = lw * 0.7;
  ctx.beginPath(); ctx.arc(cx + ex, cy + u * 0.09 + ey, u * 0.065, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
  ctx.fillStyle = 'rgba(255,90,90,.35)';
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sx * u * 0.22 + ex, cy + u * 0.07 + ey, u * 0.05, u * 0.03, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

/** 아이템 아이콘: bomb=풍선 개수, range=물줄기 길이, speed=신발 */
function drawItemIcon(ctx, type, cx, cy, u) {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, u * 0.045); ctx.strokeStyle = NAVY;
  if (type === ITEM.BOMB) {
    ctx.fillStyle = '#4aa8f0';
    ctx.beginPath(); ctx.ellipse(cx, cy - u * 0.03, u * 0.15, u * 0.18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + u * 0.15); ctx.lineTo(cx - u * 0.045, cy + u * 0.22); ctx.lineTo(cx + u * 0.045, cy + u * 0.22); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath(); ctx.ellipse(cx - u * 0.06, cy - u * 0.1, u * 0.04, u * 0.06, -0.5, 0, Math.PI * 2); ctx.fill();
  } else if (type === ITEM.RANGE) {
    ctx.fillStyle = '#3fd0ff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - u * 0.24);
    ctx.bezierCurveTo(cx + u * 0.22, cy - u * 0.02, cx + u * 0.17, cy + u * 0.2, cx, cy + u * 0.2);
    ctx.bezierCurveTo(cx - u * 0.17, cy + u * 0.2, cx - u * 0.22, cy - u * 0.02, cx, cy - u * 0.24);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath(); ctx.ellipse(cx - u * 0.06, cy + u * 0.03, u * 0.035, u * 0.07, 0.3, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = '#ff8a3d';
    ctx.beginPath();
    ctx.moveTo(cx - u * 0.17, cy - u * 0.16);
    ctx.lineTo(cx - u * 0.02, cy - u * 0.16);
    ctx.lineTo(cx - u * 0.01, cy - u * 0.02);
    ctx.lineTo(cx + u * 0.2, cy + u * 0.03);
    ctx.lineTo(cx + u * 0.2, cy + u * 0.1);
    ctx.lineTo(cx - u * 0.17, cy + u * 0.1);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const wx of [-0.1, 0.12]) { circ(ctx, cx + u * wx, cy + u * 0.16, u * 0.05); ctx.fill(); ctx.stroke(); }
  }
  ctx.restore();
}

function skinAvatar(canvas, skin, selected) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawChar(ctx, canvas.width / 2, canvas.height * 0.58, canvas.width * 0.92, skin, 'down', 0);
}

/* ============================================================================
 * 2. Renderer
 * ========================================================================== */
class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = CONFIG.COLS * S;
    canvas.height = CONFIG.ROWS * S;
  }

  draw(core, time, myPid, ghosts) {
    const ctx = this.ctx, { COLS, ROWS } = CONFIG;
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        ctx.fillStyle = ((x + y) & 1) ? '#cfe9c4' : '#c3e2b6';
        ctx.fillRect(x * S, y * S, S, S);
      }
    }
    for (const it of core.items) this.drawItem(it, time);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = core.grid[y * COLS + x];
        if (t === 1) this.drawWall(x, y);
        else if (t === 2) this.drawBlock(x, y);
      }
    }
    for (const b of core.bombs) this.drawBomb(b, time);
    if (ghosts) for (const g of ghosts) this.drawBomb({ x: g.x, y: g.y, timer: CONFIG.FUSE_MS }, time);
    for (const f of core.flames) this.drawFlame(f);
    const order = core.players.filter(p => p.alive).sort((a, b) => (a.py + (a.y - a.py) * 0.5) - (b.py + (b.y - b.py) * 0.5));
    for (const p of order) this.drawPlayer(p, time, core, p.id === myPid);
  }

  drawWall(x, y) {
    const ctx = this.ctx, px = x * S, py = y * S;
    ctx.fillStyle = NAVY; rrect(ctx, px + 1, py + 1, S - 2, S - 2, 8); ctx.fill();
    ctx.fillStyle = '#4d6a91'; rrect(ctx, px + 3, py + 3, S - 6, S - 6, 6); ctx.fill();
    ctx.fillStyle = '#7f9cc4'; rrect(ctx, px + 5, py + 5, S - 10, S - 16, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.3)'; rrect(ctx, px + 9, py + 9, S - 24, 5, 2.5); ctx.fill();
  }

  drawBlock(x, y) {
    const ctx = this.ctx, px = x * S, py = y * S;
    ctx.fillStyle = NAVY; rrect(ctx, px + 2, py + 2, S - 4, S - 4, 7); ctx.fill();
    ctx.fillStyle = '#c9822f'; rrect(ctx, px + 4, py + 4, S - 8, S - 8, 5); ctx.fill();
    ctx.fillStyle = '#f2b765'; rrect(ctx, px + 6, py + 6, S - 12, S - 17, 4); ctx.fill();
    ctx.strokeStyle = '#c9822f'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px + 11, py + 11); ctx.lineTo(px + S - 11, py + S - 18);
    ctx.moveTo(px + S - 11, py + 11); ctx.lineTo(px + 11, py + S - 18);
    ctx.stroke();
  }

  drawBomb(b, time) {
    const ctx = this.ctx;
    const cx = (b.x + 0.5) * S, cy = (b.y + 0.5) * S;
    const urgent = b.timer < 600;
    const pulse = 1 + 0.07 * Math.sin(time / (urgent ? 55 : 150));
    const r = S * 0.34 * pulse;
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.beginPath(); ctx.ellipse(cx, cy + S * 0.3, r * 0.9, r * 0.27, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#f2fbff');
    g.addColorStop(0.5, urgent ? '#ffb1a6' : '#86d4ff');
    g.addColorStop(1, urgent ? '#e0463f' : '#2f93e0');
    ctx.fillStyle = g; ctx.strokeStyle = NAVY; ctx.lineWidth = 3;
    circ(ctx, cx, cy, r); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath(); ctx.ellipse(cx - r * 0.35, cy - r * 0.4, r * 0.2, r * 0.13, -0.6, 0, Math.PI * 2); ctx.fill();
  }

  drawFlame(f) {
    const ctx = this.ctx;
    const a = Math.max(0, f.timer / f.max);
    const cx = (f.x + 0.5) * S, cy = (f.y + 0.5) * S;
    const r = S * (0.52 + 0.14 * (1 - a));
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
    g.addColorStop(0.5, `rgba(110,210,255,${0.9 * a})`);
    g.addColorStop(1, 'rgba(40,140,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(f.x * S - 4, f.y * S - 4, S + 8, S + 8);
  }

  drawItem(it, time) {
    const ctx = this.ctx;
    const cx = (it.x + 0.5) * S, cy = (it.y + 0.5) * S + Math.sin(time / 200 + it.x * 1.3 + it.y) * 2.5;
    ctx.fillStyle = '#fffbe8'; ctx.strokeStyle = NAVY; ctx.lineWidth = 3;
    circ(ctx, cx, cy, S * 0.31); ctx.fill(); ctx.stroke();
    drawItemIcon(ctx, it.type, cx, cy, S * 0.9);
  }

  drawPlayer(p, time, core, isMe) {
    const ctx = this.ctx;
    const t = p.moveTimer > 0 ? 1 - p.moveTimer / p.curDur : 1;
    const gx = p.px + (p.x - p.px) * t, gy = p.py + (p.y - p.py) * t;
    const cx = (gx + 0.5) * S;
    let cy = (gy + 0.5) * S;
    const team = TEAM[p.team];
    const roundWon = core.state !== 'playing' && core.winnerTeam === p.team;

    // 팀 색 발판
    ctx.fillStyle = 'rgba(0,0,0,.14)';
    ctx.beginPath(); ctx.ellipse(cx, cy + S * 0.31, S * 0.28, S * 0.095, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = team.color; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(cx, cy + S * 0.31, S * 0.27, S * 0.09, 0, 0, Math.PI * 2); ctx.stroke();

    if (p.invuln > 0 && Math.floor(time / 90) % 2) ctx.globalAlpha = 0.45;

    if (p.trapped) {
      const k = Math.max(0, p.trapTimer / CONFIG.TRAP_MS);
      const wob = Math.sin(time / 170) * 2.5;
      drawChar(ctx, cx, cy + wob + 3, S * 0.8, p.skin, p.facing, 0);
      ctx.fillStyle = 'rgba(130, 214, 255, .5)'; ctx.strokeStyle = '#2b8fd6'; ctx.lineWidth = 3;
      circ(ctx, cx, cy + wob, S * 0.47); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath(); ctx.ellipse(cx - S * 0.19, cy + wob - S * 0.22, S * 0.08, S * 0.045, -0.7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = k < 0.35 ? '#e8473f' : '#fff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy + wob, S * 0.52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
      cy += wob;
    } else {
      const bob = roundWon ? -Math.abs(Math.sin(time / 150)) * 9 : (p.moveTimer > 0 ? Math.sin(time / 55) * 1.6 : 0);
      drawChar(ctx, cx, cy, S, p.skin, p.facing, bob);
      cy += bob;
    }
    ctx.globalAlpha = 1;

    // 이름표
    const label = p.name;
    ctx.font = '12px "Jua", "Malgun Gothic", sans-serif';
    const w = Math.max(30, ctx.measureText(label).width + 12), h = 16;
    const ty = cy - S * 0.66;
    ctx.fillStyle = team.color; ctx.strokeStyle = NAVY; ctx.lineWidth = 2;
    rrect(ctx, cx - w / 2, ty - h, w, h, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, ty - h / 2 + 1);
    if (isMe) {
      ctx.fillStyle = '#ffe14d'; ctx.strokeStyle = NAVY; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 6, ty - h - 9); ctx.lineTo(cx + 6, ty - h - 9); ctx.lineTo(cx, ty - h - 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
}

/* ============================================================================
 * 3. Sfx — WebAudio 효과음
 * ========================================================================== */
class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.lastBoom = 0; }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  tone(freq, dur, type = 'sine', vol = 0.07, slideTo = null, delay = 0) {
    const a = this.ctx, t0 = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  noise(dur, vol = 0.12) {
    const a = this.ctx, len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(), g = a.createGain();
    g.gain.value = vol; src.buffer = buf; src.connect(g).connect(a.destination); src.start();
  }
  play(name) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    switch (name) {
      case 'place': this.tone(420, 0.09, 'sine', 0.08, 640); break;
      case 'boom': {
        const now = performance.now();
        if (now - this.lastBoom < 70) return;
        this.lastBoom = now;
        this.noise(0.28, 0.14); this.tone(160, 0.25, 'triangle', 0.1, 50);
        break;
      }
      case 'item':   this.tone(660, 0.08, 'square', 0.05); this.tone(990, 0.1, 'square', 0.05, null, 0.07); break;
      case 'trap':   this.tone(700, 0.22, 'sine', 0.09, 260); this.tone(380, 0.18, 'sine', 0.07, 760, 0.12); break;
      case 'rescue': [520, 780, 1040].forEach((f, i) => this.tone(f, 0.1, 'triangle', 0.08, null, i * 0.07)); break;
      case 'death':  this.tone(480, 0.4, 'sawtooth', 0.07, 90); break;
      case 'ready':  this.tone(440, 0.12, 'square', 0.04); break;
      case 'win':    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.08, null, i * 0.11)); break;
      case 'lose':   [392, 330, 262].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.08, null, i * 0.16)); break;
    }
  }
}

/* ============================================================================
 * 4. 입력 — 키보드 / 가상 조이패드
 * ========================================================================== */
class Keys {
  constructor(onDir, onBomb) {
    this.stack = [];
    this.active = false;
    this.onDir = onDir;
    this.onBomb = onBomb;
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
    const typing = e => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    window.addEventListener('keydown', e => {
      if (!this.active || typing(e)) return;
      const d = map[e.code];
      if (d) {
        e.preventDefault();
        if (!this.stack.includes(d)) { this.stack.push(d); this.emit(); }
      } else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!e.repeat) this.onBomb();
      }
    });
    window.addEventListener('keyup', e => {
      const d = map[e.code];
      if (!d) return;
      const i = this.stack.indexOf(d);
      if (i >= 0) { this.stack.splice(i, 1); this.emit(); }
    });
    window.addEventListener('blur', () => this.reset());
  }
  emit() { this.onDir(this.stack.length ? this.stack[this.stack.length - 1] : null); }
  reset() { if (this.stack.length) { this.stack = []; this.emit(); } }
}

/** 가상 조이스틱 + 물풍선 버튼.
 *  - 스틱과 버튼은 각자 다른 손가락(pointerId)으로 추적해서 이동하면서 동시에 공격할 수 있음
 *  - 손잡이가 손가락을 따라 움직이고, 데드존/축 고정(히스테리시스)으로 대각선에서 방향이 떨리지 않음
 *  - 가려는 방향이 벽이면 손가락이 기운 쪽의 다른 방향으로 미끄러져 모서리를 부드럽게 돌아감 */
class TouchPad {
  constructor({ stick, knob, bombBtn, onDir, onBomb, onGesture, isBlocked }) {
    this.stick = stick; this.knob = knob; this.bombBtn = bombBtn;
    this.onDir = onDir;
    this.isBlocked = isBlocked || (() => false);
    this.dir = null;
    this.axis = null;
    this.vec = { x: 0, y: 0 };
    this.stickId = null;
    this.bombIds = new Set();
    this.rect = null;

    stick.addEventListener('pointerdown', e => {
      if (this.stickId !== null) return;
      e.preventDefault(); onGesture();
      this.stickId = e.pointerId;
      this.rect = stick.getBoundingClientRect();
      this.moveTo(e);
    });
    bombBtn.addEventListener('pointerdown', e => {
      e.preventDefault(); onGesture();
      this.bombIds.add(e.pointerId);
      bombBtn.classList.add('on');
      if (navigator.vibrate) navigator.vibrate(10);
      onBomb();
    });
    // 이동/종료는 window 에서 받아서 손가락이 버튼 밖으로 나가도 끊기지 않게 함
    window.addEventListener('pointermove', e => { if (e.pointerId === this.stickId) this.moveTo(e); });
    const end = e => {
      if (e.pointerId === this.stickId) { this.stickId = null; this.release(); }
      if (this.bombIds.delete(e.pointerId) && !this.bombIds.size) bombBtn.classList.remove('on');
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    for (const el of [stick, bombBtn]) el.addEventListener('contextmenu', e => e.preventDefault());
  }

  moveTo(e) {
    const r = this.rect, R = r.width / 2;
    const dx = (e.clientX - (r.left + R)) / R, dy = (e.clientY - (r.top + r.height / 2)) / R;
    this.vec = { x: dx, y: dy };
    const len = Math.hypot(dx, dy), k = len > 1 ? 1 / len : 1, travel = R * 0.52;
    this.knob.style.transform = `translate(${dx * k * travel}px, ${dy * k * travel}px)`;
    this.apply();
  }

  apply() {
    const { x, y } = this.vec;
    const len = Math.hypot(x, y);
    let dir = null;
    if (len >= 0.2) {                                   // 데드존
      const ax = Math.abs(x), ay = Math.abs(y);
      if (this.axis === 'x' && ay > ax * 1.35) this.axis = 'y';     // 축을 바꾸려면 확실히 기울여야 함
      else if (this.axis === 'y' && ax > ay * 1.35) this.axis = 'x';
      else if (!this.axis) this.axis = ax >= ay ? 'x' : 'y';
      const hx = x > 0 ? 'right' : 'left', hy = y > 0 ? 'down' : 'up';
      const primary = this.axis === 'x' ? hx : hy, secondary = this.axis === 'x' ? hy : hx;
      const secMag = this.axis === 'x' ? ay : ax;
      dir = primary;
      if (this.isBlocked(primary) && secMag > len * 0.3 && !this.isBlocked(secondary)) dir = secondary;   // 벽 슬라이드
    } else {
      this.axis = null;
    }
    this.setDir(dir);
  }

  setDir(d) {
    if (d === this.dir) return;
    this.dir = d;
    this.stick.querySelectorAll('.arr').forEach(el => el.classList.toggle('on', el.dataset.dir === d));
    this.onDir(d);
  }

  /** 매 프레임: 손가락은 그대로여도 주변 지형이 바뀌면(막힘/뚫림) 방향을 다시 계산 */
  tick() { if (this.stickId !== null) this.apply(); }

  release() {
    this.vec = { x: 0, y: 0 };
    this.axis = null;
    this.knob.style.transform = 'translate(0, 0)';
    this.setDir(null);
  }

  reset() {
    this.stickId = null;
    this.bombIds.clear();
    this.bombBtn.classList.remove('on');
    this.release();
  }
}

/* ============================================================================
 * 5. 세션 — "경기 한 판"을 감싸는 객체 (온라인 / 오프라인 공통 인터페이스)
 *      core, myPid, update(dt), sendDir(dir), sendBomb(), close()
 * ========================================================================== */
class OnlineSession {
  /** start: 'start'(전용 서버 방식) 또는 'hstart'(방장 방식) 메시지 */
  constructor(app, start) {
    this.app = app;
    this.net = app.net;
    this.online = true;
    this.mode = start.mode;
    this.myPid = start.you;
    this.relay = start.hostPid !== undefined;        // true = 방장 방식, false = 전용 서버 방식
    this.hostPid = this.relay ? start.hostPid : -1;
    this.isHost = false;
    this.defs = start.players;
    this.bots = [];
    this.events = [];
    this.lastGrid = null;
    this.lastSend = 0;
    this.overAt = 0;
    this.endSent = false;
    this.lastDir = null;
    this.ghosts = [];
    this.aheadSince = 0;
    this.core = new GameCore({
      seed: start.seed, players: start.players, winsToMatch: start.winsToMatch,
      onEvent: e => { if (this.isHost) { this.events.push(e); this.app.onEvent(e); } },
    });
    if (this.relay && start.hostPid === start.you) this.becomeHost(start.bots || []);
  }

  /* ----- 방장 ----- */
  becomeHost(botPids) {
    this.isHost = true;
    this.hostPid = this.myPid;
    this.lastGrid = null;
    this.events = [];
    this.overAt = 0;
    this.endSent = false;
    this.setBots(botPids);
  }
  setBots(pids) {
    for (const pid of pids) if (!this.bots[pid] && pid !== this.myPid && this.core.players[pid]) this.bots[pid] = new BotController(this.core, pid);
  }
  stopHosting() { this.isHost = false; this.bots = []; this.events = []; }

  /** 서버가 보낸 메시지 처리. 처리했으면 true */
  handle(m) {
    switch (m.t) {
      case 's': if (!this.isHost) this.handleSnapshot(m); return true;
      case 'r_in': if (this.isHost && this.core.players[m.pid]) this.core.setInput(m.pid, DIR_NAMES.includes(m.dir) ? m.dir : null); return true;
      case 'r_bomb': if (this.isHost) this.core.queueBomb(m.pid | 0); return true;
      case 'peer_left': if (this.isHost) this.setBots([m.pid | 0]); return true;
      case 'host_change':
        this.hostPid = m.hostPid;
        if (m.hostPid === this.myPid) {
          if (!this.isHost) this.becomeHost(m.bots || []); else this.setBots(m.bots || []);
          this.core.setInput(this.myPid, this.lastDir);
          this.app.notice('내가 방장이 되었습니다. 게임을 이어서 진행합니다');
        } else {
          if (this.isHost) this.stopHosting();
          this.app.notice(`방장이 ${m.name}님으로 바뀌었습니다`);
        }
        return true;
      default: return false;
    }
  }

  update(dt) {
    if (!this.isHost) { this.core.update(dt); return; }
    for (const b of this.bots) if (b) b.update(dt);
    this.core.update(dt);
    this.broadcast();
    if (this.core.state === 'matchOver') {                 // 한 판이 끝나면 잠시 뒤 모두 대기방으로
      const now = performance.now();
      if (!this.overAt) this.overAt = now;
      else if (!this.endSent && now - this.overAt > 7000) { this.endSent = true; this.net.send({ t: 'room_end' }); }
    }
  }

  broadcast() {
    const now = performance.now();
    if (now - this.lastSend < 40) return;                   // 25Hz
    this.lastSend = now;
    const g = this.core.grid.join('');
    const snap = this.core.getSnapshot(false);
    if (g !== this.lastGrid) { snap.g = g; this.lastGrid = g; }
    this.net.send({ t: 'hs', s: snap, ev: this.events });
    this.events = [];
  }

  /* ----- 참가자: 서버(방장)가 보낸 상태 반영 + 내 캐릭터 예측 ----- */
  handleSnapshot(m) {
    const me = this.core.players[this.myPid];
    const keep = me && { x: me.x, y: me.y, px: me.px, py: me.py, moveTimer: me.moveTimer, curDur: me.curDur, facing: me.facing };
    this.core.applySnapshot(m.s);
    const sp = this.core.players[this.myPid];
    if (sp && keep) {
      // 내 입력은 즉시 내 화면에 반영(예측)해 두었으므로, 서버 상태와 한 칸 이내로 어긋나면 내 쪽을 유지해 끊김을 없앰
      const dist = Math.abs(keep.x - sp.x) + Math.abs(keep.y - sp.y);
      const now = performance.now();
      let useLocal = false;
      if (sp.alive && !sp.trapped && this.core.state === 'playing' && this.core.freeze <= 0) {
        if (dist === 0) { useLocal = true; this.aheadSince = 0; }
        else if (dist === 1) { if (!this.aheadSince) this.aheadSince = now; useLocal = now - this.aheadSince < 450; }
        else this.aheadSince = 0;
      } else this.aheadSince = 0;
      if (useLocal) Object.assign(sp, keep);
      sp.input = this.lastDir;
    }
    for (const e of m.ev || []) this.app.onEvent(e);
  }

  sendDir(dir) {
    if (dir === this.lastDir) return;
    this.lastDir = dir;
    this.core.setInput(this.myPid, dir);                    // 방장은 곧바로 반영, 참가자는 예측
    if (!this.isHost) this.net.send({ t: 'in', dir });
  }

  sendBomb() {
    if (this.isHost) { this.core.queueBomb(this.myPid); return; }
    this.net.send({ t: 'bomb' });
    const c = this.core, me = c.players[this.myPid], now = performance.now();
    if (!me || !me.alive || me.trapped || c.state !== 'playing' || c.freeze > 0) return;
    const pending = this.ghostBombs(now);
    if (c.countBombs(me.id) + pending.length >= me.maxBombs) return;
    if (c.bombAt(me.x, me.y) || pending.some(g => g.x === me.x && g.y === me.y)) return;
    this.ghosts.push({ x: me.x, y: me.y, t: now });         // 서버 확인 전에도 물풍선이 바로 보이게
  }

  /** 아직 서버에서 확인되지 않은 내 물풍선(표시 전용) */
  ghostBombs(now) {
    this.ghosts = this.ghosts.filter(g => now - g.t < 450 && !this.core.bombAt(g.x, g.y));
    return this.ghosts;
  }

  close() { this.net.send({ t: this.relay ? 'room_leave' : 'leave' }); }
}

class OfflineSession {
  constructor(mode, me, onEvent) {
    this.online = false;
    this.relay = false;
    this.isHost = false;
    this.hostPid = -1;
    this.mode = mode;
    this.myPid = 0;
    const per = MODES[mode].perTeam;
    const defs = [{ name: me.name, team: 0, skin: me.skin }];
    const used = new Set([me.skin]);
    let n = 1;
    const nextSkin = () => { let s = 0; while (used.has(s) && used.size < SKIN_COUNT) s++; used.add(s); return s % SKIN_COUNT; };
    for (let i = 1; i < per; i++) defs.push({ name: '봇' + n++, team: 0, skin: nextSkin() });
    for (let i = 0; i < per; i++) defs.push({ name: '봇' + n++, team: 1, skin: nextSkin() });
    this.core = new GameCore({ seed: (Math.random() * 4294967296) >>> 0, players: defs, winsToMatch: CONFIG.WINS_TO_MATCH, onEvent });
    this.bots = defs.map((_, i) => (i === 0 ? null : new BotController(this.core, i)));
  }
  update(dt) { for (const b of this.bots) if (b) b.update(dt); this.core.update(dt); }
  sendDir(dir) { this.core.setInput(0, dir); }
  sendBomb() { this.core.queueBomb(0); }
  ghostBombs() { return []; }
  close() {}
}

/* ============================================================================
 * 6. 네트워크
 * ========================================================================== */
function defaultBase() { return location.protocol === 'file:' ? 'http://localhost:8080' : ''; }
function serverBases() {
  const cfg = window.BG_CONFIG && Array.isArray(window.BG_CONFIG.servers) ? window.BG_CONFIG.servers : [];
  return cfg.length ? cfg.map(s => String(s).replace(/\/+$/, '')) : [defaultBase()];
}
function wsUrl(base, id) {
  if (!base) return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/' + id;
  return base.replace(/^http/i, 'ws') + '/ws/' + id;
}
async function fetchServers() {
  const results = await Promise.all(serverBases().map(async base => {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 3500);
    try {
      const r = await fetch(base + '/api/servers', { signal: ctl.signal, cache: 'no-store' });
      const arr = await r.json();
      return arr.map(c => ({ ...c, base }));
    } catch {
      return [{ base, id: null, name: base || '서버', offline: true }];
    } finally { clearTimeout(to); }
  }));
  return results.flat();
}

class Net {
  constructor(handlers) { this.ws = null; this.h = handlers; }
  connect(base, id, hello) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl(base, id));
      this.ws = ws;
      const fail = e => { if (!settled) { settled = true; reject(e); } };
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', ...hello }));
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome' && !settled) { settled = true; resolve(m); }
        else if (m.t === 'full') fail(new Error('full'));
        this.h.onMessage(m);
      };
      ws.onerror = () => fail(new Error('connect'));
      ws.onclose = () => { fail(new Error('closed')); if (this.ws === ws) { this.ws = null; this.h.onClose(); } };
    });
  }
  send(o) {
    const w = this.ws;
    if (!w || w.readyState !== 1) return;
    if (o.t === 'hs' && w.bufferedAmount > 200000) return;     // 회선이 밀리면 상태 전송을 건너뜀
    w.send(JSON.stringify(o));
  }
  close() { const w = this.ws; this.ws = null; if (w) { w.onclose = null; try { w.close(); } catch { /* 이미 닫힘 */ } } }
  get open() { return !!this.ws && this.ws.readyState === 1; }
}

/* ============================================================================
 * 6-2. P2PNet — 서버 없이 하는 온라인 (PeerJS / WebRTC)
 *  Net 과 같은 모양(send / close / open)이라 나머지 코드는 그대로 씁니다.
 *  - 방 주소가 고정되어 있음: bubblegrid-p2p-<서버번호>-<방식>-<칸>
 *  - 먼저 매칭을 누른 사람이 그 주소를 "차지"해 방장이 되고, 다음 사람은 주소가 이미 쓰이고 있으므로 그 방에 접속
 *  - 방장이 나가면 남은 사람 중 순서가 앞선 사람이 같은 주소를 다시 차지해 새 방장이 됨 (나머지는 그 주소로 재접속)
 * ========================================================================== */
const P2P_SLOTS = 6;
function loadPeerLib() {
  if (window.Peer) return Promise.resolve();
  const urls = ['https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'];
  return urls.reduce((p, u) => p.catch(() => new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = u; el.onload = () => (window.Peer ? res() : rej(new Error('lib'))); el.onerror = () => rej(new Error('load'));
    document.head.appendChild(el);
  })), Promise.reject(new Error('start')));
}

class P2PNet {
  constructor(h) { this.h = h; this.open = true; this.ch = 1; this.me = { name: '', skin: 0 }; this.mode = '1v1'; this.gen = 0; this.hardReset(); }
  configure(ch, me) { this.ch = ch; this.me = me; }
  roomId(slot) { return `bubblegrid-p2p-${this.ch}-${this.mode}-${slot}`; }
  need() { return MODES[this.mode].perTeam * 2; }
  emit(m) { try { this.h.onMessage(m); } catch (e) { console.error(e); } }

  hardReset() {
    this.gen++;
    clearInterval(this.tBeat); clearTimeout(this.tMig); clearTimeout(this.tGrace);
    for (const p of [this.peer, this.gpeer]) { try { if (p) p.destroy(); } catch { /* 이미 닫힘 */ } }
    this.peer = this.gpeer = this.conn = null;
    this.role = null; this.phase = 'idle'; this.members = []; this.pmap = new Map();
    this.myPid = -1; this.hostPid = -1; this.defs = []; this.slot = 0; this.lastRecv = 0;
  }
  close() { this.hardReset(); }
  fail(g, msg) { if (g !== this.gen) return; this.hardReset(); this.emit({ t: 'error', msg }); }

  send(o) {
    switch (o.t) {
      case 'queue': this.mode = o.mode; this.begin(); break;
      case 'cancel': case 'leave': case 'room_leave': this.hardReset(); break;
      case 'fillbots':
        if (this.role === 'host' && this.phase === 'wait') this.startGame();
        else if (this.role === 'guest' && this.phase === 'wait' && this.conn) this.conn.send({ t: 'fillbots' });
        break;
      case 'in': case 'bomb': if (this.role === 'guest' && this.conn && this.conn.open) this.conn.send(o); break;
      case 'hs':
        if (this.role === 'host') for (const c of this.pmap.values()) if (c.open) c.send({ t: 's', s: o.s, ev: o.ev });
        break;
      case 'room_end':
        if (this.role === 'host') {
          for (const c of this.pmap.values()) if (c.open) c.send({ t: 'p2p_end' });
          this.emit({ t: 'p2p_end' });
          const g = this.gen; setTimeout(() => { if (g === this.gen) this.hardReset(); }, 400);
        }
        break;
      default: break;
    }
  }

  /* ----- 매칭: 주소 차지 시도 → 실패하면 그 방에 참가 ----- */
  async begin() {
    this.hardReset();
    const g = this.gen;
    this.phase = 'find';
    try { await loadPeerLib(); } catch { this.fail(g, 'P2P 연결 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'); return; }
    if (g === this.gen) this.find(0, 0, g);
  }

  find(slot, tries, g) {
    if (g !== this.gen) return;
    if (tries >= P2P_SLOTS * 2) { this.fail(g, '매칭에 실패했습니다. 잠시 후 다시 시도해 주세요.'); return; }
    let peer;
    try { peer = new Peer(this.roomId(slot % P2P_SLOTS)); } catch { this.fail(g, 'P2P 연결을 만들지 못했습니다.'); return; }
    this.peer = peer;
    peer.on('open', () => { if (g === this.gen) this.hostWait(slot, g); });
    peer.on('error', err => {
      if (g !== this.gen || this.phase !== 'find') return;
      try { peer.destroy(); } catch { /* 이미 닫힘 */ }
      this.peer = null;
      if (err && err.type === 'unavailable-id') this.guestJoin(slot, tries, g);
      else this.fail(g, 'P2P 중계 서버에 접속하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    });
  }

  guestJoin(slot, tries, g) {
    let gp;
    try { gp = new Peer(); } catch { this.fail(g, 'P2P 연결을 만들지 못했습니다.'); return; }
    this.gpeer = gp;
    const next = () => {
      if (g !== this.gen || this.phase !== 'find') return;
      try { gp.destroy(); } catch { /* 이미 닫힘 */ }
      this.gpeer = null; this.conn = null;
      this.find(slot + 1, tries + 1, g);
    };
    const retrySame = () => {                       // 그 사이 방장이 사라졌으면 내가 그 주소를 차지
      if (g !== this.gen || this.phase !== 'find') return;
      try { gp.destroy(); } catch { /* 이미 닫힘 */ }
      this.gpeer = null; this.conn = null;
      this.find(slot, tries + 1, g);
    };
    const timer = setTimeout(next, 7000);
    gp.on('error', err => {
      if (g !== this.gen || this.phase !== 'find') return;
      clearTimeout(timer);
      if (err && err.type === 'peer-unavailable') retrySame(); else this.fail(g, 'P2P 중계 서버에 접속하지 못했습니다.');
    });
    gp.on('open', () => {
      if (g !== this.gen) return;
      const c = gp.connect(this.roomId(slot % P2P_SLOTS), { reliable: true, serialization: 'json' });
      c.on('open', () => c.send({ t: 'join', name: this.me.name, skin: this.me.skin }));
      c.on('data', m => {
        if (g !== this.gen || !m) return;
        if (m.t === 'full') { clearTimeout(timer); next(); return; }
        if (m.t === 'queue' && this.phase === 'find') {                // 방에 들어감
          clearTimeout(timer); this.phase = 'wait'; this.role = 'guest'; this.conn = c; this.slot = slot % P2P_SLOTS; this.watch(g);
        }
        this.onHostMsg(m, g);
      });
      c.on('close', () => { clearTimeout(timer); if (g === this.gen && this.conn === c) this.hostLost(g); });
      c.on('error', () => {});
    });
  }

  /* ----- 방장 ----- */
  hostWait(slot, g) {
    this.role = 'host'; this.phase = 'wait'; this.slot = slot % P2P_SLOTS;
    this.members = [{ conn: null, name: this.me.name, skin: this.me.skin }];
    this.peer.on('connection', c => {
      c.on('data', m => { if (g === this.gen && m) this.hostData(c, m); });
      c.on('close', () => { if (g === this.gen) this.hostLeft(c); });
      c.on('error', () => {});
    });
    this.announce();
  }
  announce() {
    const m = { t: 'queue', count: this.members.length, need: this.need() };
    for (const x of this.members) if (x.conn && x.conn.open) x.conn.send(m);
    this.emit(m);
  }
  hostData(c, m) {
    if (m.t === 'join') {
      if (this.phase !== 'wait' || this.members.length >= this.need() || this.members.some(x => x.conn === c)) { c.send({ t: 'full' }); return; }
      const name = String(m.name || '손님').replace(/[<>&"'`\\]/g, '').slice(0, 10) || '손님';
      this.members.push({ conn: c, name, skin: Math.max(0, Math.min(SKIN_COUNT - 1, m.skin | 0)) });
      this.announce();
      if (this.members.length >= this.need()) this.startGame();
    } else if (m.t === 'fillbots') { if (this.phase === 'wait') this.startGame(); }
    else if (m.t === 'resume') { if (this.phase === 'playing') this.resume(c, m); }
    else if (this.phase === 'playing') {
      const pid = this.pidOf(c);
      if (pid < 0) return;
      if (m.t === 'in') this.emit({ t: 'r_in', pid, dir: m.dir });
      else if (m.t === 'bomb') this.emit({ t: 'r_bomb', pid });
    }
  }
  pidOf(c) { for (const [pid, x] of this.pmap) if (x === c) return pid; return -1; }
  hostLeft(c) {
    if (this.phase === 'wait') {
      const i = this.members.findIndex(x => x.conn === c);
      if (i > 0) { this.members.splice(i, 1); this.announce(); }
    } else if (this.phase === 'playing') {
      const pid = this.pidOf(c);
      if (pid >= 0) { this.pmap.delete(pid); this.emit({ t: 'peer_left', pid }); }
    }
  }

  startGame() {
    if (this.phase !== 'wait') return;
    const per = MODES[this.mode].perTeam, used = new Set();
    const pick = want => { let sk = want; if (used.has(sk)) for (let k = 0; k < SKIN_COUNT; k++) if (!used.has(k)) { sk = k; break; } used.add(sk); return sk; };
    const teams = [[], []];
    this.members.forEach((m, i) => teams[i % 2].push(m));
    const defs = [], owner = [];
    let botNo = 1;
    for (const t of [0, 1]) for (let k = 0; k < per; k++) {
      const m = teams[t][k];
      defs.push({ name: m ? m.name : '봇' + botNo++, team: t, skin: pick(m ? m.skin : (used.size + 1) % SKIN_COUNT), bot: !m });
      owner.push(m || null);
    }
    const hostPid = owner.findIndex(m => m && !m.conn);
    const bots = defs.map((d, i) => (d.bot ? i : -1)).filter(i => i >= 0);
    const seed = (Math.random() * 2 ** 31) >>> 0;
    this.phase = 'playing'; this.defs = defs; this.myPid = hostPid; this.hostPid = hostPid;
    this.pmap = new Map();
    owner.forEach((m, pid) => { if (m && m.conn) this.pmap.set(pid, m.conn); });
    for (const [pid, c] of this.pmap) c.send({ t: 'hstart', mode: this.mode, you: pid, hostPid, seed, players: defs, winsToMatch: 2, bots });
    this.emit({ t: 'hstart', mode: this.mode, you: hostPid, hostPid, seed, players: defs, winsToMatch: 2, bots });
  }

  /* ----- 참가자 ----- */
  onHostMsg(m, g) {
    this.lastRecv = performance.now();
    if (m.t === 'hstart') { this.phase = 'playing'; this.myPid = m.you; this.hostPid = m.hostPid; this.defs = m.players; }
    else if (m.t === 'host_change') this.hostPid = m.hostPid;
    else if (m.t === 'p2p_end') { const gg = g; this.emit(m); setTimeout(() => { if (gg === this.gen) this.hardReset(); }, 100); return; }
    this.emit(m);
  }
  /** 방장이 말없이 사라졌는지 감시 (탭을 그냥 닫으면 close 이벤트가 늦게 올 수 있음) */
  watch(g) {
    this.lastRecv = performance.now();
    clearInterval(this.tBeat);
    this.tBeat = setInterval(() => {
      if (g !== this.gen || this.role !== 'guest') return;
      if (this.phase === 'playing' && performance.now() - this.lastRecv > 4500) this.hostLost(g);
    }, 1000);
  }
  hostLost(g) {
    if (g !== this.gen || this.role !== 'guest') return;
    const old = this.conn; this.conn = null;
    try { if (old) old.close(); } catch { /* 이미 닫힘 */ }
    clearInterval(this.tBeat);
    if (this.phase === 'wait') { this.begin(); return; }                    // 대기 중 방장이 나가면 처음부터 다시 매칭
    if (this.phase !== 'playing') return;
    // 승계: 남은 사람 중 번호가 빠른 순서대로 같은 방 주소를 차지
    const oldHost = this.hostPid;
    const humans = this.defs.map((d, i) => ({ d, i })).filter(x => !x.d.bot && x.i !== oldHost).map(x => x.i);
    const rank = Math.max(0, humans.indexOf(this.myPid));
    this.tMig = setTimeout(() => this.claimRoom(g), 300 + rank * 1500);
  }
  claimRoom(g, tries = 0) {
    if (g !== this.gen) return;
    try { if (this.gpeer) this.gpeer.destroy(); } catch { /* 이미 닫힘 */ }
    this.gpeer = null;
    let peer;
    try { peer = new Peer(this.roomId(this.slot)); } catch { this.fail(g, '연결이 끊어졌습니다.'); return; }
    this.peer = peer;
    let opened = false;
    peer.on('open', () => { if (g === this.gen) { opened = true; this.becomeHostLate(g); } });
    peer.on('error', err => {
      if (g !== this.gen || opened) return;
      try { peer.destroy(); } catch { /* 이미 닫힘 */ }
      this.peer = null;
      if (err && err.type === 'unavailable-id') this.reconnect(g, 0); else if (tries < 3) setTimeout(() => this.claimRoom(g, tries + 1), 1000); else this.fail(g, '연결이 끊어졌습니다.');
    });
  }
  becomeHostLate(g) {
    this.role = 'host'; this.hostPid = this.myPid; this.pmap = new Map();
    this.peer.on('connection', c => {
      c.on('data', m => { if (g === this.gen && m) this.hostData(c, m); });
      c.on('close', () => { if (g === this.gen) this.hostLeft(c); });
      c.on('error', () => {});
    });
    this.tGrace = setTimeout(() => {                       // 재접속할 시간을 준 뒤, 못 온 사람 자리는 봇으로
      if (g !== this.gen) return;
      const bots = this.defs.map((d, i) => i).filter(i => i !== this.myPid && !this.pmap.has(i));
      const msg = { t: 'host_change', hostPid: this.myPid, name: this.me.name, bots };
      for (const c of this.pmap.values()) if (c.open) c.send(msg);
      this.emit(msg);
    }, 3500);
  }
  resume(c, m) {
    const pid = m.pid | 0;
    if (pid < 0 || pid >= this.defs.length || this.defs[pid].bot || pid === this.myPid) return;
    this.pmap.set(pid, c);
  }
  /** 새 방장이 이미 주소를 차지했으니 그쪽으로 다시 접속 */
  reconnect(g, tries) {
    if (g !== this.gen) return;
    if (tries >= 10) { this.fail(g, '연결이 끊어졌습니다.'); return; }
    let gp = this.gpeer;
    const go = () => {
      const c = gp.connect(this.roomId(this.slot), { reliable: true, serialization: 'json' });
      const bad = () => { if (g === this.gen && this.conn !== c) setTimeout(() => this.reconnect(g, tries + 1), 800); };
      const t = setTimeout(bad, 3000);
      c.on('open', () => {
        clearTimeout(t); this.conn = c; this.role = 'guest'; this.lastRecv = performance.now(); this.watch(g);
        c.send({ t: 'resume', pid: this.myPid, name: this.me.name });
      });
      c.on('data', m => { if (g === this.gen && m) this.onHostMsg(m, g); });
      c.on('close', () => { clearTimeout(t); if (g === this.gen && this.conn === c) this.hostLost(g); else bad(); });
      c.on('error', () => {});
    };
    if (gp && !gp.destroyed) go();
    else { try { gp = new Peer(); } catch { this.fail(g, '연결이 끊어졌습니다.'); return; } this.gpeer = gp; gp.on('open', () => { if (g === this.gen) go(); }); gp.on('error', () => setTimeout(() => this.reconnect(g, tries + 1), 800)); }
  }
}

/* ============================================================================
 * 7. App — 화면/흐름
 * ========================================================================== */
class App {
  constructor() {
    this.name = store.get('bg.name') || '';
    this.skin = Math.min(SKIN_COUNT - 1, Math.max(0, parseInt(store.get('bg.skin'), 10) || 0));
    this.mode = MODES[store.get('bg.mode')] ? store.get('bg.mode') : '1v1';
    this.offline = false;
    this.server = null;
    this.session = null;
    this.wsNet = new Net({ onMessage: m => this.onNet(m), onClose: () => this.onNetClosed() });
    this.p2pNet = new P2PNet({ onMessage: m => this.onNet(m) });
    this.net = this.wsNet;
    this.sfx = new Sfx();
    this.renderer = new Renderer($('game'));
    this.sig = {};
    this.queueStart = 0;
    this.matchTimer = 0;
    this.resultShown = false;
    this.goUntil = 0;
    this.prevFreeze = 0;
    this.last = performance.now();

    this.keys = new Keys(d => this.session && this.session.sendDir(d), () => this.pressBomb());
    this.pad = new TouchPad({
      stick: $('stick'), knob: $('knob'), bombBtn: $('bomb-btn'),
      onDir: d => this.session && this.session.sendDir(d),
      onBomb: () => this.pressBomb(),
      onGesture: () => this.sfx.unlock(),
      isBlocked: dir => this.blockedDir(dir),
    });
    this.inRoom = false;
    this.lobbyTab = 'auto';
    this.createMode = '1v1';
    this.noticeText = '';
    this.noticeUntil = 0;
    this.lastHidden = 0;
    this.startTicker();

    this.buildTitle();
    this.buildModes();
    this.buildStatIcons();
    this.bind();
    if (window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('pad-on');
    requestAnimationFrame(t => this.loop(t));
  }

  /* ---------- 화면 ---------- */
  show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
    this.keys.active = id === 'game';
    window.scrollTo(0, 0);
  }
  dialog(msg, onOk, onCancel) {
    $('dialog-msg').textContent = msg;
    $('dialog').classList.remove('hidden');
    $('dialog-cancel').classList.toggle('hidden', !onCancel);
    const done = fn => { $('dialog').classList.add('hidden'); $('dialog-ok').onclick = null; $('dialog-cancel').onclick = null; if (fn) fn(); };
    $('dialog-ok').onclick = () => done(onOk);
    $('dialog-cancel').onclick = () => done(onCancel);
    $('dialog-ok').focus();
  }

  /* ---------- 타이틀 ---------- */
  buildTitle() {
    $('nick').value = this.name;
    const box = $('skin-picker');
    for (let i = 0; i < SKIN_COUNT; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'skin-btn' + (i === this.skin ? ' sel' : '');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-label', '캐릭터 ' + (i + 1));
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      skinAvatar(cv, i);
      b.appendChild(cv);
      b.onclick = () => {
        this.skin = i; store.set('bg.skin', String(i));
        [...box.children].forEach((c, k) => c.classList.toggle('sel', k === i));
      };
      box.appendChild(b);
    }
  }

  takeProfile() {
    let n = $('nick').value.replace(/[<>&"'`\\]/g, '').trim().slice(0, 10);
    if (!n) n = '손님' + Math.floor(100 + Math.random() * 900);
    this.name = n; $('nick').value = n;
    store.set('bg.name', n);
  }

  /* ---------- 서버 선택 ---------- */
  async openServers() {
    this.takeProfile();
    this.offline = false;
    this.net = this.wsNet;
    this.show('servers');
    await this.refreshServers();
  }

  async refreshServers() {
    const list = $('server-list');
    if (!list.children.length) { const li = document.createElement('li'); li.className = 'server-empty'; li.textContent = '서버 목록을 불러오는 중...'; list.appendChild(li); }
    const servers = await fetchServers();
    if (!$('screen-servers').classList.contains('active')) return;
    list.textContent = '';
    for (const s of servers) {
      const li = document.createElement('li'); li.className = 'server-row';
      const left = document.createElement('div');
      const nm = document.createElement('div'); nm.className = 'server-name'; nm.textContent = s.name;
      const meta = document.createElement('div'); meta.className = 'server-meta';
      const btn = document.createElement('button'); btn.className = 'btn'; btn.type = 'button'; btn.textContent = '입장';
      if (s.offline) {
        const tag = document.createElement('span'); tag.className = 'load-tag off'; tag.textContent = '연결 불가';
        meta.append(tag);
        btn.disabled = true;
      } else {
        const ratio = s.online / s.cap;
        const lv = s.online >= s.cap ? 'full' : ratio >= 0.75 ? 'high' : ratio >= 0.4 ? 'mid' : '';
        const bar = document.createElement('div'); bar.className = 'load-bar ' + lv;
        const fill = document.createElement('i'); fill.style.width = Math.max(4, Math.min(100, ratio * 100)) + '%'; bar.appendChild(fill);
        const tag = document.createElement('span'); tag.className = 'load-tag ' + lv;
        tag.textContent = lv === 'full' ? '만원' : lv === 'high' ? '혼잡' : lv === 'mid' ? '보통' : '원활';
        const cnt = document.createElement('span'); cnt.textContent = `${s.online} / ${s.cap}명 · 진행 중 ${s.rooms}판`;
        meta.append(bar, tag, cnt);
        btn.disabled = s.online >= s.cap;
        btn.onclick = () => this.enterServer(s, btn);
      }
      left.append(nm, meta);
      li.append(left, btn);
      list.appendChild(li);
    }
    if (!servers.length) { const li = document.createElement('li'); li.className = 'server-empty'; li.textContent = '게임 서버에 연결할 수 없습니다. 아래 P2P 서버는 서버 없이 사용할 수 있습니다.'; list.appendChild(li); }
    const head = document.createElement('li'); head.className = 'server-empty'; head.textContent = '서버 없이 접속 (P2P) — 먼저 누른 사람이 방장이 됩니다';
    list.appendChild(head);
    for (let n = 1; n <= 3; n++) {
      const li = document.createElement('li'); li.className = 'server-row';
      const left = document.createElement('div');
      const nm = document.createElement('div'); nm.className = 'server-name'; nm.textContent = 'P2P 서버 ' + n;
      const meta = document.createElement('div'); meta.className = 'server-meta';
      const tag = document.createElement('span'); tag.className = 'load-tag'; tag.textContent = '서버 불필요'; meta.append(tag);
      const btn = document.createElement('button'); btn.className = 'btn'; btn.type = 'button'; btn.textContent = '입장';
      btn.onclick = () => this.enterP2P(n);
      left.append(nm, meta); li.append(left, btn); list.appendChild(li);
    }
  }

  enterP2P(n) {
    this.sfx.unlock();
    this.net = this.p2pNet;
    this.p2pNet.configure(n, { name: this.name, skin: this.skin });
    this.server = { name: 'P2P 서버 ' + n, p2p: true };
    this.offline = false;
    this.openLobby();
  }

  async enterServer(info, btn) {
    this.sfx.unlock();
    btn.disabled = true; btn.textContent = '접속중';
    try {
      const w = await this.net.connect(info.base, info.id, { name: this.name, skin: this.skin });
      this.server = { ...info, name: w.server.name };
      this.offline = false;
      this.openLobby();
    } catch (e) {
      this.net.close();
      this.dialog(e.message === 'full' ? '서버가 가득 찼습니다. 다른 서버를 선택해 주세요.' : '서버에 접속하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      this.refreshServers();
    }
  }

  /* ---------- 로비 ---------- */
  buildModes() {
    const box = $('mode-cards');
    box.textContent = '';
    for (const [key, m] of Object.entries(MODES)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mode-card'; b.dataset.mode = key;
      b.setAttribute('role', 'radio');
      const num = document.createElement('span'); num.className = 'mc-num'; num.textContent = m.label;
      const icons = document.createElement('span'); icons.className = 'mc-icons';
      for (let i = 0; i < m.perTeam; i++) icons.appendChild(document.createElement('i'));
      const vs = document.createElement('em'); vs.textContent = 'vs'; icons.appendChild(vs);
      for (let i = 0; i < m.perTeam; i++) { const d = document.createElement('i'); d.className = 'b'; icons.appendChild(d); }
      const sub = document.createElement('span'); sub.className = 'mc-sub'; sub.textContent = (m.perTeam * 2) + '명 팀 대전';
      b.append(num, icons, sub);
      b.onclick = () => { this.mode = key; store.set('bg.mode', key); this.markMode(); };
      box.appendChild(b);
    }
    this.markMode();
  }
  markMode() {
    document.querySelectorAll('.mode-card').forEach(c => c.classList.toggle('sel', c.dataset.mode === this.mode));
  }

  openLobby() {
    this.inRoom = false;
    this.show('lobby');
    $('lobby-title').textContent = this.offline ? '연습 게임' : this.server.name;
    $('btn-lobby-leave').textContent = this.offline ? '처음으로' : '서버 선택';
    $('btn-lobby-practice').classList.toggle('hidden', this.offline);
    $('btn-match').textContent = this.offline ? '연습 시작' : '게임 시작';
    const p2p = !!(this.server && this.server.p2p) && !this.offline;
    $('lobby-tabs').classList.toggle('hidden', this.offline || p2p);
    document.querySelector('.chat').classList.toggle('hidden', this.offline || p2p);
    $('me-name').textContent = this.name;
    $('me-sub').textContent = this.offline ? '봇과 대전합니다' : this.server.name + ' 접속중';
    skinAvatar($('me-avatar'), this.skin);
    this.markMode();
    this.setTab(this.offline || p2p ? 'auto' : this.lobbyTab);
    if (this.offline || p2p) {
      this.renderLobby({ online: 1, players: [{ n: this.name, s: 0 }], hrooms: [] });
      if (p2p) $('me-sub').textContent = this.server.name + ' · 서버 없이 접속';
    } else {
      $('chat-log').textContent = '';
      this.chat(null, `${this.server.name}에 입장했습니다. 자동 매칭을 하거나, 방 목록에서 방을 만들고 입장할 수 있습니다.`);
    }
  }

  setTab(tab) {
    this.lobbyTab = tab;
    $('tab-auto').classList.toggle('hidden', tab !== 'auto');
    $('tab-rooms').classList.toggle('hidden', tab !== 'rooms');
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === tab));
  }

  renderLobby(m) {
    $('online-count').textContent = m.online;
    const ul = $('player-list');
    ul.textContent = '';
    for (const p of m.players) {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.textContent = p.n;
      if (p.n === this.name) n.className = 'me';
      const st = document.createElement('span'); st.className = 'st ' + (p.s === 1 ? 'q' : p.s === 2 ? 'p' : '');
      st.textContent = p.s === 1 ? '매칭중' : p.s === 2 ? '게임중' : '대기';
      li.append(n, st); ul.appendChild(li);
    }
    this.renderRoomList(m.hrooms || []);
  }

  /* ---------- 방장 방식: 방 목록 / 만들기 / 대기방 ---------- */
  renderRoomList(list) {
    const ul = $('room-list');
    ul.textContent = '';
    if (!list.length) {
      const li = document.createElement('li'); li.className = 'server-empty';
      li.textContent = '열린 방이 없습니다. 방을 만들어 보세요!';
      ul.appendChild(li);
      return;
    }
    for (const r of list) {
      const li = document.createElement('li'); li.className = 'room-row';
      const left = document.createElement('div'); left.className = 'rr-main';
      const title = document.createElement('div'); title.className = 'rr-title'; title.textContent = r.title;
      const meta = document.createElement('div'); meta.className = 'rr-meta';
      const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = (MODES[r.mode] || MODES['1v1']).label;
      const cnt = document.createElement('span'); cnt.textContent = `${r.n} / ${r.cap}명`;
      const host = document.createElement('span'); host.textContent = '방장 ' + r.host;
      const st = document.createElement('span'); st.className = 'load-tag' + (r.st ? ' mid' : ''); st.textContent = r.st ? '게임중' : '대기중';
      meta.append(chip, cnt, host, st);
      left.append(title, meta);
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small';
      btn.textContent = '입장'; btn.disabled = !!r.st || r.n >= r.cap;
      btn.onclick = () => { this.sfx.unlock(); this.inRoom = true; this.net.send({ t: 'room_join', id: r.id }); };
      li.append(left, btn);
      ul.appendChild(li);
    }
  }

  openCreateRoom() {
    this.sfx.unlock();
    this.createMode = this.mode;
    $('room-title-input').value = (this.name + '의 방').slice(0, 16);
    document.querySelectorAll('.rc-mode').forEach(b => b.classList.toggle('sel', b.dataset.mode === this.createMode));
    $('room-create').classList.remove('hidden');
    $('room-title-input').focus();
    $('room-title-input').select();
  }

  renderRoom(m) {
    this.room = m;
    $('room-title').textContent = m.title;
    $('room-mode').textContent = (MODES[m.mode] || MODES['1v1']).label;
    const per = (MODES[m.mode] || MODES['1v1']).perTeam;
    for (const t of [0, 1]) {
      const ul = $('room-team' + t);
      ul.textContent = '';
      const list = m.members.map((x, i) => ({ ...x, i })).filter(x => x.team === t);
      for (let k = 0; k < per; k++) {
        const li = document.createElement('li'); li.className = 'rslot';
        const x = list[k];
        if (x) {
          if (x.i === m.me) li.classList.add('me');
          const cv = document.createElement('canvas'); cv.width = cv.height = 48; skinAvatar(cv, x.skin);
          const n = document.createElement('span'); n.className = 'rn'; n.textContent = x.n + (x.i === m.me ? ' (나)' : '');
          li.append(cv, n);
          if (x.host) { const h = document.createElement('span'); h.className = 'host-tag'; h.textContent = '방장'; li.appendChild(h); }
        } else {
          li.classList.add('empty');
          const n = document.createElement('span'); n.className = 'rn'; n.textContent = '빈 자리 (봇이 채웁니다)';
          li.appendChild(n);
        }
        ul.appendChild(li);
      }
    }
    const meInfo = m.members[m.me];
    const iAmHost = !!(meInfo && meInfo.host);
    $('btn-room-start').classList.toggle('hidden', !iAmHost);
    $('room-wait').classList.toggle('hidden', iAmHost);
    $('room-count').textContent = `${m.members.length} / ${m.cap}명`;
  }

  onRoom(m) {
    if (!this.inRoom) return;                          // 이미 나간 방의 늦은 알림은 무시
    this.renderRoom(m);
    if (this.session) {
      if (this.session.relay && m.state === 'waiting') {   // 한 판이 끝나 대기방으로 복귀
        this.cleanupSession();
        $('result').classList.add('hidden');
        this.show('room');
      }
    } else if (!$('screen-room').classList.contains('active')) {
      this.show('room');
    }
  }

  notice(text) { this.noticeText = text; this.noticeUntil = performance.now() + 4500; }

  /** 조이스틱 보정용: 지금 위치에서 그 방향이 막혀 있는가 */
  blockedDir(dir) {
    const s = this.session;
    if (!s) return false;
    const me = s.core.players[s.myPid];
    if (!me) return false;
    const d = DIRS[dir];
    return !s.core.canEnter(me, me.x + d.dx, me.y + d.dy);
  }

  /** 방장의 탭이 백그라운드로 가도 게임이 멈추지 않도록 Worker 타이머로 계속 진행 (화면이 보일 때는 requestAnimationFrame 이 담당) */
  startTicker() {
    try {
      const w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},16)'], { type: 'text/javascript' })));
      w.onmessage = () => this.hiddenTick();
      this.ticker = w;
    } catch { this.ticker = null; }
  }
  hiddenTick() {
    if (!document.hidden || !this.session || !this.session.isHost) { this.lastHidden = 0; return; }
    const now = performance.now();
    const dt = this.lastHidden ? Math.min(now - this.lastHidden, 100) : 16;
    this.lastHidden = now;
    this.session.update(dt);
  }

  chat(name, text) {
    const log = $('chat-log');
    const d = document.createElement('div');
    if (name === null) { d.className = 'sys'; d.textContent = text; }
    else { const b = document.createElement('b'); b.textContent = name; d.append(b, ': ' + text); }
    log.appendChild(d);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  /* ---------- 매칭 ---------- */
  startMatch() {
    this.sfx.unlock();
    if (this.offline) { this.startPractice(); return; }
    if (!this.net.open) { this.onNetClosed(); return; }
    this.net.send({ t: 'queue', mode: this.mode });
    this.queueStart = Date.now();
    $('matching-title').childNodes[0].textContent = '매칭중';
    $('matching-mode').textContent = MODES[this.mode].label;
    $('matching-count').textContent = `1 / ${MODES[this.mode].perTeam * 2}`;
    $('matching-time').textContent = '0:00';
    $('matching-hint').textContent = this.server && this.server.p2p ? '먼저 누른 사람이 방장이 되고, 다음 사람이 그 방으로 들어옵니다.' : '같은 서버에서 대전할 상대를 찾고 있습니다.';
    $('btn-fillbots').classList.add('hidden');
    $('btn-cancel-match').disabled = false;
    $('matching').classList.remove('hidden');
    clearInterval(this.matchTimer);
    this.matchTimer = setInterval(() => this.tickMatch(), 250);
  }
  tickMatch() {
    const sec = Math.floor((Date.now() - this.queueStart) / 1000);
    $('matching-time').textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    if (sec >= 8) {
      $('btn-fillbots').classList.remove('hidden');
      $('matching-hint').textContent = '상대가 오래 안 잡히면 봇과 함께 시작할 수 있습니다.';
    }
  }
  closeMatching() { clearInterval(this.matchTimer); $('matching').classList.add('hidden'); }
  cancelMatch() { this.net.send({ t: 'cancel' }); this.closeMatching(); }

  /* ---------- 게임 ---------- */
  startPractice() {
    this.cleanupSession();
    this.resultShown = false;
    this.session = new OfflineSession(this.mode, { name: this.name, skin: this.skin }, e => this.onEvent(e));
    this.enterGame();
  }
  startOnline(m) {
    this.cleanupSession();
    this.resultShown = false;
    this.session = new OnlineSession(this, m);
    const p2p = !!(this.server && this.server.p2p);
    if (this.session.relay && !p2p) this.inRoom = true;
    this.enterGame();
    if (!this.session.relay || p2p) {                          // 전용 서버 자동 매칭: "매칭 성공!" 연출
      $('matching-title').childNodes[0].textContent = '매칭 성공!';
      $('btn-fillbots').classList.add('hidden');
      $('btn-cancel-match').disabled = true;
      clearInterval(this.matchTimer);
      setTimeout(() => this.closeMatching(), 900);
    }
  }
  enterGame() {
    this.sig = {};
    this.prevFreeze = 0; this.goUntil = 0;
    $('result').classList.add('hidden');
    $('banner').classList.add('hidden');
    $('btn-rematch').classList.toggle('hidden', this.session.online);
    $('result-hint').classList.add('hidden');
    $('result-hint').textContent = this.server && this.server.p2p ? '잠시 후 로비로 돌아갑니다.' : '잠시 후 대기방으로 돌아갑니다.';
    $('btn-result-exit').textContent = this.session.relay ? '나가기' : '로비로';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    this.show('game');
    this.buildSlots();
  }
  cleanupSession() { this.keys.reset(); this.pad.reset(); this.session = null; }
  leaveGame() {
    const relay = this.session && this.session.relay;
    if (this.session) this.session.close();
    this.cleanupSession();
    if (relay) this.inRoom = false;
    $('result').classList.add('hidden');
    if (!this.offline && !this.net.open) { this.onNetClosed(); return; }
    this.openLobby();
  }
  pressBomb() {
    this.sfx.unlock();
    if (this.session) this.session.sendBomb();
  }

  onEvent(e) {
    switch (e.type) {
      case 'bomb_place': this.sfx.play('place'); break;
      case 'explode': this.sfx.play('boom'); break;
      case 'item': this.sfx.play('item'); break;
      case 'trap': this.sfx.play('trap'); break;
      case 'rescue': this.sfx.play('rescue'); break;
      case 'death': this.sfx.play('death'); break;
      case 'round_start': this.sfx.play('ready'); break;
      case 'round_end': {
        const me = this.session && this.session.core.players[this.session.myPid];
        if (me && e.winnerTeam === me.team) this.sfx.play('win'); else if (e.winnerTeam >= 0) this.sfx.play('lose');
        break;
      }
    }
  }

  /* ---------- 네트워크 메시지 ---------- */
  onNet(m) {
    if (this.session && this.session.online) {            // 게임 중 메시지(상태/입력 중계/방장 변경)는 세션이 처리
      try { if (this.session.handle(m)) return; } catch (e) { console.error('세션 처리 오류', e); return; }
    }
    switch (m.t) {
      case 'lobby': this.renderLobby(m); break;
      case 'chat': this.chat(m.name, m.text); break;
      case 'queue': $('matching-count').textContent = `${m.count} / ${m.need}`; break;
      case 'start': case 'hstart': this.startOnline(m); break;
      case 'room': this.onRoom(m); break;
      case 'p2p_end': this.cleanupSession(); $('result').classList.add('hidden'); this.openLobby(); break;
      case 'room_closed': {
        const relay = this.inRoom || (this.session && this.session.relay);
        this.cleanupSession();
        $('result').classList.add('hidden');
        this.inRoom = false;
        if (relay) this.dialog('방이 닫혔습니다.', () => this.openLobby());
        else this.openLobby();
        break;
      }
      case 'error': this.inRoom = false; this.closeMatching(); this.dialog(m.msg || '오류가 발생했습니다.'); break;
    }
  }
  onNetClosed() {
    if (this.offline) return;
    this.inRoom = false;
    this.closeMatching();
    this.cleanupSession();
    $('result').classList.add('hidden');
    this.net.close();
    this.dialog('서버와의 연결이 끊어졌습니다.', () => this.openServers());
  }

  /* ---------- HUD ---------- */
  buildSlots() {
    const c = this.session.core;
    const ul = $('slots');
    ul.textContent = '';
    this.slotEls = c.players.map(p => {
      const li = document.createElement('li');
      li.className = 'slot t' + p.team + (p.id === this.session.myPid ? ' me' : '');
      const n = document.createElement('span'); n.className = 'sn'; n.textContent = p.name + (p.id === this.session.myPid ? ' (나)' : '');
      const s = document.createElement('span'); s.className = 'ss';
      li.append(n, s); ul.appendChild(li);
      return { li, s, n };
    });
  }
  buildStatIcons() {
    const box = $('mystats');
    box.textContent = '';
    this.statEls = {};
    for (const [key, type] of [['maxBombs', ITEM.BOMB], ['range', ITEM.RANGE], ['speed', ITEM.SPEED]]) {
      const d = document.createElement('div');
      const cv = document.createElement('canvas'); cv.width = cv.height = 68;
      drawItemIcon(cv.getContext('2d'), type, 34, 34, 68);
      const v = document.createElement('span');
      d.append(cv, v); box.appendChild(d);
      this.statEls[key] = v;
    }
  }

  updateHud() {
    const s = this.session, c = s.core, me = c.players[s.myPid];
    const hsig = 'h' + s.hostPid;
    if (this.sig.hostTag !== hsig) {                        // 방장 표시
      this.sig.hostTag = hsig;
      c.players.forEach((p, i) => { this.slotEls[i].n.textContent = p.name + (i === s.myPid ? ' (나)' : '') + (s.relay && i === s.hostPid ? ' [방장]' : ''); });
    }
    const sec = Math.max(0, Math.ceil(c.roundTimer / 1000));
    const timer = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    if (this.sig.timer !== timer) { this.sig.timer = timer; $('timer').textContent = timer; $('timer').classList.toggle('low', sec <= 20); }
    const rl = `ROUND ${c.round} · ${MODES[s.mode].label}`;
    if (this.sig.rl !== rl) { this.sig.rl = rl; $('round-label').textContent = rl; }

    const sb = c.teamWins.join('-') + '|' + me.team;
    if (this.sig.sb !== sb) {
      this.sig.sb = sb;
      const box = $('scoreboard'); box.textContent = '';
      for (const t of [0, 1]) {
        const d = document.createElement('div'); d.className = 't' + t + ' score-team' + (me.team === t ? ' me' : '');
        d.className = 'score-team t' + t + (me.team === t ? ' me' : '');
        const a = document.createElement('div'); a.className = 'tn'; a.textContent = TEAM[t].name + (me.team === t ? ' (우리)' : '');
        const b = document.createElement('div'); b.className = 'tw'; b.textContent = c.teamWins[t];
        d.append(a, b); box.appendChild(d);
      }
    }
    c.players.forEach((p, i) => {
      const st = !p.alive ? 'dead' : p.trapped ? 'trap' : 'ok';
      if (this.sig['s' + i] === st) return;
      this.sig['s' + i] = st;
      const el = this.slotEls[i];
      el.li.classList.toggle('dead', st === 'dead');
      el.s.className = 'ss ' + (st === 'ok' ? '' : st);
      el.s.textContent = st === 'dead' ? '탈락' : st === 'trap' ? '물방울' : '생존';
    });
    const ms = [me.maxBombs, me.range, me.speed].join('/');
    if (this.sig.ms !== ms) {
      this.sig.ms = ms;
      this.statEls.maxBombs.textContent = me.maxBombs;
      this.statEls.range.textContent = me.range;
      this.statEls.speed.textContent = me.speed;
    }
  }

  updateBanner(ts) {
    const s = this.session, c = s.core, me = c.players[s.myPid];
    let main = '', sub = '', cls = '', low = false;
    if (c.state === 'playing') {
      if (c.freeze > 0) {
        main = 'READY'; sub = c.round > 1 ? `ROUND ${c.round}` : `${TEAM[me.team].name} 팀`;
        this.prevFreeze = c.freeze;
      } else if (this.prevFreeze > 0) { this.prevFreeze = 0; this.goUntil = ts + 800; }
      if (!main && ts < this.goUntil) main = 'GO!';
      if (!main && me.trapped) { sub = '물방울에 갇혔습니다! 팀원이 구해줄 때까지 버티세요'; low = true; }
      else if (!main && !me.alive) { sub = '탈락했습니다. 팀원을 응원하세요'; low = true; }
    } else if (c.state === 'roundOver') {
      const w = c.winnerTeam;
      main = w === -1 ? 'DRAW' : (w === me.team ? 'ROUND WIN' : 'ROUND LOSE');
      cls = w === me.team ? 'win' : w === -1 ? '' : 'lose';
      sub = `${TEAM[0].name} ${c.teamWins[0]} : ${c.teamWins[1]} ${TEAM[1].name}`;
    }
    if (!main && performance.now() < this.noticeUntil) { sub = this.noticeText; low = true; }   // 방장 변경 안내
    const sig = [main, sub, cls, low].join('|');
    if (sig === this.sig.banner) return;
    this.sig.banner = sig;
    const b = $('banner');
    b.classList.toggle('hidden', !main && !sub);
    b.style.justifyContent = low ? 'flex-end' : 'center';
    b.style.paddingBottom = low ? '18px' : '0';
    $('banner-main').textContent = main;
    $('banner-main').className = 'banner-main ' + cls;
    $('banner-sub').textContent = sub;
  }

  showResult() {
    const s = this.session, c = s.core, me = c.players[s.myPid];
    this.resultShown = true;
    const w = c.winnerTeam;
    const win = w === me.team;
    $('result-title').textContent = win ? 'WIN!' : 'LOSE';
    $('result-title').className = 'result-title ' + (win ? '' : 'lose');
    $('result-sub').textContent = `${TEAM[0].name} ${c.teamWins[0]} : ${c.teamWins[1]} ${TEAM[1].name}`;
    const tb = $('result-table'); tb.textContent = '';
    const head = document.createElement('tr');
    for (const h of ['플레이어', '처치', '점수']) { const th = document.createElement('th'); th.textContent = h; head.appendChild(th); }
    tb.appendChild(head);
    for (const p of [...c.players].sort((a, b) => b.score - a.score)) {
      const tr = document.createElement('tr'); tr.className = 't' + p.team + (p.id === s.myPid ? ' me' : '');
      const a = document.createElement('td'); a.textContent = p.name;
      const k = document.createElement('td'); k.className = 'num'; k.textContent = p.kills;
      const sc = document.createElement('td'); sc.className = 'num'; sc.textContent = p.score;
      tr.append(a, k, sc); tb.appendChild(tr);
    }
    $('result-hint').classList.toggle('hidden', !s.relay);
    $('result').classList.remove('hidden');
  }

  /* ---------- 이벤트 연결 ---------- */
  bind() {
    $('btn-online').onclick = () => { this.sfx.unlock(); this.openServers(); };
    $('btn-practice').onclick = () => { this.sfx.unlock(); this.takeProfile(); this.offline = true; this.openLobby(); };
    $('nick').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-online').click(); });
    $('btn-servers-refresh').onclick = () => this.refreshServers();
    $('btn-servers-back').onclick = () => this.show('title');
    $('btn-lobby-leave').onclick = () => {
      if (this.offline) { this.show('title'); return; }
      this.net.close(); this.openServers();
    };
    $('btn-match').onclick = () => this.startMatch();
    $('btn-lobby-practice').onclick = () => { this.sfx.unlock(); this.startPractice(); };
    $('btn-cancel-match').onclick = () => this.cancelMatch();
    $('btn-fillbots').onclick = () => this.net.send({ t: 'fillbots' });
    $('chat-form').onsubmit = e => {
      e.preventDefault();
      const v = $('chat-input').value.trim();
      if (v) this.net.send({ t: 'chat', text: v });
      $('chat-input').value = '';
    };
    document.querySelectorAll('.tab').forEach(t => { t.onclick = () => this.setTab(t.dataset.tab); });
    $('btn-room-create').onclick = () => this.openCreateRoom();
    document.querySelectorAll('.rc-mode').forEach(b => {
      b.onclick = () => { this.createMode = b.dataset.mode; document.querySelectorAll('.rc-mode').forEach(x => x.classList.toggle('sel', x === b)); };
    });
    $('btn-create-cancel').onclick = () => $('room-create').classList.add('hidden');
    $('room-create-form').onsubmit = e => {
      e.preventDefault();
      const title = $('room-title-input').value.trim() || (this.name + '의 방');
      this.inRoom = true;
      this.net.send({ t: 'room_create', mode: this.createMode, title });
      $('room-create').classList.add('hidden');
    };
    $('btn-team').onclick = () => this.net.send({ t: 'team' });
    $('btn-room-start').onclick = () => { this.sfx.unlock(); this.net.send({ t: 'room_start' }); };
    $('btn-room-leave').onclick = () => { this.inRoom = false; this.net.send({ t: 'room_leave' }); this.openLobby(); };
    $('btn-pad').onclick = () => document.body.classList.toggle('pad-on');
    $('btn-mute').onclick = () => {
      this.sfx.muted = !this.sfx.muted;
      $('btn-mute').textContent = this.sfx.muted ? '소리 끔' : '소리 켬';
    };
    $('btn-exit').onclick = () => this.dialog('경기에서 나가시겠습니까?', () => this.leaveGame(), () => {});
    $('btn-result-exit').onclick = () => this.leaveGame();
    $('btn-rematch').onclick = () => this.startPractice();
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.keys.reset(); this.pad.reset(); } });
  }

  loop(ts) {
    const dt = Math.min(ts - this.last, 100);
    this.last = ts;
    if (this.session) {
      this.pad.tick();
      this.session.update(dt);
      this.renderer.draw(this.session.core, ts, this.session.myPid, this.session.ghostBombs(ts));
      this.updateHud();
      this.updateBanner(ts);
      if (this.session.core.state === 'matchOver' && !this.resultShown) this.showResult();
    }
    requestAnimationFrame(t => this.loop(t));
  }
}

const boot = () => { window.bgApp = new App(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
