/**
 * ════════════════════════════════════════════════════════════════════
 *  PUPITRE · Red social + Marketplace universitario (Google Apps Script)
 *  Desarrollado por estudiantes de la Universidad Santa María
 * ════════════════════════════════════════════════════════════════════
 *  Archivos del proyecto:
 *    Code.gs     → configuración, base de datos (Sheets), utilidades, doGet/doPost
 *    Auth.gs     → cuentas, sesiones, contraseña, Continuar con Google / Apple
 *    Market.gs   → Marketplace (publicaciones de venta, imágenes, favoritos)
 *    Social.gs   → muro, comentarios, reacciones, encuestas, historias, grupos,
 *                  eventos, seguidores, mensajes y notificaciones
 *    Privacy.gs  → consentimientos, exportar datos, eliminar cuenta, mantenimiento
 *    Admin.gs    → panel de métricas (KPI de ventas y comunidad) y Google Analytics
 *    Index.html  → estructura de la página (incluye Styles y JavaScript)
 *    Styles.html → estilos
 *    JavaScript.html → lógica de la interfaz
 *    appsscript.json (activa el servicio avanzado "Google Sheets API" para lecturas rápidas)
 *
 *  RENDIMIENTO
 *   - Las tablas se guardan en caché (CacheService) y se invalidan al escribir.
 *   - Varias hojas se leen en UNA sola llamada con la API avanzada de Sheets.
 *   - Las fotos se suben en paralelo apenas se eligen (uploadImage), así publicar es instantáneo.
 *   - La configuración viaja dentro de la página (sin una llamada extra al abrir).
 *
 *  PRIMER USO
 *   1) Ejecuta setup() y acepta los permisos.
 *   2) Implementar → Nueva implementación → Aplicación web
 *        Ejecutar como: Yo · Quién tiene acceso: Cualquier persona
 *   3) (Opcional) Continuar con Google / Apple → ver instrucciones en Auth.gs
 *   4) (Opcional) instalarMantenimiento()  ·  cargarDemo() / borrarDemo()
 *   5) Métricas: en Propiedades del script agrega ADMIN_EMAILS (tu correo) y
 *      GA_MEASUREMENT_ID (G-XXXXXXX de Google Analytics 4). Ver Admin.gs.
 */

const CFG = Object.freeze({
  APP_NAME: 'Pupitre',
  DB_NAME: 'Pupitre_DB',
  FOLDER_NAME: 'Pupitre_Imagenes',
  POLICY_VERSION: '2026-11-13',
  SCHEMA_VERSION: '3',
  SESSION_DAYS_LONG: 14,
  SESSION_DAYS_SHORT: 1,
  HASH_ROUNDS: 250,
  MAX_IMAGES: 5,
  MAX_POST_IMAGES: 4,
  MAX_IMAGE_BYTES: 1.5 * 1024 * 1024,
  MAX_ACTIVE_PER_USER: 40,
  PAGE_SIZE: 24,
  FEED_PAGE: 15,
  LOGIN_MAX_FAILS: 5,
  LOCK_MINUTES: 15,
  REPORTS_TO_AUTOPAUSE: 3,
  STORY_HOURS: 24,
  MAX_GROUPS_OWNED: 5,
  ADMIN_EMAIL: '' // opcional: recibe avisos de reportes
});

