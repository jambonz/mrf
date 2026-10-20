/**
 * Per-country tone patterns, keyed by ISO 3166-1 alpha-2 code (lowercase).
 *
 * Source: ITU-T E.180, "Various tones used in national networks" (Annex to ITU
 * Operational Bulletin No. 955, position on 1 May 2010). Each value is a full
 * mediajam/FreeSWITCH `tone_stream://` URL encoding ONE cadence period; the
 * caller loops it (e.g. the feature-server's dialMusic), so no `;loops=` suffix.
 *
 * Used by translatePlayUrl() in ./utils.js to expand the shorthand
 * `tone_stream://<cc>.<tone>` (e.g. `tone_stream://gb.ring`) into the pattern.
 *
 * Notation handled when deriving these from E.180: `a+b` = mixed dual tone;
 * `a×b` = modulation, carrier `a` used; `a/b` = sequence, first used; `a//b` =
 * either/or across exchanges, the common dual-tone alternative chosen; a 25 Hz
 * entry is the (inaudible) ring current, replaced with 425 Hz audible ringback.
 * Where a country lists Ringing tone I/II/III the first (primary) variant is used.
 *
 * To add a tone type (busy, dialtone, …) add a key beside `ring` here and the
 * alias in utils.js TONE_ALIASES; the URL grammar does not change.
 */
