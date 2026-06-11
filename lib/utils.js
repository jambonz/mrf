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
    const m = /%\((\d+),\d+,(\d+)/.exec(url);
    if (m) return `tone://?freq=${m[2]}&duration=${m[1]}`;
    return 'tone://';
  }
  return url;
}

module.exports = { parseSdp, translatePlayUrl };
