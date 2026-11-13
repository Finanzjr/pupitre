/**
 * ════════════════════════════════════════════════════════════════════
 *  Auth.gs · Cuentas, sesiones y "Continuar con Google / Apple"
 * ════════════════════════════════════════════════════════════════════
 *
 *  CONTINUAR CON GOOGLE (gratis)
 *   1. Implementa la app web y ejecuta verURLRedireccion(); copia la URL que muestra.
 *   2. Entra a https://console.cloud.google.com → crea un proyecto.
 *   3. "Pantalla de consentimiento de OAuth" → tipo Externo → nombre "Pupitre",
 *      correo de soporte y logo. Alcances: openid, email, profile. Publica la app.
 *   4. "Credenciales" → Crear credenciales → ID de cliente de OAuth → Aplicación web.
 *      En "URI de redireccionamiento autorizados" pega la URL del paso 1 (exacta).
 *   5. En Apps Script → Configuración del proyecto → Propiedades del script, agrega:
 *        GOOGLE_CLIENT_ID      = (ID de cliente)
 *        GOOGLE_CLIENT_SECRET  = (Secreto del cliente)
 *      El botón "Continuar con Google" aparece solo cuando ambas existen.
 *
 *  CONTINUAR CON APPLE (requiere Apple Developer Program, 99 USD/año)
 *   1. developer.apple.com → Identifiers → crea un "Services ID" (ej. com.tudominio.pupitre.web)
 *      y activa "Sign in with Apple". En Website URLs agrega el dominio script.google.com
 *      y como Return URL la misma URL de verURLRedireccion().
 *   2. Crea una "Key" con Sign in with Apple y genera el client_secret (un JWT ES256
 *      válido hasta 6 meses) con tu Team ID, Key ID y el archivo .p8. Apps Script no puede
 *      firmar ES256, por eso se genera fuera (por ejemplo con un script de Node o Python)
 *      y se renueva cada 6 meses.
 *   3. Propiedades del script:
 *        APPLE_SERVICE_ID     = (Services ID)
 *        APPLE_CLIENT_SECRET  = (JWT generado)
 *   Nota: si el usuario elige "Ocultar mi correo", Apple le da una dirección @privaterelay.
 *   Para que los avisos por correo le lleguen, registra tu dominio remitente en Apple.
 *
 *  Si tu URL de producción cambia, define SSO_REDIRECT_URI en Propiedades del script.
 */

