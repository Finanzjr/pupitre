/**
 * Api.gs · Pupitre como API JSON para el frontend en Vercel.
 *
 * El navegador nunca habla con Google directamente: llama a /api/rpc en Vercel, y esa
 * función reenvía la petición a esta implementación (doPost). No hace falta ninguna
 * clave JSON ni cuenta de servicio: el script corre como tú y Vercel solo conoce la URL /exec.
 *
 * Propiedades del script (Configuración del proyecto → Propiedades del script):
 *   FRONTEND_URL      https://tu-proyecto.vercel.app   (sin barra final)
 *   PROXY_KEY         (opcional) una frase secreta; ponla igual en Vercel como PROXY_KEY
 *   SSO_REDIRECT_URI  https://tu-proyecto.vercel.app/api/sso   (solo si usas Google/Apple)
 */

/** Funciones que el frontend puede llamar. Nada fuera de esta lista es accesible. */
const API_FNS_ = [
  'addComment', 'adminMetrics', 'answerRequest', 'changePassword', 'completeSsoSignup', 'conversations',
  'createEvent', 'createGroup', 'createPost', 'createStory', 'deleteEvent', 'deleteMyAccount', 'deletePost',
  'deleteProduct', 'deleteStory', 'events', 'exportMyData', 'follow', 'getConfig', 'getImage', 'getProduct',
  'group', 'groupRequests', 'groups', 'hidePost', 'joinGroup', 'listProducts', 'logConsent', 'login', 'logout',
  'markNotifs', 'me', 'messages', 'myFavorites', 'myProducts', 'notifications', 'openConversation', 'people',
  'redeemTicket', 'register', 'reportPost', 'reportProduct', 'requestPasswordReset', 'resetPassword', 'rsvp',
  'savePost', 'saveProduct', 'sendMessage', 'setProductStatus', 'socialFeed', 'socialPulse', 'ssoLinks',
  'stories', 'toggleFavorite', 'toggleLike', 'unlinkProvider', 'updateProfile', 'updateSocialPrivacy',
  'uploadImage', 'userProfile', 'votePoll', 'ssoCallback'
];

function frontendUrl_() { return String(prop_('FRONTEND_URL') || '').replace(/\/+$/, ''); }

function json_out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** ¿Es una llamada de la API (JSON) y no el regreso de Apple (formulario)? */
function isApiCall_(e) {
  const t = e && e.postData && String(e.postData.type || '');
  return !!t && !/x-www-form-urlencoded|multipart/i.test(t);
}

function apiRoute_(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return json_out_({ ok: false, error: 'Petición no válida.', code: 'BAD' }); }
  const key = prop_('PROXY_KEY');
  if (key && req.k !== key) return json_out_({ ok: false, error: 'Acceso no autorizado.', code: 'FORBIDDEN' });
  const fn = String(req.fn || '');
  if (API_FNS_.indexOf(fn) < 0 || typeof globalThis[fn] !== 'function') return json_out_({ ok: false, error: 'Función no disponible.', code: 'BAD' });
  const args = Array.isArray(req.args) ? req.args.slice(0, 8) : [];
  ensureSetup_();
  return json_out_(globalThis[fn].apply(null, args));
}

/** Vercel (/api/sso) entrega aquí lo que Google o Apple devolvieron y recibe el ticket de sesión. */
function ssoCallback(p) {
  return run_(function () {
    p = p || {};
    if (!p.state || !(p.code || p.error)) fail_('Respuesta de inicio de sesión incompleta.');
    try { return finishSso_({ state: String(p.state), code: p.code ? String(p.code) : '', error: p.error ? String(p.error) : '', user: p.user ? String(p.user) : '' }); }
    catch (x) { if (x && x.userMessage) throw x; console.error(x); fail_('No pudimos iniciar sesión con ese método. Intenta de nuevo.'); }
  });
}

/** Si alguien abre la URL /exec directamente, lo enviamos a la página en Vercel. */
function goFrontend_(query) {
  const url = frontendUrl_() + (query ? '/?' + query : '/');
  const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#14243B;text-align:center">' +
    '<div><p style="margin:0 0 16px">Pupitre ahora vive en su propia dirección.</p>' +
    '<a href="' + safe + '" target="_top" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#1E3A5F;color:#fff;text-decoration:none;font-weight:600">Abrir Pupitre</a></div></div>' +
    '<script>try{window.top.location.replace(' + JSON.stringify(url) + ')}catch(e){}</script>'
  ).setTitle('Pupitre').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}