const CATEGORIES = [
  { id: 'cursos', label: 'Cursos y tutorías', icon: 'cap' },
  { id: 'libros', label: 'Libros y apuntes', icon: 'book' },
  { id: 'tecnologia', label: 'Tecnología', icon: 'laptop' },
  { id: 'accesorios', label: 'Accesorios', icon: 'headphones' },
  { id: 'equipos', label: 'Equipos y laboratorio', icon: 'flask' },
  { id: 'ropa', label: 'Ropa y merch', icon: 'shirt' },
  { id: 'servicios', label: 'Servicios', icon: 'wrench' },
  { id: 'residencia', label: 'Hogar y residencia', icon: 'home' },
  { id: 'otros', label: 'Otros', icon: 'sparkles' }
];
const NO_PHOTO_OK = ['cursos', 'servicios'];
const CONDITIONS = ['Nuevo', 'Como nuevo', 'Buen estado', 'Con detalles', 'No aplica (servicio)'];
const CURRENCIES = ['USD', 'VES'];
const STATUSES = ['active', 'paused', 'sold'];
const AUDIENCES = ['publico', 'universidad', 'seguidores'];
const PALETTE = ['var(--lime)', 'var(--lilac)', 'var(--mint)', 'var(--sky)', 'var(--tang)'];
const GROUP_ICONS = ['users', 'laptop', 'book', 'flask', 'tag', 'image', 'cap', 'search', 'sparkles', 'home'];
const UNIVERSITIES = [
  'Universidad Santa María (USM)', 'Universidad Central de Venezuela (UCV)', 'Universidad Simón Bolívar (USB)',
  'Universidad Católica Andrés Bello (UCAB)', 'Universidad Metropolitana (UNIMET)', 'Universidad Monteávila (UMA)',
  'Universidad de Carabobo (UC)', 'Universidad de Los Andes (ULA)', 'Universidad del Zulia (LUZ)',
  'Universidad de Oriente (UDO)', 'Universidad Centroccidental Lisandro Alvarado (UCLA)', 'UNEXPO', 'UNEFA',
  'Universidad Pedagógica Experimental Libertador (UPEL)', 'Universidad Rafael Urdaneta (URU)',
  'Universidad José María Vargas (UJMV)', 'Universidad Nueva Esparta (UNE)', 'Universidad Arturo Michelena (UAM)',
  'Universidad Bicentenaria de Aragua (UBA)', 'IESA'
];

const SCHEMA = {
  Users: ['id', 'email', 'name', 'university', 'career', 'phone', 'passHash', 'salt', 'createdAt', 'updatedAt', 'status', 'termsVersion', 'marketingOptIn', 'showPhone', 'lastLogin', 'color', 'bio', 'googleSub', 'appleSub', 'socialPrivacy'],
  Sessions: ['tokenHash', 'userId', 'createdAt', 'expiresAt'],
  Products: ['id', 'sellerId', 'title', 'description', 'category', 'condition', 'price', 'currency', 'campus', 'images', 'status', 'createdAt', 'updatedAt', 'views'],
  Favorites: ['userId', 'productId', 'createdAt'],
  Consents: ['id', 'subject', 'kind', 'detail', 'version', 'createdAt'],
  Reports: ['id', 'productId', 'reporterId', 'reason', 'createdAt', 'status'],
  Posts: ['id', 'authorId', 'groupId', 'kind', 'audience', 'text', 'images', 'poll', 'productId', 'eventId', 'createdAt', 'status', 'reports'],
  Comments: ['id', 'postId', 'authorId', 'text', 'createdAt'],
  Reactions: ['postId', 'userId', 'createdAt'],
  PollVotes: ['postId', 'userId', 'option', 'createdAt'],
  Follows: ['followerId', 'followeeId', 'createdAt'],
  Groups: ['id', 'name', 'desc', 'color', 'icon', 'privacy', 'ownerId', 'createdAt', 'status'],
  GroupMembers: ['groupId', 'userId', 'role', 'createdAt'],
  Events: ['id', 'groupId', 'title', 'date', 'place', 'color', 'icon', 'createdBy', 'createdAt', 'status'],
  Rsvps: ['eventId', 'userId', 'createdAt'],
  Chats: ['id', 'userA', 'userB', 'createdAt', 'lastAt', 'lastText', 'lastFrom', 'unreadA', 'unreadB'],
  ChatMessages: ['id', 'chatId', 'fromId', 'text', 'createdAt'],
  Notifications: ['id', 'userId', 'icon', 'text', 'link', 'createdAt', 'read'],
  Saved: ['userId', 'postId', 'createdAt'],
  Hidden: ['userId', 'postId', 'createdAt'],
  PostReports: ['id', 'postId', 'reporterId', 'reason', 'createdAt'],
  Stories: ['id', 'authorId', 'text', 'color', 'icon', 'image', 'createdAt', 'expiresAt']
};

