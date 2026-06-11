// Minimal RTP build/parse helpers for integration tests.

function buildRtp({ pt, seq, ts, ssrc, payload, marker = false }) {
  const buf = Buffer.alloc(12 + payload.length);
  buf[0] = 0x80;
  buf[1] = (marker ? 0x80 : 0) | (pt & 0x7f);
  buf.writeUInt16BE(seq & 0xffff, 2);
  buf.writeUInt32BE(ts >>> 0, 4);
  buf.writeUInt32BE(ssrc >>> 0, 8);
  payload.copy(buf, 12);
  return buf;
}

function parseRtp(buf) {
  if (buf.length < 12 || (buf[0] >> 6) !== 2) return null;
  return {
    marker: !!(buf[1] & 0x80),
    pt: buf[1] & 0x7f,
    seq: buf.readUInt16BE(2),
    ts: buf.readUInt32BE(4),
    ssrc: buf.readUInt32BE(8),
    payload: buf.subarray(12)
  };
}

module.exports = { buildRtp, parseRtp };
