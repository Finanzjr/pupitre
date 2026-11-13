'use strict';
/* ═════════════ CONFIG LEGAL (EDITA ESTOS DATOS) ═════════════ */
const LEGAL_OWNER = 'Pupitre (proyecto de marketplace universitario)';
const LEGAL_EMAIL = 'privacidad@tudominio.com';
const LEGAL_CITY  = 'Caracas, Venezuela';

/* ═════════════ UTILIDADES ═════════════ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (n, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const view = $('#view');
const mem = {};
const store = {
  get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch { return mem[k] ?? null; } },
  set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} delete mem[k]; }
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'a' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function ago(iso) {
  const d = (new Date(iso) - Date.now()) / 1000;
  for (const [u, s] of [['year',31536e3],['month',2592e3],['week',604800],['day',86400],['hour',3600],['minute',60]])
    if (Math.abs(d) >= s) return rtf.format(Math.round(d / s), u);
  return 'justo ahora';
}
function money(v, c) {
  v = Number(v);
  if (!v) return 'Gratis';
  const n = v.toLocaleString('es-VE', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return c === 'VES' ? 'Bs. ' + n : '$' + n;
}
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* Llamadas al servidor: nunca se quedan "guindadas" (tiempo límite) y las lecturas se reintentan solas. */
const READS = new Set(['adminMetrics', 'getConfig', 'me', 'listProducts', 'getProduct', 'myProducts', 'myFavorites', 'socialFeed', 'stories', 'groups', 'group', 'events', 'people', 'userProfile', 'conversations', 'messages', 'notifications', 'socialPulse', 'groupRequests', 'getImage', 'ssoLinks']);
const MARKET_W = new Set(['saveProduct', 'deleteProduct', 'setProductStatus', 'toggleFavorite', 'login', 'logout', 'register', 'completeSsoSignup', 'deleteMyAccount']);
const SOCIAL_W = new Set(['createPost', 'deletePost', 'hidePost', 'follow', 'joinGroup', 'createGroup', 'createEvent', 'deleteEvent', 'answerRequest', 'updateSocialPrivacy', 'login', 'logout', 'register', 'completeSsoSignup', 'redeemTicket', 'deleteMyAccount', 'resetPassword']);
const LIST_CACHE = new Map(), LIST_FRESH = new Set(), FEED_CACHE = new Map(), FEED_FRESH = new Set();
const BOOT_CFG = null;
/* Historial del navegador (rutas con #) */
const histNav = (mode, state, hash) => { try { history[mode + 'State'](state, '', hash ? '#' + hash : location.pathname + location.search); } catch {} };
async function callOnce(fn, args, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  let r;
  try {
    const res = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn, args }), signal: ctrl.signal, cache: 'no-store' });
    r = await res.json().catch(() => null);
    if (!r) { const e = new Error('El servidor no respondió correctamente. Intenta de nuevo.'); e.code = 'SERVER'; throw e; }
  } catch (err) {
    if (err.code) throw err;
    const e = new Error(err.name === 'AbortError' ? 'La conexión está lenta. Intenta de nuevo.' : 'Sin conexión. Revisa tu internet.');
    e.code = err.name === 'AbortError' ? 'TIMEOUT' : 'NET';
    throw e;
  } finally { clearTimeout(timer); }
  if (r.ok) return r.data;
  const e = new Error(r.error || 'Error desconocido'); e.code = r.code;
  if (e.code === 'AUTH') onSessionLost();
  throw e;
}
async function api(fn, ...args) {
  const read = READS.has(fn), ms = fn === 'uploadImage' ? 60000 : read ? 20000 : 30000;
  let r;
  try { r = await callOnce(fn, args, ms); }
  catch (e) {
    if (!read || !['NET', 'TIMEOUT', 'SERVER'].includes(e.code)) throw e;
    await new Promise(ok => setTimeout(ok, 700));
    r = await callOnce(fn, args, ms);
  }
  try { gaFromApi(fn, args, r); } catch {}
  if (MARKET_W.has(fn)) LIST_CACHE.clear();
  if (SOCIAL_W.has(fn)) FEED_CACHE.clear();
  return r;
}
/** Sube una foto en segundo plano apenas se elige. */
function startUpload(dataUrl, kind) {
  const job = { dataUrl, id: '', done: false, error: null };
  job.promise = api('uploadImage', getToken(), dataUrl, kind).then(id => { job.id = id; job.done = true; return id; }, e => { job.error = e; job.done = true; throw e; });
  job.promise.catch(() => {});
  return job;
}

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'err' ? ' err' : '');
  el.innerHTML = icon(type === 'err' ? 'alert' : 'check') + `<span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, type === 'err' ? 5200 : 3200);
}
function busy(btn, on) { if (!btn) return; btn.setAttribute('aria-busy', on ? 'true' : 'false'); btn.disabled = !!on; }

/* ═════════════ ESTADO ═════════════ */
const S = {
  cfg: null, user: null, favs: new Set(), route: { name: 'home' }, consent: null,
  filters: { q: '', cat: '', sort: 'recent', min: '', max: '', cond: '', currency: '', page: 1 },
  facets: {}, totalAll: 0
};
const PH_COLORS = { cursos:'var(--lime)', libros:'var(--lilac)', tecnologia:'var(--sky)', accesorios:'var(--tang)', equipos:'var(--mint)', ropa:'var(--lilac)', servicios:'var(--lime)', residencia:'var(--tang)', otros:'var(--sky)' };
const catOf = id => (S.cfg.categories.find(c => c.id === id) || { label: 'Otros', icon: 'sparkles' });
const getToken = () => store.get('pp_session') || store.get('pp_session', true);
function setToken(t, remember) { store.del('pp_session'); if (t) store.set('pp_session', t, !remember); }

/* ═════════════ IMÁGENES (Drive) ═════════════ */
const imgSrc = (id, w = 800) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}`;
const imgTag = (id, alt, w = 800, eager) => `<img src="${imgSrc(id, w)}" data-fid="${esc(id)}" data-w="${w}" alt="${esc(alt)}" ${eager ? '' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer">`;
const phTag = cat => `<div class="ph" style="--c:${PH_COLORS[cat] || 'var(--lime)'}">${icon(catOf(cat).icon)}</div>`;
document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.dataset.fid) return;
  const step = Number(img.dataset.step || 0); img.dataset.step = step + 1;
  if (step === 0) img.src = `https://lh3.googleusercontent.com/d/${img.dataset.fid}=w${img.dataset.w || 800}`;
  else if (step === 1) api('getImage', img.dataset.fid).then(u => { img.src = u; }).catch(() => { img.style.opacity = 0; });
}, true);

/** Re-codifica en el navegador: reduce tamaño y ELIMINA metadatos EXIF/GPS. */
async function compressImage(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) throw new Error(`"${file.name}" no es JPG, PNG o WebP.`);
  if (file.size > 15 * 1024 * 1024) throw new Error(`"${file.name}" pesa más de 15 MB.`);
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`No pudimos leer "${file.name}". Prueba con JPG o PNG.`); }
  const max = 1400, scale = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  let q = .84, type = 'image/webp', url = c.toDataURL(type, q);
  if (!url.startsWith('data:image/webp')) { type = 'image/jpeg'; url = c.toDataURL(type, q); }
  const limit = S.cfg.maxImageBytes * .95;
  while (url.length * .75 > limit && q > .4) { q -= .1; url = c.toDataURL(type, q); }
  if (url.length * .75 > limit) throw new Error(`"${file.name}" sigue siendo muy pesada.`);
  return url;
}

/* ═════════════ ROUTER ═════════════ */
function parseHash(h) {
  const [a, b] = String(h || '').replace(/^#?\/?/, '').split('/');
  switch (a) {
    case 'vender': return { name: 'sell' };
    case 'editar': return { name: 'sell', id: b };
    case 'p': return { name: 'home', product: b };
    case 'perfil': return { name: 'profile', tab: b || 'publicaciones' };
    case 'favoritos': return { name: 'profile', tab: 'favoritos' };
    case 'legal': return { name: 'legal', doc: b || 'privacidad' };
    case 'market': return { name: 'home' };
    case 'grupos': return b ? { name: 'group', id: b } : { name: 'groups' };
    case 'eventos': return { name: 'events' };
    case 'mensajes': return { name: 'messages', id: b };
    case 'u': return { name: 'user', id: b };
    case 'admin': return { name: 'admin' };
    default: return { name: 'feed' };
  }
}
function toHash(r) {
  if (r.name === 'sell') return r.id ? 'editar/' + r.id : 'vender';
  if (r.name === 'profile') return 'perfil/' + (r.tab || 'publicaciones');
  if (r.name === 'legal') return 'legal/' + (r.doc || 'privacidad');
  if (r.name === 'groups') return 'grupos';
  if (r.name === 'group') return 'grupos/' + r.id;
  if (r.name === 'events') return 'eventos';
  if (r.name === 'messages') return 'mensajes' + (r.id ? '/' + r.id : '');
  if (r.name === 'user') return 'u/' + r.id;
  if (r.name === 'admin') return 'admin';
  if (r.product) return 'p/' + r.product;
  return r.name === 'home' ? 'market' : '';
}
function go(r, push = true) {
  const prevName = S.route.name;
  S.route = r;
  if (push) { try { histNav('push', r, toHash(r)); } catch {} }
  render(prevName !== r.name || r.name !== 'home');
}
function navTo(key) {
  if (key === 'home') return go({ name: 'home' });
  if (key === 'feed') return go({ name: 'feed' });
  if (key === 'groups') return go({ name: 'groups' });
  if (key === 'events') return go({ name: 'events' });
  if (key === 'messages') return requireAuth(() => go({ name: 'messages' }), 'Ingresa para ver tus mensajes');
  if (key === 'me') return requireAuth(() => go({ name: 'user', id: S.user.id }));
  if (key === 'publish') return openPublish();
  if (key === 'admin') return requireAuth(() => go({ name: 'admin' }));
  if (key === 'sell') return requireAuth(() => go({ name: 'sell' }), 'Crea tu cuenta para publicar');
  if (key === 'favs') return requireAuth(() => go({ name: 'profile', tab: 'favoritos' }));
  if (key === 'profile') return requireAuth(() => go({ name: 'profile', tab: 'publicaciones' }));
}
function render(full) {
  const r = S.route;
  S.rseq = (S.rseq || 0) + 1;
  trackPage(r);
  $$('.tab').forEach(t => t.removeAttribute('aria-current'));
  clearInterval(SOC.chatTimer);
  const tabKey = (r.name === 'profile' || (r.name === 'user' && S.user && r.id === S.user.id)) ? 'me' : r.name;
  const t = $(`.tab[data-tab="${tabKey}"]`); if (t) t.setAttribute('aria-current', 'page');
  const navKey = r.name === 'group' ? 'groups' : r.name;
  $$('.hdr-nav [data-nav]').forEach(b => b.dataset.nav === navKey ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (r.name === 'home') {
    if (full || !$('#grid')) renderHome();
    if (r.product) openProduct(r.product, false);
  }
  else if (r.name === 'sell') renderSell(r.id);
  else if (r.name === 'profile') renderProfile(r.tab);
  else if (r.name === 'legal') renderLegal(r.doc);
  else if (r.name === 'feed') renderFeed();
  else if (r.name === 'groups') renderGroups();
  else if (r.name === 'group') renderGroup(r.id);
  else if (r.name === 'events') renderEvents();
  else if (r.name === 'messages') renderMessages(r.id);
  else if (r.name === 'user') renderUser(r.id);
  else if (r.name === 'admin') renderAdmin();
  if (full) { window.scrollTo({ top: 0, behavior: 'instant' }); }
}

/* ═════════════ HEADER / USUARIO ═════════════ */
function initials(name) { const p = String(name || '').trim().split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
function renderUserSlot() {
  renderBell(); refreshPulse(); gaUser();
  const slot = $('#userSlot');
  if (!S.user) {
    slot.innerHTML = `<button class="btn btn-ghost" id="loginBtn">${icon('user')}<span class="hide-m">Ingresar</span></button>`;
    $('#loginBtn').onclick = () => openAuth('login');
    return;
  }
  slot.innerHTML = `
    <button class="avatar" id="avatarBtn" aria-haspopup="menu" aria-expanded="false" aria-label="Menú de ${esc(S.user.name)}">${esc(initials(S.user.name))}</button>
    <div class="menu" id="userMenu" role="menu">
      <div class="who"><strong>${esc(S.user.name)}</strong><span>${esc(S.user.university)}</span></div>
      <button role="menuitem" data-m="me">${icon('user')}Mi perfil</button>
      ${S.user.isAdmin ? `<button role="menuitem" data-m="admin">${icon('poll')}Métricas</button>` : ''}
      <button role="menuitem" data-m="publicaciones">${icon('tag')}Mis ventas</button>
      <button role="menuitem" data-m="favoritos">${icon('heart')}Favoritos</button>
      <button role="menuitem" data-m="cuenta">${icon('user')}Mi cuenta</button>
      <button role="menuitem" data-m="privacidad">${icon('shield')}Centro de privacidad</button>
      <button role="menuitem" data-m="logout">${icon('logout')}Cerrar sesión</button>
    </div>`;
  const btn = $('#avatarBtn'), menu = $('#userMenu');
  const close = () => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
  btn.onclick = e => { e.stopPropagation(); const o = menu.classList.toggle('open'); btn.setAttribute('aria-expanded', o); if (o) menu.querySelector('button').focus(); };
  document.addEventListener('click', e => { if (!menu.contains(e.target)) close(); });
  menu.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); btn.focus(); } });
  $$('button', menu).forEach(b => b.onclick = () => { close(); b.dataset.m === 'admin' ? go({ name: 'admin' }) : b.dataset.m === 'logout' ? doLogout() : b.dataset.m === 'me' ? go({ name: 'user', id: S.user.id }) : go({ name: 'profile', tab: b.dataset.m }); });
}
async function doLogout() {
  const t = getToken();
  setToken(null); S.user = null; S.favs.clear(); renderUserSlot();
  toast('Sesión cerrada. ¡Hasta pronto!');
  go({ name: 'feed' });
  if (t) api('logout', t).catch(() => {});
}
function onSessionLost() {
  if (!S.user) return;
  setToken(null); S.user = null; S.favs.clear(); renderUserSlot();
  toast('Tu sesión expiró. Vuelve a ingresar.', 'err');
}
function requireAuth(fn, title) { if (S.user) return fn(); openAuth('login', fn, title); }