/* ═══════════════════════════ ENTRADA WEB ═══════════════════════════ */

function doGet(e) {
  ensureSetup_();
  const p = (e && e.parameter) || {};
  if (p.ping) return json_out_({ ok: true, data: 'pong' });
  let ticket = '', error = '';
  if (p.state && (p.code || p.error)) {
    try { ticket = finishSso_(p); }
    catch (x) { error = x && x.userMessage ? x.message : 'No pudimos iniciar sesión con ese método. Intenta de nuevo.'; if (!(x && x.userMessage)) console.error(x); }
  }
  // Con FRONTEND_URL la app vive en Vercel: esta URL solo reenvía hacia allá.
  if (frontendUrl_()) return goFrontend_(ticket ? 'sso_ticket=' + encodeURIComponent(ticket) : error ? 'sso_error=' + encodeURIComponent(error) : '');
  return page_(ticket, error);
}

/** Apple devuelve la respuesta por POST (response_mode=form_post). */
function doPost(e) {
  if (isApiCall_(e)) return apiRoute_(e);
  ensureSetup_();
  const p = (e && e.parameter) || {};
  let ticket = '', error = '';
  if (p.state && (p.code || p.error)) {
    try { ticket = finishSso_(p); }
    catch (x) { error = x && x.userMessage ? x.message : 'No pudimos iniciar sesión con Apple. Intenta de nuevo.'; if (!(x && x.userMessage)) console.error(x); }
  }
  if (frontendUrl_()) return goFrontend_(ticket ? 'sso_ticket=' + encodeURIComponent(ticket) : error ? 'sso_error=' + encodeURIComponent(error) : '');
  return page_(ticket, error);
}

function page_(ticket, error) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.ssoTicket = ticket || '';
  t.ssoError = error || '';
  const cfg = getConfig();
  t.bootJson = cfg.ok ? JSON.stringify(cfg.data).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '') : '';
  return t.evaluate()
    .setTitle(CFG.APP_NAME + ' · Tu campus, conectado')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * DIAGNÓSTICO: ejecútalo desde el editor (selecciona "diagnostico" y pulsa Ejecutar)
 * si la página se queda cargando. Revisa el "Registro de ejecución".
 */
