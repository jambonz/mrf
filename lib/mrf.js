const { EventEmitter } = require('events');
const Connection = require('./connection');
const MediaServer = require('./mediaserver');

const noopLogger = {
  info: () => {},
  error: () => {},
  debug: () => {}
};

/**
 * Mrf is the entry point, mirroring drachtio-fsmrf's Mrf class. The srf
 * argument is accepted for drop-in compatibility but unused — mediajam needs
 * no SIP signaling to allocate endpoints.
 */
class Mrf extends EventEmitter {
  constructor(srf, opts = {}) {
    super();
    // allow new Mrf({logger}) without an srf
    if (srf && !opts.logger && (srf.info || srf.logger)) {
      if (srf.info) {
        opts = { logger: srf };
        srf = null;
      } else if (srf.logger) {
        opts = srf;
        srf = null;
      }
    }
    this.srf = srf;
    this.logger = opts.logger || noopLogger;
    this.mediaservers = [];
  }

  /**
   * Connect to a mediajam server.
   * @param {object} opts - {address, port} ('secret'/'listenPort' accepted
   *   and ignored for fsmrf compatibility)
   */
  async connect(opts) {
    const { address, port = 9090 } = opts;
    const connection = new Connection(this.logger);
    const ms = new MediaServer(connection, this.logger, { address, port });
    const helloData = await connection.connect({ address, port }, clientInfo());
    ms._onHello(helloData);
    this.mediaservers.push(ms);
    return ms;
  }
}

function clientInfo() {
  const { name, version } = require('../package.json');
  return `${name}/${version}`;
}

module.exports = Mrf;