/* ═════════════ HOME ═════════════ */
function renderHome() {
  const f = S.filters, cats = S.cfg.categories;
  view.innerHTML = `
  <section class="wrap hero">
    <div>
      <span class="eyebrow"><b>MARKET</b> Compra y vende en tu comunidad</span>
      <h1>Lo que ya no usas, <em>a alguien de tu campus</em> le <u>hace falta</u>.</h1>
      <p class="lead">Vende cursos, apuntes, tecnología y equipos de laboratorio. Compra más barato a gente de tu propia universidad, sin publicar tu correo ni tu número.</p>
      <form class="hero-search" id="heroSearch" role="search">
        ${icon('search')}
        <label class="sr" for="heroQ">¿Qué estás buscando?</label>
        <input id="heroQ" type="search" placeholder="¿Qué necesitas este semestre?" value="${esc(f.q)}" maxlength="80" autocomplete="off">
        <button class="btn btn-primary" type="submit">Buscar</button>
      </form>
      <div class="quick"><span>Lo más buscado:</span>
        ${['Calculadora científica','Bata de laboratorio','Tutorías de Cálculo','Laptop'].map(q => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
      </div>
    </div>
    <div class="hero-art">
      ${[['cursos','s1','Tutorías y cursos','Aprende con quien ya aprobó'],['libros','s2','Apuntes y libros','Resúmenes de verdad'],['tecnologia','s3','Tecnología','Laptops, tablets, calculadoras']]
        .map(([id, cls, t, s]) => `<button class="sticker ${cls}" data-cat="${id}">${icon(catOf(id).icon)}<span class="tag" data-facet="${id}">—</span><div><strong>${t}</strong><small>${s}</small></div></button>`).join('')}
    </div>
  </section>

  <section class="wrap" aria-labelledby="resTitle">
    <div class="cats" role="toolbar" aria-label="Categorías">
      <button class="chip" data-cat="" aria-pressed="${!f.cat}">${icon('sparkles')}Todo<span class="n" id="nAll">—</span></button>
      ${cats.map(c => `<button class="chip" data-cat="${c.id}" aria-pressed="${f.cat === c.id}">${icon(c.icon)}${esc(c.label)}<span class="n" data-facet="${c.id}">0</span></button>`).join('')}
    </div>
    <div class="toolbar">
      <h2 id="resTitle">Recién publicado<span id="resCount"></span></h2>
      <label class="sr" for="sortSel">Ordenar</label>
      <select class="input" id="sortSel">
        <option value="recent">Más recientes</option><option value="price_asc">Menor precio</option>
        <option value="price_desc">Mayor precio</option><option value="popular">Más vistos</option>
      </select>
      <button class="btn btn-ghost" id="filterBtn" aria-expanded="false" aria-controls="filters">${icon('sliders')}Filtros</button>
    </div>
    <form class="filters" id="filters">
      <div class="field"><label for="fMin">Precio mínimo</label><input class="input" id="fMin" type="number" min="0" inputmode="decimal" value="${esc(f.min)}"></div>
      <div class="field"><label for="fMax">Precio máximo</label><input class="input" id="fMax" type="number" min="0" inputmode="decimal" value="${esc(f.max)}"></div>
      <div class="field"><label for="fCond">Estado</label><select class="input" id="fCond"><option value="">Cualquiera</option>${S.cfg.conditions.map(c => `<option ${f.cond === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="fCur">Moneda</label><select class="input" id="fCur"><option value="">Todas</option>${S.cfg.currencies.map(c => `<option ${f.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <button class="btn btn-ghost" type="button" id="fClear">Limpiar</button>
    </form>
    <div id="grid" class="grid" aria-live="polite" aria-busy="true"></div>
    <div id="pager" class="pager"></div>
  </section>

  <section class="wrap how" aria-labelledby="howT">
    <h2 id="howT">Vender en Pupitre toma <em>menos que un recreo.</em></h2>
    <ol class="steps">
      <li><div><h3>Crea tu cuenta</h3><p>Solo tu nombre, tu correo y una contraseña. Únicamente para mayores de 18 años.</p></div></li>
      <li><div><h3>Sube fotos y pon tu precio</h3><p>Hasta ${S.cfg.maxImages} fotos. Las optimizamos y les quitamos la ubicación GPS antes de guardarlas.</p></div></li>
      <li><div><h3>Recibe mensajes sin exponerte</h3><p>Los compradores te escriben por Pupitre y el mensaje te llega al correo. Tú decides si respondes.</p></div></li>
    </ol>
  </section>

  <section class="wrap">
    <div class="trust">
      <div>
        <h2>Tu información es tuya. <em>Punto.</em></h2>
        <p>Diseñamos Pupitre para que compres y vendas sin regalar tus datos. Puedes descargar todo lo que guardamos de ti o borrar tu cuenta cuando quieras.</p>
        <div style="margin-top:22px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-lime" data-legal="privacidad">Leer la política de privacidad</button>
        </div>
      </div>
      <ul>
        <li><strong>${icon('mail')}Correo oculto</strong><span>Nunca se muestra en las publicaciones.</span></li>
        <li><strong>${icon('lock')}Contraseñas cifradas</strong><span>Guardamos solo un hash con sal, nunca la clave real.</span></li>
        <li><strong>${icon('pin')}Sin GPS en fotos</strong><span>Quitamos los metadatos de ubicación al subir.</span></li>
        <li><strong>${icon('download')}Control total</strong><span>Exporta tus datos o elimina tu cuenta en un clic.</span></li>
      </ul>
    </div>
  </section>`;

  $('#sortSel').value = f.sort;
  $('#heroSearch').onsubmit = e => { e.preventDefault(); setFilter({ q: $('#heroQ').value.trim() }); };
  $$('.quick [data-q]').forEach(b => b.onclick = () => { $('#heroQ').value = b.dataset.q; setFilter({ q: b.dataset.q }); });
  $$('[data-cat]', view).forEach(b => b.onclick = () => { setFilter({ cat: b.dataset.cat }); if (b.classList.contains('sticker')) $('#resTitle').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#sortSel').onchange = e => setFilter({ sort: e.target.value });
  const fb = $('#filterBtn'), fp = $('#filters');
  fb.onclick = () => { const o = fp.classList.toggle('open'); fb.setAttribute('aria-expanded', o); };
  const applyF = debounce(() => setFilter({ min: $('#fMin').value, max: $('#fMax').value, cond: $('#fCond').value, currency: $('#fCur').value }), 450);
  $$('input,select', fp).forEach(i => i.addEventListener('input', applyF));
  fp.onsubmit = e => e.preventDefault();
  $('#fClear').onclick = () => { fp.reset(); ['fMin','fMax'].forEach(id => $('#' + id).value = ''); setFilter({ min: '', max: '', cond: '', currency: '' }); };
  if (f.min || f.max || f.cond || f.currency) { fp.classList.add('open'); fb.setAttribute('aria-expanded', 'true'); }
  loadProducts();
}
function setFilter(patch) {
  Object.assign(S.filters, patch, { page: patch.page || 1 });
  if (S.consent?.preferences) store.set('pp_filters', JSON.stringify({ sort: S.filters.sort }));
  if ('q' in patch) { $('#hdrQ').value = S.filters.q; if ($('#heroQ')) $('#heroQ').value = S.filters.q; }
  if (S.route.name !== 'home' || !$('#grid')) { S.route = { name: 'home' }; try { histNav('push', S.route, ''); } catch {} renderHome(); return; }
  $$('.chip[data-cat]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.cat === S.filters.cat)));
  loadProducts();
}
let loadSeq = 0;
async function loadProducts() {
  const grid = $('#grid'); if (!grid) return;
  const seq = ++loadSeq;
  const ck = JSON.stringify(S.filters), cached = LIST_CACHE.get(ck);
  grid.setAttribute('aria-busy', 'true');
  if (!cached) grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skel"><div class="a"></div><div class="b"></div><div class="b"></div></div>').join('');
  $('#pager').innerHTML = '';
  try {
    const r = cached || await api('listProducts', S.filters);
    if (seq !== loadSeq) return;
    LIST_CACHE.set(ck, r);
    if (cached && !LIST_FRESH.delete(ck)) api('listProducts', S.filters).then(x => { if (JSON.stringify(x) !== JSON.stringify(cached)) { LIST_CACHE.set(ck, x); LIST_FRESH.add(ck); if (seq === loadSeq) loadProducts(); } }).catch(() => {});
    S.facets = r.facets; S.totalAll = r.totalAll;
    $$('[data-facet]').forEach(el => { const n = r.facets[el.dataset.facet] || 0; el.textContent = el.classList.contains('tag') ? n + (n === 1 ? ' activo' : ' activos') : n; });
    $('#nAll').textContent = r.totalAll;
    const f = S.filters, cat = f.cat ? catOf(f.cat).label : '';
    $('#resTitle').firstChild.textContent = f.q ? `Resultados para “${f.q}”` : (cat || 'Recién publicado');
    $('#resCount').textContent = `${r.total} ${r.total === 1 ? 'artículo' : 'artículos'}`;
    if (!r.items.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('search')}<h3>${f.q || f.cat ? 'Nada por aquí… todavía' : 'Sé la primera persona en publicar'}</h3>
        <p>${f.q || f.cat ? 'Prueba con otra palabra o quita filtros. También puedes publicar lo que buscas y alguien te escribirá.' : 'Sube algo que ya no uses y estrena el mercado de tu campus.'}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${f.q || f.cat ? '<button class="btn btn-ghost" id="clearAll">Quitar filtros</button>' : ''}<button class="btn btn-primary" data-go="sell">${icon('plus')}Publicar</button></div></div>`;
      $('#clearAll')?.addEventListener('click', () => { $('#heroQ').value = ''; setFilter({ q: '', cat: '', min: '', max: '', cond: '', currency: '' }); });
    } else {
      grid.innerHTML = r.items.map((p, i) => cardHTML(p, i)).join('');
      bindCards(grid);
    }
    if (r.pages > 1) {
      $('#pager').innerHTML = `<button class="btn btn-ghost btn-icon" ${r.page <= 1 ? 'disabled' : ''} data-pg="${r.page - 1}" aria-label="Página anterior">${icon('left')}</button>
        <span>Página ${r.page} de ${r.pages}</span>
        <button class="btn btn-ghost btn-icon" ${r.page >= r.pages ? 'disabled' : ''} data-pg="${r.page + 1}" aria-label="Página siguiente">${icon('right')}</button>`;
      $$('[data-pg]').forEach(b => b.onclick = () => { setFilter({ page: Number(b.dataset.pg) }); $('#resTitle').scrollIntoView({ behavior: 'smooth' }); });
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('alert')}<h3>No pudimos cargar las publicaciones</h3><p>${esc(e.message)}</p><button class="btn btn-primary" id="retry">Reintentar</button></div>`;
    $('#retry').onclick = loadProducts;
  } finally { grid.setAttribute('aria-busy', 'false'); }
}
function cardHTML(p, i = 0) {
  const fav = S.favs.has(p.id);
  return `<article class="card" style="--i:${Math.min(i, 12)}" data-id="${esc(p.id)}">
    <div class="media">
      ${p.cover ? imgTag(p.cover, p.title, 600) : phTag(p.category)}
      <span class="price ${Number(p.price) ? '' : 'free'}">${esc(money(p.price, p.currency))}</span>
      ${p.demo ? '<span class="pill demo">DEMO</span>' : ''}${p.status === 'sold' ? '<span class="pill sold demo">VENDIDO</span>' : ''}
    </div>
    <button class="card-hit" data-open="${esc(p.id)}"><span class="sr">Ver ${esc(p.title)}</span></button>
    <button class="fav" data-fav="${esc(p.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Quitar de' : 'Guardar en'} favoritos">${icon('heart')}</button>
    <div class="card-body">
      <h3>${esc(p.title)}</h3>
      <div class="meta"><span>${esc(shortUni(p.seller.university))}</span><span>${esc(p.condition)}</span></div>
      <div class="meta"><span>${esc(ago(p.createdAt))}</span></div>
    </div>
  </article>`;
}
const shortUni = u => { const m = /\(([^)]+)\)\s*$/.exec(u || ''); return m ? m[1] : (u || ''); };
function bindCards(root) {
  $$('[data-open]', root).forEach(b => b.onclick = () => openProduct(b.dataset.open));
  $$('[data-fav]', root).forEach(b => b.onclick = e => { e.stopPropagation(); toggleFav(b.dataset.fav, b); });
}
async function toggleFav(id, btn) {
  if (!S.user) return openAuth('login', () => toggleFav(id), 'Ingresa para guardar favoritos');
  const was = S.favs.has(id);
  const sync = on => $$(`[data-fav="${CSS.escape(id)}"]`).forEach(b => { b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', (on ? 'Quitar de' : 'Guardar en') + ' favoritos'); });
  was ? S.favs.delete(id) : S.favs.add(id); sync(!was);
  try { const on = await api('toggleFavorite', getToken(), id); on ? S.favs.add(id) : S.favs.delete(id); sync(on); toast(on ? 'Guardado en favoritos' : 'Quitado de favoritos'); }
  catch (e) { was ? S.favs.add(id) : S.favs.delete(id); sync(was); toast(e.message, 'err'); }
}

/* ═════════════ DETALLE DE PRODUCTO ═════════════ */
async function openProduct(id, push = true) {
  const d = $('#dlgProduct');
  if (S.route.name === 'home') {
    S.route = { name: 'home', product: id };
    if (push) { try { histNav('push', S.route, 'p/' + id); } catch {} }
  }
  d.innerHTML = `<div class="dlg-head"><h2 id="pdTitle">Cargando…</h2><button class="btn btn-ghost btn-icon" data-close aria-label="Cerrar">${icon('x')}</button></div><div class="loading" style="min-height:360px"><div class="spinner"></div></div>`;
  bindClose(d); if (!d.open) d.showModal();
  d.onclose = () => { if (S.route.product) { S.route = { name: 'home' }; try { histNav('replace', { name: 'home' }, ''); } catch {} } };
  try {
    const p = await api('getProduct', id, getToken());
    if (p.isFav) S.favs.add(p.id);
    renderProductDlg(p);
  } catch (e) {
    d.querySelector('.loading').outerHTML = `<div class="dlg-body"><div class="empty">${icon('alert')}<h3>Ups</h3><p>${esc(e.message)}</p></div></div>`;
    $('#pdTitle').textContent = 'No disponible';
  }
}
function renderProductDlg(p) {
  const d = $('#dlgProduct'), imgs = p.images || [], fav = S.favs.has(p.id), cat = catOf(p.category);
  let idx = 0;
  const contact = !S.user
    ? `<button class="btn btn-primary" id="pdLogin">${icon('chat')}Ingresa para contactar</button>`
    : p.isOwner ? `<button class="btn btn-primary" id="pdEdit">${icon('edit')}Editar publicación</button>`
    : p.demo ? `<button class="btn btn-primary" disabled>Publicación de demostración</button>`
    : `<button class="btn btn-primary" id="pdMsg" ${p.status === 'sold' || (p.contact && !p.contact.canMessage) ? 'disabled' : ''} ${p.contact && !p.contact.canMessage ? 'title="Esta persona solo recibe mensajes de quienes sigue"' : ''}>${icon('chat')}${p.status === 'sold' ? 'Ya se vendió' : p.contact && !p.contact.canMessage ? 'Mensajes restringidos' : 'Enviar mensaje'}</button>
       ${p.contact?.whatsapp && p.status !== 'sold' ? `<a class="btn btn-lime" target="_blank" rel="noopener noreferrer" href="https://wa.me/${esc(p.contact.whatsapp)}?text=${encodeURIComponent('Hola! Vi tu publicación "' + p.title + '" en Pupitre')}">${icon('chat')}WhatsApp</a>` : ''}`;
  d.innerHTML = `
    <div class="dlg-head">
      <h2 id="pdTitle" class="sr">${esc(p.title)}</h2>
      <span class="pill">${icon(cat.icon, 'ico')}${esc(cat.label)}</span>
      ${p.status === 'sold' ? '<span class="pill sold">Vendido</span>' : ''}${p.demo ? '<span class="pill" style="background:#14243B;color:var(--lime)">DEMO</span>' : ''}
      <span style="margin-right:auto"></span>
      <button class="btn btn-ghost btn-icon" id="pdShare" aria-label="Copiar enlace">${icon('share')}</button>
      <button class="btn btn-ghost btn-icon" data-close aria-label="Cerrar">${icon('x')}</button>
    </div>
    <div class="dlg-body pd">
      <div>
        <div class="gal-main" id="galMain">${imgs.length ? imgTag(imgs[0], p.title, 1200, true) : phTag(p.category)}
          ${imgs.length > 1 ? `<button class="gal-nav prev" aria-label="Foto anterior">${icon('left')}</button><button class="gal-nav next" aria-label="Foto siguiente">${icon('right')}</button>` : ''}
        </div>
        ${imgs.length > 1 ? `<div class="thumbs-row">${imgs.map((f, i) => `<button data-i="${i}" aria-current="${i === 0}" aria-label="Foto ${i + 1}">${imgTag(f, '', 160)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="pd-info">
        <div><h1 aria-hidden="true">${esc(p.title)}</h1><p class="meta" style="margin-top:8px"><span>Publicado ${esc(ago(p.createdAt))}</span><span>${p.views} vistas</span></p></div>
        <div class="pd-price">${esc(money(p.price, p.currency))}</div>
        <div class="actions">${contact}
          <button class="btn btn-ghost btn-icon fav" style="position:static;box-shadow:none" data-fav="${esc(p.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Quitar de' : 'Guardar en'} favoritos">${icon('heart')}</button>
        </div>
        <dl class="facts">
          <div><dt>Estado</dt><dd>${esc(p.condition)}</dd></div>
          <div><dt>Moneda</dt><dd>${esc(p.currency)}</dd></div>
          ${p.campus ? `<div style="grid-column:1/-1"><dt>Entrega en</dt><dd>${esc(p.campus)}</dd></div>` : ''}
        </dl>
        <div><h3 style="font-size:18px;margin-bottom:8px">Descripción</h3><p class="pd-desc">${esc(p.description)}</p></div>
        <div class="seller" data-act="uid" data-id="${esc(p.seller.id || '')}" style="cursor:pointer" title="Ver perfil"><span class="avatar">${esc(p.seller.initials)}</span><div><strong>${esc(p.seller.firstName)}</strong><small>${[p.seller.university, p.seller.memberSince ? 'en Pupitre desde ' + fmtMonth(p.seller.memberSince) : '', p.seller.listings + (p.seller.listings === 1 ? ' activo' : ' activos')].filter(Boolean).map(esc).join(' · ')}</small></div></div>
        <p class="safety">${icon('shield')}<span>Reúnete en un lugar público del campus, revisa el artículo antes de pagar y nunca adelantes dinero ni compartas códigos de verificación.</span></p>
        ${!p.isOwner && S.user ? `<button class="link" id="pdReport" style="justify-self:start;color:var(--ink-3)">${'Reportar esta publicación'}</button>` : ''}
      </div>
    </div>`;
  bindClose(d);
  const show = i => {
    if (!imgs.length) return;
    idx = (i + imgs.length) % imgs.length;
    const img = $('#galMain img'); img.dataset.step = 0; img.dataset.fid = imgs[idx]; img.src = imgSrc(imgs[idx], 1200);
    $$('.thumbs-row button', d).forEach((b, j) => b.setAttribute('aria-current', j === idx));
  };
  $$('.thumbs-row button', d).forEach(b => b.onclick = () => show(+b.dataset.i));
  d.querySelector('.gal-nav.prev')?.addEventListener('click', () => show(idx - 1));
  d.querySelector('.gal-nav.next')?.addEventListener('click', () => show(idx + 1));
  d.onkeydown = e => { if (imgs.length > 1 && e.target.tagName !== 'TEXTAREA') { if (e.key === 'ArrowLeft') show(idx - 1); if (e.key === 'ArrowRight') show(idx + 1); } };
  $('[data-fav]', d).onclick = e => toggleFav(p.id, e.currentTarget);
  $('#pdLogin')?.addEventListener('click', () => openAuth('login', () => openProduct(p.id, false), 'Ingresa para contactar al vendedor'));
  $('#pdEdit')?.addEventListener('click', () => { d.close(); go({ name: 'sell', id: p.id }); });
  const lead = method => track('generate_lead', { currency: p.currency, value: Number(p.price) || 0, method, item_id: p.id, item_category: p.category });
  $('#pdMsg')?.addEventListener('click', () => { lead('mensaje'); d.close(); go({ name: 'messages', id: p.seller.id }); });
  d.querySelector('a[href^="https://wa.me"]')?.addEventListener('click', () => lead('whatsapp'));
  $('#pdReport')?.addEventListener('click', () => reportFlow(p));
  $('#pdShare').onclick = async () => {
    const url = (S.cfg.url || '') + '#p/' + p.id;
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
    catch { await confirmDlg({ title: 'Copia este enlace', body: `<input class="input" readonly value="${esc(url)}" onfocus="this.select()">`, ok: 'Listo', noCancel: true }); }
  };
}
const fmtMonth = ym => { const [y, m] = String(ym).split('-'); return new Date(+y, (+m || 1) - 1, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' }); };

function openContact(p) {
  const d = $('#dlgContact');
  d.innerHTML = `
    <div class="dlg-head"><h2 id="ctTitle">Escribe a ${esc(p.seller.firstName)}</h2><button class="btn btn-ghost btn-icon" data-close aria-label="Cerrar">${icon('x')}</button></div>
    <form class="dlg-body form" id="ctForm" novalidate>
      <p class="hint">Sobre «${esc(p.title)}». Tu mensaje le llegará por correo; su dirección nunca se te muestra.</p>
      <div class="field"><label for="ctMsg">Mensaje</label>
        <textarea class="input" id="ctMsg" maxlength="1000" required>Hola ${esc(p.seller.firstName)}, me interesa «${esc(p.title)}». ¿Sigue disponible? ¿Dónde podríamos vernos?</textarea>
        <span class="hint count" id="ctCount"></span><span class="ferr" id="ctErr"></span></div>
      <label class="check"><input type="checkbox" id="ctOk" required><span>Autorizo que Pupitre comparta mi correo con esta persona <b>solo</b> para que pueda responderme.</span></label>
      <div class="notice">${icon('shield')}<span>No compartas datos bancarios ni códigos por mensaje. Paga al recibir el artículo.</span></div>
      <button class="btn btn-primary btn-block" type="submit">${icon('mail')}Enviar mensaje</button>
    </form>`;
  bindClose(d); d.showModal();
  const ta = $('#ctMsg'), cnt = () => $('#ctCount').textContent = `${ta.value.length}/1000`; ta.oninput = cnt; cnt();
  $('#ctForm').onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter || $('#ctForm button[type=submit]');
    if (ta.value.trim().length < 5) { $('#ctErr').textContent = 'Escribe un mensaje un poco más largo.'; ta.focus(); return; }
    if (!$('#ctOk').checked) { $('#ctErr').textContent = 'Necesitamos tu autorización para compartir tu correo con el vendedor.'; return; }
    busy(btn, true);
    try { await api('contactSeller', getToken(), p.id, ta.value, true); d.close(); toast('¡Mensaje enviado! Te responderán a tu correo.'); }
    catch (err) { $('#ctErr').textContent = err.message; }
    finally { busy(btn, false); }
  };
}
async function reportFlow(p) {
  const reason = await confirmDlg({
    title: 'Reportar publicación',
    body: `<p class="hint" style="margin-bottom:12px">Revisamos cada reporte. Con ${3} reportes la publicación se pausa automáticamente.</p>
      <div class="field"><label for="cfIn">Motivo</label><select class="input" id="cfIn">
      <option>Artículo prohibido o ilegal</option><option>Infringe derechos de autor o marca</option><option>Parece una estafa</option><option>Contenido ofensivo</option>
      <option>Venta de trabajos académicos para entregar (plagio)</option><option>Datos personales de otra persona</option><option>Otro</option></select></div>`,
    ok: 'Enviar reporte', danger: true, input: true
  });
  if (!reason) return;
  try { await api('reportProduct', getToken(), p.id, reason); toast('Gracias. Revisaremos la publicación.'); }
  catch (e) { toast(e.message, 'err'); }
}

/* ═════════════ AUTENTICACIÓN ═════════════ */
function openAuth(mode = 'login', after, title) {
  const d = $('#dlgAuth');
  const unis = S.cfg.universities.map(u => `<option value="${esc(u)}">`).join('');
  d.innerHTML = `
    <div class="dlg-head"><h2 id="authTitle">${esc(title || (mode === 'login' ? 'Qué bueno verte' : 'Únete a Pupitre'))}</h2><button class="btn btn-ghost btn-icon" data-close aria-label="Cerrar">${icon('x')}</button></div>
    <div class="dlg-body">
      <div class="tabs" role="tablist">
        <button role="tab" id="tabL" aria-selected="${mode === 'login'}" aria-controls="fLogin">Ingresar</button>
        <button role="tab" id="tabR" aria-selected="${mode !== 'login'}" aria-controls="fReg">Crear cuenta</button>
      </div>
      <div class="sso" id="ssoBox" hidden>
        <a class="btn btn-sso" id="ssoGoogle" data-p="google" href="#" target="_top" aria-disabled="true" hidden><span class="mark" aria-hidden="true">G</span>Continuar con Google</a>
        <a class="btn btn-sso apple" id="ssoApple" data-p="apple" href="#" target="_top" aria-disabled="true" hidden>Continuar con Apple</a>
        <div class="or"><span id="ssoOr">o con tu correo</span></div>
      </div>
      <form class="form" id="fLogin" role="tabpanel" aria-labelledby="tabL" ${mode !== 'login' ? 'hidden' : ''} novalidate>
        <div class="field"><label for="lEmail">Correo</label><input class="input" id="lEmail" type="email" autocomplete="email" required maxlength="120"></div>
        <div class="field"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><label for="lPass" class="lbl">Contraseña</label><button type="button" class="link" id="forgotBtn" style="font-size:14px">¿Olvidaste tu contraseña?</button></div><input class="input" id="lPass" type="password" autocomplete="current-password" required maxlength="128"></div>
        <label class="check"><input type="checkbox" id="lRemember" checked><span>Mantener la sesión iniciada en este dispositivo (14 días)</span></label>
        <span class="ferr" id="lErr" role="alert"></span>
        <button class="btn btn-primary btn-block" type="submit">Ingresar</button>
      </form>
      <form class="form" id="fReset" hidden novalidate aria-labelledby="authTitle">
        <p class="hint" id="rsIntro">Escribe el correo con el que te registraste. Te enviaremos un código de 6 dígitos para crear una contraseña nueva.</p>
        <div class="field"><label for="rsEmail">Correo</label><input class="input" id="rsEmail" type="email" autocomplete="email" maxlength="120"></div>
        <div id="rsStep2" hidden class="form">
          <div class="field"><label for="rsCode">Código de verificación</label><input class="input" id="rsCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" style="letter-spacing:.4em;font-weight:600;font-size:20px"><span class="hint">Vence en 15 minutos. Revisa también la carpeta de spam.</span></div>
          <div class="field"><label for="rsPass">Nueva contraseña</label><input class="input" id="rsPass" type="password" autocomplete="new-password" maxlength="128"><span class="hint">8+ caracteres con letras y números.</span></div>
        </div>
        <span class="ferr" id="rsErr" role="alert"></span>
        <button class="btn btn-primary btn-block" type="submit" id="rsSubmit">Enviarme el código</button>
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <button type="button" class="link" id="rsBack" style="display:inline-flex;align-items:center;gap:4px">${icon('left')}Volver a ingresar</button>
          <button type="button" class="link" id="rsResend" hidden>Reenviar código</button>
        </div>
      </form>
      <form class="form" id="fReg" role="tabpanel" aria-labelledby="tabR" ${mode === 'login' ? 'hidden' : ''} novalidate>
        <div class="field"><label for="rName">Nombre y apellido</label><input class="input" id="rName" autocomplete="name" required maxlength="60"><span class="hint">Solo mostramos tu nombre de pila.</span></div>
        <div class="field"><label for="rEmail">Correo</label><input class="input" id="rEmail" type="email" autocomplete="email" required maxlength="120"><span class="hint">Nunca se publica. Mejor si es el de tu universidad.</span></div>
        <div class="field"><label for="rPass">Contraseña</label><input class="input" id="rPass" type="password" autocomplete="new-password" required minlength="8" maxlength="128">
          <div class="meter" aria-hidden="true"><i id="pwBar"></i></div><span class="hint" id="pwHint">Mínimo 8 caracteres con letras y números.</span></div>
        <div class="field"><label for="rPhone">WhatsApp <span class="opt">(opcional)</span></label><input class="input" id="rPhone" type="tel" autocomplete="tel" placeholder="+58 412 000 0000" maxlength="20"></div>
        <label class="check"><input type="checkbox" id="rShowPhone"><span>Mostrar mi WhatsApp solo a usuarios registrados que vean mis publicaciones.</span></label>
        <fieldset class="consents" style="margin:0">
          <legend class="sr">Aceptación de políticas</legend>
          <label class="check"><input type="checkbox" id="cAccept" required><span>Declaro ser mayor de 18 años y acepto los <button type="button" class="link" data-legal-open="terminos">Términos</button> y la <button type="button" class="link" data-legal-open="privacidad">Política de Privacidad</button>.</span></label>
          <label class="check"><input type="checkbox" id="cMarketing"><span>Quiero recibir novedades y ofertas de Pupitre <span class="opt">(opcional)</span>.</span></label>
        </fieldset>
        <span class="ferr" id="rErr" role="alert"></span>
        <button class="btn btn-primary btn-block" type="submit">Crear mi cuenta</button>
      </form>
    </div>`;
  bindClose(d);
  if (!d.open) d.showModal();
  const switchTab = m => {
    $('.tabs', d).hidden = false; $('#fReset').hidden = true; $('#ssoBox').hidden = !$('#ssoBox').dataset.ok;
    $('#tabL').setAttribute('aria-selected', m === 'login'); $('#tabR').setAttribute('aria-selected', m !== 'login');
    $('#fLogin').hidden = m !== 'login'; $('#fReg').hidden = m === 'login';
    $('#authTitle').textContent = title || (m === 'login' ? 'Qué bueno verte' : 'Únete a Pupitre');
    (m === 'login' ? $('#lEmail') : $('#rName')).focus();
  };
  $('#tabL').onclick = () => switchTab('login'); $('#tabR').onclick = () => switchTab('reg');
  $$('[role=tab]', d).forEach(t => t.onkeydown = e => { if (['ArrowLeft','ArrowRight'].includes(e.key)) { const o = t.id === 'tabL' ? 'reg' : 'login'; switchTab(o); $(o === 'login' ? '#tabL' : '#tabR').focus(); } });
  $$('[data-legal-open]', d).forEach(b => b.onclick = e => { e.preventDefault(); d.close(); go({ name: 'legal', doc: b.dataset.legalOpen }); });


  /* Recuperar contraseña: paso 1 pide código, paso 2 lo valida y crea la nueva clave */
  let rsStep = 1;
  $('#forgotBtn').onclick = () => {
    $('.tabs', d).hidden = true; $('#ssoBox').hidden = true; $('#fLogin').hidden = true; $('#fReg').hidden = true; $('#fReset').hidden = false;
    $('#authTitle').textContent = 'Recupera tu acceso';
    $('#rsEmail').value = $('#lEmail').value.trim(); $('#rsEmail').focus();
  };
  $('#rsBack').onclick = () => { rsStep = 1; $('#rsStep2').hidden = true; $('#rsResend').hidden = true; $('#rsEmail').disabled = false; $('#rsSubmit').textContent = 'Enviarme el código'; $('#rsErr').textContent = ''; switchTab('login'); };
  const sendCode = async btn => {
    const em = $('#rsEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(em)) { $('#rsErr').textContent = 'Escribe un correo válido.'; $('#rsEmail').focus(); return; }
    busy(btn, true); $('#rsErr').textContent = '';
    try {
      const r = await api('requestPasswordReset', em);
      rsStep = 2; $('#rsStep2').hidden = false; $('#rsResend').hidden = false; $('#rsEmail').disabled = true;
      $('#rsIntro').textContent = `Si ${em} tiene una cuenta, te llegó un código de 6 dígitos. Escríbelo abajo junto con tu nueva contraseña.`;
      $('#rsSubmit').textContent = 'Cambiar contraseña e ingresar';
      if (r && r.demoCode) toast('Demo: tu código es ' + r.demoCode);
      $('#rsCode').focus();
    } catch (x) { $('#rsErr').textContent = x.message; }
    finally { busy(btn, false); }
  };
  $('#rsResend').onclick = e => sendCode(e.currentTarget);
  $('#fReset').onsubmit = async e => {
    e.preventDefault(); const btn = $('#rsSubmit');
    if (rsStep === 1) return sendCode(btn);
    const code = $('#rsCode').value.trim(), pw = $('#rsPass').value;
    if (!/^\d{6}$/.test(code)) { $('#rsErr').textContent = 'El código tiene 6 dígitos.'; $('#rsCode').focus(); return; }
    if (pw.length < 8 || !/[a-z]/i.test(pw) || !/\d/.test(pw)) { $('#rsErr').textContent = 'Contraseña: 8+ caracteres con letras y números.'; $('#rsPass').focus(); return; }
    busy(btn, true); $('#rsErr').textContent = '';
    try { const res = await api('resetPassword', $('#rsEmail').value.trim(), code, pw); done(res, true); toast('Contraseña actualizada'); }
    catch (x) { $('#rsErr').textContent = x.message; }
    finally { busy(btn, false); }
  };

  $('#rPass').oninput = e => {
    const v = e.target.value; let s = 0;
    if (v.length >= 8) s++; if (v.length >= 12) s++; if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^\w\s]/.test(v)) s++;
    const bar = $('#pwBar'); bar.style.width = (s / 5 * 100) + '%';
    bar.style.background = s < 3 ? 'var(--err)' : s < 4 ? 'var(--warn)' : 'var(--ok)';
    $('#pwHint').textContent = ['Muy débil','Débil','Aceptable','Buena','Fuerte','Excelente'][s];
  };

  const done = (res, remember) => {
    setToken(res.token, remember); S.user = res.user; S.favs = new Set(res.favs || []);
    renderUserSlot(); d.close();
    toast(`¡Hola, ${res.user.name.split(' ')[0]}!`);
    if (S.consent) api('logConsent', getAnon(), S.consent, res.token).catch(() => {});
    if (after) after(); else render(true);
  };
  $('#fLogin').onsubmit = async e => {
    e.preventDefault(); const btn = $('#fLogin button[type=submit]'), err = $('#lErr'); err.textContent = '';
    const em = $('#lEmail').value.trim(), pw = $('#lPass').value;
    if (!em || !pw) { err.textContent = 'Completa tu correo y contraseña.'; return; }
    busy(btn, true);
    try { done(await api('login', em, pw, $('#lRemember').checked), $('#lRemember').checked); }
    catch (x) { err.textContent = x.message; $('#lPass').select(); }
    finally { busy(btn, false); }
  };
  $('#fReg').onsubmit = async e => {
    e.preventDefault(); const btn = $('#fReg button[type=submit]'), err = $('#rErr'); err.textContent = '';
    const fields = [['rName', v => v.length >= 2, 'Escribe tu nombre.'], ['rEmail', v => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v), 'Correo no válido.'], ['rPass', v => v.length >= 8 && /[a-z]/i.test(v) && /\d/.test(v), 'Contraseña: 8+ caracteres con letras y números.']];
    for (const [id, ok, msg] of fields) { const el = $('#' + id); const good = ok(el.value.trim()); el.setAttribute('aria-invalid', !good); if (!good) { err.textContent = msg; el.focus(); return; } }
    const consents = { accept: $('#cAccept').checked, marketing: $('#cMarketing').checked };
    if (!consents.accept) { err.textContent = 'Para crear tu cuenta debes declarar que eres mayor de 18 años y aceptar los Términos y la Política de Privacidad.'; $('#cAccept').focus(); return; }
    busy(btn, true);
    try {
      done(await api('register', { name: $('#rName').value, email: $('#rEmail').value, password: $('#rPass').value, phone: $('#rPhone').value, showPhone: $('#rShowPhone').checked, consents }), true);
    } catch (x) { err.textContent = x.message; }
    finally { busy(btn, false); }
  };
  setTimeout(() => (mode === 'login' ? $('#lEmail') : $('#rName')).focus(), 60);
  loadSso(d);
}
async function loadSso(d) {
  const box = $('#ssoBox', d), cfg = (S.cfg && S.cfg.sso) || {};
  if (!cfg.google && !cfg.apple) return;
  box.dataset.ok = '1'; box.hidden = !$('#fReset', d).hidden;
  const g = $('#ssoGoogle', d), a = $('#ssoApple', d);
  g.hidden = !cfg.google; a.hidden = !cfg.apple;
  try {
    const l = await api('ssoLinks');
    if (l.google) { g.href = l.google; g.removeAttribute('aria-disabled'); }
    if (l.apple) { a.href = l.apple; a.removeAttribute('aria-disabled'); }
  } catch (x) { toast('No pudimos preparar el acceso rápido. Usa tu correo.', 'err'); }
  [g, a].forEach(x => x.onclick = async e => {
    if (x.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
    if (x.getAttribute('href').startsWith('#demo')) {
      e.preventDefault(); busy(x, true);
      try { const tk = await api('demoSso', x.dataset.p); d.close(); await handleTicket(tk); render(true); }
      catch (err) { toast(err.message, 'err'); } finally { busy(x, false); }
      return;
    }
    x.setAttribute('aria-busy', 'true');
  });
}
async function handleTicket(ticket) {
  try {
    const r = await api('redeemTicket', ticket);
    if (r.token) { setToken(r.token, true); S.user = r.user; S.favs = new Set(r.favs || []); renderUserSlot(); toast(`¡Hola, ${r.user.name.split(' ')[0]}!`); return true; }
    if (r.pendingId) openSsoComplete(r.pendingId, r.pending);
  } catch (e) { toast(e.message, 'err'); }
  return false;
}
function openSsoComplete(pid, info) {
  const prov = info.provider === 'apple' ? 'Apple' : 'Google';
  const legal = doc => S.cfg.url ? `<a class="link" href="${esc(S.cfg.url)}#legal/${doc}" target="_blank" rel="noopener">` : `<a class="link" href="#" onclick="return false">`;
  const d = formDlg('Un último paso', `
    <div class="notice">${icon('check')}<span>${prov} confirmó tu correo <b>${esc(info.email)}</b>. Nunca se publica.</span></div>
    <div class="field"><label for="ssName">Nombre y apellido</label><input class="input" id="ssName" name="name" maxlength="60" value="${esc(info.name || '')}" required><span class="hint">Solo mostramos tu nombre de pila.</span></div>
    <label class="check"><input type="checkbox" name="accept"><span>Declaro ser mayor de 18 años y acepto los ${legal('terminos')}Términos</a> y la ${legal('privacidad')}Política de Privacidad</a>.</span></label>
    <label class="check"><input type="checkbox" name="marketing"><span>Quiero recibir novedades de Pupitre <span class="opt">(opcional)</span>.</span></label>`,
    'Crear mi cuenta', async fd => {
      if (!fd.get('accept')) throw new Error('Para crear tu cuenta debes declarar que eres mayor de 18 años y aceptar los Términos y la Política de Privacidad.');
      const r = await api('completeSsoSignup', pid, { name: fd.get('name'), accept: true, marketing: !!fd.get('marketing') });
      setToken(r.token, true); S.user = r.user; S.favs = new Set(r.favs || []);
      d.close(); renderUserSlot(); toast(`¡Bienvenida/o a Pupitre, ${r.user.name.split(' ')[0]}!`); render(true);
    });
}

/* ═════════════ VENDER / EDITAR ═════════════ */
let SELL = null;
async function renderSell(id) {
  if (!S.user) return openAuth('login', () => go({ name: 'sell', id }), 'Crea tu cuenta para publicar');
  view.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  let p = null;
  const rs = S.rseq;
  if (id) {
    try { p = await api('getProduct', id, getToken()); if (!p.isOwner) throw new Error('No puedes editar esta publicación.'); }
    catch (e) { view.innerHTML = `<div class="wrap"><div class="empty" style="margin-block:60px">${icon('alert')}<h3>No disponible</h3><p>${esc(e.message)}</p><button class="btn btn-primary" data-go="home">Volver</button></div></div>`; return; }
  }
  if (rs !== S.rseq) return;
  SELL = { id: p?.id || '', images: (p?.images || []).map(f => ({ id: f, key: f })), dirty: false };
  const c = S.cfg;
  view.innerHTML = `
  <div class="wrap">
    <div class="page-head"><div><h1>${p ? 'Edita tu publicación' : 'Publica en 2 minutos'}</h1><p>Fotos claras, un título que diga exactamente qué es y un precio justo. Así vendes más rápido.</p></div></div>
    <form class="sell" id="sellForm" novalidate>
      <div>
        <section class="box" aria-labelledby="s1">
          <h2 id="s1"><b>1</b>Fotos</h2>
          <label class="drop" id="drop" tabindex="0">
            ${icon('image')}<strong>Arrastra tus fotos o haz clic para elegir</strong>
            <span class="hint">Hasta ${c.maxImages} fotos · JPG, PNG o WebP · la primera es la portada</span>
            <input type="file" id="fileIn" accept="image/jpeg,image/png,image/webp,image/heic" multiple class="sr">
          </label>
          <div class="thumbs" id="thumbs"></div>
          <span class="ferr" id="eImages"></span>
        </section>
        <section class="box" aria-labelledby="s2">
          <h2 id="s2"><b>2</b>Detalles</h2>
          <div class="field"><label for="sTitle">Título</label><input class="input" id="sTitle" maxlength="80" required placeholder="Ej: Calculadora Casio fx-991 con estuche"><span class="hint count" id="cTitle"></span><span class="ferr" id="eTitle"></span></div>
          <div class="row2">
            <div class="field"><label for="sCat">Categoría</label><select class="input" id="sCat" required><option value="">Elige una…</option>${c.categories.map(x => `<option value="${x.id}">${esc(x.label)}</option>`).join('')}</select><span class="ferr" id="eCat"></span></div>
            <div class="field"><label for="sCond">Estado</label><select class="input" id="sCond" required><option value="">Elige…</option>${c.conditions.map(x => `<option>${esc(x)}</option>`).join('')}</select><span class="ferr" id="eCond"></span></div>
          </div>
          <div class="field"><label for="sDesc">Descripción</label><textarea class="input" id="sDesc" maxlength="2000" required placeholder="Cuenta cómo está, qué incluye, por qué lo vendes y cómo se entrega. No incluyas tu número ni tu correo aquí."></textarea><span class="hint count" id="cDesc"></span><span class="ferr" id="eDesc"></span></div>
        </section>
        <section class="box" aria-labelledby="s3">
          <h2 id="s3"><b>3</b>Precio y entrega</h2>
          <div class="field"><label for="sPrice">Precio</label>
            <div class="price-in"><label class="sr" for="sCur">Moneda</label><select class="input" id="sCur">${c.currencies.map(x => `<option>${x}</option>`).join('')}</select>
            <input class="input" id="sPrice" type="number" min="0" step="0.01" inputmode="decimal" required placeholder="0 = gratis"></div><span class="ferr" id="ePrice"></span></div>
          <div class="field"><label for="sCampus">Campus o zona de entrega <span class="opt">(opcional)</span></label><input class="input" id="sCampus" maxlength="80" placeholder="Ej: Biblioteca central, Facultad de Ingeniería"><span class="hint">Evita direcciones exactas de tu casa.</span></div>
        </section>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:22px">
          <button class="btn btn-primary" type="submit" id="sSubmit">${icon('check')}${p ? 'Guardar cambios' : 'Publicar ahora'}</button>
          <button class="btn btn-ghost" type="button" id="sCancel">Cancelar</button>
        </div>
      </div>
      <aside>
        <div class="preview"><p class="lbl" style="margin-bottom:10px">Así se verá</p><div id="preview"></div></div>
        <div class="notice">${icon('shield')}<span>Quitamos la ubicación GPS y otros metadatos de tus fotos antes de subirlas. Tu correo nunca aparece en la publicación.</span></div>
      </aside>
    </form>
  </div>`;
  if (p) { $('#sTitle').value = p.title; $('#sCat').value = p.category; $('#sCond').value = p.condition; $('#sDesc').value = p.description; $('#sPrice').value = p.price; $('#sCur').value = p.currency; $('#sCampus').value = p.campus || ''; }
  const upd = () => { SELL.dirty = true; $('#cTitle').textContent = `${$('#sTitle').value.length}/80`; $('#cDesc').textContent = `${$('#sDesc').value.length}/2000`; renderPreview(); };
  $$('#sellForm input, #sellForm select, #sellForm textarea').forEach(el => el.addEventListener('input', upd));
  $('#sCat').addEventListener('change', () => { if (['cursos','servicios'].includes($('#sCat').value) && !$('#sCond').value) $('#sCond').value = 'No aplica (servicio)'; upd(); });
  upd(); SELL.dirty = false; renderThumbs();

  const drop = $('#drop'), fin = $('#fileIn');
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fin.click(); } };
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  fin.onchange = () => { addFiles(fin.files); fin.value = ''; };
  $('#sCancel').onclick = async () => { if (!SELL.dirty || await confirmDlg({ title: '¿Descartar cambios?', body: '<p>Perderás lo que has escrito.</p>', ok: 'Descartar', danger: true })) go(SELL.id ? { name: 'profile', tab: 'publicaciones' } : { name: 'home' }); };
  $('#sellForm').onsubmit = submitSell;
}
async function addFiles(list) {
  const files = [...list].filter(f => f.type.startsWith('image/'));
  const room = S.cfg.maxImages - SELL.images.length;
  $('#eImages').textContent = '';
  if (!files.length) return;
  if (files.length > room) $('#eImages').textContent = room > 0 ? `Solo caben ${room} foto(s) más.` : `Máximo ${S.cfg.maxImages} fotos.`;
  for (const f of files.slice(0, Math.max(0, room))) {
    const key = uid(); SELL.images.push({ key, busy: true }); renderThumbs();
    try {
      const dataUrl = await compressImage(f), item = SELL.images.find(x => x.key === key);
      if (item) {
        Object.assign(item, { dataUrl, busy: false, job: startUpload(dataUrl, 'product') });
        item.job.promise.then(() => renderThumbs(), () => { renderThumbs(); $('#eImages').textContent = 'No se pudo subir una foto. Quítala e inténtalo de nuevo.'; });
      }
    }
    catch (e) { SELL.images = SELL.images.filter(x => x.key !== key); $('#eImages').textContent = e.message; }
    SELL.dirty = true; renderThumbs(); renderPreview();
  }
}
function renderThumbs() {
  const box = $('#thumbs'); if (!box) return;
  box.innerHTML = SELL.images.map((im, i) => `
    <div class="thumb ${im.busy ? 'busy' : ''} ${im.job && !im.job.done ? 'up' : ''} ${im.job && im.job.error ? 'fail' : ''}">
      ${im.busy ? '<div class="loading" style="min-height:100%"><div class="spinner"></div></div>' : im.id ? imgTag(im.id, 'Foto ' + (i + 1), 300) : `<img src="${im.dataUrl}" alt="Foto ${i + 1}">`}
      ${i === 0 && !im.busy ? '<span class="cover">Portada</span>' : ''}
      ${im.busy ? '' : `<div class="ctl">${i > 0 ? `<button type="button" data-cover="${i}" aria-label="Usar como portada">${icon('star')}</button>` : '<span></span>'}<button type="button" data-rm="${i}" aria-label="Quitar foto ${i + 1}">${icon('trash')}</button></div>`}
    </div>`).join('');
  $$('[data-rm]', box).forEach(b => b.onclick = () => { SELL.images.splice(+b.dataset.rm, 1); SELL.dirty = true; renderThumbs(); renderPreview(); });
  $$('[data-cover]', box).forEach(b => b.onclick = () => { const [x] = SELL.images.splice(+b.dataset.cover, 1); SELL.images.unshift(x); SELL.dirty = true; renderThumbs(); renderPreview(); });
  $('#drop').style.display = SELL.images.length >= S.cfg.maxImages ? 'none' : '';
}
function renderPreview() {
  const box = $('#preview'); if (!box) return;
  const cover = SELL.images.find(x => !x.busy);
  const p = { id: 'preview', title: $('#sTitle').value || 'Tu título aparecerá aquí', price: Number($('#sPrice').value) || 0, currency: $('#sCur').value, category: $('#sCat').value || 'otros', condition: $('#sCond').value || 'Estado', createdAt: new Date().toISOString(), seller: { university: S.user.university }, cover: '' };
  box.innerHTML = cardHTML(p).replace(/<button class="card-hit"[\s\S]*?<\/button>/, '').replace(/<button class="fav"[\s\S]*?<\/button>/, '');
  if (cover) $('.media', box).firstElementChild.outerHTML = cover.id ? imgTag(cover.id, '', 500) : `<img src="${cover.dataUrl}" alt="">`;
}
async function submitSell(e) {
  e.preventDefault();
  const btn = $('#sSubmit');
  const val = { title: $('#sTitle').value.trim(), category: $('#sCat').value, condition: $('#sCond').value, description: $('#sDesc').value.trim(), price: $('#sPrice').value, currency: $('#sCur').value, campus: $('#sCampus').value.trim() };
  const errs = {
    eTitle: val.title.length < 4 ? 'Escribe un título de al menos 4 caracteres.' : '',
    eCat: !val.category ? 'Elige una categoría.' : '',
    eCond: !val.condition ? 'Elige el estado.' : '',
    eDesc: val.description.length < 10 ? 'Describe tu artículo (mínimo 10 caracteres).' : /\b[\w.+-]+@[\w-]+\.[\w.]+\b/.test(val.description) ? 'Por tu privacidad, no incluyas correos en la descripción.' : '',
    ePrice: val.price === '' || Number(val.price) < 0 ? 'Indica un precio (0 si es gratis).' : '',
    eImages: SELL.images.some(x => x.busy) ? 'Espera a que terminen de procesarse las fotos.' : (!SELL.images.length && !['cursos','servicios'].includes(val.category)) ? 'Agrega al menos una foto.' : ''
  };
  const map = { eTitle: 'sTitle', eCat: 'sCat', eCond: 'sCond', eDesc: 'sDesc', ePrice: 'sPrice' };
  let first = null;
  Object.entries(errs).forEach(([k, m]) => { $('#' + k).textContent = m; if (map[k]) $('#' + map[k]).setAttribute('aria-invalid', !!m); if (m && !first) first = map[k] ? $('#' + map[k]) : $('#drop'); });
  if (first) { first.focus(); first.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  busy(btn, true);
  try {
    if (SELL.images.some(x => x.job && x.job.error)) throw new Error('Quita las fotos que no se pudieron subir.');
    await Promise.all(SELL.images.filter(x => x.job).map(x => x.job.promise));
    const res = await api('saveProduct', getToken(), { ...val, id: SELL.id, images: SELL.images.map(x => x.id ? { id: x.id } : x.job ? { uploaded: x.job.id } : { dataUrl: x.dataUrl }) });
    SELL.dirty = false;
    toast(SELL.id ? 'Cambios guardados' : '¡Publicado! Ya está visible para todos.');
    go({ name: 'profile', tab: 'publicaciones' });
    setTimeout(() => openProduct(res.id), 350);
  } catch (x) { toast(x.message, 'err'); }
  finally { busy(btn, false); }
}

/* ═════════════ PERFIL ═════════════ */
async function renderProfile(tab = 'publicaciones') {
  if (!S.user) return openAuth('login', () => go({ name: 'profile', tab }));
  const u = S.user, tabs = [['publicaciones','Mis ventas'],['favoritos','Favoritos'],['cuenta','Mi cuenta'],['privacidad','Privacidad']];
  view.innerHTML = `
  <div class="wrap">
    <div class="prof"><span class="avatar">${esc(initials(u.name))}</span><div><h1>${esc(u.name)}</h1><p>${[u.university, u.career, 'desde ' + fmtMonth(String(u.createdAt).slice(0, 7))].filter(Boolean).map(esc).join(' · ')}${u.university ? '' : ` · <button class="link" data-t="cuenta">Agrega tu universidad</button>`}</p></div>
      <button class="btn btn-primary" data-go="sell" style="margin-left:auto">${icon('plus')}Nueva publicación</button></div>
    <div class="ptabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-t="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
    <div id="pbody" role="tabpanel"><div class="loading" style="min-height:240px"><div class="spinner"></div></div></div>
  </div>`;
  $$('[data-t]').forEach(b => b.onclick = () => go({ name: 'profile', tab: b.dataset.t }));
  const body = $('#pbody');
  if (tab === 'publicaciones') return profileListings(body);
  if (tab === 'favoritos') return profileFavs(body);
  if (tab === 'cuenta') return profileAccount(body);
  if (tab === 'privacidad') return profilePrivacy(body);
}
async function profileListings(body) {
  try {
    const items = await api('myProducts', getToken());
    if (!items.length) { body.innerHTML = `<div class="empty">${icon('tag')}<h3>Aún no publicas nada</h3><p>Ese libro de primer semestre o la calculadora que ya no usas le pueden servir a alguien hoy.</p><button class="btn btn-primary" data-go="sell">${icon('plus')}Publicar mi primer artículo</button></div>`; return; }
    const lbl = { active: 'Activa', paused: 'Pausada', sold: 'Vendida' };
    body.innerHTML = `<div class="list">${items.map((p, i) => `
      <div class="li" style="--i:${i}">
        <div class="thumbsq">${p.cover ? imgTag(p.cover, '', 200) : phTag(p.category)}</div>
        <div style="min-width:0"><h3>${esc(p.title)}</h3>
          <div class="meta"><span class="pill ${p.status}">${lbl[p.status]}</span><span>${esc(money(p.price, p.currency))}</span><span>${p.views} vistas</span><span>${esc(ago(p.createdAt))}</span></div></div>
        <div class="acts">
          <button class="btn btn-ghost btn-sm" data-a="view" data-id="${p.id}">${icon('eye')}Ver</button>
          <button class="btn btn-ghost btn-sm" data-a="edit" data-id="${p.id}">${icon('edit')}Editar</button>
          ${p.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-a="paused" data-id="${p.id}">${icon('pause')}Pausar</button><button class="btn btn-ghost btn-sm" data-a="sold" data-id="${p.id}">${icon('check')}Vendido</button>` : `<button class="btn btn-ghost btn-sm" data-a="active" data-id="${p.id}">${icon('play')}Reactivar</button>`}
          <button class="btn btn-ghost btn-sm btn-icon" data-a="del" data-id="${p.id}" aria-label="Eliminar ${esc(p.title)}">${icon('trash')}</button>
        </div>
      </div>`).join('')}</div>`;
    $$('[data-a]', body).forEach(b => b.onclick = async () => {
      const id = b.dataset.id, a = b.dataset.a;
      if (a === 'view') return openProduct(id);
      if (a === 'edit') return go({ name: 'sell', id });
      if (a === 'del') {
        if (!await confirmDlg({ title: '¿Eliminar publicación?', body: '<p>Se borrarán también sus fotos. No se puede deshacer.</p>', ok: 'Eliminar', danger: true })) return;
        busy(b, true);
        try { await api('deleteProduct', getToken(), id); toast('Publicación eliminada'); profileListings(body); } catch (e) { toast(e.message, 'err'); busy(b, false); }
        return;
      }
      busy(b, true);
      try { await api('setProductStatus', getToken(), id, a); toast({ active: 'Publicación reactivada', paused: 'Publicación pausada', sold: '¡Felicidades por la venta!' }[a]); profileListings(body); }
      catch (e) { toast(e.message, 'err'); busy(b, false); }
    });
  } catch (e) { body.innerHTML = `<div class="empty">${icon('alert')}<h3>Error</h3><p>${esc(e.message)}</p></div>`; }
}
async function profileFavs(body) {
  try {
    const items = await api('myFavorites', getToken());
    S.favs = new Set(items.map(x => x.id));
    body.innerHTML = items.length ? `<div class="grid" style="padding-bottom:70px">${items.map(cardHTML).join('')}</div>`
      : `<div class="empty">${icon('heart')}<h3>Tu lista está vacía</h3><p>Toca el corazón en cualquier publicación para guardarla aquí.</p><button class="btn btn-primary" data-go="home">Explorar</button></div>`;
    bindCards(body);
  } catch (e) { body.innerHTML = `<div class="empty">${icon('alert')}<h3>Error</h3><p>${esc(e.message)}</p></div>`; }
}
function profileAccount(body) {
  const u = S.user, unis = S.cfg.universities.map(x => `<option value="${esc(x)}">`).join('');
  const prov = u.providers || {}, sso = S.cfg.sso || {};
  body.innerHTML = `
  <div class="settings">
    <form class="box" id="accForm" novalidate>
      <h2>Datos de tu cuenta</h2>
      <div class="field"><label for="aName">Nombre y apellido</label><input class="input" id="aName" maxlength="60" value="${esc(u.name)}"></div>
      <div class="field"><label for="aEmail">Correo</label><input class="input" id="aEmail" value="${esc(u.email)}" disabled><span class="hint">Privado. Solo se usa para iniciar sesión y avisos.</span></div>
      <div class="row2"><div class="field"><label for="aUni">Universidad</label><input class="input" id="aUni" list="uniList2" maxlength="90" value="${esc(u.university)}"><datalist id="uniList2">${unis}</datalist></div>
      <div class="field"><label for="aCareer">Carrera</label><input class="input" id="aCareer" maxlength="80" value="${esc(u.career)}"></div></div>
      <div class="field"><label for="aBio">Biografía <span class="opt">(opcional)</span></label><textarea class="input" id="aBio" maxlength="160" style="min-height:80px" placeholder="Semestre, intereses, en qué puedes ayudar…">${esc(u.bio || '')}</textarea></div>
      <div class="field"><label for="aPhone">WhatsApp <span class="opt">(opcional)</span></label><input class="input" id="aPhone" type="tel" maxlength="20" value="${esc(u.phone)}"></div>
      <label class="check"><input type="checkbox" id="aShow" ${u.showPhone ? 'checked' : ''}><span>Mostrar mi WhatsApp a usuarios registrados</span></label>
      <span class="ferr" id="accErr"></span>
      <button class="btn btn-primary" type="submit">Guardar cambios</button>
    </form>
    <div>
      <form class="box" id="pwForm" novalidate>
        <h2>${u.hasPassword ? 'Cambiar contraseña' : 'Crea una contraseña'}</h2>
        ${u.hasPassword ? `<div class="field"><label for="pCur">Contraseña actual</label><input class="input" id="pCur" type="password" autocomplete="current-password"></div>` : `<p class="hint">Entraste con ${prov.apple ? 'Apple' : 'Google'}. Si creas una contraseña también podrás entrar con tu correo.</p>`}
        <div class="field"><label for="pNew">Nueva contraseña</label><input class="input" id="pNew" type="password" autocomplete="new-password"><span class="hint">8+ caracteres con letras y números. Cerraremos tus otras sesiones.</span></div>
        <span class="ferr" id="pwErr"></span>
        <button class="btn btn-ghost" type="submit">${icon('lock')}${u.hasPassword ? 'Actualizar contraseña' : 'Crear contraseña'}</button>
      </form>
      <div class="box">
        <h2>Métodos de acceso</h2>
        <div class="prov"><div><strong>Correo y contraseña</strong><small class="hint" style="display:block">${u.hasPassword ? 'Activo' : 'Sin contraseña'}</small></div>${u.hasPassword ? '<span class="pill active">Activo</span>' : ''}</div>
        ${[['google', 'Google'], ['apple', 'Apple']].filter(([k]) => prov[k] || sso[k]).map(([k, l]) => `<div class="prov"><div><strong>${l}</strong><small class="hint" style="display:block">${prov[k] ? 'Vinculado' : 'No vinculado · entra con ' + l + ' usando este mismo correo para vincularlo'}</small></div>${prov[k] ? `<button class="btn btn-ghost btn-sm" data-unlink="${k}">Desvincular</button>` : ''}</div>`).join('')}
      </div>
    </div>
  </div>`;
  $('#accForm').onsubmit = async e => {
    e.preventDefault(); const b = $('#accForm button[type=submit]'); $('#accErr').textContent = ''; busy(b, true);
    try { S.user = await api('updateProfile', getToken(), { name: $('#aName').value, university: $('#aUni').value, career: $('#aCareer').value, bio: $('#aBio').value, phone: $('#aPhone').value, showPhone: $('#aShow').checked, marketingOptIn: S.user.marketingOptIn }); renderUserSlot(); toast('Datos actualizados'); }
    catch (x) { $('#accErr').textContent = x.message; } finally { busy(b, false); }
  };
  $('#pwForm').onsubmit = async e => {
    e.preventDefault(); const b = $('#pwForm button[type=submit]'); $('#pwErr').textContent = ''; busy(b, true);
    try { await api('changePassword', getToken(), $('#pCur') ? $('#pCur').value : '', $('#pNew').value); S.user.hasPassword = true; toast('Contraseña guardada'); profileAccount(body); }
    catch (x) { $('#pwErr').textContent = x.message; } finally { busy(b, false); }
  };
  $$('[data-unlink]', body).forEach(b => b.onclick = async () => {
    busy(b, true);
    try { S.user = await api('unlinkProvider', getToken(), b.dataset.unlink); toast('Método desvinculado'); profileAccount(body); }
    catch (x) { toast(x.message, 'err'); busy(b, false); }
  });
}
function profilePrivacy(body) {
  const u = S.user, c = S.consent || {};
  body.innerHTML = `
  <div class="settings">
    <div class="box">
      <h2>${icon('shield')}Tus permisos</h2>
      <div>
        <label class="switch"><div><strong>Datos necesarios</strong><span>Cuenta, sesión y publicaciones. Imprescindibles para que Pupitre funcione.</span></div><input type="checkbox" checked disabled aria-label="Datos necesarios (siempre activos)"></label>
        <label class="switch"><div><strong>Comunicaciones de Pupitre</strong><span>Novedades y ofertas por correo.</span></div><input type="checkbox" id="pvMk" ${u.marketingOptIn ? 'checked' : ''}></label>
        <label class="switch"><div><strong>WhatsApp visible</strong><span>Solo para usuarios registrados.</span></div><input type="checkbox" id="pvPh" ${u.showPhone ? 'checked' : ''} ${u.phone ? '' : 'disabled'}></label>
        <label class="switch"><div><strong>Perfil solo para mi universidad</strong><span>Personas de otras universidades solo verán tu nombre de pila.</span></div><input type="checkbox" class="pvSoc" data-k="profileUniOnly" ${u.privacy && u.privacy.profileUniOnly ? 'checked' : ''}></label>
        <label class="switch"><div><strong>Mensajes solo de personas que sigo</strong><span>Evita que desconocidos te escriban.</span></div><input type="checkbox" class="pvSoc" data-k="dmFollowingOnly" ${u.privacy && u.privacy.dmFollowingOnly ? 'checked' : ''}></label>
        <label class="switch"><div><strong>Aparecer en “Personas que quizás conozcas”</strong><span>Te sugerimos a compañeros de tu universidad.</span></div><input type="checkbox" class="pvSoc" data-k="suggestible" ${!u.privacy || u.privacy.suggestible !== false ? 'checked' : ''}></label>
      </div>
      <p class="hint">Cookies y almacenamiento: preferencias ${c.preferences ? 'activadas' : 'desactivadas'}, analítica ${c.analytics ? 'activada' : 'desactivada'}, marketing ${c.marketing ? 'activado' : 'desactivado'}.</p>
      <button class="btn btn-ghost" id="pvCookies">${icon('cookie')}Configurar cookies</button>
    </div>
    <div>
      <div class="box">
        <h2>${icon('download')}Descarga tus datos</h2>
        <p class="hint">Recibe un archivo JSON con tu cuenta, tus publicaciones, favoritos y el historial de tus consentimientos.</p>
        <button class="btn btn-ghost" id="pvExport">${icon('download')}Descargar mis datos</button>
      </div>
      <div class="box danger">
        <h2>${icon('trash')}Eliminar mi cuenta</h2>
        <p class="hint">Borra de forma permanente tu cuenta, publicaciones del muro y del Marketplace, fotos, historias, comentarios, mensajes, seguidores y sesiones. Solo conservamos un registro anónimo de que diste y retiraste tu consentimiento.</p>
        <button class="btn btn-danger" id="pvDelete">Eliminar mi cuenta</button>
      </div>
      <div class="box"><p class="hint">Dudas sobre tus datos: <b>${esc(LEGAL_EMAIL)}</b> · <button class="link" data-legal="privacidad">Política de privacidad</button></p></div>
    </div>
  </div>`;
  const saveSw = async (el, patch) => {
    el.disabled = true;
    try { S.user = await api('updateProfile', getToken(), { name: u.name, university: u.university, career: u.career, phone: u.phone, showPhone: S.user.showPhone, marketingOptIn: S.user.marketingOptIn, ...patch }); toast('Preferencia guardada'); }
    catch (e) { el.checked = !el.checked; toast(e.message, 'err'); } finally { el.disabled = false; }
  };
  $('#pvMk').onchange = e => saveSw(e.target, { marketingOptIn: e.target.checked });
  $('#pvPh').onchange = e => saveSw(e.target, { showPhone: e.target.checked });
  $$('.pvSoc').forEach(i => i.onchange = async () => { i.disabled = true; try { S.user.privacy = await api('updateSocialPrivacy', getToken(), { [i.dataset.k]: i.checked }); toast('Preferencia guardada'); } catch (x) { i.checked = !i.checked; toast(x.message, 'err'); } finally { i.disabled = false; } });
  $('#pvCookies').onclick = () => openCookieSettings(() => profilePrivacy(body));
  $('#pvExport').onclick = async e => {
    const b = e.currentTarget; busy(b, true);
    try {
      const data = await api('exportMyData', getToken());
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `pupitre-mis-datos-${new Date().toISOString().slice(0, 10)}.json`, target: '_self' });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Descarga lista');
    } catch (x) { toast(x.message, 'err'); } finally { busy(b, false); }
  };
  $('#pvDelete').onclick = async () => {
    const pw = await confirmDlg({ title: 'Eliminar cuenta definitivamente', body: S.user.hasPassword
      ? '<p style="margin-bottom:14px">Esta acción no se puede deshacer. Escribe tu contraseña para confirmar.</p><div class="field"><label for="cfIn">Contraseña</label><input class="input" id="cfIn" type="password" autocomplete="current-password"></div>'
      : '<p style="margin-bottom:14px">Esta acción no se puede deshacer. Escribe <b>ELIMINAR</b> para confirmar.</p><div class="field"><label for="cfIn">Confirmación</label><input class="input" id="cfIn" autocomplete="off" placeholder="ELIMINAR"></div>', ok: 'Eliminar para siempre', danger: true, input: true });
    if (!pw) return;
    try { await api('deleteMyAccount', getToken(), pw); setToken(null); S.user = null; S.favs.clear(); renderUserSlot(); go({ name: 'feed' }); toast('Tu cuenta y tus datos fueron eliminados.'); }
    catch (e) { toast(e.message, 'err'); }
  };
}

/* ═════════════ DIÁLOGOS GENÉRICOS ═════════════ */
function bindClose(d) {
  $$('[data-close]', d).forEach(b => b.onclick = () => d.close());
  d.onclick = e => { if (e.target === d) d.close(); };
}
function confirmDlg({ title, body, ok = 'Aceptar', danger, input, noCancel }) {
  return new Promise(res => {
    const d = $('#dlgConfirm');
    d.innerHTML = `<div class="dlg-head"><h2 id="cfTitle">${esc(title)}</h2></div><div class="dlg-body">${body}</div>
      <div class="dlg-foot">${noCancel ? '' : '<button class="btn btn-ghost" id="cfNo">Cancelar</button>'}<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cfYes">${esc(ok)}</button></div>`;
    let val = false;
    d.onclose = () => res(val);
    $('#cfNo')?.addEventListener('click', () => d.close());
    $('#cfYes').onclick = () => { if (input) { const i = $('#cfIn'); if (!i.value) { i.setAttribute('aria-invalid', 'true'); i.focus(); return; } val = i.value; } else val = true; d.close(); };
    d.onclick = e => { if (e.target === d) d.close(); };
    d.showModal();
    (input ? $('#cfIn') : $('#cfYes')).focus();
  });
}

/* ═════════════ COOKIES Y CONSENTIMIENTO ═════════════ */
function getAnon() { let a = store.get('pp_anon'); if (!a) { a = uid(); store.set('pp_anon', a); } return a; }
function saveConsent(p) {
  S.consent = { v: S.cfg.policyVersion, necessary: true, preferences: !!p.preferences, analytics: !!p.analytics, marketing: !!p.marketing, at: new Date().toISOString() };
  store.set('pp_consent', JSON.stringify(S.consent));
  if (!S.consent.preferences) { store.del('pp_theme'); store.del('pp_filters'); }
  else store.set('pp_theme', document.documentElement.dataset.theme);
  $('#cookieBanner').innerHTML = '';
  api('logConsent', getAnon(), S.consent, getToken()).catch(() => {});
  if (S.consent.analytics) { gaLoad(); lastPage = ''; trackPage(S.route); }
  else if (GA.on) { try { gtag('consent', 'update', { analytics_storage: 'denied' }); } catch {} }
}
function showCookieBanner() {
  const b = $('#cookieBanner');
  b.innerHTML = `<section class="cookie" role="dialog" aria-labelledby="cbT" aria-describedby="cbD">
    <h2 id="cbT">${icon('cookie')}Usamos cookies, con respeto</h2>
    <p id="cbD">Usamos almacenamiento local necesario para tu sesión y seguridad. Con tu permiso, también guardamos tus preferencias (tema, orden) y estadísticas anónimas. Lee la <button class="link" data-legal="cookies">política de cookies</button>.</p>
    <div class="row">
      <button class="btn btn-lime" id="cbAll">Aceptar todas</button>
      <button class="btn btn-ghost" id="cbNec">Solo necesarias</button>
      <button class="btn btn-ghost" id="cbCfg">Configurar</button>
    </div></section>`;
  $('#cbAll').onclick = () => { saveConsent({ preferences: true, analytics: true, marketing: true }); toast('Preferencias de cookies guardadas'); };
  $('#cbNec').onclick = () => { saveConsent({}); toast('Solo usaremos lo necesario'); };
  $('#cbCfg').onclick = () => openCookieSettings();
  bindLegalLinks(b);
}
function openCookieSettings(after) {
  const d = $('#dlgCookies'), c = S.consent || { preferences: false, analytics: false, marketing: false };
  const row = (k, t, s, dis) => `<label class="switch"><div><strong>${t}</strong><span>${s}</span></div><input type="checkbox" data-k="${k}" ${dis || c[k] ? 'checked' : ''} ${dis ? 'disabled' : ''} aria-label="${t}"></label>`;
  d.innerHTML = `<div class="dlg-head"><h2 id="ckTitle">Configurar cookies</h2><button class="btn btn-ghost btn-icon" data-close aria-label="Cerrar">${icon('x')}</button></div>
    <div class="dlg-body">
      ${row('necessary', 'Necesarias', 'Sesión, seguridad y registro de tu elección. Siempre activas.', true)}
      ${row('preferences', 'Preferencias', 'Recordar tema claro/oscuro y orden de resultados.')}
      ${row('analytics', 'Analítica', 'Estadísticas anónimas de uso para mejorar el servicio.')}
      ${row('marketing', 'Marketing', 'Medir campañas y mostrar novedades relevantes.')}
    </div>
    <div class="dlg-foot"><button class="btn btn-ghost" id="ckNone">Rechazar opcionales</button><button class="btn btn-ghost" id="ckSave">Guardar selección</button><button class="btn btn-primary" id="ckAll">Aceptar todas</button></div>`;
  bindClose(d); d.showModal();
  const fin = p => { saveConsent(p); d.close(); toast('Preferencias de cookies guardadas'); after && after(); };
  $('#ckAll').onclick = () => fin({ preferences: true, analytics: true, marketing: true });
  $('#ckNone').onclick = () => fin({});
  $('#ckSave').onclick = () => { const p = {}; $$('[data-k]', d).forEach(i => p[i.dataset.k] = i.checked); fin(p); };
}

/* ═════════════ TEMA ═════════════ */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  $('#themeBtn').innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
  $('#themeBtn').setAttribute('aria-label', t === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro');
  if (S.consent?.preferences) store.set('pp_theme', t);
}

/* ═════════════ TEXTOS LEGALES ═════════════ */
function legalDocs() {
  const v = S.cfg.policyVersion, app = S.cfg.appName;
  return {
    privacidad: { t: 'Política de privacidad', h: `
      <div class="callout"><p><b>Resumen:</b> pedimos lo mínimo, nunca publicamos tu correo, no vendemos tus datos y puedes descargarlos o borrarlos cuando quieras desde el Centro de privacidad.</p></div>
      <h2>1. Responsable</h2><p>${esc(LEGAL_OWNER)}, con domicilio en ${esc(LEGAL_CITY)}, es responsable del tratamiento de los datos recogidos en ${esc(app)}. Contacto: <b>${esc(LEGAL_EMAIL)}</b>.</p>
      <h2>2. Qué datos recogemos</h2><ul>
        <li><b>Cuenta:</b> nombre y apellido y correo electrónico. De forma opcional: universidad, carrera y número de WhatsApp.</li>
        <li><b>Publicaciones:</b> fotos, título, descripción, categoría, estado, precio y zona de entrega que tú escribas.</li>
        <li><b>Actividad en la comunidad:</b> lo que publicas en el muro y en grupos, tus comentarios, reacciones, votos en encuestas, grupos a los que te unes, eventos a los que asistirás, a quién sigues y tus mensajes privados.</li>
        <li><b>Seguridad:</b> contraseña transformada en un hash irreversible con sal (nunca guardamos la contraseña real), hash del token de sesión, fecha de último acceso.</li>
        <li><b>Consentimientos:</b> qué aceptaste, la versión de la política y la fecha.</li>
        <li><b>Actividad mínima:</b> número de vistas de una publicación y registro de que enviaste un mensaje (sin su contenido).</li></ul>
      <p><b>Si usas “Continuar con Google” o “Continuar con Apple”</b>, ese servicio confirma tu identidad y nos entrega tu nombre, tu correo verificado y un identificador de tu cuenta. Nunca recibimos tu contraseña de Google o Apple ni accedemos a tu correo, contactos o archivos.</p>
      <p><b>No recogemos</b> cédula, datos bancarios ni de tarjetas, ni tu ubicación GPS (la eliminamos de tus fotos antes de subirlas).</p>
      <h2>3. Para qué los usamos</h2><ul>
        <li>Crear y mantener tu cuenta y mostrar tus publicaciones (ejecución del servicio que solicitas).</li>
        <li>Mostrar tu muro, grupos, eventos e historias, y permitir mensajes privados entre usuarios. Por correo solo te avisamos que tienes un mensaje nuevo, sin su contenido (ejecución del servicio).</li>
        <li>Prevenir fraudes, abusos y accesos no autorizados (interés legítimo en la seguridad de la comunidad).</li>
        <li>Enviarte novedades, solo si lo autorizas (consentimiento, revocable en cualquier momento).</li></ul>
      <h2>4. Qué es público</h2><p>Tu perfil muestra tu nombre, carrera, universidad y biografía; puedes limitarlo a tu universidad en el Centro de privacidad. Cada publicación del muro la ve solo la audiencia que elijas (Público, Mi universidad o Seguidores) y las de grupos privados solo sus miembros. Tus artículos del Marketplace son visibles para cualquier visitante. Tu WhatsApp solo se muestra a usuarios registrados y únicamente si activas esa opción. Tu correo nunca se muestra.</p>
      <h2>5. Con quién los compartimos</h2><ul>
        <li><b>Google LLC</b>, como proveedor de infraestructura (Apps Script, Sheets, Drive y Gmail), bajo sus propias condiciones de seguridad y privacidad.</li>
        <li><b>Google o Apple</b>, solo si eliges iniciar sesión con ellos: confirman tu identidad bajo sus propias políticas.</li>
        <li><b>Google Analytics</b>, solo si aceptas las cookies de analítica: recibe datos de uso seudónimos y agregados (nunca tu nombre, correo, teléfono ni tus mensajes).</li>
        <li><b>Otros usuarios</b>, solo lo que tú publicas, según la audiencia que elijas. Tus mensajes privados solo los ven tú y la otra persona; el equipo administrador solo accedería ante un requerimiento legal o un reporte de abuso.</li>
        <li><b>Autoridades</b>, únicamente cuando exista una obligación legal.</li></ul>
      <p>No vendemos, alquilamos ni cedemos tus datos con fines comerciales.</p>
      <h2>6. Cuánto tiempo los guardamos</h2><p>Mientras tu cuenta esté activa. Las historias se borran a las 24 horas, las notificaciones a los 90 días y las sesiones vencen solas (1 o 14 días). Si eliminas tu cuenta, borramos de inmediato tus datos, publicaciones, fotos, comentarios, mensajes, seguidores y sesiones; solo conservamos un registro anonimizado de tus consentimientos para poder demostrar que se respetaron.</p>
      <h2>7. Cómo los protegemos</h2><ul>
        <li>Contraseñas con HMAC-SHA256 iterado, sal única por usuario y clave secreta del servidor.</li>
        <li>Tokens de sesión aleatorios de los que solo almacenamos su hash.</li>
        <li>Límite de intentos de inicio de sesión y de mensajes por hora.</li>
        <li>Validación de todo lo que se envía, protección contra inyección y verificación del tipo real de cada imagen.</li>
        <li>Acceso a la base de datos restringido a la persona administradora.</li></ul>
      <h2>8. Tus derechos</h2><p>Conforme al derecho de <b>habeas data</b> (artículo 28 de la Constitución de la República Bolivariana de Venezuela) y a la protección del honor, la intimidad y la limitación del uso de la informática (artículo 60), puedes en cualquier momento:</p><ul>
        <li><b>Acceder</b> y <b>descargar</b> tus datos (Centro de privacidad → Descargar mis datos).</li>
        <li><b>Rectificar</b> tus datos (Mi cuenta).</li>
        <li><b>Eliminar</b> tu cuenta y tus datos (Centro de privacidad → Eliminar mi cuenta).</li>
        <li><b>Retirar</b> tu consentimiento para comunicaciones y cookies opcionales.</li></ul>
      <p>Para cualquier otra solicitud escribe a <b>${esc(LEGAL_EMAIL)}</b>. Responderemos en un plazo razonable.</p>
      <h2>9. Mayoría de edad</h2><p>${esc(app)} es solo para personas mayores de 18 años. Si detectamos una cuenta de un menor, la eliminaremos.</p>
      <h2>10. Marco aplicable</h2><p>Constitución de la República Bolivariana de Venezuela (arts. 28 y 60), Ley Especial contra los Delitos Informáticos y Ley sobre Mensajes de Datos y Firmas Electrónicas. Adoptamos además buenas prácticas internacionales (minimización, transparencia, seguridad y derechos del titular) inspiradas en el Reglamento General de Protección de Datos europeo.</p>
      <h2>11. Cambios</h2><p>Si cambiamos esta política te lo avisaremos en la plataforma y, cuando sea necesario, te pediremos aceptarla de nuevo.</p>` },
    cookies: { t: 'Política de cookies', h: `
      <p>${esc(app)} funciona dentro de Google Apps Script. En lugar de cookies tradicionales usamos el <b>almacenamiento local del navegador</b> (localStorage y sessionStorage), que cumple la misma función. Esta política explica qué guardamos y cómo controlarlo.</p>
      <h2>Lo que guardamos</h2>
      <div class="tscroll" tabindex="0" role="region" aria-label="Tabla de almacenamiento"><table><thead><tr><th>Clave</th><th>Tipo</th><th>Para qué</th><th>Duración</th></tr></thead><tbody>
        <tr><td><code>pp_session</code></td><td>Necesaria</td><td>Mantener tu sesión iniciada de forma segura.</td><td>Hasta cerrar sesión (máx. 14 días)</td></tr>
        <tr><td><code>pp_consent</code></td><td>Necesaria</td><td>Recordar tu elección sobre cookies.</td><td>Hasta que la cambies o actualicemos la política</td></tr>
        <tr><td><code>pp_anon</code></td><td>Necesaria</td><td>Identificador aleatorio para registrar tu consentimiento sin datos personales.</td><td>Persistente</td></tr>
        <tr><td><code>pp_theme</code></td><td>Preferencias</td><td>Recordar el tema claro u oscuro.</td><td>Persistente</td></tr>
        <tr><td><code>pp_filters</code></td><td>Preferencias</td><td>Recordar el orden de los resultados.</td><td>Persistente</td></tr>
        <tr><td><code>_ga</code>, <code>_ga_*</code></td><td>Analítica (Google)</td><td>Distinguir visitas de forma seudónima y medir el uso agregado. Solo con tu permiso.</td><td>Hasta 2 años</td></tr>
      </tbody></table></div>
      <h2>Analítica (Google Analytics)</h2><p>Solo si aceptas la categoría <b>Analítica</b> cargamos Google Analytics 4 para medir, de forma agregada, cómo se usa ${esc(app)}: páginas vistas, publicaciones creadas, artículos vistos o guardados y contactos a vendedores. Usa un identificador aleatorio de ${esc(app)}; nunca le enviamos tu nombre, correo, teléfono ni el contenido de tus mensajes. Google Analytics 4 no almacena direcciones IP. Si no aceptas, no se carga. Puedes retirar tu permiso en cualquier momento.</p>
      <h2>Marketing</h2><p>Hoy no usamos herramientas de publicidad de terceros. Si en el futuro las incorporamos, solo se activarán con tu permiso y actualizaremos esta política.</p>
      <h2>Cookies de Google</h2><p>Al estar alojado en servidores de Google, el navegador puede recibir cookies técnicas de Google necesarias para servir la aplicación. Se rigen por la política de privacidad de Google.</p>
      <h2>Cómo cambiar tu elección</h2><p>Usa “Configurar cookies” en el pie de página o en el Centro de privacidad. También puedes borrar el almacenamiento desde la configuración de tu navegador.</p>
      <p><button class="btn btn-primary" id="legalCk" style="margin-top:12px">${icon('cookie')}Configurar cookies ahora</button></p>` },
    terminos: { t: 'Términos y condiciones', h: `
      <h2>1. Qué es ${esc(app)}</h2><p>Una plataforma para que estudiantes y miembros de comunidades universitarias publiquen y encuentren cursos, tutorías, apuntes, accesorios, equipos y otros artículos. ${esc(app)} no vende, no compra, no cobra comisiones ni interviene en los pagos: solo conecta a las personas.</p>
      <h2>2. Quién puede usarlo</h2><p>Personas mayores de 18 años que entreguen datos verdaderos. Cada cuenta es personal e intransferible y eres responsable de mantener tu contraseña en secreto.</p>
      <h2>3. Qué puedes publicar</h2><p>Artículos y servicios lícitos, propios y descritos con honestidad, con fotos reales y precio claro.</p>
      <h2>4. Qué está prohibido</h2><ul>
        <li>Armas, drogas, alcohol, tabaco, medicamentos o sustancias controladas.</li>
        <li>Artículos robados, falsificados o que no te pertenecen.</li>
        <li>Trabajos, tesis o exámenes para ser entregados como propios por otra persona (plagio o fraude académico).</li>
        <li>Cursos o materiales que infrinjan derechos de autor de terceros.</li>
        <li>Documentos de identidad, cuentas o datos personales de otras personas.</li>
        <li>Acoso, amenazas, burlas, discriminación o suplantación de identidad, en publicaciones, comentarios o mensajes.</li>
        <li>Fotos o videos de otras personas sin su permiso.</li>
        <li>Contenido sexual, violento, discriminatorio u ofensivo.</li>
        <li>Publicaciones engañosas, esquemas piramidales o cualquier forma de estafa.</li></ul>
      <h2>5. Moderación</h2><p>Cualquier usuario puede reportar una publicación. Al alcanzar varios reportes se pausa automáticamente mientras se revisa. Podemos eliminar contenido y suspender cuentas que incumplan estos términos.</p>
      <h2>6. Transacciones entre usuarios</h2><p>Los acuerdos de precio, pago y entrega son exclusivamente entre comprador y vendedor. Te recomendamos reunirte en lugares públicos del campus, revisar el artículo antes de pagar y no adelantar dinero. ${esc(app)} no garantiza la calidad, legalidad ni existencia de lo publicado y no responde por pérdidas derivadas de los acuerdos entre usuarios.</p>
      <h2>7. Tu contenido y propiedad intelectual</h2><p>Sigues siendo dueño de lo que publicas. Nos autorizas a mostrarlo dentro de la plataforma mientras la publicación esté activa. Al eliminarla, la borramos junto con sus fotos. Los detalles están en la <button class="link" data-legal="propiedad">Política de propiedad intelectual</button>.</p>
      <h2>8. Disponibilidad</h2><p>El servicio se ofrece “tal cual”. Puede tener interrupciones, especialmente por los límites de la infraestructura de Google.</p>
      <h2>9. Cambios y terminación</h2><p>Podemos actualizar estos términos avisándote en la plataforma. Puedes dejar de usar el servicio y borrar tu cuenta cuando quieras.</p>
      <h2>10. Ley aplicable</h2><p>Estos términos se rigen por las leyes de la República Bolivariana de Venezuela. Contacto: <b>${esc(LEGAL_EMAIL)}</b>.</p>` },
    propiedad: { t: 'Propiedad intelectual', h: `
      <div class="callout"><p><b>En corto:</b> lo que publicas sigue siendo tuyo; solo nos permites mostrarlo aquí. Publica únicamente lo que es tuyo o tienes permiso de usar. Si alguien usó tu obra o tu marca sin permiso, avísanos y la retiramos.</p></div>
      <h2>1. La plataforma</h2><p>El software, el diseño visual, los textos de la interfaz, la organización de la base de datos y el nombre y logotipo de ${esc(app)} son obras y signos protegidos que pertenecen a ${esc(LEGAL_OWNER)} y a sus autores, estudiantes de la Universidad Santa María. Puedes usarlos solo para utilizar el servicio. No está permitido copiarlos, descompilar el código, extraer datos de forma masiva (scraping) ni crear servicios derivados sin autorización escrita.</p>
      <p>La mención a la Universidad Santa María identifica el origen académico del proyecto. Su nombre y sus signos distintivos pertenecen a la universidad y su mención no implica un respaldo oficial, salvo autorización expresa.</p>
      <h2>2. Tu contenido</h2><p>Conservas todos los derechos sobre tus fotos, textos, cursos, apuntes, historias y demás contenido. Al publicarlo nos otorgas una licencia gratuita, no exclusiva y limitada para alojarlo, mostrarlo y adaptarlo técnicamente (por ejemplo, reducir el tamaño de una foto) dentro de ${esc(app)}, solo mientras esté publicado. La licencia termina cuando lo borras o eliminas tu cuenta. No vendemos tu contenido ni lo usamos en publicidad fuera de la plataforma sin tu permiso.</p>
      <p>Como autor conservas siempre tus derechos morales, entre ellos que se reconozca tu autoría y que se respete la integridad de tu obra.</p>
      <h2>3. Contenido de otras personas</h2><p>Solo puedes publicar contenido propio o que tengas permiso de usar. En particular, no está permitido:</p><ul>
        <li>Vender o compartir libros escaneados, PDF de editoriales, software o cursos pirateados.</li>
        <li>Vender guías, presentaciones, grabaciones de clases o exámenes de profesores sin su autorización.</li>
        <li>Usar fotos de catálogos, de tiendas o de otras personas para anunciar tus artículos. Usa fotos tuyas.</li>
        <li>Vender productos falsificados o usar marcas ajenas para confundir sobre el origen de un producto.</li>
        <li>Presentar como propio el trabajo intelectual de otra persona.</li></ul>
      <p>Las citas breves con fines de estudio, crítica o enseñanza, indicando autor y fuente, están permitidas dentro de los límites que establece la ley.</p>
      <h2>4. Cursos, tutorías y apuntes</h2><p>Si ofreces un curso, una tutoría o tus apuntes, el material que entregas debe ser de tu autoría o contar con licencia para usarlo. Quien lo compra obtiene un uso personal: no puede revenderlo ni redistribuirlo, salvo que tú lo autorices.</p>
      <h2>5. Cómo reportar una infracción</h2><p>Si crees que una publicación infringe tus derechos de autor o tu marca, toca “Reportar” y elige “Infringe derechos de autor o marca”, o escribe a <b>${esc(LEGAL_EMAIL)}</b> indicando:</p><ul>
        <li>Tu nombre y una forma de contacto (o los de la persona o empresa que representas).</li>
        <li>La obra o marca protegida y, si existe, su número de registro ante el SAPI.</li>
        <li>El enlace o la descripción de la publicación que infringe.</li>
        <li>Una declaración de buena fe de que ese uso no está autorizado y de que la información que envías es exacta.</li></ul>
      <p>Revisaremos el reporte y, si procede, pausaremos o retiraremos el contenido y avisaremos a quien lo publicó, que podrá responder si cree que se trata de un error. Las cuentas que infrinjan derechos de forma reiterada serán suspendidas.</p>
      <h2>6. Marco legal</h2><p>Esta política se basa en la Ley sobre el Derecho de Autor (Gaceta Oficial N.º 4.638 Extraordinario, de 1993), la Ley de Propiedad Industrial y el Convenio de Berna para la Protección de las Obras Literarias y Artísticas, del que Venezuela es parte desde 1982. El organismo competente en Venezuela es el Servicio Autónomo de la Propiedad Intelectual (SAPI).</p>` }
  };
}
function renderLegal(doc) {
  const docs = legalDocs(), d = docs[doc] || docs.privacidad;
  view.innerHTML = `<div class="wrap" style="padding-top:clamp(26px,4vw,56px)"><div class="legal">
    <nav aria-label="Documentos legales">${Object.entries(docs).map(([k, x]) => `<button data-legal="${k}" ${k === doc ? 'aria-current="page"' : ''}>${x.t}</button>`).join('')}</nav>
    <article class="prose"><h1>${d.t}</h1><p class="ver">Versión ${esc(S.cfg.policyVersion)} · Última actualización ${new Date(S.cfg.policyVersion + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}</p>${d.h}</article>
  </div></div>`;
  $('#legalCk')?.addEventListener('click', () => openCookieSettings());
}
function bindLegalLinks(root) {
  $$('[data-legal]', root).forEach(b => b.onclick = e => { e.preventDefault(); go({ name: 'legal', doc: b.dataset.legal }); });
}


/* ═════════════ RED SOCIAL ═════════════ */
const SOC = { tab: 'para-ti', tag: '', posts: new Map(), open: new Set(), all: new Set(), version: 0, stories: [], convo: null, chatTimer: null, focusComposer: false };
const AUD = { publico: { l: 'Público', i: 'globe' }, universidad: { l: 'Mi universidad', i: 'cap' }, seguidores: { l: 'Seguidores', i: 'users' } };
const avatarHTML = (u, cls = '') => `<span class="av ${cls}" style="--c:${u.color || 'var(--lilac)'}" aria-hidden="true">${esc(u.initials || initials(u.name))}</span>`;
const anyImg = (src, alt, w = 800) => String(src).startsWith('data:') ? `<img src="${src}" alt="${esc(alt)}" loading="lazy">` : imgTag(src, alt, w);
const meU = () => S.user ? { ...S.user, initials: initials(S.user.name) } : null;
const shortAgo = iso => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? 'ahora' : s < 3600 ? Math.floor(s / 60) + ' min' : s < 86400 ? Math.floor(s / 3600) + ' h' : Math.floor(s / 86400) + ' d'; };
const fmtEvDate = iso => new Date(iso).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
function richText(t) {
  return esc(t)
    .replace(/(^|[\s(])#([0-9A-Za-zÁÉÍÓÚÑáéíóúñü_]{2,30})/g, (m, s, tag) => `${s}<button class="hash" data-act="hash" data-hash="${tag}">#${tag}</button>`)
    .replace(/\n/g, '<br>');
}
const flyerHTML = f => `<div class="flyer" style="--c:${f.color}"><span class="flyer-tag">${esc(f.tag)}</span>${icon(f.icon, 'ico big')}<strong>${esc(f.title)}</strong><small>${esc(f.sub)}</small></div>`;
const evDate = iso => { const d = new Date(iso); return `<span class="evt-date" aria-hidden="true"><b>${d.toLocaleDateString('es', { month: 'short' }).replace('.', '')}</b><strong>${d.getDate()}</strong></span>`; };
const rsvpBtn = (ev, sm = 'btn-sm') => `<button class="btn ${sm} ${ev.isGoing ? 'btn-primary' : 'btn-ghost'}" data-act="rsvp" data-id="${ev.id}" aria-pressed="${ev.isGoing}">${ev.isGoing ? icon('check') + 'Asistiré' : 'Asistiré'}</button>`;
const joinBtn = g => `<button class="btn btn-sm ${g.joined || g.pending ? 'btn-ghost' : 'btn-primary'}" data-act="join" data-id="${g.id}" aria-pressed="${g.joined || g.pending}">${g.isOwner ? icon('shield') + 'Administras' : g.joined ? icon('check') + 'Te uniste' : g.pending ? 'Solicitud enviada' : g.privacy === 'Privado' ? 'Solicitar unirme' : 'Unirme'}</button>`;
const followBtn = (u, big) => `<button class="btn ${big ? '' : 'btn-sm'} ${u.following ? 'btn-ghost' : (big ? 'btn-primary' : 'btn-ghost')}" data-act="follow" data-id="${u.id}" data-big="${big ? 1 : ''}" aria-pressed="${!!u.following}">${u.following ? 'Siguiendo' : 'Seguir'}</button>`;
const embedProduct = p => `<button class="embed" data-act="product" data-id="${esc(p.id)}"><span class="thumbsq">${p.cover ? imgTag(p.cover, '', 200) : phTag(p.category)}</span><span class="txt"><small class="hint">Marketplace</small><strong>${esc(p.title)}</strong><span class="eprice">${esc(money(p.price, p.currency))}</span></span>${icon('right')}</button>`;
const embedEvent = ev => `<div class="embed">${evDate(ev.date)}<span class="txt"><strong>${esc(ev.title)}</strong><small class="hint">${esc(ev.place)} · <span data-eg="${ev.id}">${ev.going}</span> asistirán</small></span>${rsvpBtn(ev)}</div>`;
const evRowHTML = ev => `<div class="evrow">${evDate(ev.date)}<div><strong>${esc(ev.title)}</strong><small><span data-eg="${ev.id}">${ev.going}</span> asistirán</small></div>${rsvpBtn(ev)}</div>`;
const personRow = u => `<div class="prow"><button class="avbtn" data-act="uid" data-id="${u.id}" aria-label="Perfil de ${esc(u.name)}">${avatarHTML(u, 'sm')}</button><div><button class="cname" data-act="uid" data-id="${u.id}">${esc(u.name)}</button><small class="hint">${esc(u.reason || u.career || '')}</small></div>${followBtn(u)}</div>`;

function socShell(active, main, right = true) {
  const u = S.user;
  const nav = [['feed', 'home', 'Inicio'], ['home', 'store', 'Marketplace'], ['groups', 'users', 'Grupos'], ['events', 'calendar', 'Eventos'], ['messages', 'chat', 'Mensajes'], ['sell', 'plus', 'Vender algo']];
  return `<div class="wrap soc">
    <aside class="soc-left" aria-label="Menú de la comunidad"><nav class="soc-nav">
      ${u ? `<button class="me-card" data-act="uid" data-id="${u.id}">${avatarHTML(meU())}<span><strong>${esc(u.name)}</strong><small>Ver mi perfil</small></span></button>` : ''}
      ${nav.map(([k, i, l]) => `<button data-go="${k}" ${active === k ? 'aria-current="page"' : ''}>${icon(i)}${l}</button>`).join('')}
    </nav>${u ? '<div class="mygroups" id="myGroups"></div>' : ''}</aside>
    <section class="soc-main" id="socMain">${main}</section>
    ${right ? '<aside class="soc-right" id="socRight" aria-label="Sugerencias"></aside>' : ''}
  </div>`;
}
async function loadMyGroups() {
  const box = $('#myGroups'); if (!box) return;
  try {
    const gs = (await api('groups', getToken())).filter(g => g.joined);
    box.innerHTML = gs.length ? `<p class="side-h">Tus grupos</p>${gs.map(g => `<button data-act="group" data-id="${g.id}"><span class="gdot" style="--c:${g.color}">${icon(g.icon)}</span>${esc(g.name)}</button>`).join('')}` : '';
  } catch { box.innerHTML = ''; }
}
async function loadRight() {
  const r = $('#socRight'); if (!r) return;
  r.innerHTML = '<div class="panel"><div class="spinner" style="margin:20px auto"></div></div>';
  try {
    const [evs, mk, ppl] = await Promise.all([api('events', getToken()), api('listProducts', { sort: 'popular' }), api('people', getToken())]);
    r.innerHTML = `
      <section class="panel"><h3>Próximos eventos<button class="link-q" data-go="events">Ver todos</button></h3>${evs.slice(0, 3).map(evRowHTML).join('')}</section>
      <section class="panel"><h3>Hoy en el Marketplace<button class="link-q" data-go="home">Ver más</button></h3>${mk.items.slice(0, 3).map(embedProduct).join('')}</section>
      ${ppl.length ? `<section class="panel"><h3>Personas que quizás conozcas</h3>${ppl.map(personRow).join('')}</section>` : ''}
      <p class="hint" style="padding:0 6px;font-size:12px">Pupitre · <button class="link-q" data-legal="privacidad">Privacidad</button> · <button class="link-q" data-legal="terminos">Términos</button> · <button class="link-q" data-legal="cookies">Cookies</button></p>`;
  } catch { r.innerHTML = ''; }
}

/* ── Publicaciones ── */
function postHTML(p, i = 0, still) {
  const a = p.author, aud = AUD[p.audience] || AUD.publico;
  const showC = p.comments.length || SOC.open.has(p.id);
  return `<article class="post ${still ? 'still' : ''} ${p.pending ? 'pending' : ''}" id="post-${p.id}" style="animation-delay:${Math.min(i, 6) * 45}ms" aria-labelledby="pa-${p.id}">
    <header class="post-h">
      <button class="avbtn" data-act="uid" data-id="${a.id}" aria-label="Perfil de ${esc(a.name)}">${avatarHTML(a)}</button>
      <div class="who"><button class="cname" id="pa-${p.id}" data-act="uid" data-id="${a.id}">${esc(a.name)}</button>${p.group ? `<span class="to"> ${icon('right')} <button class="cname" data-act="group" data-id="${p.group.id}">${esc(p.group.name)}</button></span>` : ''}
        <small><span>${esc([a.career, shortUni(a.university)].filter(Boolean).join(' · '))}</span><span aria-hidden="true">·</span>${p.pending ? '<span class="pend">Publicando…</span>' : `<time datetime="${p.createdAt}">${esc(ago(p.createdAt))}</time>`}<span aria-hidden="true">·</span><span title="Visible para: ${aud.l}" aria-label="Visible para: ${aud.l}">${icon(aud.i)}</span></small></div>
      <div class="rel"><button class="btn btn-ghost btn-icon btn-sm" style="border-color:transparent" data-act="menu" data-id="${p.id}" aria-label="Opciones de la publicación" aria-haspopup="menu">${icon('dots')}</button></div>
    </header>
    ${p.kind === 'question' ? '<span class="qtag">Pregunta</span>' : ''}
    ${p.text ? `<div class="post-t">${richText(p.text)}</div>` : ''}
    ${p.flyer ? flyerHTML(p.flyer) : ''}
    ${p.images && p.images.length ? `<div class="post-media n${Math.min(p.images.length, 4)}">${p.images.slice(0, 4).map((src, j) => anyImg(src, `Foto ${j + 1} de ${a.name}`, 1000)).join('')}</div>` : ''}
    ${p.hidden ? `<p class="notice" style="margin:0 16px 12px">${icon('flag')}<span>Oculta por reportes de la comunidad. Solo tú la ves mientras se revisa.</span></p>` : ''}
    ${p.poll ? pollHTML(p) : ''}
    ${p.product ? embedProduct(p.product) : ''}
    ${p.event ? embedEvent(p.event) : ''}
    <div class="post-stats"><span class="lk">${p.likes ? `<i>${icon('heart')}</i>${p.liked ? (p.likes > 1 ? 'Tú y ' + (p.likes - 1) + ' más' : 'Te gusta') : p.likes}` : ''}</span>${p.comments.length ? `<button class="link-q" data-act="comment" data-id="${p.id}">${p.comments.length} comentario${p.comments.length > 1 ? 's' : ''}</button>` : ''}</div>
    <div class="post-acts">
      <button data-act="like" data-id="${p.id}" aria-pressed="${p.liked}">${icon('heart')}Me gusta</button>
      <button data-act="comment" data-id="${p.id}">${icon('chat')}Comentar</button>
      <button data-act="share" data-id="${p.id}">${icon('share')}Compartir</button>
    </div>
    <div class="cmts" id="cm-${p.id}" ${showC ? '' : 'hidden'}>${commentsHTML(p)}</div>
  </article>`;
}
function pollHTML(p) {
  const pl = p.poll, voted = pl.voted > -1;
  return `<div class="poll" role="group" aria-label="Encuesta">${pl.options.map((o, i) => {
    const pct = pl.total ? Math.round(o.votes / pl.total * 100) : 0;
    return `<button data-act="vote" data-id="${p.id}" data-i="${i}" aria-pressed="${pl.voted === i}">${voted ? `<i class="bar" style="width:${pct}%"></i>` : ''}<span>${pl.voted === i ? icon('check') + ' ' : ''}${esc(o.t)}</span>${voted ? `<span class="pct">${pct}%</span>` : ''}</button>`;
  }).join('')}<small class="hint">${pl.total} voto${pl.total === 1 ? '' : 's'}${voted ? ' · Puedes cambiar tu voto' : ' · Toca una opción para votar'}</small></div>`;
}
function commentsHTML(p) {
  const all = SOC.all.has(p.id), list = all ? p.comments : p.comments.slice(-2), more = p.comments.length - list.length;
  return `${more > 0 ? `<button class="link-q" style="justify-self:start" data-act="morecm" data-id="${p.id}">Ver ${more} comentario${more > 1 ? 's' : ''} más</button>` : ''}
    ${list.map(c => `<div class="cmt ${c.pending ? 'pending' : ''}"><button class="avbtn" data-act="uid" data-id="${c.author.id}" aria-label="Perfil de ${esc(c.author.name)}">${avatarHTML(c.author, 'sm')}</button><div><div class="bubble"><button class="cname" data-act="uid" data-id="${c.author.id}">${esc(c.author.name)}</button>${richText(c.text)}</div><small class="hint">${esc(ago(c.createdAt))}</small></div></div>`).join('')}
    ${S.user ? `<form class="cmt-form" data-post="${p.id}">${avatarHTML(meU(), 'sm')}<label class="sr" for="ci-${p.id}">Escribe un comentario</label><input id="ci-${p.id}" maxlength="500" placeholder="Escribe un comentario…" autocomplete="off"><button class="btn btn-ghost btn-icon btn-sm" aria-label="Enviar comentario">${icon('send')}</button></form>`
    : `<button class="link" style="justify-self:start" data-act="login">Inicia sesión para comentar</button>`}`;
}
function rerenderPost(id) {
  const el = document.getElementById('post-' + id), p = SOC.posts.get(id);
  if (!el || !p) return;
  const inp = document.getElementById('ci-' + id), val = inp ? inp.value : '', had = !!inp && document.activeElement === inp;
  el.outerHTML = postHTML(p, 0, true);
  const n = document.getElementById('ci-' + id);
  if (n && (val || had)) { n.value = val; if (had) n.focus(); }
}
const skelPosts = () => Array.from({ length: 2 }, () => `<div class="post still" aria-hidden="true"><div class="post-h"><span class="av" style="--c:var(--paper-2);border-color:transparent"></span><div class="who"><div class="skel" style="height:12px;width:40%;border:0"><div class="b" style="margin:0"></div></div></div></div><div class="skel" style="border:0;border-radius:0"><div class="b"></div><div class="b"></div><div class="a" style="aspect-ratio:16/9"></div></div></div>`).join('');

async function loadPosts(o = {}, append = false) {
  const box = $('#posts'); if (!box) return;
  if (!append) { SOC.query = { filter: SOC.tab, tag: SOC.tag, ...o }; SOC.page = 1; }
  else SOC.page++;
  const fk = JSON.stringify([SOC.query, SOC.page, !!S.user]), quiet = FEED_FRESH.has(fk), cached = !append && FEED_CACHE.get(fk);
  if (!append && !cached) box.innerHTML = skelPosts();
  const seq = SOC.seq = (SOC.seq || 0) + 1;
  $('#morePosts')?.remove();
  try {
    let r;
    if (cached) r = cached;
    else if (!append && SOC.prefetch && SOC.prefetch.key === fk) { r = await SOC.prefetch.p; SOC.prefetch = null; }
    else r = await api('socialFeed', getToken(), { ...SOC.query, page: SOC.page });
    if (!append && seq !== SOC.seq) return;
    FEED_CACHE.set(fk, r);
    if (cached && !FEED_FRESH.delete(fk)) api('socialFeed', getToken(), { ...SOC.query, page: 1 }).then(x => { if (JSON.stringify(x.posts) !== JSON.stringify(cached.posts)) { FEED_CACHE.set(fk, x); FEED_FRESH.add(fk); if (seq === SOC.seq && document.getElementById('posts') === box) loadPosts(o); } }).catch(() => {});
    SOC.version = Math.max(SOC.version || 0, r.version || 0);
    r.posts.forEach(p => SOC.posts.set(p.id, p));
    const html = r.posts.map((p, i) => postHTML(p, i, quiet)).join('');
    if (append) box.insertAdjacentHTML('beforeend', html);
    else box.innerHTML = r.posts.length ? html
      : `<div class="empty">${icon('chat')}<h3>${o.authorId ? 'Aún no hay publicaciones' : 'Nada por aquí todavía'}</h3><p>${SOC.tab === 'siguiendo' ? 'Sigue a compañeros para ver lo que publican.' : 'Sé la primera persona en compartir algo con tu comunidad.'}</p></div>`;
    if (r.hasMore) { box.insertAdjacentHTML('afterend', `<button class="btn btn-ghost btn-block" id="morePosts">Ver más publicaciones</button>`); $('#morePosts').onclick = e => { busy(e.currentTarget, true); loadPosts(o, true); }; }
    if ($('#newPill') && !append) $('#newPill').hidden = true;
  } catch (e) {
    if (append) { SOC.page--; toast(e.message, 'err'); return; }
    box.innerHTML = `<div class="empty">${icon('alert')}<h3>No pudimos cargar el muro</h3><p>${esc(e.message)}</p><button class="btn btn-primary" onclick="loadPosts()">Reintentar</button></div>`;
  }
}

function composerHTML(groupId) {
  const u = meU();
  return `<form class="composer" id="composer" data-group="${groupId || ''}" novalidate>
    <div class="comp-top">${avatarHTML(u)}<label class="sr" for="cText">Crear publicación</label><textarea id="cText" rows="1" maxlength="2000" placeholder="¿Qué hay de nuevo, ${esc(u.name.split(' ')[0])}?"></textarea></div>
    <div class="comp-media" id="cMedia"></div>
    <div class="comp-poll" id="cPoll" hidden><p class="lbl">Opciones de la encuesta</p><div id="cPollOpts" style="display:grid;gap:8px"></div><button type="button" class="link" style="justify-self:start" id="cPollAdd">+ Agregar opción</button></div>
    <div class="comp-bar">
      <button type="button" class="tool t-img" id="cImgBtn">${icon('image')}<span>Foto</span></button>
      <input type="file" id="cFile" accept="image/jpeg,image/png,image/webp" multiple class="sr" tabindex="-1" aria-hidden="true">
      <button type="button" class="tool t-poll" id="cPollBtn" aria-pressed="false">${icon('poll')}<span>Encuesta</span></button>
      <button type="button" class="tool t-sell" data-go="sell">${icon('tag')}<span>Vender</span></button>
      <label class="sr" for="cAud">Quién puede verlo</label>
      <select class="input" id="cAud">${Object.entries(AUD).map(([k, a]) => `<option value="${k}">${a.l}</option>`).join('')}</select>
      <button class="btn btn-primary btn-sm" type="submit" id="cSubmit">Publicar</button>
    </div>
  </form>`;
}
function bindComposer() {
  const f = $('#composer'); if (!f) return;
  const ta = $('#cText'), opts = $('#cPollOpts');
  let imgs = [], pollOn = false;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 280) + 'px'; };
  ta.oninput = grow;
  const drawMedia = () => {
    $('#cMedia').innerHTML = imgs.map((j, i) => `<div class="thumb ${!j.done ? 'up' : j.error ? 'fail' : ''}"><img src="${j.dataUrl}" alt="Foto ${i + 1}"><div class="ctl"><span></span><button type="button" data-rmi="${i}" aria-label="Quitar foto ${i + 1}">${icon('trash')}</button></div></div>`).join('');
    $$('[data-rmi]', f).forEach(b => b.onclick = () => { imgs.splice(+b.dataset.rmi, 1); drawMedia(); });
  };
  $('#cImgBtn').onclick = () => $('#cFile').click();
  $('#cFile').onchange = async e => {
    const files = [...e.target.files].slice(0, (S.cfg.maxPostImages || 4) - imgs.length);
    if (e.target.files.length > files.length) toast('Máximo 4 fotos por publicación', 'err');
    e.target.value = '';
    await Promise.all(files.map(async file => {
      try {
        const j = startUpload(await compressImage(file), 'post');
        imgs.push(j); drawMedia();
        j.promise.then(drawMedia, () => { drawMedia(); toast('No se pudo subir una foto. Quítala e inténtalo de nuevo.', 'err'); });
      } catch (x) { toast(x.message, 'err'); }
    }));
  };
  const addOpt = () => { if (opts.children.length >= 4) return toast('Máximo 4 opciones', 'err'); const i = opts.children.length + 1; opts.insertAdjacentHTML('beforeend', `<input class="input" maxlength="60" placeholder="Opción ${i}" aria-label="Opción ${i}">`); opts.lastElementChild.focus(); };
  const setPoll = on => { pollOn = on; $('#cPoll').hidden = !on; $('#cPollBtn').setAttribute('aria-pressed', on); if (on && !opts.children.length) { addOpt(); addOpt(); opts.firstElementChild.focus(); } if (!on) opts.innerHTML = ''; };
  $('#cPollBtn').onclick = () => setPoll(!pollOn);
  $('#cPollAdd').onclick = addOpt;
  f.onsubmit = async e => {
    e.preventDefault();
    const text = ta.value.trim(), options = pollOn ? $$('input', opts).map(i => i.value.trim()).filter(Boolean) : [];
    if (!text && !imgs.length) { toast('Escribe algo o agrega una foto', 'err'); ta.focus(); return; }
    if (pollOn && options.length < 2) { toast('La encuesta necesita al menos 2 opciones', 'err'); return; }
    if (imgs.some(j => j.error)) { toast('Quita las fotos que no se pudieron subir', 'err'); return; }
    const jobs = imgs.slice(), audience = $('#cAud').value, groupId = f.dataset.group || '', poll = pollOn ? options : null;
    // Se muestra al instante; el servidor confirma en segundo plano
    const tmp = { id: 'tmp' + Date.now(), author: meU(), group: null, kind: poll ? 'question' : 'post', audience, createdAt: new Date().toISOString(), text, images: jobs.map(j => j.dataUrl), likes: 0, liked: false, comments: [], poll: poll ? { options: poll.map(t => ({ t, votes: 0 })), voted: -1, total: 0 } : null, mine: true, pending: true };
    const box = $('#posts'); box.querySelector('.empty')?.remove(); box.insertAdjacentHTML('afterbegin', postHTML(tmp));
    ta.value = ''; grow(); imgs = []; drawMedia(); setPoll(false);
    try {
      const ids = await Promise.all(jobs.map(j => j.promise));
      const p = await api('createPost', getToken(), { text, audience, images: ids, groupId, poll });
      SOC.posts.set(p.id, p);
      const el = document.getElementById('post-' + tmp.id); if (el) el.outerHTML = postHTML(p, 0, true);
      toast('¡Publicado!');
    } catch (x) {
      document.getElementById('post-' + tmp.id)?.remove();
      if (!ta.value) { ta.value = text; grow(); }
      imgs = jobs.filter(j => !j.error); drawMedia();
      toast(x.message + ' Tu texto sigue en el cuadro para reintentar.', 'err');
    }
  };
}

async function loadStories() {
  const box = $('#stories'); if (!box) return;
  try {
    SOC.stories = await api('stories', getToken());
    box.innerHTML = (S.user ? `<button class="story add" data-act="newstory">${icon('plus')}<strong>Tu historia</strong></button>` : '')
      + SOC.stories.map((s, i) => `<button class="story ${s.image ? 'has-img' : ''}" style="--c:${s.color}" data-act="story" data-i="${i}" aria-label="Historia de ${esc(s.author.name)}: ${esc(s.title)}">${s.image ? anyImg(s.image, '', 300) : icon(s.icon, 'ico big')}${avatarHTML(s.author)}<strong>${esc(s.title)}</strong></button>`).join('');
  } catch { box.remove(); }
}
function openStory(i) {
  const d = $('#dlgStory'); let idx = i, timer;
  const show = () => {
    const s = SOC.stories[idx];
    if (!s) { d.close(); return; }
    d.innerHTML = `<div class="sv" style="--c:${s.color}">
      <div class="sv-bars" aria-hidden="true">${SOC.stories.map((_, j) => `<i class="${j < idx ? 'done' : j === idx ? 'run' : ''}"></i>`).join('')}</div>
      <div class="sv-head">${avatarHTML(s.author, 'sm')}<div><strong>${esc(s.author.name)}</strong> <small>${esc(shortAgo(s.createdAt))}</small></div><button class="btn btn-icon" data-close aria-label="Cerrar historia">${icon('x')}</button></div>
      ${s.image ? `<div class="sv-img">${anyImg(s.image, s.title, 900)}</div>` : ''}
      <div class="sv-body">${s.image ? '' : icon(s.icon, 'ico big')}<span class="flyer-tag">${esc(s.tag)}</span><strong id="svT">${esc(s.title)}</strong>${s.sub ? `<p>${esc(s.sub)}</p>` : ''}
        ${s.eventId ? `<button class="btn btn-primary" style="align-self:flex-start;position:relative;z-index:4" data-svgo="events">${icon('calendar')}Ver evento</button>` : ''}
        ${s.mine ? `<button class="btn btn-ghost" style="align-self:flex-start;position:relative;z-index:4;border-color:#14243B;color:#14243B" data-svdel="${s.id}">${icon('trash')}Borrar historia</button>` : ''}</div>
      <button class="sv-prev" aria-label="Historia anterior"></button><button class="sv-next" aria-label="Historia siguiente"></button></div>`;
    $$('[data-close]', d).forEach(b => b.onclick = () => d.close());
    $('[data-svgo]', d)?.addEventListener('click', () => { d.close(); go({ name: 'events' }); });
    $('[data-svdel]', d)?.addEventListener('click', async e => { clearTimeout(timer); try { await api('deleteStory', getToken(), e.currentTarget.dataset.svdel); d.close(); toast('Historia borrada'); loadStories(); } catch (x) { toast(x.message, 'err'); } });
    $('.sv-prev', d).onclick = () => { idx = Math.max(0, idx - 1); show(); };
    $('.sv-next', d).onclick = () => { idx++; show(); };
    clearTimeout(timer); timer = setTimeout(() => { idx++; show(); }, 5000);
  };
  d.setAttribute('aria-labelledby', 'svT');
  d.onclose = () => clearTimeout(timer);
  d.onkeydown = e => { if (e.key === 'ArrowRight') { idx++; show(); } if (e.key === 'ArrowLeft') { idx = Math.max(0, idx - 1); show(); } };
  show(); if (!d.open) d.showModal();
}

/* ── Vistas ── */
function renderFeed() {
  const tabs = [['para-ti', 'Para ti'], ['universidad', 'Mi universidad'], ['siguiendo', 'Siguiendo'], ['preguntas', 'Preguntas y encuestas']];
  view.innerHTML = socShell('feed', `
    <div class="stories" id="stories" aria-label="Historias"></div>
    ${S.user ? composerHTML() : `<div class="joincta"><div><h3>Tu campus, en un solo lugar</h3><p>Únete para publicar, comentar, unirte a grupos y escribir a tus compañeros.</p></div><button class="btn btn-lime" data-act="login">Crear cuenta gratis</button></div>`}
    <div class="feed-tabs" role="tablist" aria-label="Filtrar el muro">${tabs.map(([k, l]) => `<button class="chip" role="tab" data-ftab="${k}" aria-selected="${SOC.tab === k}" aria-pressed="${SOC.tab === k}">${l}</button>`).join('')}</div>
    ${SOC.tag ? `<div class="tagbar"><span>Mostrando publicaciones con <b>#${esc(SOC.tag)}</b></span><button class="btn btn-ghost btn-sm" id="clearTag">${icon('x')}Quitar filtro</button></div>` : ''}
    <button class="btn btn-primary btn-sm newpill" id="newPill" hidden>${icon('arrow')}Nuevas publicaciones</button>
    <div id="posts" class="posts" aria-live="polite"></div>`);
  bindComposer();
  $$('[data-ftab]').forEach(b => b.onclick = () => { SOC.tab = b.dataset.ftab; $$('[data-ftab]').forEach(x => { x.setAttribute('aria-selected', x === b); x.setAttribute('aria-pressed', x === b); }); loadPosts(); });
  $('#clearTag')?.addEventListener('click', () => { SOC.tag = ''; renderFeed(); });
  $('#newPill').onclick = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); loadPosts(); };
  loadStories(); loadPosts(); loadRight(); loadMyGroups();
  if (SOC.focusComposer) { SOC.focusComposer = false; setTimeout(() => $('#cText')?.focus(), 80); }
}
async function renderGroups() {
  view.innerHTML = socShell('groups', `<div class="sec-head row-head"><div><h1>Grupos</h1><p>Comunidades de tu carrera, clubes estudiantiles y ayuda entre compañeros.</p></div><button class="btn btn-primary" data-act="newgroup">${icon('plus')}Crear grupo</button></div><div class="g-grid" id="gGrid"><div class="loading" style="min-height:200px;grid-column:1/-1"><div class="spinner"></div></div></div>`);
  loadRight(); loadMyGroups();
  try {
    const rs = S.rseq, gs = await api('groups', getToken());
    if (rs !== S.rseq || !$('#gGrid')) return;
    $('#gGrid').innerHTML = gs.map((g, i) => `<article class="gcard" style="animation-delay:${i * 40}ms"><button class="cover" style="--c:${g.color}" data-act="group" data-id="${g.id}" aria-label="Abrir ${esc(g.name)}">${icon(g.icon, 'ico big')}</button><div class="body"><h3><button class="cname" data-act="group" data-id="${g.id}">${esc(g.name)}</button></h3><span class="meta-i">${icon(g.privacy === 'Privado' ? 'lock' : 'globe')}${g.privacy} · <span data-gm="${g.id}">${g.members}</span> miembros</span><p>${esc(g.desc)}</p>${joinBtn(g)}</div></article>`).join('');
  } catch (e) { if ($('#gGrid')) $('#gGrid').innerHTML = `<div class="empty">${icon('alert')}<p>${esc(e.message)}</p></div>`; }
}
async function renderGroup(id) {
  view.innerHTML = socShell('groups', '<div class="loading"><div class="spinner"></div></div>');
  loadRight(); loadMyGroups();
  try {
    const rs = S.rseq, g = await api('group', getToken(), id);
    if (rs !== S.rseq || !$('#socMain')) return;
    $('#socMain').innerHTML = `<div class="cover-band" style="--c:${g.color}">${icon(g.icon, 'ico big')}</div>
      <div class="ghead"><div><h1>${esc(g.name)}</h1><p class="meta-i">${icon(g.privacy === 'Privado' ? 'lock' : 'globe')}Grupo ${g.privacy.toLowerCase()} · <span data-gm="${g.id}">${g.members}</span> miembros</p><p>${esc(g.desc)}</p></div>${joinBtn(g)}</div>
      ${g.isOwner && g.requests ? `<section class="panel" id="gReq"><h3>Solicitudes para unirse (${g.requests})</h3><div class="spinner" style="margin:10px auto"></div></section>` : ''}
      ${S.user && g.joined ? composerHTML(g.id) : `<div class="notice">${icon(g.privacy === 'Privado' ? 'lock' : 'users')}<span>${g.privacy === 'Privado' ? (g.pending ? 'Tu solicitud está pendiente. Verás las publicaciones cuando te acepten.' : 'Grupo privado: solo sus miembros ven las publicaciones. Solicita unirte.') : 'Únete al grupo para publicar y comentar.'}</span></div>`}
      <div id="posts" class="posts"></div>`;
    bindComposer(); loadPosts({ filter: 'todo', groupId: id, tag: '' });
    if (g.isOwner && g.requests) loadRequests(g);
  } catch (e) { if ($('#socMain')) $('#socMain').innerHTML = `<div class="empty">${icon('alert')}<h3>Grupo no disponible</h3><p>${esc(e.message)}</p></div>`; }
}
async function loadRequests(g) {
  const box = $('#gReq'); if (!box) return;
  try {
    const list = await api('groupRequests', getToken(), g.id);
    box.innerHTML = `<h3>Solicitudes para unirse (${list.length})</h3>` + (list.length ? list.map(u => `<div class="prow" data-req="${u.id}"><button class="avbtn" data-act="uid" data-id="${u.id}">${avatarHTML(u, 'sm')}</button><div><button class="cname" data-act="uid" data-id="${u.id}">${esc(u.name)}</button><small class="hint">${esc([u.career, shortUni(u.university)].filter(Boolean).join(' · ') || 'Sin datos de carrera')}</small></div><button class="btn btn-primary btn-sm" data-ans="1">Aceptar</button><button class="btn btn-ghost btn-sm" data-ans="0">Rechazar</button></div>`).join('') : '<p class="hint">No hay solicitudes pendientes.</p>');
    $$('[data-ans]', box).forEach(b => b.onclick = async () => {
      const row = b.closest('[data-req]'); busy(b, true);
      try { await api('answerRequest', getToken(), g.id, row.dataset.req, b.dataset.ans === '1'); row.remove(); toast(b.dataset.ans === '1' ? 'Solicitud aceptada' : 'Solicitud rechazada'); }
      catch (x) { toast(x.message, 'err'); busy(b, false); }
    });
  } catch (x) { box.innerHTML = `<p class="hint">${esc(x.message)}</p>`; }
}
async function renderEvents() {
  view.innerHTML = socShell('events', `<div class="sec-head row-head"><div><h1>Eventos</h1><p>Lo que pasa en tu campus estos días. Marca “Asistiré” y te recordamos.</p></div><button class="btn btn-primary" data-act="newevent">${icon('plus')}Crear evento</button></div><div id="evList" class="ev-list"><div class="loading" style="min-height:200px"><div class="spinner"></div></div></div>`);
  loadRight(); loadMyGroups();
  const rs = S.rseq;
  let evs;
  try { evs = await api('events', getToken()); } catch (e) { if ($('#evList')) $('#evList').innerHTML = `<div class="empty">${icon('alert')}<p>${esc(e.message)}</p></div>`; return; }
  if (rs !== S.rseq || !$('#evList')) return;
  if (!evs.length) { $('#evList').innerHTML = `<div class="empty">${icon('calendar')}<h3>No hay eventos próximos</h3><p>Organiza un taller, una salida o un grupo de estudio y aparecerá aquí.</p><button class="btn btn-primary" data-act="newevent">${icon('plus')}Crear evento</button></div>`; return; }
  $('#evList').innerHTML = evs.map((ev, i) => `<article class="ecard" style="animation-delay:${i * 50}ms">${flyerHTML({ color: ev.color, tag: ev.group || 'Evento abierto', title: ev.title, sub: fmtEvDate(ev.date) + ' · ' + ev.place, icon: ev.icon })}<div class="ebody"><div><strong>${esc(ev.title)}</strong><small class="hint">${esc(fmtEvDate(ev.date))} · ${esc(ev.place)}</small><small class="hint"><span data-eg="${ev.id}">${ev.going}</span> personas asistirán</small></div><div class="actions" style="flex:0">${ev.mine ? `<button class="btn btn-ghost btn-icon" data-act="delevent" data-id="${ev.id}" aria-label="Eliminar evento">${icon('trash')}</button>` : ''}${rsvpBtn(ev, '')}</div></div></article>`).join('');
}
async function renderUser(id) {
  if (!id || id === 'me') { if (!S.user) return openAuth('login', () => go({ name: 'user', id: 'me' })); id = S.user.id; }
  view.innerHTML = socShell(S.user && id === S.user.id ? 'me' : '', '<div class="loading"><div class="spinner"></div></div>');
  loadRight(); loadMyGroups();
  try {
    const rs = S.rseq, r = await api('userProfile', getToken(), id), u = r.user;
    if (rs !== S.rseq || !$('#socMain')) return;
    $('#socMain').innerHTML = `<div class="cover-band" style="--c:${u.color}"></div>
      <div class="uhead">${avatarHTML(u, 'lg')}<div class="uinfo"><h1>${esc(u.name)}</h1><p class="hint">${esc([u.career, u.university].filter(Boolean).join(' · '))}</p></div>
        <div class="uacts">${r.isMe ? `<button class="btn btn-ghost" data-act="editprofile">${icon('edit')}Editar perfil</button><button class="btn btn-ghost" data-act="mylistings">${icon('tag')}Mis ventas</button>` : `${followBtn({ id: u.id, following: r.following }, true)}<button class="btn btn-ghost" data-act="dm" data-id="${u.id}" ${S.user && !r.canDm ? 'disabled title="Solo recibe mensajes de quienes sigue"' : ''}>${icon('chat')}Mensaje</button>`}</div></div>
      ${u.bio ? `<p class="ubio">${esc(u.bio)}</p>` : ''}
      ${r.restricted ? `<p class="notice" style="margin:0 20px">${icon('lock')}<span>Este perfil solo muestra sus datos completos a su universidad y a quienes sigue.</span></p>` : ''}
      <div class="stats"><span><b>${r.stats.posts}</b>publicaciones</span><span><b id="stFollowers">${r.stats.followers}</b>seguidores</span><span><b>${r.stats.following}</b>siguiendo</span></div>
      <div class="ptabs" role="tablist" style="margin-bottom:0"><button role="tab" data-ut="posts" aria-selected="true">Publicaciones</button><button role="tab" data-ut="market" aria-selected="false">Marketplace (${r.listings.length})</button></div>
      <div id="uBody" class="soc-main"></div>`;
    const tab = t => {
      $$('[data-ut]').forEach(b => b.setAttribute('aria-selected', b.dataset.ut === t));
      const body = $('#uBody');
      if (t === 'posts') { body.innerHTML = (r.isMe ? composerHTML() : '') + '<div id="posts" class="posts"></div>'; bindComposer(); loadPosts({ filter: 'todo', authorId: id, tag: '' }); }
      else { body.innerHTML = r.listings.length ? `<div class="grid">${r.listings.map(cardHTML).join('')}</div>` : `<div class="empty">${icon('tag')}<h3>Sin artículos a la venta</h3></div>`; bindCards(body); }
    };
    $$('[data-ut]').forEach(b => b.onclick = () => tab(b.dataset.ut));
    tab('posts');
  } catch (e) { if ($('#socMain')) $('#socMain').innerHTML = `<div class="empty">${icon('alert')}<h3>Perfil no disponible</h3><p>${esc(e.message)}</p></div>`; }
}

/* ── Mensajes ── */
async function renderMessages(withUser) {
  if (!S.user) return openAuth('login', () => go({ name: 'messages', id: withUser }), 'Ingresa para ver tus mensajes');
  view.innerHTML = `<div class="wrap"><div class="chat" id="chat">
    <aside class="clist" aria-label="Conversaciones"><div class="clist-h"><h2>Mensajes</h2><p>${icon('lock')}Solo tú y la otra persona pueden leerlos.</p></div><div id="cList"><div class="spinner" style="margin:30px auto"></div></div></aside>
    <section class="cpane" id="cPane"><div class="cempty">${icon('chat')}<h3>Tus conversaciones</h3><p>Escribe a compañeros, vendedores o a tu grupo de estudio.</p></div></section></div></div>`;
  let cid = null;
  const rs = S.rseq;
  try { if (withUser) cid = await api('openConversation', getToken(), withUser); } catch (e) { toast(e.message, 'err'); }
  if (rs !== S.rseq) return;
  try { await drawConvos(cid); } catch (e) { if ($('#cList')) $('#cList').innerHTML = `<p class="hint" style="padding:16px">${esc(e.message)}</p>`; return; }
  if (rs !== S.rseq) return;
  if (cid) openConvo(cid);
}
async function drawConvos(active) {
  if (!$('#cList')) return;
  const list = await api('conversations', getToken());
  const box = $('#cList'); if (!box) return;
  box.innerHTML = list.length ? list.map(c => `<button data-cid="${c.id}" aria-current="${c.id === active}">${avatarHTML(c.with)}<span style="min-width:0;flex:1"><strong>${esc(c.with.name)}</strong><small>${c.lastMine ? 'Tú: ' : ''}${esc(c.last)}</small></span><span class="ctime">${esc(shortAgo(c.at))}${c.unread ? `<i class="dot" aria-label="Sin leer"></i>` : ''}</span></button>`).join('')
    : '<p class="hint" style="padding:16px">Aún no tienes conversaciones.</p>';
  $$('[data-cid]', box).forEach(b => b.onclick = () => openConvo(b.dataset.cid));
}
const msgHTML = m => `<div class="msg ${m.mine ? 'mine' : ''}">${esc(m.text)}<small>${new Date(m.at).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' })}</small></div>`;
async function openConvo(cid) {
  SOC.convo = cid; clearInterval(SOC.chatTimer);
  $$('[data-cid]').forEach(b => b.setAttribute('aria-current', b.dataset.cid === cid));
  $('#chat').classList.add('open');
  const pane = $('#cPane');
  pane.innerHTML = '<div class="cempty"><div class="spinner"></div></div>';
  let c;
  try { c = await api('messages', getToken(), cid); } catch (e) { pane.innerHTML = `<div class="cempty">${icon('alert')}<p>${esc(e.message)}</p></div>`; return; }
  if (SOC.convo !== cid || !pane.isConnected) return;
  let count = c.messages.length;
  pane.innerHTML = `<header class="chead"><button class="btn btn-ghost btn-icon btn-sm cback" aria-label="Volver a conversaciones">${icon('left')}</button><button class="avbtn" data-act="uid" data-id="${c.with.id}" aria-label="Perfil de ${esc(c.with.name)}">${avatarHTML(c.with, 'sm')}</button><div><strong>${esc(c.with.name)}</strong><small class="hint">${esc([c.with.career, shortUni(c.with.university)].filter(Boolean).join(' · '))}</small></div></header>
    <div class="msgs" id="msgs" aria-live="polite">${c.messages.length ? c.messages.map(msgHTML).join('') : '<p class="hint" style="margin:auto;text-align:center">Saluda a ' + esc(c.with.name.split(' ')[0]) + ' 👋</p>'}</div>
    <form class="cform" id="cForm"><label class="sr" for="mIn">Escribe un mensaje</label><input class="input" id="mIn" maxlength="1000" placeholder="Escribe un mensaje…" autocomplete="off"><button class="btn btn-primary btn-icon" aria-label="Enviar mensaje">${icon('send')}</button></form>`;
  const box = $('#msgs'); box.scrollTop = box.scrollHeight;
  $('.cback', pane).onclick = () => $('#chat').classList.remove('open');
  const sync = async () => {
    if (SOC.convo !== cid || !document.getElementById('msgs')) return clearInterval(SOC.chatTimer);
    if (document.hidden) return;
    try {
      const c2 = await api('messages', getToken(), cid);
      if (c2.messages.length !== count) { count = c2.messages.length; box.innerHTML = c2.messages.map(msgHTML).join(''); box.scrollTop = box.scrollHeight; drawConvos(cid); }
    } catch {}
  };
  SOC.chatTimer = setInterval(sync, 2500);
  $('#cForm').onsubmit = async e => {
    e.preventDefault();
    const inp = $('#mIn'), t = inp.value.trim(); if (!t) return;
    inp.value = '';
    box.querySelector('p.hint')?.remove();
    box.insertAdjacentHTML('beforeend', msgHTML({ mine: true, text: t, at: new Date().toISOString() }));
    box.insertAdjacentHTML('beforeend', '<div class="msg typing" id="typing" aria-label="Escribiendo"><span></span><span></span><span></span></div>');
    box.scrollTop = box.scrollHeight;
    try { await api('sendMessage', getToken(), cid, t); count++; drawConvos(cid); }
    catch (x) { toast(x.message, 'err'); }
    setTimeout(() => document.getElementById('typing')?.remove(), 6000);
  };
  $('#mIn').focus();
  refreshPulse();
}

/* ── Notificaciones y pulso en vivo ── */
function renderBell() {
  const slot = $('#bellSlot'); if (!slot) return;
  if (!S.user) { slot.innerHTML = ''; return; }
  slot.innerHTML = `<button class="btn btn-ghost btn-icon" id="bellBtn" aria-haspopup="true" aria-expanded="false" aria-label="Notificaciones">${icon('bell')}<span class="badge" id="bellBadge" hidden></span></button><div class="menu notif" id="notifPanel" role="region" aria-label="Notificaciones"></div>`;
  const b = $('#bellBtn'), p = $('#notifPanel');
  const close = () => { p.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); };
  b.onclick = async e => {
    e.stopPropagation();
    const o = p.classList.toggle('open'); b.setAttribute('aria-expanded', o);
    if (!o) return;
    p.innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
    try {
      const list = await api('notifications', getToken());
      p.innerHTML = `<div class="who" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><strong>Notificaciones</strong><button class="link-q" id="markAll">Marcar todo como leído</button></div>`
        + (list.length ? list.map((n, i) => `<button class="nitem ${n.read ? '' : 'unread'}" data-ni="${i}"><span class="nic">${icon(n.icon)}</span><span><span>${esc(n.text)}</span><small class="hint">${esc(ago(n.at))}</small></span></button>`).join('') : '<p class="hint" style="padding:12px">No tienes notificaciones.</p>');
      $$('[data-ni]', p).forEach(x => x.onclick = () => { close(); go(list[+x.dataset.ni].link); });
      $('#markAll').onclick = async ev => { ev.stopPropagation(); await api('markNotifs', getToken()); $$('.nitem', p).forEach(x => x.classList.remove('unread')); refreshPulse(); };
    } catch (x) { p.innerHTML = `<p class="hint" style="padding:12px">${esc(x.message)}</p>`; }
  };
  p.onclick = e => e.stopPropagation();
  document.addEventListener('click', close);
  p.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); b.focus(); } });
}
function setBadge(sel, n) { const b = $(sel); if (!b) return; b.hidden = !n; b.textContent = n > 9 ? '9+' : n; }
async function refreshPulse() {
  if (!S.user) { setBadge('#msgBadge', 0); setBadge('#tabMsgBadge', 0); return; }
  try {
    const r = await api('socialPulse', getToken());
    setBadge('#bellBadge', r.unread); setBadge('#msgBadge', r.unreadMsgs); setBadge('#tabMsgBadge', r.unreadMsgs);
    if (S.route.name === 'feed' && SOC.version && r.version > SOC.version && $('#newPill')) $('#newPill').hidden = false;
  } catch {}
}

/* ── Publicar (botón + móvil) ── */
function openPublish() {
  requireAuth(() => {
    const d = $('#dlgConfirm');
    d.innerHTML = `<div class="dlg-head"><h2 id="cfTitle">¿Qué quieres hacer?</h2><button class="btn btn-ghost btn-icon" data-close aria-label="Cerrar">${icon('x')}</button></div>
      <div class="dlg-body pubpick"><button data-pick="post">${icon('edit')}<strong>Publicar en el muro</strong><small>Comparte una idea, foto, pregunta o encuesta.</small></button><button data-pick="sell">${icon('tag')}<strong>Vender algo</strong><small>Publica un curso, accesorio o equipo en el Marketplace.</small></button></div>`;
    d.onclose = null; bindClose(d); d.showModal();
    $$('[data-pick]', d).forEach(b => b.onclick = () => { d.close(); if (b.dataset.pick === 'sell') go({ name: 'sell' }); else if (S.route.name === 'feed') $('#cText')?.focus(); else { SOC.focusComposer = true; go({ name: 'feed' }); } });
  }, 'Ingresa para publicar');
}

/* ── Crear historia, grupo y evento ── */
const SWATCHES = ['var(--lime)', 'var(--lilac)', 'var(--mint)', 'var(--sky)', 'var(--tang)'];
const swatchHTML = (name, sel) => `<div class="swatches" role="radiogroup" aria-label="Color">${SWATCHES.map((c, i) => `<label><input type="radio" name="${name}" value="${c}" ${c === sel || (!sel && !i) ? 'checked' : ''}><span style="--c:${c}" aria-label="Color ${i + 1}"></span></label>`).join('')}</div>`;
function formDlg(title, body, okText, onOk) {
  const d = $('#dlgConfirm');
  d.innerHTML = `<div class="dlg-head"><h2 id="cfTitle">${esc(title)}</h2><button class="btn btn-ghost btn-icon" data-close aria-label="Cerrar">${icon('x')}</button></div>
    <form class="dlg-body form" id="fdForm" novalidate>${body}<span class="ferr" id="fdErr" role="alert"></span><button class="btn btn-primary btn-block" type="submit">${esc(okText)}</button></form>`;
  d.onclose = null; bindClose(d); d.showModal();
  $('#fdForm').onsubmit = async e => {
    e.preventDefault(); const btn = $('#fdForm button[type=submit]'); $('#fdErr').textContent = ''; busy(btn, true);
    try { await onOk(new FormData(e.target), d); } catch (x) { $('#fdErr').textContent = x.message; } finally { busy(btn, false); }
  };
  setTimeout(() => d.querySelector('input:not([type=radio]),textarea')?.focus(), 60);
  return d;
}
function openStoryCreator() {
  let img = '';
  const d = formDlg('Tu historia', `
    <p class="hint">Visible 24 horas para quienes te siguen y tu universidad.</p>
    <div class="field"><label for="stText">Texto</label><textarea class="input" id="stText" name="text" maxlength="140" style="min-height:90px" placeholder="¿Qué está pasando hoy?"></textarea></div>
    <div class="field"><span class="lbl">Color de fondo</span>${swatchHTML('color')}</div>
    <div class="field"><span class="lbl">Foto <span class="opt">(opcional)</span></span><div id="stPrev" class="comp-media"></div><button type="button" class="btn btn-ghost" id="stPick">${icon('image')}Elegir foto</button><input type="file" id="stFile" class="sr" accept="image/jpeg,image/png,image/webp" tabindex="-1" aria-hidden="true"></div>`,
    'Publicar historia', async fd => {
      if (!fd.get('text').trim() && !img) throw new Error('Escribe algo o agrega una foto.');
      await api('createStory', getToken(), { text: fd.get('text'), color: fd.get('color'), image: img ? await img.promise : '' });
      d.close(); toast('¡Historia publicada!'); loadStories();
    });
  $('#stPick').onclick = () => $('#stFile').click();
  $('#stFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const du = await compressImage(f); img = startUpload(du, 'story'); $('#stPrev').innerHTML = `<div class="thumb up" id="stThumb"><img src="${du}" alt="Vista previa"></div>`; img.promise.then(() => $('#stThumb')?.classList.remove('up'), () => { $('#stThumb')?.classList.add('fail'); img = null; toast('No se pudo subir la foto. Elige otra.', 'err'); }); } catch (x) { toast(x.message, 'err'); } };
}
function openGroupCreator() {
  const icons = S.cfg.groupIcons || ['users', 'laptop', 'book', 'flask', 'tag', 'image', 'cap'];
  const d = formDlg('Crear grupo', `
    <div class="field"><label for="gName">Nombre</label><input class="input" id="gName" name="name" maxlength="60" required placeholder="Ej: Ingeniería de Sistemas · Cohorte 2026"></div>
    <div class="field"><label for="gDesc">Descripción</label><textarea class="input" id="gDesc" name="desc" maxlength="300" style="min-height:90px" placeholder="¿Para qué es el grupo? ¿Qué se puede publicar?"></textarea></div>
    <div class="row2"><div class="field"><label for="gPriv">Privacidad</label><select class="input" id="gPriv" name="privacy"><option value="Público">Público · cualquiera ve y se une</option><option value="Privado">Privado · apruebas a cada miembro</option></select></div>
    <div class="field"><label for="gIcon">Ícono</label><select class="input" id="gIcon" name="icon">${icons.map(i => `<option value="${i}">${{ users: 'Personas', laptop: 'Tecnología', book: 'Estudio', flask: 'Laboratorio', tag: 'Ventas', image: 'Fotografía', cap: 'Académico', search: 'Búsqueda', sparkles: 'General', home: 'Residencia' }[i] || i}</option>`).join('')}</select></div></div>
    <div class="field"><span class="lbl">Color</span>${swatchHTML('color', 'var(--sky)')}</div>`,
    'Crear grupo', async fd => {
      const g = await api('createGroup', getToken(), Object.fromEntries(fd));
      d.close(); toast('¡Grupo creado!'); go({ name: 'group', id: g.id });
    });
}
async function openEventCreator() {
  let mine = [];
  try { mine = (await api('groups', getToken())).filter(g => g.joined); } catch {}
  const pad = n => String(n).padStart(2, '0'), t = new Date(Date.now() + 864e5);
  const def = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T17:00`;
  const d = formDlg('Crear evento', `
    <div class="field"><label for="eTitle">Título</label><input class="input" id="eTitle" name="title" maxlength="80" required placeholder="Ej: Grupo de estudio de Física II"></div>
    <div class="row2"><div class="field"><label for="eDate">Fecha y hora</label><input class="input" id="eDate" name="date" type="datetime-local" value="${def}" required></div>
    <div class="field"><label for="ePlace">Lugar</label><input class="input" id="ePlace" name="place" maxlength="120" required placeholder="Ej: Biblioteca, sala 3"></div></div>
    <div class="field"><label for="eText">Descripción <span class="opt">(opcional)</span></label><textarea class="input" id="eText" name="text" maxlength="600" style="min-height:80px"></textarea></div>
    <div class="field"><label for="eGroup">Publicar en</label><select class="input" id="eGroup" name="groupId"><option value="">Mi muro (público)</option>${mine.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></div>
    <div class="field"><span class="lbl">Color</span>${swatchHTML('color', 'var(--sky)')}</div>
    <p class="hint">${icon('shield')} Evita publicar direcciones de casas. Prefiere espacios del campus o lugares públicos.</p>`,
    'Crear evento', async fd => {
      const o = Object.fromEntries(fd); o.date = new Date(o.date).toISOString();
      await api('createEvent', getToken(), o);
      d.close(); toast('¡Evento creado!'); S.route.name === 'events' ? renderEvents() : go({ name: 'events' });
    });
}

/* ── Acciones (delegación de eventos) ── */
function postMenu(btn, id) {
  $$('.pmenu').forEach(m => m.remove());
  const p = SOC.posts.get(id); if (!p) return;
  const m = document.createElement('div');
  m.className = 'menu open pmenu'; m.setAttribute('role', 'menu');
  m.innerHTML = `${p.mine ? `<button role="menuitem" data-pm="delete">${icon('trash')}Eliminar publicación</button>` : ''}<button role="menuitem" data-pm="save">${icon('bookmark')}${p.saved ? 'Quitar de guardados' : 'Guardar publicación'}</button>${p.mine ? '' : `<button role="menuitem" data-pm="hide">${icon('eye')}Ocultar publicación</button><button role="menuitem" data-pm="report">${icon('flag')}Reportar publicación</button>`}`;
  btn.parentElement.append(m); m.querySelector('button').focus();
  const close = () => m.remove();
  setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
  m.onkeydown = e => { if (e.key === 'Escape') { close(); btn.focus(); } };
  $$('[data-pm]', m).forEach(b => b.onclick = async ev => {
    ev.stopPropagation(); close();
    if (!S.user) return openAuth('login');
    const a = b.dataset.pm, el = document.getElementById('post-' + id);
    try {
      if (a === 'save') { p.saved = await api('savePost', getToken(), id); toast(p.saved ? 'Guardada en tus publicaciones guardadas' : 'Quitada de guardados'); }
      if (a === 'hide') { await api('hidePost', getToken(), id); el?.remove(); toast('No volverás a ver esta publicación'); }
      if (a === 'delete') { if (!await confirmDlg({ title: '¿Eliminar publicación?', body: '<p>Se borrará junto con sus comentarios. No se puede deshacer.</p>', ok: 'Eliminar', danger: true })) return; await api('deletePost', getToken(), id); el?.remove(); toast('Publicación eliminada'); }
      if (a === 'report') {
        const r = await confirmDlg({ title: 'Reportar publicación', body: `<p class="hint" style="margin-bottom:12px">Tu reporte es anónimo para la otra persona.</p><div class="field"><label for="cfIn">Motivo</label><select class="input" id="cfIn"><option>Acoso o bullying</option><option>Comparte datos personales de alguien</option><option>Spam o estafa</option><option>Infringe derechos de autor o marca</option><option>Contenido ofensivo o sexual</option><option>Fraude académico</option><option>Otro</option></select></div>`, ok: 'Enviar reporte', danger: true, input: true });
        if (r) { await api('reportPost', getToken(), id, r); toast('Gracias. Revisaremos la publicación.'); }
      }
    } catch (x) { toast(x.message, 'err'); }
  });
}
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  const closeDialogs = () => $$('dialog[open]').forEach(d => d.close());
  switch (act) {
    case 'uid': closeDialogs(); return go({ name: 'user', id });
    case 'group': closeDialogs(); return go({ name: 'group', id });
    case 'hash': SOC.tag = el.dataset.hash; SOC.tab = 'para-ti'; return go({ name: 'feed' });
    case 'login': return openAuth('reg');
    case 'compose': $('#cText')?.focus(); $('#composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    case 'story': return openStory(+el.dataset.i);
    case 'newstory': return requireAuth(openStoryCreator, 'Ingresa para publicar historias');
    case 'newgroup': return requireAuth(openGroupCreator, 'Ingresa para crear grupos');
    case 'newevent': return requireAuth(openEventCreator, 'Ingresa para crear eventos');
    case 'delevent': {
      if (!await confirmDlg({ title: '¿Eliminar evento?', body: '<p>Desaparecerá de la lista de eventos para todos.</p>', ok: 'Eliminar', danger: true })) return;
      try { await api('deleteEvent', getToken(), id); toast('Evento eliminado'); renderEvents(); } catch (x) { toast(x.message, 'err'); }
      return;
    }
    case 'product': return openProduct(id);
    case 'menu': e.stopPropagation(); return postMenu(el, id);
    case 'editprofile': return go({ name: 'profile', tab: 'cuenta' });
    case 'mylistings': return go({ name: 'profile', tab: 'publicaciones' });
    case 'dm': return requireAuth(() => go({ name: 'messages', id }), 'Ingresa para enviar mensajes');
    case 'morecm': SOC.all.add(id); return rerenderPost(id);
    case 'comment':
      if (!S.user) return openAuth('login', null, 'Ingresa para comentar');
      SOC.open.add(id); rerenderPost(id);
      return setTimeout(() => document.getElementById('ci-' + id)?.focus(), 30);
    case 'share': {
      track('share', { method: 'copiar_enlace', content_type: 'post', item_id: id });
      const url = (S.cfg.url || location.href.split('#')[0]) + '#post-' + id;
      try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { toast('Copia este enlace: ' + url); }
      return;
    }
    case 'like': return requireAuth(async () => {
      const p = SOC.posts.get(id); if (!p) return;
      p.liked = !p.liked; p.likes += p.liked ? 1 : -1; rerenderPost(id);
      try { const np = await api('toggleLike', getToken(), id); SOC.posts.set(id, np); rerenderPost(id); }
      catch (x) { p.liked = !p.liked; p.likes += p.liked ? 1 : -1; rerenderPost(id); toast(x.message, 'err'); }
    }, 'Ingresa para reaccionar');
    case 'vote': return requireAuth(async () => {
      try { const np = await api('votePoll', getToken(), id, +el.dataset.i); SOC.posts.set(id, np); rerenderPost(id); } catch (x) { toast(x.message, 'err'); }
    }, 'Ingresa para votar');
    case 'rsvp': return requireAuth(async () => {
      busy(el, true);
      try {
        const ev = await api('rsvp', getToken(), id);
        $$(`[data-act="rsvp"][data-id="${id}"]`).forEach(b => { const big = !b.classList.contains('btn-sm'); b.outerHTML = rsvpBtn(ev, big ? '' : 'btn-sm'); });
        $$(`[data-eg="${id}"]`).forEach(s => s.textContent = ev.going);
        toast(ev.isGoing ? '¡Listo! Te esperamos.' : 'Ya no aparecerás como asistente');
      } catch (x) { toast(x.message, 'err'); busy(el, false); }
    }, 'Ingresa para confirmar asistencia');
    case 'join': return requireAuth(async () => {
      busy(el, true);
      try {
        const g = await api('joinGroup', getToken(), id);
        $$(`[data-act="join"][data-id="${id}"]`).forEach(b => b.outerHTML = joinBtn(g));
        $$(`[data-gm="${id}"]`).forEach(s => s.textContent = g.members);
        toast(g.joined ? `Te uniste a ${g.name}` : g.pending ? 'Solicitud enviada. Te avisaremos cuando te acepten.' : `Saliste de ${g.name}`);
        loadMyGroups();
        if (S.route.name === 'group' && S.route.id === id) renderGroup(id);
      } catch (x) { toast(x.message, 'err'); busy(el, false); }
    }, 'Ingresa para unirte a grupos');
    case 'follow': return requireAuth(async () => {
      try {
        const r = await api('follow', getToken(), id);
        $$(`[data-act="follow"][data-id="${id}"]`).forEach(b => { b.outerHTML = followBtn({ id, following: r.following }, !!b.dataset.big); });
        if ($('#stFollowers') && S.route.name === 'user' && S.route.id === id) $('#stFollowers').textContent = r.followers;
        toast(r.following ? 'Ahora sigues a esta persona' : 'Dejaste de seguir');
      } catch (x) { toast(x.message, 'err'); }
    }, 'Ingresa para seguir a otras personas');
  }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('.cmt-form'); if (!f) return;
  e.preventDefault();
  const inp = f.querySelector('input'), t = inp.value.trim(), id = f.dataset.post, p = SOC.posts.get(id);
  if (!t || !p) return;
  inp.value = '';
  const tmp = { id: 'tmpc' + Date.now(), author: meU(), text: t, createdAt: new Date().toISOString(), pending: true };
  p.comments = p.comments.concat(tmp); SOC.open.add(id); SOC.all.add(id); rerenderPost(id);
  document.getElementById('ci-' + id)?.focus();
  try { const np = await api('addComment', getToken(), id, t); SOC.posts.set(id, np); rerenderPost(id); }
  catch (x) {
    p.comments = p.comments.filter(c => c !== tmp); rerenderPost(id);
    const i2 = document.getElementById('ci-' + id); if (i2 && !i2.value) i2.value = t;
    toast(x.message, 'err');
  }
});
setInterval(() => { if (!document.hidden) refreshPulse(); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPulse(); });


/* ═════════════ GOOGLE ANALYTICS 4 (solo con consentimiento de analítica) ═════════════
   Eventos que miden los KPI (marca como "evento clave" en GA los marcados con ★):
   Ventas:      view_item · add_to_wishlist · generate_lead ★ · listing_create ★ · item_sold ★ · search
   Comunidad:   sign_up ★ · login · post_create ★ · like · comment · share · poll_vote · story_create
                follow · join_group · group_create · event_create · event_rsvp · message_send
   Nunca se envían nombres, correos, teléfonos ni textos de mensajes. */
const GA = { on: false, log: [] };
const gaAllowed = () => !!(S.cfg && S.cfg.gaId && S.consent && S.consent.analytics);
const gaBase = () => (S.cfg && S.cfg.url) || location.href.split('#')[0];
function gaLoad() {
  if (GA.on || !gaAllowed()) return;
  GA.on = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  gtag('config', S.cfg.gaId, { send_page_view: false, client_id: getAnon(), cookie_flags: 'SameSite=None;Secure', page_location: gaBase(), allow_google_signals: false });
  const s = document.createElement('script');
  s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(S.cfg.gaId);
  document.head.append(s);
  gaUser();
}
function gaUser() {
  if (!GA.on || !S.user) return;
  const pv = S.user.providers || {};
  gtag('set', 'user_properties', { universidad: shortUni(S.user.university) || 'sin_dato', acceso: pv.google ? 'google' : pv.apple ? 'apple' : 'correo' });
}
function track(name, params = {}) {
  GA.log.unshift({ name, params, at: new Date(), sent: gaAllowed() });
  if (GA.log.length > 40) GA.log.length = 40;
  if (!gaAllowed()) return;
  gaLoad();
  try { gtag('event', name, params); } catch {}
}
const PAGE_TITLES = { feed: 'Inicio', home: 'Marketplace', sell: 'Vender', profile: 'Mi cuenta', legal: 'Legal', groups: 'Grupos', group: 'Grupo', events: 'Eventos', messages: 'Mensajes', user: 'Perfil', admin: 'Métricas' };
let lastPage = '';
function trackPage(r) {
  const path = '/' + (toHash(r) || '');
  if (path === lastPage) return;
  lastPage = path;
  track('page_view', { page_title: PAGE_TITLES[r.name] || 'Pupitre', page_location: gaBase() + '#' + (toHash(r) || ''), page_path: path });
}
function gaFromApi(fn, a, r) {
  const T = track, d = a[1] || {};
  switch (fn) {
    case 'register': return T('sign_up', { method: 'correo' });
    case 'completeSsoSignup': return T('sign_up', { method: r.user && r.user.providers && r.user.providers.apple ? 'apple' : 'google' });
    case 'login': return T('login', { method: 'correo' });
    case 'redeemTicket': if (r && r.token) T('login', { method: 'google_o_apple' }); return;
    case 'listProducts': if (a[0] && a[0].q && a[0].page === 1) T('search', { search_term: String(a[0].q).slice(0, 80) }); return;
    case 'getProduct': return T('view_item', { currency: r.currency, value: Number(r.price) || 0, items: [{ item_id: r.id, item_name: String(r.title).slice(0, 80), item_category: r.category, price: Number(r.price) || 0 }] });
    case 'toggleFavorite': if (r) T('add_to_wishlist', { items: [{ item_id: a[1] }] }); return;
    case 'saveProduct': return T(d.id ? 'listing_update' : 'listing_create', { item_category: d.category, value: Number(d.price) || 0, currency: d.currency, photos: (d.images || []).length });
    case 'setProductStatus': if (a[2] === 'sold' && r && r.id) T('item_sold', { currency: r.currency, value: Number(r.price) || 0, item_category: r.category, items: [{ item_id: r.id, item_category: r.category, price: Number(r.price) || 0 }] }); return;
    case 'createPost': return T('post_create', { has_photo: (d.images || []).length > 0, has_poll: !!d.poll, audience: d.audience, in_group: !!d.groupId, shares_listing: !!d.productId });
    case 'toggleLike': if (r && r.liked) T('like', { content_type: 'post' }); return;
    case 'addComment': return T('comment', { content_type: 'post' });
    case 'votePoll': return T('poll_vote');
    case 'createStory': return T('story_create', { has_photo: !!d.image });
    case 'joinGroup': if (r.joined) T('join_group', { group_id: r.id }); else if (r.pending) T('join_group_request', { group_id: r.id }); return;
    case 'createGroup': return T('group_create', { privacy: r.privacy });
    case 'createEvent': return T('event_create', { in_group: !!d.groupId });
    case 'rsvp': if (r.isGoing) T('event_rsvp', { event_id: r.id }); return;
    case 'follow': if (r.following) T('follow'); return;
    case 'sendMessage': return T('message_send');
    case 'reportPost': case 'reportProduct': return T('report_content', { content_type: fn === 'reportPost' ? 'post' : 'listing' });
    case 'deleteMyAccount': return T('account_delete');
  }
}

/* ═════════════ PANEL DE MÉTRICAS (administración) ═════════════ */
const ADM = { days: 30, data: null };
const fmtN = n => Number(n || 0).toLocaleString('es-VE');
const fmtM = c => v => Number(v) ? money(v, c) : (c === 'VES' ? 'Bs. 0' : '$0');
const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' }).replace('.', '');
const niceMax = m => { if (m <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(m))); const n = m / p; return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
function deltaHTML(k) {
  const v = k.value, p = k.prev;
  if (!p && !v) return '<span class="dl">Sin actividad</span>';
  if (!p) return '<span class="dl up">▲ Nuevo</span>';
  const d = Math.round((v - p) / p * 100);
  return `<span class="dl ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)}%</span>`;
}
const kpiTile = (label, k, fmt = fmtN) => `<div class="kpi"><span class="kl">${esc(label)}</span><strong>${esc(fmt(k.value))}</strong><span class="kd">${deltaHTML(k)}<small>vs. ${esc(fmt(k.prev))} en los ${ADM.days} días previos</small></span></div>`;
function lineChart(id, title, data) {
  const W = 340, H = 140, pl = 30, pr = 12, pt = 12, pb = 24;
  const total = data.reduce((s, p) => s + p.v, 0), top = niceMax(Math.max(...data.map(p => p.v), 1));
  const x = i => pl + (data.length < 2 ? 0 : i * (W - pl - pr) / (data.length - 1));
  const y = v => pt + (H - pt - pb) * (1 - v / top);
  const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const grid = [0, top / 2, top].map(v => `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ax" x="${pl - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${fmtN(v)}</text>`).join('');
  return `<figure class="chart" id="${id}" tabindex="0" aria-label="${esc(title)}: ${fmtN(total)} en ${data.length} días. Usa las flechas para recorrer los días.">
    <figcaption><span>${esc(title)}</span><b>${fmtN(total)}</b></figcaption>
    <div class="plot"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
      ${grid}<path class="ar" d="${line}L${x(data.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z"/><path class="ln" d="${line}"/>
      <text class="ax" x="${pl}" y="${H - 6}">${fmtDay(data[0].d)}</text><text class="ax" x="${W - pr}" y="${H - 6}" text-anchor="end">${fmtDay(data[data.length - 1].d)}</text>
      <line class="xh" y1="${pt}" y2="${H - pb}" visibility="hidden"/><circle class="dot" r="4.5" visibility="hidden"/>
      <rect class="hit" x="${pl - 6}" y="0" width="${W - pl - pr + 12}" height="${H}" fill="transparent"/>
    </svg><div class="tip" role="status" hidden></div></div>
    <details><summary>Ver datos</summary><div class="tscroll"><table><thead><tr><th>Día</th><th class="num">${esc(title)}</th></tr></thead><tbody>${data.slice().reverse().map(p => `<tr><td>${fmtDay(p.d)}</td><td class="num">${fmtN(p.v)}</td></tr>`).join('')}</tbody></table></div></details>
  </figure>`;
}
function bindLine(fig, data) {
  const svg = fig.querySelector('svg'), xh = fig.querySelector('.xh'), dot = fig.querySelector('.dot'), tip = fig.querySelector('.tip'), plot = fig.querySelector('.plot');
  const W = 340, H = 140, pl = 30, pr = 12, pt = 12, pb = 24, top = niceMax(Math.max(...data.map(p => p.v), 1));
  const x = i => pl + (data.length < 2 ? 0 : i * (W - pl - pr) / (data.length - 1));
  const y = v => pt + (H - pt - pb) * (1 - v / top);
  let cur = -1;
  const show = i => {
    cur = Math.max(0, Math.min(data.length - 1, i));
    const p = data[cur];
    [xh, dot].forEach(el => el.setAttribute('visibility', 'visible'));
    xh.setAttribute('x1', x(cur)); xh.setAttribute('x2', x(cur)); dot.setAttribute('cx', x(cur)); dot.setAttribute('cy', y(p.v));
    tip.hidden = false; tip.innerHTML = `<b>${fmtN(p.v)}</b><span>${fmtDay(p.d)}</span>`;
    const r = svg.getBoundingClientRect(), px = x(cur) / W * r.width;
    tip.style.left = Math.min(Math.max(px, 40), r.width - 40) + 'px';
  };
  const hide = () => { [xh, dot].forEach(el => el.setAttribute('visibility', 'hidden')); tip.hidden = true; };
  svg.addEventListener('pointermove', e => { const r = svg.getBoundingClientRect(); const vx = (e.clientX - r.left) / r.width * W; show(Math.round((vx - pl) / ((W - pl - pr) / Math.max(1, data.length - 1)))); });
  svg.addEventListener('pointerleave', hide);
  fig.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); show(cur < 0 ? data.length - 1 : cur + 1); } if (e.key === 'ArrowLeft') { e.preventDefault(); show(cur < 0 ? data.length - 1 : cur - 1); } if (e.key === 'Escape') hide(); });
  fig.addEventListener('blur', hide);
}
function barList(rows, fmt = fmtN, note) {
  const max = Math.max(1, ...rows.map(r => r.v));
  return `<div class="bars">${rows.map(r => `<div class="br" title="${esc(r.k)}: ${esc(fmt(r.v))}"><span class="bk">${esc(r.k)}</span><span class="bt"><i style="width:${Math.max(r.v ? 1.5 : 0, r.v / max * 100)}%"></i></span><span class="bv">${esc(fmt(r.v))}</span>${r.sub ? `<small class="bs">${esc(r.sub)}</small>` : ''}</div>`).join('')}</div>${note ? `<p class="hint" style="margin-top:10px">${note}</p>` : ''}`;
}
async function renderAdmin() {
  if (!S.user) return openAuth('login', () => go({ name: 'admin' }));
  if (!S.user.isAdmin) { view.innerHTML = `<div class="wrap"><div class="empty" style="margin-block:60px">${icon('lock')}<h3>Solo para administración</h3><p>Pide que agreguen tu correo en la propiedad ADMIN_EMAILS del proyecto.</p></div></div>`; return; }
  view.innerHTML = `<div class="wrap adm">
    <div class="page-head"><div><h1>Métricas</h1><p>KPI de ventas y comunidad calculados con los datos de Pupitre. Visitas, dispositivos, países y tiempo en la página están en Google Analytics.</p></div>
      <div class="adm-ctl"><div class="seg" role="radiogroup" aria-label="Período">${[7, 30, 90].map(d => `<button role="radio" aria-checked="${ADM.days === d}" data-days="${d}">${d} días</button>`).join('')}</div>
        <button class="btn btn-ghost btn-icon" id="admRefresh" aria-label="Actualizar">${icon('sliders')}</button>
        <a class="btn btn-primary" href="https://analytics.google.com/" target="_blank" rel="noopener noreferrer">${icon('poll')}Google Analytics</a></div></div>
    <div id="admBody"><div class="loading"><div class="spinner"></div></div></div></div>`;
  $$('[data-days]').forEach(b => b.onclick = () => { ADM.days = +b.dataset.days; $$('[data-days]').forEach(x => x.setAttribute('aria-checked', x === b)); loadAdmin(); });
  $('#admRefresh').onclick = () => loadAdmin();
  loadAdmin();
}
async function loadAdmin() {
  const body = $('#admBody'); if (!body) return;
  const rs = S.rseq;
  body.classList.add('is-loading');
  try {
    const m = await api('adminMetrics', getToken(), ADM.days);
    if (rs !== S.rseq || !$('#admBody')) return;
    ADM.data = m; body.innerHTML = adminHTML(m); body.classList.remove('is-loading');
    [['chSign', 'signups'], ['chPosts', 'posts'], ['chList', 'listings'], ['chSold', 'sold'], ['chMsg', 'messages']].forEach(([id, k]) => { const f = document.getElementById(id); if (f) bindLine(f, m.series[k]); });
    $('#gaLogBtn')?.addEventListener('click', () => { $('#gaLog').innerHTML = gaLogHTML(); });
  } catch (e) { body.classList.remove('is-loading'); body.innerHTML = `<div class="empty">${icon('alert')}<h3>No pudimos cargar las métricas</h3><p>${esc(e.message)}</p></div>`; }
}
const gaLogHTML = () => GA.log.length ? `<ul class="galog">${GA.log.slice(0, 15).map(e => `<li><code>${esc(e.name)}</code><span>${e.at.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span><span class="pill ${e.sent ? 'active' : ''}">${e.sent ? 'Enviado' : 'Sin consentimiento'}</span></li>`).join('')}</ul>` : '<p class="hint">Aún no hay eventos en esta sesión.</p>';
function adminHTML(m) {
  const k = m.kpis, f = m.funnel;
  const conv = f.map((s, i) => ({ k: s.k, v: s.v, sub: i ? (f[i - 1].v ? Math.round(s.v / f[i - 1].v * 1000) / 10 + '% del paso anterior' : '—') : '' }));
  return `
  <section class="adm-sec" aria-labelledby="hVentas"><h2 id="hVentas">${icon('store')}Ventas en el Marketplace</h2><div class="kpis">
    ${kpiTile('Ventas cerradas (USD)', k.gmvUSD, fmtM('USD'))}${kpiTile('Ventas cerradas (Bs.)', k.gmvVES, fmtM('VES'))}${kpiTile('Artículos vendidos', k.sold)}
    ${kpiTile('Artículos publicados', k.newListings)}${kpiTile('Guardados en favoritos', k.favorites)}${kpiTile('Conversaciones iniciadas', k.chats)}</div></section>
  <section class="adm-sec" aria-labelledby="hCom"><h2 id="hCom">${icon('users')}Comunidad</h2><div class="kpis">
    ${kpiTile('Usuarios nuevos', k.newUsers)}${kpiTile('Usuarios activos', k.activeUsers)}${kpiTile('Publicaciones del muro', k.posts)}
    ${kpiTile('Comentarios', k.comments)}${kpiTile('Me gusta', k.likes)}${kpiTile('Mensajes privados', k.messages)}</div></section>
  <section class="adm-sec" aria-labelledby="hAct"><h2 id="hAct">${icon('calendar')}Actividad diaria</h2><div class="charts">
    ${lineChart('chSign', 'Registros', m.series.signups)}${lineChart('chPosts', 'Publicaciones del muro', m.series.posts)}${lineChart('chList', 'Artículos publicados', m.series.listings)}
    ${lineChart('chSold', 'Artículos vendidos', m.series.sold)}${lineChart('chMsg', 'Mensajes privados', m.series.messages)}
    <div class="chart totals"><figcaption><span>Totales hoy</span></figcaption><dl>
      <div><dt>Usuarios</dt><dd>${fmtN(m.totals.users)}</dd></div><div><dt>Artículos activos</dt><dd>${fmtN(m.totals.listingsActive)}</dd></div>
      <div><dt>Vendidos (histórico)</dt><dd>${fmtN(m.totals.listingsSold)}</dd></div><div><dt>Publicaciones</dt><dd>${fmtN(m.totals.posts)}</dd></div>
      <div><dt>Grupos</dt><dd>${fmtN(m.totals.groups)}</dd></div><div><dt>Eventos próximos</dt><dd>${fmtN(m.totals.upcomingEvents)}</dd></div>
      <div><dt>Entran con Google/Apple</dt><dd>${m.totals.users ? Math.round(m.totals.sso / m.totals.users * 100) : 0}%</dd></div></dl></div>
  </div></section>
  <section class="adm-two">
    <div class="panel"><h3>Embudo de ventas (histórico)</h3>${barList(conv)}</div>
    <div class="panel"><h3>Artículos activos por categoría</h3>${barList(m.categories.map(c => ({ k: c.label, v: c.active, sub: `${fmtN(c.sold)} vendidos · ${fmtN(c.views)} vistas` })))}</div>
  </section>
  <section class="adm-two">
    <div class="panel"><h3>Artículos más vistos</h3>${m.topListings.length ? `<div class="tscroll"><table><thead><tr><th>Artículo</th><th class="num">Vistas</th><th class="num">Favoritos</th><th class="num">Precio</th></tr></thead><tbody>${m.topListings.map(p => `<tr><td><button class="cname" data-open="${esc(p.id)}">${esc(p.title)}</button>${p.status === 'sold' ? ' <span class="pill sold">Vendido</span>' : ''}</td><td class="num">${fmtN(p.views)}</td><td class="num">${fmtN(p.favorites)}</td><td class="num">${esc(money(p.price, p.currency))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">Sin datos todavía.</p>'}</div>
    <div class="panel"><h3>Publicaciones con más interacción</h3>${m.topPosts.length ? `<div class="tscroll"><table><thead><tr><th>Publicación</th><th class="num">Me gusta</th><th class="num">Comentarios</th></tr></thead><tbody>${m.topPosts.map(p => `<tr><td><small class="hint">${esc(p.author)}</small><br>${esc(p.text) || '<span class="hint">(foto)</span>'}</td><td class="num">${fmtN(p.likes)}</td><td class="num">${fmtN(p.comments)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">Sin publicaciones en este período.</p>'}</div>
  </section>
  <section class="adm-two">
    <div class="panel"><h3>Usuarios por universidad</h3>${barList(m.universities.map(u => ({ k: shortUni(u.k) || u.k, v: u.v })))}</div>
    <div class="panel"><h3>Moderación</h3><dl class="mod">
      <div><dt>Reportes de artículos abiertos</dt><dd>${fmtN(m.moderation.productReports)}</dd></div><div><dt>Reportes de publicaciones (${ADM.days} días)</dt><dd>${fmtN(m.moderation.postReports)}</dd></div>
      <div><dt>Publicaciones ocultas por reportes</dt><dd>${fmtN(m.moderation.hiddenPosts)}</dd></div><div><dt>Artículos pausados</dt><dd>${fmtN(m.moderation.pausedListings)}</dd></div></dl>
      <p class="hint">Revisa los reportes en las hojas <code>Reports</code> y <code>PostReports</code> de Pupitre_DB.</p></div>
  </section>
  <section class="panel gapanel" aria-labelledby="hGa"><h3 id="hGa">${icon('poll')}Google Analytics 4</h3>
    ${m.gaId ? `<p><span class="pill active">Conectado</span> ID de medición <code>${esc(m.gaId)}</code>. Solo cuenta a quienes aceptan las cookies de analítica, por eso sus números serán menores que los de este panel.</p>`
    : `<p><span class="pill paused">No configurado</span> Agrega la propiedad <code>GA_MEASUREMENT_ID</code> (G-XXXXXXX) en el proyecto de Apps Script. Los pasos están en <code>Admin.gs</code>.</p>`}
    <p class="hint">Eventos clave para tus KPI: <code>sign_up</code>, <code>listing_create</code>, <code>generate_lead</code> (contacto a un vendedor), <code>item_sold</code> y <code>post_create</code>. En GA ve a Informes → Participación → Eventos.</p>
    <button class="btn btn-ghost btn-sm" id="gaLogBtn">Ver eventos de esta sesión</button><div id="gaLog"></div>
  </section>
  <p class="hint" style="padding:6px 2px 60px">Actualizado ${new Date(m.generatedAt).toLocaleString('es')}. Las ventas cuentan los artículos que su vendedor marcó como vendidos en el período; Pupitre no procesa pagos.</p>`;
}

/* ═════════════ INICIO ═════════════ */
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); $$('dialog[open]').forEach(d => d.close()); return navTo(g.dataset.go); }
  const l = e.target.closest('[data-legal]');
  if (l && !l.closest('.legal nav') && !l.closest('#cookieBanner')) { e.preventDefault(); $$('dialog[open]').forEach(d => d.close()); go({ name: 'legal', doc: l.dataset.legal }); }
  else if (l && l.closest('.legal nav')) { go({ name: 'legal', doc: l.dataset.legal }); }
  const op = e.target.closest('.adm [data-open]'); if (op) openProduct(op.dataset.open);
});
$('#hdrSearch').onsubmit = e => { e.preventDefault(); setFilter({ q: $('#hdrQ').value.trim() }); };
$('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('#footCookies').onclick = () => openCookieSettings();
addEventListener('scroll', () => $('#hdr').classList.toggle('is-stuck', scrollY > 8), { passive: true });
addEventListener('beforeunload', e => { if (SELL?.dirty && S.route.name === 'sell') { e.preventDefault(); e.returnValue = ''; } });

(async function boot() {
  try {
  window.__pupitreStep = 'preparar la página';
  S.consent = (() => { try { return JSON.parse(store.get('pp_consent')); } catch { return null; } })();
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = (S.consent?.preferences && store.get('pp_theme')) || (sysDark ? 'dark' : 'light');
  if (S.consent?.preferences) { try { Object.assign(S.filters, JSON.parse(store.get('pp_filters')) || {}); } catch {} }
  const tkn = getToken();
  const meP = tkn ? api('me', tkn).catch(() => null) : Promise.resolve(null);
  SOC.prefetch = { key: JSON.stringify([{ filter: 'para-ti', tag: '' }, 1, !!tkn]), p: api('socialFeed', tkn || '', { filter: 'para-ti', tag: '', page: 1 }) };
  SOC.prefetch.p.catch(() => { SOC.prefetch = null; });
  window.__pupitreStep = 'cargar la configuración';
  try {
    S.cfg = BOOT_CFG || await api('getConfig');
  } catch (e) {
    $('#boot').innerHTML = `<div class="empty" style="border:0">${icon('alert')}<h3>No pudimos iniciar Pupitre</h3><p>${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">Reintentar</button></div>`;
    window.__pupitreReady = true;
    return;
  }
  setTheme(document.documentElement.dataset.theme);
  if (!S.consent || S.consent.v !== S.cfg.policyVersion) { S.consent = S.consent && S.consent.v === S.cfg.policyVersion ? S.consent : null; showCookieBanner(); }
  window.__pupitreStep = 'verificar tu sesión';
  const SLOW = {};
  const mr = await Promise.race([meP, new Promise(ok => setTimeout(() => ok(SLOW), 15000))]);
  if (mr && mr !== SLOW) { S.user = mr.user; S.favs = new Set(mr.favs); } else if (tkn && mr !== SLOW) setToken(null);
  gaLoad();
  renderUserSlot();
  const qp = new URLSearchParams(location.search);
  const ssoTicket = (qp.get('sso_ticket') || '').trim(), ssoError = (qp.get('sso_error') || '').trim();
  if (ssoTicket || ssoError) { try { history.replaceState(null, '', location.pathname + location.hash); } catch {} }
  if (ssoTicket) await handleTicket(ssoTicket);
  if (ssoError) setTimeout(() => toast(ssoError, 'err'), 600);
  window.addEventListener('popstate', e => {
    const prev = S.route;
    S.route = e.state && e.state.name ? e.state : parseHash(location.hash);
    $$('dialog[open]').forEach(d => d.close());
    render(!(prev.name === 'home' && S.route.name === 'home' && $('#grid')));
  });
  window.__pupitreStep = 'leer la dirección';
  const startHash = location.hash;
  window.__pupitreStep = 'mostrar la página';
  S.route = parseHash(startHash);
  if (ssoTicket || ssoError) { try { histNav('replace', S.route, toHash(S.route)); } catch {} }
  render(true);
  $('#boot').classList.add('hide'); setTimeout(() => $('#boot').remove(), 400);
  window.__pupitreReady = true;
  } catch (e) {
    console.error(e);
    if (window.__pupitreFail) window.__pupitreFail('Error al ' + esc(window.__pupitreStep || 'iniciar') + ': <code>' + esc((e && e.message) || e) + '</code>');
  }
})();