function diagnostico() {
  const out = [];
  const t = function (name, fn) {
    const s = Date.now();
    try { const r = fn(); out.push('✔ ' + name + ' (' + (Date.now() - s) + ' ms)' + (r ? ': ' + r : '')); }
    catch (e) { out.push('✘ ' + name + ': ' + (e && e.message ? e.message : e)); }
  };
  t('Base de datos y carpeta', function () { ensureSetup_(); return 'Pupitre_DB ' + prop_('DB_ID'); });
  const raw_ = function (n) { return HtmlService.createTemplateFromFile(n).getRawContent(); };
  ['Index', 'Styles', 'JavaScript'].forEach(function (n) {
    t('Archivo ' + n + '.html', function () {
      const c = raw_(n);
      const diff = typeof compararArchivo_ === 'function' ? compararArchivo_(n, c) : null;
      if (diff) throw new Error(diff);
      return Math.round(c.length / 1024) + ' KB, idéntico al original';
    });
  });
  t('Cambios de HtmlService en JavaScript.html', function () {
    const d = typeof primeraDiferencia_ === 'function' ? primeraDiferencia_(raw_('JavaScript'), HtmlService.createHtmlOutputFromFile('JavaScript').getContent()) : null;
    return d ? 'Apps Script altera el archivo (ya no afecta: include usa el contenido original). ' + d : 'ninguno';
  });
  t('Sintaxis de la página final', function () {
    const html = page_('', '').getContent();
    const re = /<script>([\s\S]*?)<\/script>/g; let m, n = 0;
    while ((m = re.exec(html))) {
      n++;
      try { new Function(m[1]); }
      catch (e) {
        let d = '';
        if (m[1].indexOf("'use strict'") >= 0 && typeof primeraDiferencia_ === 'function') {
          const r = raw_('JavaScript'), ms = r.match(/<script>([\s\S]*)<\/script>/);
          if (ms) d = ' · Lo que cambió Apps Script → ' + (primeraDiferencia_(ms[1], m[1]) || 'nada (el error ya está en el archivo)');
        }
        throw new Error('el bloque <script> n.º ' + n + ' (' + Math.round(m[1].length / 1024) + ' KB) tiene un error: ' + e.message + ' · empieza con «' + m[1].trim().slice(0, 60).replace(/\s+/g, ' ') + '»' + d);
      }
    }
    return n + ' bloques <script> correctos';
  });
  t('API avanzada de Sheets', function () {
    if (typeof Sheets === 'undefined') return 'no activa: funciona igual pero más lento (actívala en Servicios → Google Sheets API)';
    Sheets.Spreadsheets.Values.batchGet(prop_('DB_ID'), { ranges: ["'Users'!A2:B"] });
    return 'activa';
  });
  t('Leer tablas', function () { loadTables_(['Users', 'Posts', 'Products']); return rows_('Users').length + ' usuarios · ' + rows_('Posts').length + ' publicaciones · ' + rows_('Products').length + ' artículos'; });
  t('getConfig', function () { const r = getConfig(); if (!r.ok) throw new Error(r.error); return 'Google: ' + (r.data.sso.google ? 'sí' : 'no') + ' · Analytics: ' + (r.data.gaId || 'no configurado'); });
  t('Muro (socialFeed)', function () { const r = socialFeed('', {}); if (!r.ok) throw new Error(r.error); return r.data.posts.length + ' publicaciones públicas'; });
  t('Marketplace (listProducts)', function () { const r = listProducts({}); if (!r.ok) throw new Error(r.error); return r.data.total + ' artículos activos'; });
  t('URL de la app', function () { return redirectUri_() || 'sin implementación activa'; });
  t('Frontend en Vercel', function () {
    const f = typeof frontendUrl_ === 'function' ? frontendUrl_() : '';
    if (!f) return 'no configurado (la app se sirve desde Apps Script)';
    if (!/^https:\/\//.test(f)) throw new Error('FRONTEND_URL debe empezar con https://');
    return f + (prop_('PROXY_KEY') ? ' · con PROXY_KEY' : '') + (prop_('SSO_REDIRECT_URI') ? ' · SSO vuelve a ' + prop_('SSO_REDIRECT_URI') : '');
  });
  Logger.log('\n' + out.join('\n'));
  return out;
}

/** Inserta Styles.html y JavaScript.html dentro de Index.html. */
function include(name) {
  // getRawContent entrega el archivo tal cual. createHtmlOutputFromFile lo reprocesa como HTML
  // y puede alterar el JavaScript (escapa "<?", etc.), lo que rompe la página.
  try { return HtmlService.createTemplateFromFile(name).getRawContent(); }
  catch (e) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
}

function setup() {
  ensureSetup_();
  Logger.log('Base de datos: https://docs.google.com/spreadsheets/d/' + prop_('DB_ID'));
  Logger.log('Carpeta de imágenes: https://drive.google.com/drive/folders/' + prop_('FOLDER_ID'));
  Logger.log('Después de implementar, ejecuta verURLRedireccion() para configurar Google/Apple.');
}

function ensureSetup_() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('DB_ID') && p.getProperty('FOLDER_ID') && p.getProperty('PEPPER') && p.getProperty('SCHEMA_V') === CFG.SCHEMA_VERSION) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!p.getProperty('PEPPER')) p.setProperty('PEPPER', Utilities.getUuid() + Utilities.getUuid());
    let ss;
    if (!p.getProperty('DB_ID')) {
      ss = SpreadsheetApp.create(CFG.DB_NAME);
      p.setProperty('DB_ID', ss.getId());
    } else ss = SpreadsheetApp.openById(p.getProperty('DB_ID'));
    migrate_(ss);
    if (!p.getProperty('FOLDER_ID')) p.setProperty('FOLDER_ID', DriveApp.createFolder(CFG.FOLDER_NAME).getId());
    seedGroups_(ss);
    p.setProperty('SCHEMA_V', CFG.SCHEMA_VERSION);
  } finally {
    lock.releaseLock();
  }
}