function hashPass_(pw, salt) {
  const key = Utilities.newBlob(prop_('PEPPER') + salt).getBytes();
  let h = Utilities.computeHmacSha256Signature(Utilities.newBlob(pw).getBytes(), key);
  for (let i = 0; i < CFG.HASH_ROUNDS; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return Utilities.base64Encode(h);
}
function checkPass_(u, pw) { return !!u.passHash && safeEq_(hashPass_(String(pw || ''), u.salt), u.passHash); }
function userById_(id) { return rows_('Users').find(function (u) { return u.id === id; }) || null; }
function userByEmail_(em) { return rows_('Users').find(function (u) { return u.email === em; }) || null; }
function freshUser_(id) { return rows_('Users', true).find(function (x) { return x.id === id; }); }

function createSession_(userId, remember) {
  const token = rand_();
  const exp = new Date(Date.now() + (remember ? CFG.SESSION_DAYS_LONG : CFG.SESSION_DAYS_SHORT) * 864e5).toISOString();
  const th = sha_(token);
  withLock_(function () { insert_('Sessions', { tokenHash: th, userId: userId, createdAt: iso_(), expiresAt: exp }); });
  CacheService.getScriptCache().put('s_' + th, JSON.stringify({ userId: userId, exp: exp }), 21600);
  return token;
}
function auth_(token, required) {
  if (required === undefined) required = true;
  const deny = function () { if (required) fail_('Tu sesión expiró o no has iniciado sesión.', 'AUTH'); return null; };
  if (!token || typeof token !== 'string' || token.length < 20 || token.length > 200) return deny();
  const th = sha_(token), cache = CacheService.getScriptCache();
  let s = json_(cache.get('s_' + th), null);
  if (!s) {
    const row = rows_('Sessions').find(function (r) { return r.tokenHash === th; });
    if (row) { s = { userId: row.userId, exp: row.expiresAt }; cache.put('s_' + th, JSON.stringify(s), 21600); }
  }
  if (!s || new Date(s.exp) < new Date()) return deny();
  const u = userById_(s.userId);
  if (!u || u.status !== 'active') return deny();
  return u;
}
function killSessions_(userId, exceptHash) {
  const cache = CacheService.getScriptCache();
  const ss = rows_('Sessions', true).filter(function (s) { return s.userId === userId && s.tokenHash !== exceptHash; });
  ss.forEach(function (s) { cache.remove('s_' + s.tokenHash); });
  if (ss.length) remove_('Sessions', ss.map(function (s) { return s._row; }));
}
function purgeSessions_(userId) {
  const now = new Date();
  removeWhere_('Sessions', function (s) { return (!userId || s.userId === userId) && new Date(s.expiresAt) < now; });
}

const DEFAULT_PRIVACY = { profileUniOnly: false, dmFollowingOnly: false, suggestible: true };
function privacyOf_(u) { return Object.assign({}, DEFAULT_PRIVACY, json_(u.socialPrivacy, {})); }
function initials_(name) { const p = String(name || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
function publicUser_(u) {
  return {
    id: u.id, email: u.email, name: u.name, university: u.university, career: u.career, bio: u.bio || '',
    phone: u.phone, showPhone: u.showPhone === 'true', marketingOptIn: u.marketingOptIn === 'true',
    createdAt: u.createdAt, color: u.color || PALETTE[0], hasPassword: !!u.passHash,
    providers: { google: !!u.googleSub, apple: !!u.appleSub }, privacy: privacyOf_(u), isAdmin: isAdmin_(u)
  };
}
/** Datos mínimos que ven otras personas. */
function person_(u) {
  if (!u) return { id: '', name: 'Usuario', initials: 'U', career: '', university: '', color: 'var(--lilac)' };
  return { id: u.id, name: u.name, initials: initials_(u.name), career: u.career || '', university: u.university || '', color: u.color || PALETTE[0] };
}
function seller_(u) {
  if (!u) return { id: '', firstName: 'Usuario', initials: 'U', university: '', memberSince: '' };
  return { id: u.id, firstName: String(u.name).trim().split(/\s+/)[0], initials: initials_(u.name), university: u.university, memberSince: String(u.createdAt).slice(0, 7), color: u.color || PALETTE[0] };
}
function newUser_(o) {
  const now = iso_();
  return Object.assign({
    id: id_('U'), email: '', name: '', university: '', career: '', phone: '', passHash: '', salt: Utilities.getUuid(),
    createdAt: now, updatedAt: now, status: 'active', termsVersion: CFG.POLICY_VERSION, marketingOptIn: 'false',
    showPhone: 'false', lastLogin: now, color: PALETTE[Math.floor(Math.random() * PALETTE.length)], bio: '',
    googleSub: '', appleSub: '', socialPrivacy: JSON.stringify(DEFAULT_PRIVACY)
  }, o);
}
function logSignupConsents_(uid, marketing) {
  const now = iso_();
  insertMany_('Consents', [
    { id: id_('C'), subject: uid, kind: 'age18_terms_privacy', detail: 'true', version: CFG.POLICY_VERSION, createdAt: now },
    { id: id_('C'), subject: uid, kind: 'marketing', detail: String(marketing === true), version: CFG.POLICY_VERSION, createdAt: now }
  ]);
}
function sessionResult_(u, remember) {
  return { token: createSession_(u.id, remember !== false), user: publicUser_(u), favs: favIds_(u.id) };
}

/* ─────────── Registro e inicio de sesión con correo ─────────── */

function register(data) {
  return run_(function () {
    data = data || {};
    const email = email_(data.email);
    const name = str_(data.name, { min: 2, max: 60, label: 'Nombre' });
    const phone = phone_(data.phone);
    password_(data.password);
    const c = data.consents || {};
    if (c.accept !== true) fail_('Debes declarar que eres mayor de 18 años y aceptar los Términos y la Política de Privacidad.');
    rate_('reg', 30, 600, 'Hay muchos registros en este momento. Intenta en unos minutos.');
    const u = withLock_(function () {
      if (userByEmail_(email)) fail_('Ya existe una cuenta con ese correo. Inicia sesión.');
      const salt = Utilities.getUuid();
      const nu = newUser_({ email: email, name: name, phone: phone, salt: salt, passHash: hashPass_(data.password, salt), marketingOptIn: String(c.marketing === true), showPhone: String(!!data.showPhone && !!phone) });
      insert_('Users', nu);
      logSignupConsents_(nu.id, c.marketing);
      return nu;
    });
    return sessionResult_(u, true);
  });
}

function login(email, password, remember) {
  return run_(function () {
    const em = email_(email);
    if (typeof password !== 'string' || !password) fail_('Escribe tu contraseña.');
    const cache = CacheService.getScriptCache(), key = 'lf_' + sha_(em), fails = Number(cache.get(key) || 0);
    if (fails >= CFG.LOGIN_MAX_FAILS) fail_('Demasiados intentos fallidos. Espera ' + CFG.LOCK_MINUTES + ' minutos.');
    const u = userByEmail_(em);
    if (u && u.status === 'active' && !u.passHash) fail_('Esta cuenta usa ' + (u.googleSub ? 'Google' : 'Apple') + '. Usa ese botón o crea una contraseña con "¿Olvidaste tu contraseña?".');
    if (!(u && u.status === 'active' && checkPass_(u, password))) {
      cache.put(key, String(fails + 1), CFG.LOCK_MINUTES * 60);
      Utilities.sleep(400);
      fail_('Correo o contraseña incorrectos.');
    }
    cache.remove(key);
    withLock_(function () { const f = freshUser_(u.id); f.lastLogin = iso_(); update_('Users', f); purgeSessions_(u.id); });
    return sessionResult_(u, !!remember);
  });
}

function logout(token) {
  return run_(function () {
    if (!token) return true;
    const th = sha_(token);
    CacheService.getScriptCache().remove('s_' + th);
    withLock_(function () { removeWhere_('Sessions', function (s) { return s.tokenHash === th; }); });
    return true;
  });
}

function me(token) {
  return run_(function () { const u = auth_(token); return { user: publicUser_(u), favs: favIds_(u.id) }; });
}

function updateProfile(token, data) {
  return run_(function () {
    const u = auth_(token);
    data = data || {};
    const name = str_(data.name, { min: 2, max: 60, label: 'Nombre' });
    const university = str_(data.university, { max: 90, label: 'Universidad' });
    const career = str_(data.career, { max: 80, label: 'Carrera' });
    const bio = str_(data.bio, { max: 160, label: 'Biografía' });
    const phone = phone_(data.phone);
    return withLock_(function () {
      const f = freshUser_(u.id), prevMk = f.marketingOptIn;
      Object.assign(f, { name: name, university: university, career: career, bio: bio, phone: phone, showPhone: String(!!data.showPhone && !!phone), marketingOptIn: String(data.marketingOptIn === true), updatedAt: iso_() });
      if (data.color && PALETTE.indexOf(data.color) > -1) f.color = data.color;
      update_('Users', f);
      if (prevMk !== f.marketingOptIn) insert_('Consents', { id: id_('C'), subject: u.id, kind: 'marketing', detail: f.marketingOptIn, version: CFG.POLICY_VERSION, createdAt: iso_() });
      return publicUser_(f);
    });
  });
}

function changePassword(token, current, next) {
  return run_(function () {
    const u = auth_(token);
    if (u.passHash && !checkPass_(u, current)) fail_('La contraseña actual no es correcta.');
    password_(next);
    withLock_(function () {
      const f = freshUser_(u.id);
      f.salt = Utilities.getUuid(); f.passHash = hashPass_(next, f.salt); f.updatedAt = iso_();
      update_('Users', f);
      killSessions_(u.id, sha_(token));
    });
    return true;
  });
}

/* ─────────── Recuperar contraseña (código de 6 dígitos) ─────────── */

function requestPasswordReset(email) {
  return run_(function () {
    const em = email_(email);
    rate_('rr_' + sha_(em), 3, 900, 'Ya enviamos varios códigos. Espera 15 minutos e intenta de nuevo.');
    const u = userByEmail_(em);
    if (u && u.status === 'active' && MailApp.getRemainingDailyQuota() > 0) {
      const pad = ('000000' + (parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 10), 16) % 1000000)).slice(-6);
      CacheService.getScriptCache().put('rc_' + sha_(em), JSON.stringify({ h: sha_(pad + u.salt), tries: 0 }), 900);
      MailApp.sendEmail({
        to: em, name: CFG.APP_NAME, subject: pad + ' es tu código de ' + CFG.APP_NAME,
        body: 'Tu código para crear una contraseña nueva es ' + pad + '. Vence en 15 minutos. Si no lo pediste, ignora este correo.',
        htmlBody: mailWrap_('<h2 style="margin:0 0 10px">Tu código de acceso</h2><p>Usa este código en ' + esc_(CFG.APP_NAME) + ':</p>' +
          '<p style="font-size:34px;font-weight:700;letter-spacing:8px;background:#F2CF3A;color:#14243B;display:inline-block;padding:10px 18px;border-radius:12px">' + pad + '</p>' +
          '<p>Vence en 15 minutos. Si no lo pediste, ignora este correo: tu cuenta sigue segura.</p>')
      });
    }
    return true;
  });
}
function resetPassword(email, code, next) {
  return run_(function () {
    const em = email_(email), cache = CacheService.getScriptCache(), k = 'rc_' + sha_(em);
    const d = json_(cache.get(k), null), u = userByEmail_(em);
    if (!d || !u) fail_('El código venció o no es válido. Pide uno nuevo.');
    if (!safeEq_(sha_(String(code || '').trim() + u.salt), d.h)) {
      d.tries++;
      if (d.tries >= 5) cache.remove(k); else cache.put(k, JSON.stringify(d), 900);
      fail_(d.tries >= 5 ? 'Demasiados intentos. Pide un código nuevo.' : 'Código incorrecto. Revisa tu correo.');
    }
    password_(next);
    cache.remove(k);
    withLock_(function () {
      const f = freshUser_(u.id);
      f.salt = Utilities.getUuid(); f.passHash = hashPass_(next, f.salt); f.updatedAt = iso_();
      update_('Users', f);
      killSessions_(u.id, '');
    });
    cache.remove('lf_' + sha_(em));
    return sessionResult_(userById_(u.id), true);
  });
}

/* ═══════════════════ CONTINUAR CON GOOGLE / APPLE ═══════════════════ */

function redirectUri_() {
  const forced = prop_('SSO_REDIRECT_URI');
  if (forced) return forced;
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}
/** Ejecuta esto después de implementar: muestra la URL exacta que debes registrar en Google/Apple. */
function verURLRedireccion() {
  const u = redirectUri_();
  Logger.log(u ? 'URL de redireccionamiento: ' + u : 'Primero implementa la app web (Implementar → Nueva implementación).');
  return u;
}
function qs_(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
function newState_(provider) {
  const st = rand_().slice(0, 40);
  CacheService.getScriptCache().put('st_' + st, provider, 600);
  return st;
}
function jwtPayload_(jwt) {
  const part = String(jwt || '').split('.')[1];
  if (!part) fail_('Respuesta de identidad no válida.');
  const pad = part + '==='.slice((part.length + 3) % 4);
  return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString());
}

/** Enlaces de inicio de sesión (cada uno con un "state" de un solo uso, anti-CSRF). */
function ssoLinks() {
  return run_(function () {
    const out = {}, uri = redirectUri_();
    if (!uri) return out;
    if (prop_('GOOGLE_CLIENT_ID') && prop_('GOOGLE_CLIENT_SECRET')) {
      out.google = 'https://accounts.google.com/o/oauth2/v2/auth?' + qs_({
        client_id: prop_('GOOGLE_CLIENT_ID'), redirect_uri: uri, response_type: 'code',
        scope: 'openid email profile', state: newState_('google'), prompt: 'select_account'
      });
    }
    if (prop_('APPLE_SERVICE_ID') && prop_('APPLE_CLIENT_SECRET')) {
      out.apple = 'https://appleid.apple.com/auth/authorize?' + qs_({
        client_id: prop_('APPLE_SERVICE_ID'), redirect_uri: uri, response_type: 'code',
        response_mode: 'form_post', scope: 'name email', state: newState_('apple')
      });
    }
    return out;
  });
}

/** Procesa la vuelta desde Google/Apple y devuelve un ticket de un solo uso para la página. */
function finishSso_(p) {
  const cache = CacheService.getScriptCache();
  const provider = cache.get('st_' + p.state);
  if (!provider) fail_('El enlace de inicio de sesión venció. Intenta de nuevo.');
  cache.remove('st_' + p.state);
  if (p.error) fail_(p.error === 'access_denied' || p.error === 'user_cancelled_authorize' ? 'Cancelaste el inicio de sesión.' : 'El proveedor rechazó el inicio de sesión.');

  let id;
  if (provider === 'google') {
    const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post', muteHttpExceptions: true,
      payload: { code: p.code, client_id: prop_('GOOGLE_CLIENT_ID'), client_secret: prop_('GOOGLE_CLIENT_SECRET'), redirect_uri: redirectUri_(), grant_type: 'authorization_code' }
    });
    if (r.getResponseCode() !== 200) { console.error(r.getContentText()); fail_('Google no pudo confirmar tu identidad. Intenta de nuevo.'); }
    const c = jwtPayload_(JSON.parse(r.getContentText()).id_token);
    if (c.aud !== prop_('GOOGLE_CLIENT_ID') || !/^(https:\/\/)?accounts\.google\.com$/.test(c.iss)) fail_('Identidad de Google no válida.');
    if (c.email_verified !== true && c.email_verified !== 'true') fail_('Tu correo de Google no está verificado.');
    id = { provider: 'google', sub: String(c.sub), email: String(c.email || '').toLowerCase(), name: c.name || '' };
  } else if (provider === 'apple') {
    const r = UrlFetchApp.fetch('https://appleid.apple.com/auth/token', {
      method: 'post', muteHttpExceptions: true,
      payload: { code: p.code, client_id: prop_('APPLE_SERVICE_ID'), client_secret: prop_('APPLE_CLIENT_SECRET'), redirect_uri: redirectUri_(), grant_type: 'authorization_code' }
    });
    if (r.getResponseCode() !== 200) { console.error(r.getContentText()); fail_('Apple no pudo confirmar tu identidad. Intenta de nuevo.'); }
    const c = jwtPayload_(JSON.parse(r.getContentText()).id_token);
    if (c.aud !== prop_('APPLE_SERVICE_ID') || c.iss !== 'https://appleid.apple.com') fail_('Identidad de Apple no válida.');
    const nm = json_(p.user, {}).name || {};
    id = { provider: 'apple', sub: String(c.sub), email: String(c.email || '').toLowerCase(), name: [nm.firstName, nm.lastName].filter(Boolean).join(' ') };
  } else fail_('Proveedor no válido.');
  if (!id.email) fail_('No recibimos tu correo. Autoriza compartirlo para continuar.');
  return linkOrPending_(id);
}