module.exports = {
  al: { ring: 'tone_stream://%(1000,4000,425)' },                              // Albania
  dz: { ring: 'tone_stream://%(1500,3500,425)' },                              // Algeria
  ad: { ring: 'tone_stream://%(1500,3000,425)' },                              // Andorra
  ao: { ring: 'tone_stream://%(1000,5000,425)' },                              // Angola (ITU 25 Hz -> 425 Hz)
  ai: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Anguilla
  ag: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Antigua and Barbuda
  ar: { ring: 'tone_stream://%(1000,4000,425)' },                              // Argentina
  aw: { ring: 'tone_stream://%(1000,4000,425)' },                              // Aruba
  ac: { ring: 'tone_stream://%(384,192,400,450);%(384,2016,400,450)' },        // Ascension
  au: { ring: 'tone_stream://%(400,200,400,425,450);%(400,2000,400,425,450)' },// Australia
  at: { ring: 'tone_stream://%(1000,5000,420)' },                              // Austria
  bs: { ring: 'tone_stream://%(2000,4000,480)' },                              // Bahamas
  bh: { ring: 'tone_stream://%(400,200,425);%(400,2000,425)' },                // Bahrain
  bd: { ring: 'tone_stream://%(1000,4000,450)' },                              // Bangladesh
  bb: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Barbados
  by: { ring: 'tone_stream://%(800,3200,425)' },                               // Belarus
  be: { ring: 'tone_stream://%(1000,3000,425)' },                              // Belgium
  bj: { ring: 'tone_stream://%(1700,3300,440)' },                              // Benin
  bm: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Bermuda
  bt: { ring: 'tone_stream://%(400,200,400);%(400,2600,400)' },                // Bhutan
  ba: { ring: 'tone_stream://%(1000,4000,425)' },                              // Bosnia and Herzegovina
  bw: { ring: 'tone_stream://%(400,200,425);%(400,2000,425)' },                // Botswana
  br: { ring: 'tone_stream://%(1000,4000,425)' },                              // Brazil
  vg: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // British Virgin Islands
  bn: { ring: 'tone_stream://%(400,200,400,450);%(400,200,400,450)' },         // Brunei Darussalam
  bg: { ring: 'tone_stream://%(1000,4000,425)' },                              // Bulgaria
  bf: { ring: 'tone_stream://%(1000,4000,425)' },                              // Burkina Faso
  bi: { ring: 'tone_stream://%(1700,3300,425)' },                              // Burundi
  kh: { ring: 'tone_stream://%(400,200,425);%(400,2000,425)' },                // Cambodia
  cm: { ring: 'tone_stream://%(1700,3300,440)' },                              // Cameroon
  ca: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Canada
  ky: { ring: 'tone_stream://%(1000,4000,425)' },                              // Cayman Islands
  cf: { ring: 'tone_stream://%(1700,3300,425)' },                              // Central African Republic
  td: { ring: 'tone_stream://%(1700,3300,440)' },                              // Chad
  gg: { ring: 'tone_stream://%(400,200,400,450)' },                            // Guernsey (Channel Islands)
  je: { ring: 'tone_stream://%(400,200,400,450);%(400,2000,400,450)' },        // Jersey (Channel Islands)
  cl: { ring: 'tone_stream://%(1000,3000,400)' },                              // Chile
  cn: { ring: 'tone_stream://%(1000,4000,450)' },                              // China
  co: { ring: 'tone_stream://%(1000,4500,425)' },                              // Colombia
  km: { ring: 'tone_stream://%(1710,50,440)' },                                // Comoros
  ck: { ring: 'tone_stream://%(400,200,400,450)' },                            // Cook Islands
  cr: { ring: 'tone_stream://%(1200,4900,450)' },                              // Costa Rica
  hr: { ring: 'tone_stream://%(1000,4000,425)' },                              // Croatia
  cu: { ring: 'tone_stream://%(1000,4000,425)' },                              // Cuba
  cy: { ring: 'tone_stream://%(1500,3000,425)' },                              // Cyprus
  cz: { ring: 'tone_stream://%(1000,4000,425)' },                              // Czech Republic
  ci: { ring: 'tone_stream://%(1700,3300,425)' },                              // Côte d'Ivoire
  cd: { ring: 'tone_stream://%(2000,4000,450)' },                              // DR Congo
  dk: { ring: 'tone_stream://%(1000,4000,425)' },                              // Denmark
  io: { ring: 'tone_stream://%(1000,3000,440)' },                              // Diego Garcia (BIOT)
  dj: { ring: 'tone_stream://%(1500,3500,425)' },                              // Djibouti
  dm: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Dominica
  do: { ring: 'tone_stream://%(400,200,400);%(400,2200,400)' },                // Dominican Republic
  ec: { ring: 'tone_stream://%(1200,4650,425)' },                              // Ecuador
  eg: { ring: 'tone_stream://%(2000,1000,425)' },                              // Egypt
  sv: { ring: 'tone_stream://%(1200,4600,425)' },                              // El Salvador
  ee: { ring: 'tone_stream://%(1000,4000,425)' },                              // Estonia
  et: { ring: 'tone_stream://%(1000,4000,425)' },                              // Ethiopia
  fk: { ring: 'tone_stream://%(400,200,400,450)' },                            // Falkland Islands
  fo: { ring: 'tone_stream://%(1000,4000,425)' },                              // Faroe Islands
  fj: { ring: 'tone_stream://%(400,200,425);%(400,2000,425)' },                // Fiji
  fi: { ring: 'tone_stream://%(1000,4000,425)' },                              // Finland
  fr: { ring: 'tone_stream://%(1500,3500,440)' },                              // France
  re: { ring: 'tone_stream://%(1500,3500,440)' },                              // Réunion (French Depts. Indian Ocean)
  gf: { ring: 'tone_stream://%(1500,3500,440)' },                              // French Guiana
  pf: { ring: 'tone_stream://%(1700,3300,440)' },                              // French Polynesia
  ga: { ring: 'tone_stream://%(1700,3300,440)' },                              // Gabon
  gm: { ring: 'tone_stream://%(1000,4000,425)' },                              // Gambia
  ge: { ring: 'tone_stream://%(1000,4000,425)' },                              // Georgia (ITU 25 Hz -> 425 Hz)
  de: { ring: 'tone_stream://%(1000,4000,425)' },                              // Germany
  gh: { ring: 'tone_stream://%(1000,4000,400)' },                              // Ghana
  gi: { ring: 'tone_stream://%(400,200,400,450);%(400,2000,400,450)' },        // Gibraltar
  gr: { ring: 'tone_stream://%(1000,4000,425)' },                              // Greece
  gl: { ring: 'tone_stream://%(1000,4000,445)' },                              // Greenland
  gd: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Grenada
  gp: { ring: 'tone_stream://%(1500,3500,440)' },                              // Guadeloupe
  gn: { ring: 'tone_stream://%(400,200,450)' },                                // Guinea
  gy: { ring: 'tone_stream://%(1750,3250,425)' },                              // Guyana
  hn: { ring: 'tone_stream://%(1000,4000,440)' },                              // Honduras
  hk: { ring: 'tone_stream://%(400,200,440,480);%(400,3000,440,480)' },        // Hong Kong
  hu: { ring: 'tone_stream://%(1250,3750,425)' },                              // Hungary
  is: { ring: 'tone_stream://%(1000,4000,425)' },                              // Iceland
  in: { ring: 'tone_stream://%(400,200,400);%(400,2000,400)' },                // India
  id: { ring: 'tone_stream://%(1000,4000,425)' },                              // Indonesia
  ir: { ring: 'tone_stream://%(1000,4000,425)' },                              // Iran
  iq: { ring: 'tone_stream://%(1000,0,400)' },                                 // Iraq (continuous)
  ie: { ring: 'tone_stream://%(400,200,400,450);%(400,2000,400,450)' },        // Ireland
  il: { ring: 'tone_stream://%(1000,3000,400)' },                              // Israel
  it: { ring: 'tone_stream://%(1000,4000,425)' },                              // Italy
  jm: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Jamaica
  jp: { ring: 'tone_stream://%(1000,2000,400)' },                              // Japan
  jo: { ring: 'tone_stream://%(1000,4000,420)' },                              // Jordan
  ke: { ring: 'tone_stream://%(670,3000,425);%(1500,5000,425)' },              // Kenya
  ki: { ring: 'tone_stream://%(400,200,425);%(400,2000,425)' },                // Kiribati
  kr: { ring: 'tone_stream://%(1000,2000,440,480)' },                          // Korea (Republic of)
  kw: { ring: 'tone_stream://%(1000,4000,425)' },                              // Kuwait
  kg: { ring: 'tone_stream://%(800,3200,425)' },                               // Kyrgyzstan
  la: { ring: 'tone_stream://%(1000,4000,425)' },                              // Laos
  lv: { ring: 'tone_stream://%(1000,4000,425)' },                              // Latvia
  lb: { ring: 'tone_stream://%(1000,4000,425)' },                              // Lebanon
  ls: { ring: 'tone_stream://%(1000,4000,400)' },                              // Lesotho
  lr: { ring: 'tone_stream://%(1000,4000,425)' },                              // Liberia
  li: { ring: 'tone_stream://%(1000,0,425)' },                                 // Liechtenstein (continuous)
  lt: { ring: 'tone_stream://%(1000,4000,425)' },                              // Lithuania
  lu: { ring: 'tone_stream://%(1000,4000,425)' },                              // Luxembourg
  mo: { ring: 'tone_stream://%(1000,4000,425)' },                              // Macao
  mg: { ring: 'tone_stream://%(1700,3300,440)' },                              // Madagascar
  mw: { ring: 'tone_stream://%(1000,4000,425)' },                              // Malawi
  my: { ring: 'tone_stream://%(400,200,425);%(400,2000,425)' },                // Malaysia
  mv: { ring: 'tone_stream://%(400,200,400);%(400,2000,400)' },                // Maldives
  ml: { ring: 'tone_stream://%(1500,3000,425)' },                              // Mali
  mt: { ring: 'tone_stream://%(1000,4000,425)' },                              // Malta
  mq: { ring: 'tone_stream://%(1500,3500,440)' },                              // Martinique
  mr: { ring: 'tone_stream://%(1500,3500,425)' },                              // Mauritania
  mu: { ring: 'tone_stream://%(1000,4000,425)' },                              // Mauritius
  yt: { ring: 'tone_stream://%(1500,3500,440)' },                              // Mayotte
  mx: { ring: 'tone_stream://%(1000,4000,425)' },                              // Mexico
  md: { ring: 'tone_stream://%(800,3200,425)' },                               // Moldova
  mc: { ring: 'tone_stream://%(1700,3300,440)' },                              // Monaco
  ms: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Montserrat
  ma: { ring: 'tone_stream://%(1700,3300,425)' },                              // Morocco
  mz: { ring: 'tone_stream://%(1000,5000,400)' },                              // Mozambique
  mm: { ring: 'tone_stream://%(2000,4000,400)' },                              // Myanmar
  na: { ring: 'tone_stream://%(400,200,400);%(400,2000,400)' },                // Namibia
  nr: { ring: 'tone_stream://%(1000,4000,400)' },                              // Nauru
  np: { ring: 'tone_stream://%(1100,3100,425)' },                              // Nepal
  nl: { ring: 'tone_stream://%(1000,4000,425)' },                              // Netherlands
  nc: { ring: 'tone_stream://%(1700,3300,440)' },                              // New Caledonia
  nz: { ring: 'tone_stream://%(400,200,400,450);%(400,2000,400,450)' },        // New Zealand
  ne: { ring: 'tone_stream://%(1700,3300,440)' },                              // Niger
  ng: { ring: 'tone_stream://%(2000,4000,400)' },                              // Nigeria
  no: { ring: 'tone_stream://%(1000,4000,425)' },                              // Norway
  om: { ring: 'tone_stream://%(400,200,425);%(400,2000,425)' },                // Oman
  pk: { ring: 'tone_stream://%(1000,2000,400)' },                              // Pakistan
  pa: { ring: 'tone_stream://%(1200,4650,425)' },                              // Panama
  pg: { ring: 'tone_stream://%(400,200,400,450);%(400,2000,400,450)' },        // Papua New Guinea
  py: { ring: 'tone_stream://%(1000,4000,425)' },                              // Paraguay
  pe: { ring: 'tone_stream://%(150,300,425)' },                                // Peru
  ph: { ring: 'tone_stream://%(1000,4000,425,480)' },                          // Philippines
  pl: { ring: 'tone_stream://%(1000,4000,425)' },                              // Poland
  pt: { ring: 'tone_stream://%(1000,5000,425)' },                              // Portugal
  pr: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Puerto Rico (US pattern)
  qa: { ring: 'tone_stream://%(380,250,400,450);%(380,2000,400,450)' },        // Qatar
  ro: { ring: 'tone_stream://%(1850,4150,450)' },                              // Romania
  ru: { ring: 'tone_stream://%(800,3200,425)' },                               // Russia
  rw: { ring: 'tone_stream://%(1700,3300,440)' },                              // Rwanda
  sh: { ring: 'tone_stream://%(400,200,400,450)' },                            // Saint Helena
  kn: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Saint Kitts and Nevis
  lc: { ring: 'tone_stream://%(375,250,425);%(375,2000,425)' },                // Saint Lucia
  vc: { ring: 'tone_stream://%(400,200,400,450);%(400,2000,400,450)' },        // Saint Vincent and the Grenadines
  ws: { ring: 'tone_stream://%(400,200,425)' },                                // Samoa
  sm: { ring: 'tone_stream://%(1000,4000,425)' },                              // San Marino
  st: { ring: 'tone_stream://%(1000,5000,400)' },                              // Sao Tome and Principe
  sa: { ring: 'tone_stream://%(1200,4600,425)' },                              // Saudi Arabia
  sn: { ring: 'tone_stream://%(1700,3300,400)' },                              // Senegal
  rs: { ring: 'tone_stream://%(1000,9000,450)' },                              // Serbia
  sc: { ring: 'tone_stream://%(400,200,425);%(400,2000,425)' },                // Seychelles
  sl: { ring: 'tone_stream://%(1000,4000,425)' },                              // Sierra Leone
  sg: { ring: 'tone_stream://%(400,200,425);%(400,2000,425)' },                // Singapore
  sk: { ring: 'tone_stream://%(1000,4000,425)' },                              // Slovakia
  si: { ring: 'tone_stream://%(1000,4000,425)' },                              // Slovenia
  sb: { ring: 'tone_stream://%(400,200,400,450)' },                            // Solomon Islands
  za: { ring: 'tone_stream://%(400,200,400);%(400,2000,400)' },                // South Africa
  es: { ring: 'tone_stream://%(1500,3000,425)' },                              // Spain
  lk: { ring: 'tone_stream://%(400,200,425);%(400,2000,425)' },                // Sri Lanka
  sd: { ring: 'tone_stream://%(1000,4000,425)' },                              // Sudan
  sr: { ring: 'tone_stream://%(1000,1000,425)' },                              // Suriname
  sz: { ring: 'tone_stream://%(400,200,400);%(400,4000,400)' },                // Eswatini (Swaziland)
  se: { ring: 'tone_stream://%(1000,5000,425)' },                              // Sweden
  ch: { ring: 'tone_stream://%(1000,4000,425)' },                              // Switzerland
  sy: { ring: 'tone_stream://%(1000,500,400)' },                               // Syria
  tj: { ring: 'tone_stream://%(800,3200,425)' },                               // Tajikistan (ITU 25 Hz -> 425 Hz)
  tz: { ring: 'tone_stream://%(1000,4000,425)' },                              // Tanzania
  th: { ring: 'tone_stream://%(1000,4000,400)' },                              // Thailand
  mk: { ring: 'tone_stream://%(1000,4000,425)' },                              // North Macedonia
  tk: { ring: 'tone_stream://%(400,200,400,450)' },                            // Tokelau
  tt: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Trinidad and Tobago
  tn: { ring: 'tone_stream://%(1200,4650,425)' },                              // Tunisia
  tr: { ring: 'tone_stream://%(2000,4000,450)' },                              // Turkey
  tm: { ring: 'tone_stream://%(400,4000,425)' },                               // Turkmenistan (ITU 25 Hz -> 425 Hz)
  tc: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // Turks and Caicos Islands
  tv: { ring: 'tone_stream://%(1000,500,425);%(1000,10000,425)' },             // Tuvalu
  ug: { ring: 'tone_stream://%(1000,4000,425)' },                              // Uganda
  ae: { ring: 'tone_stream://%(400,200,400,450);%(400,2000,400,450)' },        // United Arab Emirates
  gb: { ring: 'tone_stream://%(400,200,400,450);%(400,2000,400,450)' },        // United Kingdom
  us: { ring: 'tone_stream://%(2000,4000,440,480)' },                          // United States
  uy: { ring: 'tone_stream://%(1000,4000,425)' },                              // Uruguay
  vu: { ring: 'tone_stream://%(1000,4000,425)' },                              // Vanuatu
  ve: { ring: 'tone_stream://%(1000,4000,425)' },                              // Venezuela
  vn: { ring: 'tone_stream://%(1000,4000,425)' },                              // Vietnam (not in E.180)
  wf: { ring: 'tone_stream://%(1500,3500,440)' },                              // Wallis and Futuna
  ye: { ring: 'tone_stream://%(1000,4000,425)' },                              // Yemen
  zm: { ring: 'tone_stream://%(1000,4000,425)' },                              // Zambia
  zw: { ring: 'tone_stream://%(1000,4000,450)' },                              // Zimbabwe
};
