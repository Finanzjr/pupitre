/**
 * Privacy.gs · Consentimientos, exportar datos, eliminar cuenta, mantenimiento y demo.
 */

/** Consentimiento de cookies (identificador anónimo, sin datos personales). */
function logConsent(anonId, prefs, token) {
  return run_(function () {
    const u = auth_(token, false), anon = String(anonId || '');
    if (!u && !/^[a-z0-9-]{8,64}$/i.test(anon)) fail_('Identificador no válido.');
    const p = prefs || {};
    const detail = { necessary: true, preferences: p.preferences === true, analytics: p.analytics === true, marketing: p.marketing === true };
    rate_('ck_' + (u ? u.id : anon), 20, 3600);
    withLock_(function () { insert_('Consents', { id: id_('C'), subject: u ? u.id : 'anon:' + anon, kind: 'cookies', detail: detail, version: CFG.POLICY_VERSION, createdAt: iso_() }); });
    return true;
  });
}

/** Descarga de todos los datos del usuario (portabilidad / habeas data). */
function exportMyData(token) {
  return run_(function () {
    const u = auth_(token), uid = u.id, pu = publicUser_(u);
    const mine = function (name, key) { return rows_(name).filter(function (r) { return r[key] === uid; }).map(function (r) { const o = Object.assign({}, r); delete o._row; return o; }); };
    const chats = rows_('Chats').filter(function (c) { return c.userA === uid || c.userB === uid; }).map(function (c) { return c.id; });
    return {
      exportedAt: iso_(), service: CFG.APP_NAME, policyVersion: CFG.POLICY_VERSION,
      account: Object.assign(pu, { lastLogin: u.lastLogin, termsVersion: u.termsVersion }),
      marketplace: { listings: mine('Products', 'sellerId').map(function (p) { delete p.sellerId; return p; }), favorites: favIds_(uid) },
      social: {
        posts: mine('Posts', 'authorId'), comments: mine('Comments', 'authorId'), reactions: mine('Reactions', 'userId'),
        pollVotes: mine('PollVotes', 'userId'), following: mine('Follows', 'followerId').map(function (f) { return f.followeeId; }),
        groups: mine('GroupMembers', 'userId'), eventsCreated: mine('Events', 'createdBy'), rsvps: mine('Rsvps', 'userId'),
        stories: mine('Stories', 'authorId'), saved: mine('Saved', 'userId')
      },
      messagesSent: rows_('ChatMessages').filter(function (m) { return m.fromId === uid && chats.indexOf(m.chatId) > -1; }).map(function (m) { return { chatId: m.chatId, text: m.text, at: m.createdAt }; }),
      consents: rows_('Consents').filter(function (c) { return c.subject === uid; }).map(function (c) { return { kind: c.kind, value: c.detail, version: c.version, date: c.createdAt }; })
    };
  });
}