/** Crea las hojas que falten y agrega columnas nuevas sin tocar los datos existentes. */
function migrate_(ss) {
  Object.keys(SCHEMA).forEach(function (name) {
    const cols = SCHEMA[name];
    let sh = ss.getSheetByName(name);
    if (!sh) {
      const blank = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 && /^(Hoja|Sheet)\s?1$/.test(ss.getSheets()[0].getName());
      sh = blank ? ss.getSheets()[0].setName(name) : ss.insertSheet(name);
      sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
      if (sh.getMaxColumns() > cols.length) sh.deleteColumns(cols.length + 1, sh.getMaxColumns() - cols.length);
      sh.setFrozenRows(1);
    }
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#1E3A5F').setFontColor('#F2CF3A');
  });
}

function seedGroups_(ss) {
  const sh = ss.getSheetByName('Groups');
  if (sh.getLastRow() > 1) return;
  const now = iso_();
  const g = [
    ['Objetos perdidos · Campus', '¿Perdiste o encontraste algo? Publícalo aquí. Nunca compartas fotos de documentos de identidad.', 'var(--tang)', 'search'],
    ['Ayuda académica', 'Preguntas, guías, simulacros y grupos de estudio entre carreras.', 'var(--sky)', 'book'],
    ['Emprendedores universitarios', 'Ideas, ferias y alianzas entre estudiantes que venden.', 'var(--lilac)', 'tag']
  ];
  const rows = g.map(function (x) { return ['G' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase(), x[0], x[1], x[2], x[3], 'Público', 'system', now, 'active']; });
  sh.getRange(2, 1, rows.length, rows[0].length).setNumberFormat('@').setValues(rows);
}

/* ═══════════════════════════ CAPA DE DATOS ═══════════════════════════ */

