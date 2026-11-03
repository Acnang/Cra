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

  draw(core, time, myPid) {
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

class TouchPad {
  constructor(dpad, bombBtn, onDir, onBomb, onGesture) {
    this.dir = null;
    let activeId = null;
    const calc = e => {
      const r = dpad.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < r.width * 0.15) return null;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    };
    this.setDir = d => {
      if (d === this.dir) return;
      this.dir = d;
      dpad.querySelectorAll('[data-dir]').forEach(el => el.classList.toggle('on', el.dataset.dir === d));
      onDir(d);
    };
    dpad.addEventListener('pointerdown', e => {
      e.preventDefault(); onGesture(); activeId = e.pointerId;
      try { dpad.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저는 캡처 불가 */ }
      this.setDir(calc(e));
    });
    dpad.addEventListener('pointermove', e => { if (e.pointerId === activeId) this.setDir(calc(e)); });
    const end = e => { if (e.pointerId === activeId) { activeId = null; this.setDir(null); } };
    dpad.addEventListener('pointerup', end);
    dpad.addEventListener('pointercancel', end);
    dpad.addEventListener('lostpointercapture', end);
    bombBtn.addEventListener('pointerdown', e => {
      e.preventDefault(); onGesture(); bombBtn.classList.add('on');
      if (navigator.vibrate) navigator.vibrate(12);
      onBomb();
    });
    const up = () => bombBtn.classList.remove('on');
    bombBtn.addEventListener('pointerup', up);
    bombBtn.addEventListener('pointercancel', up);
    bombBtn.addEventListener('pointerleave', up);
    for (const el of [dpad, bombBtn]) el.addEventListener('contextmenu', e => e.preventDefault());
  }
  reset() { this.setDir(null); }
}

/* ============================================================================
 * 5. 세션 — "경기 한 판"을 감싸는 객체 (온라인 / 오프라인 공통 인터페이스)
 *      core, myPid, update(dt), sendDir(dir), sendBomb(), close()
 * ========================================================================== */
class OnlineSession {
  constructor(net, start) {
    this.online = true;
    this.net = net;
    this.mode = start.mode;
    this.myPid = start.you;
    this.core = new GameCore({ seed: start.seed, players: start.players, winsToMatch: start.winsToMatch, onEvent: () => {} });
    this.lastDir = null;
    this.onEvent = () => {};
  }
  handleSnapshot(msg) {
    this.core.applySnapshot(msg.s);
    for (const e of msg.ev) this.onEvent(e);
  }
  update(dt) { this.core.update(dt); }
  sendDir(dir) { if (dir !== this.lastDir) { this.lastDir = dir; this.net.send({ t: 'in', dir }); } }
  sendBomb() { this.net.send({ t: 'bomb' }); }
  close() { this.net.send({ t: 'leave' }); }
}

class OfflineSession {
  constructor(mode, me, onEvent) {
    this.online = false;
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
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  close() { const w = this.ws; this.ws = null; if (w) { w.onclose = null; try { w.close(); } catch { /* 이미 닫힘 */ } } }
  get open() { return !!this.ws && this.ws.readyState === 1; }
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
    this.net = new Net({ onMessage: m => this.onNet(m), onClose: () => this.onNetClosed() });
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
    this.pad = new TouchPad($('dpad'), $('bomb-btn'), d => this.session && this.session.sendDir(d), () => this.pressBomb(), () => this.sfx.unlock());

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
    if (!servers.length) { const li = document.createElement('li'); li.className = 'server-empty'; li.textContent = '사용 가능한 서버가 없습니다.'; list.appendChild(li); }
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
    this.show('lobby');
    $('lobby-title').textContent = this.offline ? '연습 게임' : this.server.name;
    $('btn-lobby-leave').textContent = this.offline ? '처음으로' : '서버 선택';
    $('btn-lobby-practice').classList.toggle('hidden', this.offline);
    $('btn-match').textContent = this.offline ? '연습 시작' : '게임 시작';
    document.querySelector('.chat').classList.toggle('hidden', this.offline);
    $('me-name').textContent = this.name;
    $('me-sub').textContent = this.offline ? '봇과 대전합니다' : this.server.name + ' 접속중';
    skinAvatar($('me-avatar'), this.skin);
    this.markMode();
    if (this.offline) {
      this.renderLobby({ online: 1, players: [{ n: this.name, s: 0 }] });
    } else {
      $('chat-log').textContent = '';
      this.chat(null, `${this.server.name}에 입장했습니다. 대전 방식을 고르고 게임 시작을 누르세요.`);
    }
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
    $('matching-hint').textContent = '같은 서버에서 대전할 상대를 찾고 있습니다.';
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
    const s = new OnlineSession(this.net, m);
    s.onEvent = e => this.onEvent(e);
    this.session = s;
    this.enterGame();
    $('matching-title').childNodes[0].textContent = '매칭 성공!';
    $('btn-fillbots').classList.add('hidden');
    $('btn-cancel-match').disabled = true;
    clearInterval(this.matchTimer);
    setTimeout(() => this.closeMatching(), 900);
  }
  enterGame() {
    this.sig = {};
    this.prevFreeze = 0; this.goUntil = 0;
    $('result').classList.add('hidden');
    $('banner').classList.add('hidden');
    $('btn-rematch').classList.toggle('hidden', this.session.online);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    this.show('game');
    this.buildSlots();
  }
  cleanupSession() { this.keys.reset(); this.pad.reset(); this.session = null; }
  leaveGame() {
    if (this.session) this.session.close();
    this.cleanupSession();
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
    switch (m.t) {
      case 'lobby': this.renderLobby(m); break;
      case 'chat': this.chat(m.name, m.text); break;
      case 'queue':
        $('matching-count').textContent = `${m.count} / ${m.need}`;
        break;
      case 'start': this.startOnline(m); break;
      case 's': if (this.session && this.session.online) this.session.handleSnapshot(m); break;
      case 'room_closed':
        if (this.session && this.session.online) { this.cleanupSession(); $('result').classList.add('hidden'); this.openLobby(); }
        break;
      case 'error': this.closeMatching(); this.dialog(m.msg || '오류가 발생했습니다.'); break;
    }
  }
  onNetClosed() {
    if (this.offline) return;
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
      return { li, s };
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
      this.session.update(dt);
      this.renderer.draw(this.session.core, ts, this.session.myPid);
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