/** Elimina la cuenta y todo su contenido. Con contraseña, o escribiendo ELIMINAR si entró con Google/Apple. */
function deleteMyAccount(token, confirmation) {
  return run_(function () {
    const u = auth_(token), uid = u.id;
    if (u.passHash) { if (!checkPass_(u, confirmation)) fail_('La contraseña no es correcta.'); }
    else if (String(confirmation || '').trim().toUpperCase() !== 'ELIMINAR') fail_('Escribe ELIMINAR para confirmar.');

    // Archivos en Drive (fuera del bloqueo)
    rows_('Products', true).filter(function (p) { return p.sellerId === uid; }).forEach(function (p) { json_(p.images, []).forEach(trashImage_); });
    rows_('Posts', true).filter(function (p) { return p.authorId === uid; }).forEach(function (p) { json_(p.images, []).forEach(trashImage_); });
    rows_('Stories', true).filter(function (s) { return s.authorId === uid && s.image; }).forEach(function (s) { trashImage_(s.image); });

    withLock_(function () {
      const prodIds = rows_('Products', true).filter(function (p) { return p.sellerId === uid; }).map(function (p) { return p.id; });
      removeWhere_('Products', function (p) { return p.sellerId === uid; });
      removeWhere_('Favorites', function (f) { return f.userId === uid || prodIds.indexOf(f.productId) > -1; });
      purgePosts_(rows_('Posts', true).filter(function (p) { return p.authorId === uid; }).map(function (p) { return p.id; }));
      ['Comments'].forEach(function (n) { removeWhere_(n, function (x) { return x.authorId === uid; }); });
      ['Reactions', 'PollVotes', 'Saved', 'Hidden', 'Rsvps', 'Notifications', 'GroupMembers'].forEach(function (n) { removeWhere_(n, function (x) { return x.userId === uid; }); });
      removeWhere_('Follows', function (f) { return f.followerId === uid || f.followeeId === uid; });
      removeWhere_('Stories', function (s) { return s.authorId === uid; });
      const chatIds = rows_('Chats', true).filter(function (c) { return c.userA === uid || c.userB === uid; }).map(function (c) { return c.id; });
      removeWhere_('ChatMessages', function (m) { return chatIds.indexOf(m.chatId) > -1; });
      removeWhere_('Chats', function (c) { return chatIds.indexOf(c.id) > -1; });
      rows_('Groups', true).filter(function (g) { return g.ownerId === uid && g.status === 'active'; }).forEach(function (g) { g.status = 'deleted'; update_('Groups', g); });
      rows_('Events', true).filter(function (e) { return e.createdBy === uid && e.status === 'active'; }).forEach(function (e) { e.status = 'deleted'; update_('Events', e); });
      const sess = rows_('Sessions', true).filter(function (s) { return s.userId === uid; });
      sess.forEach(function (s) { CacheService.getScriptCache().remove('s_' + s.tokenHash); });
      if (sess.length) remove_('Sessions', sess.map(function (s) { return s._row; }));

      // Se conserva solo un registro anónimo de consentimientos y reportes
      const anon = 'deleted:' + sha_(uid).slice(0, 16);
      rows_('Consents', true).filter(function (c) { return c.subject === uid; }).forEach(function (c) { c.subject = anon; update_('Consents', c); });
      rows_('Reports', true).filter(function (r) { return r.reporterId === uid; }).forEach(function (r) { r.reporterId = anon; update_('Reports', r); });
      rows_('PostReports', true).filter(function (r) { return r.reporterId === uid; }).forEach(function (r) { r.reporterId = anon; update_('PostReports', r); });
      insert_('Consents', { id: id_('C'), subject: anon, kind: 'account_deleted', detail: 'true', version: CFG.POLICY_VERSION, createdAt: iso_() });
      removeWhere_('Users', function (x) { return x.id === uid; });
    });
    bumpFeed_();
    return true;
  });
}

/* ═══════════════════════════ MANTENIMIENTO ═══════════════════════════ */

/** Limpia sesiones vencidas, historias expiradas (y sus fotos) y notificaciones de más de 90 días. */
function mantenimiento() {
  const now = iso_(), old = new Date(Date.now() - 90 * 864e5).toISOString();
  rows_('Stories', true).filter(function (s) { return s.expiresAt < now && s.image; }).forEach(function (s) { trashImage_(s.image); });
  withLock_(function () {
    purgeSessions_(null);
    removeWhere_('Stories', function (s) { return s.expiresAt < now; });
    removeWhere_('Notifications', function (n) { return n.createdAt < old; });
  });
  try { limpiarFotosHuerfanas_(); } catch (e) { console.warn(e); }
}
/** Borra fotos subidas que nunca se usaron (más de 24 h sin estar en ninguna publicación). */
function limpiarFotosHuerfanas_() {
  const used = new Set();
  ['Products', 'Posts'].forEach(function (n) { rows_(n, true).forEach(function (r) { json_(r.images, []).forEach(function (id) { used.add(id); }); }); });
  rows_('Stories', true).forEach(function (s) { if (s.image) used.add(s.image); });
  const limit = Date.now() - 864e5, it = folder_().getFiles();
  let n = 0;
  while (it.hasNext() && n < 300) {
    const f = it.next();
    if (!used.has(f.getId()) && f.getDateCreated().getTime() < limit) { f.setTrashed(true); n++; }
  }
  return n;
}
function instalarMantenimiento() {
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'mantenimiento'; }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('mantenimiento').timeBased().everyDays(1).atHour(3).create();
}

/* ═══════════════════════════ DEMO ═══════════════════════════ */