let _ss = null;
const _sheets = {};
const _memo = {};
let _locked = false;

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function folder_() { return DriveApp.getFolderById(prop_('FOLDER_ID')); }
function db_() {
  if (!_ss) { ensureSetup_(); _ss = SpreadsheetApp.openById(prop_('DB_ID')); }
  return _ss;
}
function sh_(name) {
  if (!_sheets[name]) _sheets[name] = db_().getSheetByName(name);
  if (!_sheets[name]) throw new Error('Falta la hoja ' + name + '. Ejecuta setup().');
  return _sheets[name];
}
/* ── Lectura rápida: caché por tabla (CacheService) + lectura en lote (Sheets API) ── */
const TBL_TTL = 21600, TBL_CHUNK = 30000, TBL_MAX = 3000000;
function colLetter_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function bumpTbl_(name) { CacheService.getScriptCache().put('tv_' + name, Date.now() + '.' + Math.random().toString(36).slice(2, 7), TBL_TTL); }
function toObjs_(name, vals) {
  const cols = SCHEMA[name];
  return vals.map(function (r, i) {
    const o = { _row: i + 2 };
    cols.forEach(function (k, j) { o[k] = unq_(r[j] == null ? '' : String(r[j])); });
    return o;
  }).filter(function (o) { return o[cols[0]] !== ''; });
}
function readSheet_(name) {
  const sh = sh_(name), cols = SCHEMA[name], last = sh.getLastRow();
  return last < 2 ? [] : toObjs_(name, sh.getRange(2, 1, last - 1, cols.length).getDisplayValues());
}
/** Lee varias hojas en una sola llamada HTTP (servicio avanzado Sheets). Si no está activo, usa SpreadsheetApp. */
function batchRead_(names) {
  const out = {};
  if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values) {
    try {
      const ranges = names.map(function (n) { return "'" + n + "'!A2:" + colLetter_(SCHEMA[n].length); });
      const r = Sheets.Spreadsheets.Values.batchGet(prop_('DB_ID'), { ranges: ranges, valueRenderOption: 'FORMATTED_VALUE' });
      (r.valueRanges || []).forEach(function (vr, i) { out[names[i]] = toObjs_(names[i], vr.values || []); });
    } catch (e) { console.warn('batchGet no disponible, se usa SpreadsheetApp', e); }
  }
  names.forEach(function (n) { if (!out[n]) out[n] = readSheet_(n); });
  return out;
}
function putTable_(c, base, rows) {
  const s = JSON.stringify(rows);
  if (s.length > TBL_MAX) return;
  const o = {};
  let i = 0, p = 0;
  do {
    let end = Math.min(p + TBL_CHUNK, s.length);
    const code = s.charCodeAt(end - 1);
    if (end < s.length && code >= 0xD800 && code <= 0xDBFF) end--; // no partir emojis
    o[base + '_' + (i++)] = s.slice(p, end);
    p = end;
  } while (p < s.length);
  o[base] = String(i);
  try { c.putAll(o, TBL_TTL); } catch (e) { /* caché llena: se ignora */ }
}
/** Carga en memoria varias tablas: primero desde la caché, lo que falte en un solo batchGet. */
function loadTables_(names) {
  names = names.filter(function (n, i) { return !_memo[n] && names.indexOf(n) === i; });
  if (!names.length) return;
  const c = CacheService.getScriptCache();
  const vers = c.getAll(names.map(function (n) { return 'tv_' + n; }));
  const fix = {};
  names.forEach(function (n) { if (!vers['tv_' + n]) { vers['tv_' + n] = String(Date.now()); fix['tv_' + n] = vers['tv_' + n]; } });
  if (Object.keys(fix).length) c.putAll(fix, TBL_TTL);
  const base = function (n) { return 't_' + n + '_' + vers['tv_' + n]; };
  const metas = c.getAll(names.map(base));
  const keys = [];
  names.forEach(function (n) { const k = Number(metas[base(n)] || 0); for (let i = 0; i < k; i++) keys.push(base(n) + '_' + i); });
  const parts = keys.length ? c.getAll(keys) : {};
  const missing = [];
  names.forEach(function (n) {
    const k = Number(metas[base(n)] || 0);
    if (!k) { missing.push(n); return; }
    let str = '';
    for (let i = 0; i < k; i++) { const v = parts[base(n) + '_' + i]; if (v == null) { missing.push(n); return; } str += v; }
    try { _memo[n] = JSON.parse(str); } catch (e) { missing.push(n); }
  });
  if (!missing.length) return;
  const fresh = batchRead_(missing);
  missing.forEach(function (n) { _memo[n] = fresh[n]; putTable_(c, base(n), fresh[n]); });
}
function rows_(name, fresh) {
  if (fresh) { _memo[name] = readSheet_(name); return _memo[name]; }
  if (!_memo[name]) loadTables_([name]);
  return _memo[name];
}
function insertMany_(name, list) {
  if (!list.length) return;
  const sh = sh_(name), cols = SCHEMA[name], row = sh.getLastRow() + 1;
  const need = row + list.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), Math.max(need, 200));
  sh.getRange(row, 1, list.length, cols.length).setNumberFormat('@')
    .setValues(list.map(function (o) { return cols.map(function (k) { return cell_(o[k]); }); }));
  _memo[name] = null; bumpTbl_(name);
}
function insert_(name, obj) { insertMany_(name, [obj]); }
function update_(name, obj) {
  const cols = SCHEMA[name];
  sh_(name).getRange(obj._row, 1, 1, cols.length).setNumberFormat('@')
    .setValues([cols.map(function (k) { return cell_(obj[k]); })]);
  _memo[name] = null; bumpTbl_(name);
}
function remove_(name, rowNums) {
  const sh = sh_(name);
  Array.from(new Set(rowNums)).sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  _memo[name] = null; bumpTbl_(name);
}
/** Borra todas las filas que cumplan la condición (lee la hoja fresca). */
function removeWhere_(name, pred) {
  const rs = rows_(name, true).filter(pred).map(function (r) { return r._row; });
  if (rs.length) remove_(name, rs);
  return rs.length;
}
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
function unq_(s) { return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s; }
function withLock_(fn) {
  if (_locked) return fn();
  const l = LockService.getScriptLock();
  if (!l.tryLock(25000)) fail_('El servidor está ocupado. Intenta de nuevo en unos segundos.');
  _locked = true;
  try { return fn(); } finally { _locked = false; l.releaseLock(); }
}

