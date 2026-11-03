'use strict';
/* 온라인 스모크 테스트:  node test/smoke-online.js   (Node 22+ 의 내장 WebSocket 사용) */
const { spawn } = require('child_process');
const path = require('path');

const PORT = 18080 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) failed++; };

function startServer(extraEnv = {}, port = PORT) {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), BOT_FILL_AFTER_MS: '1500', ...extraEnv },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise(res => p.stdout.on('data', d => { if (String(d).includes('서버 시작')) res(p); }));
}

function client(channel, name, base = BASE) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws/' + channel);
  const c = { ws, name, msgs: [], snaps: 0, start: null, last: null, closed: false, events: [] };
  c.ready = new Promise(res => { ws.onopen = () => res(); });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    c.msgs.push(m);
    if (m.t === 'start') c.start = m;
    if (m.t === 's') { c.snaps++; c.last = m.s; c.events.push(...m.ev); }
  };
  ws.onclose = () => { c.closed = true; };
  c.send = o => ws.send(JSON.stringify(o));
  c.waitFor = async (pred, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const f = c.msgs.find(pred); if (f) return f; await sleep(25); }
    return null;
  };
  c.hello = async () => { await c.ready; c.send({ t: 'hello', name, skin: 1 }); return c.waitFor(m => m.t === 'welcome'); };
  return c;
}

async function api(base = BASE) { return (await fetch(base + '/api/servers')).json(); }