/** Contenido de ejemplo marcado como DEMO (sin fotos). Bórralo con borrarDemo(). */
function cargarDemo() {
  withLock_(function () {
    let demo = rows_('Users', true).find(function (u) { return u.status === 'demo'; });
    if (!demo) { demo = newUser_({ name: 'Equipo Pupitre', university: 'Universidad Santa María (USM)', status: 'demo', color: 'var(--lime)', bio: 'Cuenta oficial de demostración.' }); insert_('Users', demo); }
    const now = Date.now();
    const items = [
      ['Tutorías de Cálculo I y II (online o presencial)', 'Clases de 90 min, guías de ejercicios resueltos incluidas. Ideal para parciales y reparaciones.', 'cursos', 'No aplica (servicio)', 12, 'Campus principal'],
      ['Calculadora Casio fx-991LA CW', 'Usada un semestre, con tapa y pilas nuevas. Perfecta para Física y Estadística.', 'tecnologia', 'Como nuevo', 28, 'Biblioteca central'],
      ['Bata de laboratorio talla M + lentes de seguridad', 'Bata blanca manga larga, lavada y sin manchas. Lentes con antiempañante.', 'equipos', 'Buen estado', 15, 'Facultad de Farmacia'],
      ['Apuntes completos de Anatomía (digital, 220 págs.)', 'Resúmenes propios con esquemas a color. Se entregan en PDF.', 'libros', 'Nuevo', 5, 'Online']
    ];
    const prods = items.map(function (it, i) {
      const t = new Date(now - i * 3.6e6 * 7).toISOString();
      return { id: id_('P'), sellerId: demo.id, title: it[0], description: it[1], category: it[2], condition: it[3], price: String(it[4]), currency: 'USD', campus: it[5], images: [], status: 'active', createdAt: t, updatedAt: t, views: String(10 + i * 7) };
    });
    insertMany_('Products', prods);
    const g = rows_('Groups').find(function (x) { return x.name === 'Ayuda académica'; });
    const eid = id_('E');
    insert_('Events', { id: eid, groupId: '', title: 'Taller: arma tu CV y tu LinkedIn', date: new Date(now + 3 * 864e5).toISOString(), place: 'Aula Magna · también online', color: 'var(--sky)', icon: 'user', createdBy: demo.id, createdAt: iso_(), status: 'active' });
    insertMany_('Posts', [
      { id: id_('S'), authorId: demo.id, groupId: '', kind: 'post', audience: 'publico', text: '¡Bienvenidos a Pupitre! 👋 Comparte, pregunta, únete a grupos y vende lo que ya no usas. Recuerda: nunca publiques datos personales de otras personas. #Bienvenida', images: [], poll: '', productId: '', eventId: '', createdAt: new Date(now - 6e5).toISOString(), status: 'active', reports: '0' },
      { id: id_('S'), authorId: demo.id, groupId: g ? g.id : '', kind: 'question', audience: 'publico', text: '¿Qué horario les funciona para tutorías grupales de Estadística? #Estadística', images: [], poll: ['Lunes 5:00 p. m.', 'Miércoles 12:00 m.', 'Sábado 10:00 a. m.'], productId: '', eventId: '', createdAt: new Date(now - 36e5).toISOString(), status: 'active', reports: '0' },
      { id: id_('S'), authorId: demo.id, groupId: '', kind: 'post', audience: 'publico', text: 'Tip: no compres todos los libros nuevos. En el Marketplace hay casi todo a mitad de precio 📚 #PrimerSemestre', images: [], poll: '', productId: prods[1].id, eventId: '', createdAt: new Date(now - 72e5).toISOString(), status: 'active', reports: '0' },
      { id: id_('S'), authorId: demo.id, groupId: '', kind: 'event', audience: 'publico', text: 'Taller gratuito para preparar tu primer CV. ¡Te esperamos!', images: [], poll: '', productId: '', eventId: eid, createdAt: new Date(now - 108e5).toISOString(), status: 'active', reports: '0' }
    ]);
  });
  bumpFeed_();
}
function borrarDemo() {
  withLock_(function () {
    const demo = rows_('Users', true).find(function (u) { return u.status === 'demo'; });
    if (!demo) return;
    const posts = rows_('Posts', true).filter(function (p) { return p.authorId === demo.id; }).map(function (p) { return p.id; });
    purgePosts_(posts);
    removeWhere_('Products', function (p) { return p.sellerId === demo.id; });
    removeWhere_('Events', function (e) { return e.createdBy === demo.id; });
    removeWhere_('Users', function (u) { return u.id === demo.id; });
  });
  bumpFeed_();
}