/* ═══════════════════════════ UTILIDADES ═══════════════════════════ */

function run_(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    if (e && e.userMessage) return { ok: false, error: e.message, code: e.code || '' };
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, error: 'Ocurrió un error inesperado. Intenta de nuevo.', code: 'SERVER' };
  }
}
function fail_(msg, code) {
  const e = new Error(msg);
  e.userMessage = true;
  e.code = code || '';
  throw e;
}
function iso_() { return new Date().toISOString(); }
function id_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 14).toUpperCase(); }
function rand_() { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_512, Utilities.getUuid() + Utilities.getUuid() + Date.now())).replace(/=+$/, ''); }
function sha_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }
function json_(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; } }
function norm_(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function indexBy_(list, key) { const o = {}; list.forEach(function (x) { o[x[key]] = x; }); return o; }
function groupBy_(list, key) { const o = {}; list.forEach(function (x) { (o[x[key]] = o[x[key]] || []).push(x); }); return o; }
function safeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/** Límite de frecuencia por clave (ventana fija). */
function rate_(key, max, seconds, msg) {
  const c = CacheService.getScriptCache(), k = 'rl_' + key, n = Number(c.get(k) || 0);
  if (n >= max) fail_(msg || 'Vas muy rápido. Espera un momento e intenta de nuevo.');
  c.put(k, String(n + 1), seconds);
}
function str_(v, opt) {
  opt = opt || {};
  const min = opt.min || 0, max = opt.max || 200, label = opt.label || 'Campo';
  let s = String(v == null ? '' : v).replace(/<[^>]*>/g, '');
  s = opt.multiline
    ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').replace(/\n{3,}/g, '\n\n')
    : s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s{2,}/g, ' ');
  s = s.trim();
  if (s.length < min) fail_(label + ': mínimo ' + min + ' caracteres.');
  if (s.length > max) fail_(label + ': máximo ' + max + ' caracteres.');
  return s;
}
function email_(v) {
  const e = String(v || '').trim().toLowerCase();
  if (e.length > 120 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) fail_('Escribe un correo válido.');
  return e;
}
function phone_(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const d = s.replace(/\D/g, '');
  if (d.length < 10 || d.length > 15) fail_('El teléfono debe tener entre 10 y 15 dígitos (incluye el código de país, ej. +58).');
  return '+' + d;
}
function password_(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128 || !/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) {
    fail_('La contraseña debe tener al menos 8 caracteres, con letras y números.');
  }
}
function oneOf_(v, list, msg) { if (list.indexOf(v) < 0) fail_(msg || 'Valor no válido.'); return v; }

/* ═══════════════════════════ IMÁGENES (Drive) ═══════════════════════════ */