function linkOrPending_(id) {
  const col = id.provider === 'google' ? 'googleSub' : 'appleSub';
  const ticket = rand_().slice(0, 48), cache = CacheService.getScriptCache();
  const u = withLock_(function () {
    let x = rows_('Users', true).find(function (r) { return r[col] === id.sub; });
    if (!x) {
      x = rows_('Users').find(function (r) { return r.email === id.email; });
      if (x && x.status === 'active') { x[col] = id.sub; x.updatedAt = iso_(); update_('Users', x); }
    }
    if (x && x.status === 'active') { x.lastLogin = iso_(); update_('Users', x); return x; }
    return null;
  });
  cache.put('tk_' + ticket, JSON.stringify(u ? { type: 'session', userId: u.id } : { type: 'pending', identity: id }), 300);
  return ticket;
}

/** La página canjea el ticket por una sesión (o por un registro pendiente de aceptar términos). */
function redeemTicket(ticket) {
  return run_(function () {
    const cache = CacheService.getScriptCache(), k = 'tk_' + String(ticket || '');
    const t = json_(cache.get(k), null);
    if (!t) fail_('Tu inicio de sesión venció. Intenta de nuevo.');
    cache.remove(k);
    if (t.type === 'session') return sessionResult_(userById_(t.userId), true);
    const pid = rand_().slice(0, 40);
    cache.put('pend_' + pid, JSON.stringify(t.identity), 900);
    return { pendingId: pid, pending: { name: t.identity.name, email: t.identity.email, provider: t.identity.provider } };
  });
}

