/**
 * Extract {sdp, mediaIp, mediaPort} the way fsmrf exposes endpoint.local /
 * endpoint.remote.
 */
function parseSdp(sdp) {
  const out = { sdp, mediaIp: null, mediaPort: null };
  if (!sdp) return out;
  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith('c=IN IP4 ')) out.mediaIp = line.slice(9).trim();
    else if (line.startsWith('m=audio ')) {
      const port = parseInt(line.split(' ')[1], 10);
      if (!Number.isNaN(port)) out.mediaPort = port;
    }
  }
  return out;
}

/**
 * Translate FreeSWITCH play url schemes to mediajam schemes.
 *   silence_stream://<ms>            -> silence://?duration=<ms>
 *   tone_stream://...                -> tone:// (best-effort)
 *   file/http(s) and bare paths pass through
 */
function translatePlayUrl(url) {
  const silence = /^silence_stream:\/\/(-?\d+)/.exec(url);
  if (silence) {
    const ms = parseInt(silence[1], 10);
    return ms < 0 ? 'silence://' : `silence://?duration=${ms}`;
  }
  if (url.startsWith('tone_stream://')) {
    // FS tone_stream syntax is rich; map the common single-frequency form
    // %(<on-ms>,<off-ms>,<freq>) and fall back to a 440Hz tone
    const m = /%\(\s*(\d+)\s*,\s*\d+\s*,\s*(\d+)/.exec(url);
    if (m) return `tone://?freq=${m[2]}&duration=${m[1]}`;
    return 'tone://';
  }
  return url;
}

/**
 * Split a command arg string on spaces, keeping single-quoted spans intact
 * (quotes stripped). The feature-server wraps text / event-params JSON as
 * '<...>', which may itself contain spaces, so a plain String.split(' ')
 * would shred it. An unterminated quote takes the rest of the string as
 * its token. Pure function; returns an array of tokens.
 */
function tokenizeQuoted(s) {
  const tokens = [];
  if (!s) return tokens;
  const str = String(s);
  const len = str.length;
  let i = 0;
  while (i < len) {
    while (i < len && str[i] === ' ') i++;
    if (i >= len) break;
    if (str[i] === '\'') {
      i++; // skip opening quote
      const start = i;
      const end = str.indexOf('\'', i);
      if (end === -1) {
        tokens.push(str.slice(start));
        i = len;
      } else {
        tokens.push(str.slice(start, end));
        i = end + 1;
      }
    } else {
      const start = i;
      while (i < len && str[i] !== ' ') i++;
      tokens.push(str.slice(start, i));
    }
  }
  return tokens;
}

module.exports = { parseSdp, translatePlayUrl, tokenizeQuoted };
