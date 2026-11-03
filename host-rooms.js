'use strict';
/* 방장 방식(중계 + 방장 승계) 서버 테스트:  node test/host-rooms.js */
const { spawn } = require('child_process');
const path = require('path');

const PORT = 19100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => { console.log((c ? '  PASS ' : '  FAIL ') + l); if (!c) failed++; };

function startServer() {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST_STALL_MS: '1200' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise(res => p.stdout.on('data', d => { if (String(d).includes('서버 시작')) res(p); }));
}

function client(name, channel = 1) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/${channel}`);
  const c = { ws, name, msgs: [], closed: false };
  c.ready = new Promise(r => { ws.onopen = r; });
  ws.onmessage = ev => c.msgs.push(JSON.parse(ev.data));
  ws.onclose = () => { c.closed = true; };
  c.send = o => ws.send(JSON.stringify(o));
  c.wait = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const f = c.msgs.find(pred); if (f) return f; await sleep(20); } return null; };
  c.last = t => [...c.msgs].reverse().find(m => m.t === t);
  c.clear = () => { c.msgs.length = 0; };
  c.hello = async () => { await c.ready; c.send({ t: 'hello', name, skin: 2 }); return c.wait(m => m.t === 'welcome'); };
  return c;
}
const rooms = async () => (await (await fetch(BASE + '/api/servers')).json())[0].rooms;

(async () => {
  const srv = await startServer();
  try {
    console.log('1) 방 만들기 / 방 목록 / 입장');
    const A = client('방장A'), B = client('손님B'), C = client('손님C');
    await A.hello(); await B.hello(); await C.hello();
    A.send({ t: 'room_create', mode: '1v1', title: '<b>우리방</b>' });
    const r0 = await A.wait(m => m.t === 'room');
    ok(r0 && r0.members.length === 1 && r0.members[0].host && r0.me === 0, '만든 사람이 방장이 됨');
    ok(r0.title === 'b우리방/b' || !/[<>]/.test(r0.title), '방 제목 특수문자 제거: ' + r0.title);
    const lob = await B.wait(m => m.t === 'lobby' && m.hrooms && m.hrooms.length === 1, 3000);
    ok(lob && lob.hrooms[0].n === 1 && lob.hrooms[0].host === '방장A', '로비의 방 목록에 표시');
    B.send({ t: 'room_join', id: lob.hrooms[0].id });
    const rb = await B.wait(m => m.t === 'room' && m.members.length === 2);
    ok(rb && rb.me === 1 && rb.members[0].team !== rb.members[1].team, '입장하면 반대 팀에 배정');
    C.send({ t: 'room_join', id: lob.hrooms[0].id });
    ok(!!(await C.wait(m => m.t === 'error' && m.code === 'full')), '정원이 차면 입장 거절');
    B.send({ t: 'team' });
    await sleep(150);
    ok(A.last('room').members.map(m => m.team).join('') === '01', '상대 팀이 가득 차면 팀 변경 거절');

    console.log('2) 시작 / 입력·상태 중계');
    B.send({ t: 'room_start' });
    await sleep(200);
    ok(!A.last('hstart'), '방장이 아니면 시작 불가');
    A.send({ t: 'room_start' });
    const sa = await A.wait(m => m.t === 'hstart'), sb = await B.wait(m => m.t === 'hstart');
    ok(sa && sb && sa.you === 0 && sb.you === 1 && sa.hostPid === 0 && sb.hostPid === 0, '모두에게 시작 + 방장 번호 전달');
    ok(sa.players.length === 2 && sa.bots.length === 0, '1:1 두 명, 봇 없음');
    ok(sa.players[0].skin !== sa.players[1].skin, '같은 캐릭터를 골라도 겹치지 않음');
    B.clear(); A.clear();
    B.send({ t: 'in', dir: 'left' });
    B.send({ t: 'bomb' });
    const ri = await A.wait(m => m.t === 'r_in'), rbm = await A.wait(m => m.t === 'r_bomb');
    ok(ri && ri.pid === 1 && ri.dir === 'left' && rbm && rbm.pid === 1, '참가자 입력이 방장에게 전달됨 (pid 포함)');
    ok(!B.last('r_in'), '입력은 참가자에게 되돌아가지 않음');
    B.send({ t: 'hs', s: { tick: 999, p: [] }, ev: [] });
    await sleep(200);
    ok(!A.last('s'), '방장이 아닌 사람의 상태 전송은 무시');
    A.send({ t: 'hs', s: { tick: 1, p: [[1, 1]] }, ev: [{ type: 'explode' }] });
    const s1 = await B.wait(m => m.t === 's');
    ok(s1 && s1.s.tick === 1 && s1.ev[0].type === 'explode', '방장의 상태가 참가자에게 전달됨');
    ok(!A.last('s'), '방장 본인에게는 되돌아가지 않음');
    B.send({ t: 'chat', text: 'x'.repeat(2000) });
    await sleep(150);
    ok(!B.closed, '큰 메시지는 무시되고 연결 유지');

    console.log('3) 방장이 나가면 다음 사람이 방장 → 방 유지');
    B.clear();
    A.send({ t: 'room_leave' });
    const hc = await B.wait(m => m.t === 'host_change');
    ok(hc && hc.hostPid === 1 && hc.bots.join() === '0', '다음 사람이 방장이 되고, 나간 자리는 봇 목록에 포함');
    ok((await rooms()) === 1, '방은 사라지지 않고 유지됨');
    B.send({ t: 'hs', s: { tick: 2, p: [] }, ev: [] });
    await sleep(100);
    A.send({ t: 'hs', s: { tick: 3, p: [] }, ev: [] });       // 이미 나간 사람 → 무시
    await sleep(100);
    B.send({ t: 'room_leave' });
    await sleep(250);
    ok((await rooms()) === 0, '마지막 사람이 나가면 방 삭제');

    console.log('4) 2:2 — 방장이 접속 끊김 / 멈춤 / 참가자 이탈 / 한 판 종료');
    const D = [client('D1'), client('D2'), client('D3'), client('D4')];
    for (const c of D) await c.hello();
    D[0].send({ t: 'room_create', mode: '2v2', title: '2대2' });
    const rr = await D[0].wait(m => m.t === 'room');
    await sleep(600);
    const id = (await D[1].wait(m => m.t === 'lobby' && m.hrooms.length === 1)).hrooms[0].id;
    for (const c of D.slice(1)) c.send({ t: 'room_join', id });
    await D[3].wait(m => m.t === 'room' && m.members.length === 4);
    D[0].send({ t: 'room_start' });
    const hs = await Promise.all(D.map(c => c.wait(m => m.t === 'hstart')));
    ok(hs.every(Boolean) && hs[0].players.length === 4 && hs[0].players.filter(p => p.bot).length === 0, '4명 모두 사람으로 시작');
    const pidOf = hs.map(h => h.you);
    // 방장 멈춤: D1 이 상태를 안 보냄 → 1.2초 뒤 승계
    for (const c of D) c.clear();
    const stall = await D[1].wait(m => m.t === 'host_change', 4000);
    ok(stall && stall.bots.length === 0, '방장이 멈추면(상태 전송 중단) 자동으로 다음 사람에게 승계, 사람은 봇으로 바뀌지 않음');
    const newHostPid = stall.hostPid;
    ok(newHostPid === pidOf[1], '승계 순서: 먼저 들어온 사람(D2)');
    D[0].send({ t: 'hs', s: { tick: 7, p: [] }, ev: [] });     // 멈췄던 옛 방장의 전송은 무시
    await sleep(150);
    ok(!D[2].last('s'), '옛 방장의 상태 전송은 무시됨 (두 방장이 동시에 존재하지 않음)');
    // 새 방장 D2 가 상태 전송 → D1 도 받음
    D[1].send({ t: 'hs', s: { tick: 8, p: [] }, ev: [] });
    ok(!!(await D[0].wait(m => m.t === 's' && m.s.tick === 8)), '옛 방장도 이제 참가자로서 상태를 받음');
    // 참가자 이탈 → 방장에게 peer_left
    D[1].clear();
    D[3].ws.close();
    const pl = await D[1].wait(m => m.t === 'peer_left');
    ok(pl && pl.pid === pidOf[3], '참가자가 나가면 방장에게 알림 (그 자리는 봇으로)');
    // 방장 접속 끊김 → D1 이 새 방장 후보 순서(D3 → D1) 중 먼저
    for (const c of D) c.clear();
    D[1].ws.close();
    const hc2 = await D[2].wait(m => m.t === 'host_change');
    ok(hc2 && hc2.bots.includes(pidOf[3]) && hc2.bots.includes(pidOf[1]), '방장 접속이 끊겨도 승계, 나간 두 자리는 봇 목록으로 전달');
    // 한 판 종료 → 대기방 복귀
    const newHost = hc2.hostPid === pidOf[2] ? D[2] : D[0];
    newHost.send({ t: 'hs', s: { tick: 9, p: [] }, ev: [] });
    newHost.send({ t: 'room_end' });
    const back = await D[0].wait(m => m.t === 'room' && m.state === 'waiting') || await D[2].wait(m => m.t === 'room' && m.state === 'waiting');
    ok(!!back && back.members.length === 2, '방장이 한 판 종료를 알리면 남은 사람들이 대기방으로 복귀');
    D[0].ws.close(); D[2].ws.close();
    await sleep(300);
    ok((await rooms()) === 0, '모두 나가면 방 삭제');
  } catch (e) {
    console.error(e); failed++;
  } finally {
    srv.kill();
    console.log(failed ? `\n실패 ${failed}건` : '\n모든 테스트 통과');
    process.exit(failed ? 1 : 0);
  }
})();
