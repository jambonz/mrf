const { EventEmitter } = require('events');
const net = require('net');

const REQUEST_TIMEOUT_MS = 10_000;
const PROTOCOL_VERSION = 1;

/**
 * Connection speaks the mediajam control protocol: newline-delimited JSON
 * over TCP with a hello handshake (see mediajam docs/control-protocol.md).
 *
 * Events: 'connect' (server hello data), 'close', 'error', 'stats' (data),
 * 'evt' (full event frame).
 */
class Connection extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
    this.closed = false;
    this._buf = '';
  }

  connect({ address, port }, clientInfo) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: address, port }, () => {
        this._send({ t: 'hello', data: { version: PROTOCOL_VERSION, client: clientInfo } });
      });
      this.socket = socket;
      socket.setNoDelay(true);

      const onError = (err) => reject(err);
      socket.once('error', onError);

      this.once('connect', (helloData) => {
        socket.removeListener('error', onError);
        socket.on('error', (err) => this.emit('error', err));
        resolve(helloData);
      });

      socket.on('data', (chunk) => this._onData(chunk));
      socket.on('close', () => {
        this.closed = true;
        for (const [, p] of this.pending) p.reject(new Error('connection closed'));
        this.pending.clear();
        this.emit('close');
      });
    });
  }

  close() {
    this.closed = true;
    if (this.socket) this.socket.destroy();
  }

  _onData(chunk) {
    this._buf += chunk.toString('utf8');
    let idx;
    while ((idx = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 1);
      if (!line.trim()) continue;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        this.logger.error({ line }, 'mediajam: unparseable frame');
        continue;
      }
      this._onFrame(frame);
    }
  }

  _onFrame(frame) {
    switch (frame.t) {
      case 'hello':
        this.emit('connect', frame.data || {});
        break;
      case 'res': {
        const p = this.pending.get(frame.id);
        if (!p) return;
        this.pending.delete(frame.id);
        clearTimeout(p.timer);
        if (frame.ok) p.resolve(frame.data || {});
        else {
          const err = new Error(frame.err?.msg || 'command failed');
          err.code = frame.err?.code;
          p.reject(err);
        }
        break;
      }
      case 'evt':
        this.emit('evt', frame);
        break;
      case 'stats':
        this.emit('stats', frame.data || {});
        break;
      default:
        this.logger.info({ frame }, 'mediajam: unexpected frame type');
    }
  }

  _send(obj) {
    this.socket.write(`${JSON.stringify(obj)}\n`);
  }

  /**
   * Send a request, returning a promise for the response data.
   */
  request(cmd, ep, data) {
    if (this.closed) return Promise.reject(new Error('connection closed'));
    const id = String(++this.nextId);
    const frame = { t: 'req', id, cmd };
    if (ep) frame.ep = ep;
    if (data) frame.data = data;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for response to ${cmd}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this._send(frame);
    });
  }
}

module.exports = Connection;