/** Termina el registro de una cuenta nueva creada con Google/Apple (solo falta aceptar términos). */
function completeSsoSignup(pendingId, data) {
  return run_(function () {
    const cache = CacheService.getScriptCache(), k = 'pend_' + String(pendingId || '');
    const id = json_(cache.get(k), null);
    if (!id) fail_('El registro venció. Vuelve a intentarlo con Google o Apple.');
    data = data || {};
    if (data.accept !== true) fail_('Debes declarar que eres mayor de 18 años y aceptar los Términos y la Política de Privacidad.');
    const name = str_(data.name || id.name, { min: 2, max: 60, label: 'Nombre' });
    const u = withLock_(function () {
      const col = id.provider === 'google' ? 'googleSub' : 'appleSub';
      let x = rows_('Users', true).find(function (r) { return r[col] === id.sub || r.email === id.email; });
      if (x) { x[col] = id.sub; update_('Users', x); return x; }
      const o = { email: id.email, name: name, marketingOptIn: String(data.marketing === true) };
      o[col] = id.sub;
      const nu = newUser_(o);
      insert_('Users', nu);
      logSignupConsents_(nu.id, data.marketing);
      insert_('Consents', { id: id_('C'), subject: nu.id, kind: 'signup_' + id.provider, detail: 'true', version: CFG.POLICY_VERSION, createdAt: iso_() });
      return nu;
    });
    cache.remove(k);
    return sessionResult_(u, true);
  });
}

/** Desvincular Google/Apple (solo si la cuenta tiene contraseña u otro método). */
function unlinkProvider(token, provider) {
  return run_(function () {
    const u = auth_(token), col = provider === 'google' ? 'googleSub' : provider === 'apple' ? 'appleSub' : '';
    if (!col) fail_('Proveedor no válido.');
    const other = provider === 'google' ? u.appleSub : u.googleSub;
    if (!u.passHash && !other) fail_('Crea una contraseña antes de desvincular tu único método de acceso.');
    return withLock_(function () { const f = freshUser_(u.id); f[col] = ''; update_('Users', f); return publicUser_(f); });
  });
}

function mailWrap_(inner) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#14243B">' +
    '<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5E6B82">' + esc_(CFG.APP_NAME) + '</p>' + inner +
    '<p style="font-size:12px;color:#5E6B82;margin-top:24px">Pupitre · Desarrollado por estudiantes de la Universidad Santa María</p></div>';
}
