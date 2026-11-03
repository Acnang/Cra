'use strict';
/* =============================================================================
 *  wslite.js — 의존성 없는 최소 WebSocket 서버 (RFC 6455, Node 내장 모듈만 사용)
 *
 *  지원: 텍스트 프레임, 조각(fragment) 메시지, ping/pong, close
 *  보호: 최대 메시지 크기 제한, 마스크 없는 클라이언트 프레임 거부,
 *        느린 클라이언트(전송 버퍼 과다) 강제 종료
 *  사용:
 *    server.on('upgrade', (req, socket, head) =>
 *      acceptWebSocket(req, socket, { maxPayload: 1024 }, conn => { conn.on('message', ...) }));
 * ========================================================================== */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_BUFFERED = 1024 * 1024;     // 1MB 넘게 밀리면 느린 클라이언트로 간주

class WSConn extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.readyState = 1;               // 1=OPEN, 3=CLOSED
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragBytes = 0;
    this.fragOpcode = 0;

    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);
    socket.on('data', d => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this.terminate());
    socket.on('end', () => this.terminate());
  }

  send(text) {
    if (this.readyState !== 1) return;
    if (this.socket.writableLength > MAX_BUFFERED) { this.terminate(); return; }
    this._write(0x1, Buffer.from(text, 'utf8'));
  }

  ping() { if (this.readyState === 1) this._write(0x9, Buffer.alloc(0)); }

  close(code = 1000) {
    if (this.readyState !== 1) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code);
    this._write(0x8, p);
    this.readyState = 3;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this._emitClose();
  }

  terminate() {
    if (this.readyState === 3 && this.socket.destroyed) return;
    this.readyState = 3;
    this.socket.destroy();
    this._emitClose();
  }

  _closed() { this.readyState = 3; this._emitClose(); }
  _emitClose() {
    if (this._closeEmitted) return;
    this._closeEmitted = true;
    this.emit('close');
  }

  _write(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([header, payload]));
  }

  _fail(code) { this.close(code); }

  _onData(chunk) {
    if (this.readyState !== 1) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    if (this.buf.length > this.maxPayload * 4 + 64) { this._fail(1009); return; }   // 과도한 누적 방지

    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const rsv = b[0] & 0x70;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (rsv || !masked) { this._fail(1002); return; }
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) { this._fail(1009); return; }
        len = Number(big); off = 10;
      }
      if (len > this.maxPayload) { this._fail(1009); return; }
      if (opcode >= 0x8 && (!fin || len > 125)) { this._fail(1002); return; }
      if (b.length < off + 4 + len) return;

      const mask = b.subarray(off, off + 4);
      const data = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) data[i] = b[off + 4 + i] ^ mask[i & 3];
      this.buf = b.subarray(off + 4 + len);

      if (!this._frame(fin, opcode, data)) return;
    }
  }

  /** 프레임 1개 처리. 연결이 끝났으면 false */
  _frame(fin, opcode, data) {
    switch (opcode) {
      case 0x8: this.close(1000); return false;
      case 0x9: if (this.readyState === 1) this._write(0xA, data); return true;
      case 0xA: this.emit('pong'); return true;
      case 0x0: case 0x1: case 0x2: {
        if (opcode !== 0x0) {
          if (this.frags.length) { this._fail(1002); return false; }
          this.fragOpcode = opcode;
        } else if (!this.frags.length) { this._fail(1002); return false; }
        this.frags.push(data);
        this.fragBytes += data.length;
        if (this.fragBytes > this.maxPayload) { this._fail(1009); return false; }
        if (fin) {
          const full = this.frags.length === 1 ? this.frags[0] : Buffer.concat(this.frags);
          const op = this.fragOpcode;
          this.frags = []; this.fragBytes = 0;
          if (op === 0x1) this.emit('message', full.toString('utf8'));   // 바이너리는 무시
        }
        return true;
      }
      default: this._fail(1002); return false;
    }
  }
}

/** HTTP Upgrade 요청을 WebSocket으로 승격. 실패하면 소켓을 닫고 null */
function acceptWebSocket(req, socket, opts, onConn) {
  const key = req.headers['sec-websocket-key'];
  const ok = req.method === 'GET'
    && /websocket/i.test(req.headers.upgrade || '')
    && key && req.headers['sec-websocket-version'] === '13';
  if (!ok) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  const conn = new WSConn(socket, opts.maxPayload || 2048);
  onConn(conn);
  return conn;
}

module.exports = { acceptWebSocket, WSConn };
