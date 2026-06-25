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
    // The first arg is normally a drachtio Srf (fsmrf-compatible). Also support
    // new Mrf(logger) / new Mrf({logger}) without an srf — but an Srf must NOT be
    // mistaken for a logger: it has .locals and an .info SIP-method handler, yet
    // no .debug. The old `srf.info ⇒ logger` heuristic therefore used the whole
    // Srf as the logger, which had no .debug and crashed any logger.debug() call.
    if (srf && !opts.logger && !srf.locals) {
      if (typeof srf.debug === 'function') {
        opts = { logger: srf }; // a bare (pino-like) logger passed as the first arg
        srf = null;
      } else if (srf.logger) {
        opts = srf; // an options object passed as the first arg
        srf = null;
      }
    }
    this.srf = srf;
    // an explicit logger wins; else the one jambonz puts on srf.locals; else noop
    this.logger = opts.logger || srf?.locals?.logger || noopLogger;
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
