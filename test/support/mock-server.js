const net = require('net');
const { randomUUID } = require('crypto');

/**
 * A minimal in-process mediajam control-protocol server for testing the
 * client without the real Go binary. Implements hello, endpoint lifecycle,
 * play (with timed play.done), dtmf.send, bridge, mute.
 */
class MockMediajam {
  constructor() {
    this.server = null;
    this.port = 0;
    this.endpoints = new Map(); // id -> {socket, playTimers}
    this.requests = []; // every req frame received, for assertions
  }

  listen(port = 0) {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => this._onConnection(socket));
      this.server.listen(port, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  close() {
    for (const [, ep] of this.endpoints) {
      for (const t of ep.playTimers) clearTimeout(t);
    }
    this.server.close();
  }

  send(socket, obj) {
    socket.write(`${JSON.stringify(obj)}\n`);
  }

  // push an arbitrary event to the connection owning an endpoint
  pushEvent(epId, evt, data) {
    const ep = this.endpoints.get(epId);
    if (ep) this.send(ep.socket, { t: 'evt', ep: epId, evt, data });
  }

  pushStats(data) {
    for (const socket of this.sockets || []) {
      this.send(socket, { t: 'stats', data });
    }
  }

  _onConnection(socket) {
    (this.sockets = this.sockets || new Set()).add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim()) this._onFrame(socket, JSON.parse(line));
      }
    });
  }

  _onFrame(socket, frame) {
    if (frame.t === 'hello') {
      this.send(socket, { t: 'hello', data: { version: 1, server: 'mock/0.0.0', maxSessions: 100 } });
      return;
    }
    if (frame.t !== 'req') return;
    this.requests.push(frame);
    const res = (data) => this.send(socket, { t: 'res', id: frame.id, ok: true, data });
    const fail = (code, msg) => this.send(socket, { t: 'res', id: frame.id, ok: false, err: { code, msg } });

    switch (frame.cmd) {
      case 'endpoint.create': {
        const id = randomUUID();
        this.endpoints.set(id, { socket, playTimers: new Set() });
        res({
          endpointId: id,
          localSdp: 'v=0\r\no=mock 1 1 IN IP4 127.0.0.1\r\ns=m\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\n' +
            'm=audio 41000 RTP/AVP 0 101\r\na=rtpmap:0 PCMU/8000\r\n'
        });
        break;
      }
      case 'endpoint.destroy': {
        const ep = this.endpoints.get(frame.ep);
        if (!ep) return fail('unknown_endpoint', frame.ep);
        this.endpoints.delete(frame.ep);
        res({});
        this.send(socket, { t: 'evt', ep: frame.ep, evt: 'endpoint.destroyed', data: { reason: 'commanded' } });
        break;
      }
      case 'endpoint.modify':
        res({ localSdp: 'v=0\r\nc=IN IP4 127.0.0.1\r\nm=audio 41002 RTP/AVP 0\r\n' });
        break;
      case 'play.start': {
        const ep = this.endpoints.get(frame.ep);
        if (!ep) return fail('unknown_endpoint', frame.ep);
        const playId = randomUUID().slice(0, 8);
        res({ playId });
        this.send(socket, { t: 'evt', ep: frame.ep, evt: 'play.start', data: { playId } });
        const t = setTimeout(() => {
          ep.playTimers.delete(t);
          this.send(socket, {
            t: 'evt', ep: frame.ep, evt: 'play.done',
            data: { playId, reason: 'completed', durationMs: 100, playbackMs: 100, lastOffsetPos: 800 }
          });
        }, 30);
        ep.playTimers.add(t);
        break;
      }
      case 'play.stop':
      case 'dtmf.send':
      case 'stt.start':
      case 'stt.stop':
      case 'endpoint.set':
      case 'endpoint.mute':
      case 'endpoint.unmute':
      case 'bridge.create':
      case 'bridge.destroy':
        res({});
        break;
      case 'endpoint.info':
        res({ codec: 'PCMU', stats: { packetsIn: 0 } });
        break;
      case 'system.logLevel':
        this.logLevel = (frame.data && frame.data.level) || this.logLevel || 'info';
        res({ level: this.logLevel });
        break;
      default:
        fail('unknown_command', frame.cmd);
    }
  }
}

module.exports = MockMediajam;