(async () => {
  const srv = await startServer();
  try {
    console.log('1) 서버 목록 API');
    let list = await api();
    ok(list.length === 3 && list[0].name === '서버 1' && list[2].id === 3, '서버 1,2,3 이 보인다');

    console.log('2) 1:1 매칭 + 게임 진행');
    const a = client(1, '가나'), b = client(1, '다라');
    ok(!!(await a.hello()) && !!(await b.hello()), '두 명 접속(welcome)');
    a.send({ t: 'queue', mode: '1v1' });
    ok(!!(await a.waitFor(m => m.t === 'queue' && m.count === 1 && m.need === 2)), '대기열 안내 (1/2)');
    b.send({ t: 'queue', mode: '1v1' });
    const sa = await a.waitFor(m => m.t === 'start'), sb = await b.waitFor(m => m.t === 'start');
    ok(!!sa && !!sb && sa.players.length === 2 && sa.you !== sb.you, '1:1 매칭 성공, 서로 다른 플레이어 번호');
    ok(sa.players[0].team !== sa.players[1].team, '서로 다른 팀');
    a.send({ t: 'in', dir: 'right' });
    await sleep(3600);                      // READY(2.8s) 지나고 이동
    a.send({ t: 'bomb' });
    await sleep(600);
    a.send({ t: 'in', dir: null });
    await sleep(700);
    const gridMsgs = a.msgs.filter(m => m.t === 's' && m.s.g).length;
    ok(a.snaps > 100, `스냅샷 수신 (${a.snaps}개)`);
    ok(gridMsgs >= 1 && gridMsgs < a.snaps / 5, `격자는 변경될 때만 전송 (${gridMsgs}회)`);
    ok(a.last.p[sa.you][0] > 1, '내 캐릭터가 서버에서 오른쪽으로 이동함');
    ok(a.events.some(e => e.type === 'bomb_place'), '물풍선 이벤트 수신');
    list = await api();
    ok(list[0].rooms === 1 && list[0].online === 2, '서버 1 상태: 방 1개, 접속 2명');

    console.log('3) 접속 끊김 → 봇이 자리 이어받고, 모두 나가면 방 정리');
    b.ws.close();
    await sleep(500);
    ok(a.ws.readyState === 1 && (await api())[0].rooms === 1, '상대가 나가도 방 유지 (봇이 대신)');
    a.send({ t: 'leave' });
    await sleep(400);
    list = await api();
    ok(list[0].rooms === 0, '모두 나가면 방 삭제');
    a.send({ t: 'queue', mode: '1v1' });
    ok(!!(await a.waitFor(m => m.t === 'queue' && m.count === 1)), '나간 뒤 다시 매칭 대기 가능');
    a.ws.close();

    console.log('4) 2:2 매칭 (서버 2) — 4명');
    const q = ['A', 'B', 'C', 'D'].map(n => client(2, n));
    for (const c of q) await c.hello();
    for (const c of q) c.send({ t: 'queue', mode: '2v2' });
    const st = await Promise.all(q.map(c => c.waitFor(m => m.t === 'start')));
    ok(st.every(Boolean) && st[0].players.length === 4, '2:2 방 생성 (4명)');
    const teams = st[0].players.map(p => p.team).sort().join('');
    ok(teams === '0011', '팀 구성 2 : 2');
    ok((await api())[1].rooms === 1 && (await api())[0].rooms === 0, '서버 2에서만 방 생성 (서버 간 분리)');
    q.forEach(c => c.ws.close());
    await sleep(300);

    console.log('5) 3:3 + 봇 채우기');
    const s = client(3, '혼자');
    await s.hello();
    s.send({ t: 'queue', mode: '3v3' });
    await sleep(300);
    s.send({ t: 'fillbots' });                // 대기 시간이 부족하면 무시됨
    await sleep(200);
    ok(!s.start, '대기 시간이 짧으면 봇 채우기 거절');
    await sleep(1400);
    s.send({ t: 'fillbots' });
    const ss = await s.waitFor(m => m.t === 'start');
    ok(!!ss && ss.players.length === 6 && ss.players.filter(p => p.bot).length === 5, '3:3 방 (사람 1 + 봇 5)');
    await sleep(4200);
    ok(s.last && s.last.p.some((p, i) => i !== ss.you && (p[0] !== (ss.players[i].team ? 13 : 1) || p[1] !== 1 && p[1] !== 11)), '봇들이 움직인다');
    s.ws.close();

    console.log('6) 잘못된 입력/공격 방어');
    const x = client(1, '악당');
    await x.hello();
    x.ws.send('not json');
    x.ws.send(JSON.stringify({ t: 'in', dir: '<script>' }));
    x.ws.send(JSON.stringify({ t: 'queue', mode: 'xx' }));
    x.ws.send(JSON.stringify({ t: 'chat', text: '<b>hi</b>' }));
    await sleep(300);
    const chat = x.msgs.find(m => m.t === 'chat');
    ok(chat && !/[<>]/.test(chat.text), '채팅 특수문자 제거');
    ok(x.ws.readyState === 1, '잘못된 데이터에도 연결/서버 유지');
    x.ws.send('x'.repeat(5000));
    await sleep(300);
    ok(x.closed, '너무 큰 메시지는 연결 종료');
    const r = await fetch(BASE + '/../../etc/passwd').catch(() => null);
    const r2 = await fetch(BASE + '/%2e%2e/server.js');
    ok(r2.status === 403 || r2.status === 404, '경로 이탈(../) 차단');

    console.log('7) 서버 정원 초과');
    const srv2 = await startServer({ CHANNEL_CAP: '2', CHANNELS: '1' }, PORT + 1000);
    const B2 = `http://127.0.0.1:${PORT + 1000}`;
    const c1 = client(1, 'a', B2), c2 = client(1, 'b', B2), c3 = client(1, 'c', B2);
    await c1.hello(); await c2.hello();
    await c3.ready;
    ok(!!(await c3.waitFor(m => m.t === 'full')), '정원이 차면 "full" 안내 후 거절');
    srv2.kill();

    console.log('8) 정적 파일');
    const idx = await fetch(BASE + '/');
    ok(idx.status === 200, '/ (index.html) 응답');
    const js = await fetch(BASE + '/core.js');
    ok(js.status === 200 && (await js.text()).includes('GameCore'), '/core.js 응답');
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    srv.kill();
    console.log(failed ? `\n실패 ${failed}건` : '\n모든 테스트 통과');
    process.exit(failed ? 1 : 0);
  }
})();