function saveImage_(dataUrl, prefix, i) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) fail_('Formato de imagen no permitido. Usa JPG, PNG o WebP.');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > CFG.MAX_IMAGE_BYTES) fail_('Una imagen supera 1,5 MB. Usa una foto más liviana.');
  if (!magicOk_(bytes, m[1])) fail_('Uno de los archivos no es una imagen válida.');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[m[1]];
  const file = folder_().createFile(Utilities.newBlob(bytes, m[1], prefix + '_' + Date.now() + '_' + i + '.' + ext));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (e) { console.warn('No se pudo compartir la imagen públicamente; se servirá por getImage().', e); }
  return file.getId();
}
/** Sube una foto apenas el usuario la elige (en paralelo). Devuelve el id de Drive para usarlo después. */
function uploadImage(token, dataUrl, kind) {
  return run_(function () {
    const u = auth_(token);
    oneOf_(String(kind || ''), ['post', 'product', 'story'], 'Tipo de imagen no válido.');
    rate_('up_' + u.id, 60, 600, 'Subiste muchas fotos en poco tiempo. Espera unos minutos.');
    const id = saveImage_(dataUrl, kind + '_' + u.id.slice(-6), 0);
    const c = CacheService.getScriptCache(), k = 'upl_' + u.id, list = json_(c.get(k), []);
    list.push(id);
    c.put(k, JSON.stringify(list.slice(-60)), 21600);
    return id;
  });
}
/** Acepta solo fotos que este mismo usuario subió con uploadImage (o data URL, por compatibilidad). */
function resolveImages_(u, list, prefix) {
  const mine = json_(CacheService.getScriptCache().get('upl_' + u.id), []);
  return (list || []).map(function (x, i) {
    const v = typeof x === 'string' ? x : (x && (x.uploaded || x.dataUrl)) || '';
    if (/^data:/.test(v)) return saveImage_(v, prefix, i);
    if (mine.indexOf(v) < 0) fail_('Una de las fotos no es válida. Vuelve a elegirla.');
    return v;
  });
}
function magicOk_(b, mime) {
  const u = function (i) { return b[i] & 0xFF; };
  if (mime === 'image/jpeg') return u(0) === 0xFF && u(1) === 0xD8 && u(2) === 0xFF;
  if (mime === 'image/png') return u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4E && u(3) === 0x47;
  if (mime === 'image/webp') return u(0) === 0x52 && u(1) === 0x49 && u(8) === 0x57 && u(9) === 0x45 && u(10) === 0x42 && u(11) === 0x50;
  return false;
}
function inAppFolder_(file) {
  const fid = prop_('FOLDER_ID'), it = file.getParents();
  while (it.hasNext()) if (it.next().getId() === fid) return true;
  return false;
}
function trashImage_(fileId) {
  try { const f = DriveApp.getFileById(fileId); if (inAppFolder_(f)) f.setTrashed(true); } catch (e) { /* ya no existe */ }
}
/** Respaldo cuando el dominio bloquea compartir por enlace: sirve la imagen como data URL. */
function getImage(fileId) {
  return run_(function () {
    if (!/^[\w-]{20,80}$/.test(String(fileId))) fail_('Imagen no válida.');
    const f = DriveApp.getFileById(fileId);
    if (!inAppFolder_(f)) fail_('Imagen no disponible.');
    const b = f.getBlob();
    return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
  });
}

/* ═══════════════════════════ CONFIGURACIÓN PÚBLICA ═══════════════════════════ */

function getConfig() {
  return run_(function () {
    let url = '';
    url = typeof frontendUrl_ === 'function' ? frontendUrl_() : '';
    if (!url) try { url = ScriptApp.getService().getUrl(); } catch (e) { /* sin implementación */ }
    return {
      appName: CFG.APP_NAME, policyVersion: CFG.POLICY_VERSION, url: url,
      categories: CATEGORIES, conditions: CONDITIONS, currencies: CURRENCIES, universities: UNIVERSITIES,
      maxImages: CFG.MAX_IMAGES, maxPostImages: CFG.MAX_POST_IMAGES, maxImageBytes: CFG.MAX_IMAGE_BYTES,
      noPhotoOk: NO_PHOTO_OK, pageSize: CFG.PAGE_SIZE, groupIcons: GROUP_ICONS,
      sso: { google: !!(prop_('GOOGLE_CLIENT_ID') && prop_('GOOGLE_CLIENT_SECRET')), apple: !!(prop_('APPLE_SERVICE_ID') && prop_('APPLE_CLIENT_SECRET')) },
      gaId: /^G-[A-Z0-9]{4,16}$/.test(String(prop_('GA_MEASUREMENT_ID') || '')) ? prop_('GA_MEASUREMENT_ID') : ''
    };
  });
}
