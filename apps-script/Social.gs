/**
 * ════════════════════════════════════════════════════════════════════
 *  Social.gs · Muro, comentarios, reacciones, encuestas, historias,
 *  grupos, eventos, seguidores, mensajes privados y notificaciones.
 * ════════════════════════════════════════════════════════════════════
 *  Reglas de visibilidad de una publicación:
 *   - "publico": cualquiera (incluso sin cuenta).
 *   - "universidad": personas de la misma universidad o que siguen al autor.
 *   - "seguidores": solo quienes siguen al autor.
 *   - En grupos privados, solo los miembros.
 *   - Publicaciones con 3 reportes se ocultan hasta revisión.
 */

const byNewest_ = function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; };
const byOldest_ = function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; };
function isMember_(role) { return role === 'member' || role === 'owner'; }
function liveAuthor_(u) { return !!u && (u.status === 'active' || u.status === 'demo'); }

function feedVersion_() { return Number(CacheService.getScriptCache().get('feed_v') || 0); }
function bumpFeed_() { CacheService.getScriptCache().put('feed_v', String(Date.now()), 21600); }
function dropPulse_(uid) { CacheService.getScriptCache().remove('pl_' + uid); }

const FEED_TABLES = ['Users', 'Groups', 'GroupMembers', 'Follows', 'Posts', 'Hidden', 'Reactions', 'Comments', 'PollVotes', 'Products', 'Events', 'Rsvps', 'Saved'];
function warm_(extra) { loadTables_(['Sessions'].concat(FEED_TABLES, extra || [])); }

function socialCtx_(viewer) {
  const users = indexBy_(rows_('Users'), 'id');
  const groups = indexBy_(rows_('Groups').filter(function (g) { return g.status === 'active'; }), 'id');
  const myRoles = {};
  const following = new Set();
  if (viewer) {
    rows_('GroupMembers').forEach(function (m) { if (m.userId === viewer.id) myRoles[m.groupId] = m.role; });
    rows_('Follows').forEach(function (f) { if (f.followerId === viewer.id) following.add(f.followeeId); });
  }
  return { viewer: viewer, users: users, groups: groups, myRoles: myRoles, following: following };
}
function canSeePost_(p, c) {
  const v = c.viewer, a = c.users[p.authorId];
  if (!liveAuthor_(a) || p.status === 'deleted') return false;
  if (v && p.authorId === v.id) return true;
  if (p.status !== 'active') return false;
  if (p.groupId) {
    const g = c.groups[p.groupId];
    if (!g) return false;
    if (g.privacy === 'Privado' && !isMember_(c.myRoles[g.id])) return false;
  }
  if (p.audience === 'publico') return true;
  if (!v) return false;
  if (p.audience === 'universidad') return (!!a.university && a.university === v.university) || c.following.has(a.id);
  if (p.audience === 'seguidores') return c.following.has(a.id);
  return false;
}
function feedAux_(c) {
  const uid = c.viewer && c.viewer.id;
  return {
    reacts: groupBy_(rows_('Reactions'), 'postId'),
    comments: groupBy_(rows_('Comments'), 'postId'),
    votes: groupBy_(rows_('PollVotes'), 'postId'),
    products: indexBy_(rows_('Products'), 'id'),
    events: indexBy_(rows_('Events'), 'id'),
    rsvps: groupBy_(rows_('Rsvps'), 'eventId'),
    saved: new Set(uid ? rows_('Saved').filter(function (s) { return s.userId === uid; }).map(function (s) { return s.postId; }) : [])
  };
}
function mapEvent_(e, uid, rsvps, groups) {
  const rs = (rsvps && rsvps[e.id]) || [];
  const g = e.groupId && groups ? groups[e.groupId] : null;
  return {
    id: e.id, title: e.title, date: e.date, place: e.place, color: e.color || PALETTE[3], icon: e.icon || 'calendar',
    group: g ? g.name : '', groupId: e.groupId || '', going: rs.length, isGoing: !!uid && rs.some(function (r) { return r.userId === uid; }),
    mine: !!uid && e.createdBy === uid
  };
}
function mapPost_(p, c, x) {
  const uid = c.viewer && c.viewer.id;
  const rs = x.reacts[p.id] || [];
  const cm = (x.comments[p.id] || []).slice().sort(byOldest_).filter(function (k) { return liveAuthor_(c.users[k.authorId]); });
  const def = json_(p.poll, null);
  let poll = null;
  if (def && def.length) {
    const vs = x.votes[p.id] || [], counts = def.map(function () { return 0; });
    let voted = -1;
    vs.forEach(function (v) { const i = Number(v.option); if (counts[i] !== undefined) counts[i]++; if (v.userId === uid) voted = i; });
    poll = { options: def.map(function (t, i) { return { t: t, votes: counts[i] }; }), voted: voted, total: vs.length };
  }
  const g = p.groupId ? c.groups[p.groupId] : null;
  const pr = p.productId ? x.products[p.productId] : null;
  const ev = p.eventId ? x.events[p.eventId] : null;
  return {
    id: p.id, author: person_(c.users[p.authorId]), group: g ? { id: g.id, name: g.name } : null,
    kind: p.kind || 'post', audience: p.audience, createdAt: p.createdAt, text: p.text, flyer: null,
    images: json_(p.images, []), likes: rs.length, liked: !!uid && rs.some(function (r) { return r.userId === uid; }),
    comments: cm.map(function (k) { return { id: k.id, author: person_(c.users[k.authorId]), text: k.text, createdAt: k.createdAt }; }),
    poll: poll,
    product: pr && pr.status === 'active' ? card_(toProduct_(pr), c.users[pr.sellerId]) : null,
    event: ev && ev.status === 'active' ? mapEvent_(ev, uid, x.rsvps, c.groups) : null,
    mine: !!uid && uid === p.authorId, saved: x.saved.has(p.id), hidden: p.status === 'hidden'
  };
}
function postOut_(postId, viewer) {
  const c = socialCtx_(viewer);
  const p = rows_('Posts', true).find(function (x) { return x.id === postId; });
  if (!p || !canSeePost_(p, c)) fail_('Esta publicación ya no está disponible.');
  return mapPost_(p, c, feedAux_(c));
}
function visiblePost_(postId, viewer) {
  const c = socialCtx_(viewer);
  const p = rows_('Posts').find(function (x) { return x.id === String(postId); });
  if (!p || !canSeePost_(p, c)) fail_('Esta publicación ya no está disponible.');
  return p;
}
function notify_(userId, icon, text, link) {
  if (!userId) return;
  insert_('Notifications', { id: id_('N'), userId: userId, icon: icon, text: text, link: link || { name: 'feed' }, createdAt: iso_(), read: 'false' });
  dropPulse_(userId);
}
function firstName_(u) { return String((u && u.name) || 'Alguien').trim().split(/\s+/)[0]; }

/* ═══════════════════════════ MURO ═══════════════════════════ */

function socialFeed(token, o) {
  return run_(function () {
    warm_();
    o = o || {};
    const viewer = auth_(token, false), c = socialCtx_(viewer), uid = viewer && viewer.id;
    const hidden = new Set(uid ? rows_('Hidden').filter(function (h) { return h.userId === uid; }).map(function (h) { return h.postId; }) : []);
    let list = rows_('Posts').filter(function (p) { return canSeePost_(p, c) && !hidden.has(p.id); });
    if (o.groupId) list = list.filter(function (p) { return p.groupId === o.groupId; });
    else if (!o.authorId) list = list.filter(function (p) { const g = p.groupId && c.groups[p.groupId]; return !g || g.privacy !== 'Privado' || isMember_(c.myRoles[g.id]); });
    if (o.authorId) list = list.filter(function (p) { return p.authorId === o.authorId; });
    if (o.tag) { const t = '#' + norm_(o.tag); list = list.filter(function (p) { return norm_(p.text).indexOf(t) > -1; }); }
    if (viewer) {
      if (o.filter === 'universidad') list = list.filter(function (p) { const a = c.users[p.authorId]; return a.university && a.university === viewer.university; });
      if (o.filter === 'siguiendo') list = list.filter(function (p) { return p.authorId === uid || c.following.has(p.authorId); });
      if (o.filter === 'guardados') { const x = feedAux_(c); list = list.filter(function (p) { return x.saved.has(p.id); }); }
    }
    if (o.filter === 'preguntas') list = list.filter(function (p) { return p.kind === 'question' || !!p.poll; });
    list.sort(byNewest_);
    const page = Math.max(1, parseInt(o.page, 10) || 1), start = (page - 1) * CFG.FEED_PAGE;
    const slice = list.slice(start, start + CFG.FEED_PAGE), x = feedAux_(c);
    return { version: feedVersion_(), page: page, hasMore: list.length > start + CFG.FEED_PAGE, posts: slice.map(function (p) { return mapPost_(p, c, x); }) };
  });
}

function createPost(token, d) {
  return run_(function () {
    const u = auth_(token);
    d = d || {};
    const text = str_(d.text, { max: 2000, label: 'Publicación', multiline: true });
    const imgs = Array.isArray(d.images) ? d.images.slice(0, CFG.MAX_POST_IMAGES) : [];
    if (!text && !imgs.length) fail_('Escribe algo o agrega una foto.');
    const audience = oneOf_(String(d.audience || 'publico'), AUDIENCES, 'Elige quién puede verlo.');
    let groupId = '';
    if (d.groupId) {
      const g = rows_('Groups').find(function (x) { return x.id === String(d.groupId) && x.status === 'active'; });
      const m = rows_('GroupMembers').find(function (x) { return x.groupId === String(d.groupId) && x.userId === u.id; });
      if (!g || !m || !isMember_(m.role)) fail_('Únete al grupo para publicar en él.');
      groupId = g.id;
    }
    let poll = null;
    if (Array.isArray(d.poll) && d.poll.length) {
      poll = d.poll.map(function (t) { return str_(t, { min: 1, max: 60, label: 'Opción de encuesta' }); }).slice(0, 4);
      if (poll.length < 2) fail_('La encuesta necesita al menos 2 opciones.');
    }
    let productId = '';
    if (d.productId) {
      const pr = rows_('Products').find(function (x) { return x.id === String(d.productId) && x.status === 'active'; });
      if (pr) productId = pr.id;
    }
    rate_('post_' + u.id, 10, 600, 'Publicaste mucho en poco tiempo. Espera unos minutos.');
    const pid = id_('S');
    const ids = resolveImages_(u, imgs, 'post_' + pid);
    const kind = poll || /\?\s*(#\S+\s*)*$/.test(text) ? 'question' : 'post';
    withLock_(function () {
      insert_('Posts', { id: pid, authorId: u.id, groupId: groupId, kind: kind, audience: audience, text: text, images: ids, poll: poll || '', productId: productId, eventId: '', createdAt: iso_(), status: 'active', reports: '0' });
    });
    bumpFeed_();
    return postOut_(pid, u);
  });
}

function toggleLike(token, postId) {
  return run_(function () {
    warm_();
    const u = auth_(token), p = visiblePost_(postId, u);
    withLock_(function () {
      const ex = rows_('Reactions', true).find(function (r) { return r.postId === p.id && r.userId === u.id; });
      if (ex) remove_('Reactions', [ex._row]);
      else {
        insert_('Reactions', { postId: p.id, userId: u.id, createdAt: iso_() });
        if (p.authorId !== u.id) notify_(p.authorId, 'heart', 'A ' + firstName_(u) + ' le gusta tu publicación.', { name: 'feed' });
      }
    });
    return postOut_(p.id, u);
  });
}

function addComment(token, postId, text) {
  return run_(function () {
    warm_();
    const u = auth_(token), p = visiblePost_(postId, u);
    const t = str_(text, { min: 1, max: 500, label: 'Comentario', multiline: true });
    rate_('cm_' + u.id, 30, 600, 'Comentaste mucho en poco tiempo. Espera unos minutos.');
    withLock_(function () {
      insert_('Comments', { id: id_('K'), postId: p.id, authorId: u.id, text: t, createdAt: iso_() });
      if (p.authorId !== u.id) notify_(p.authorId, 'chat', firstName_(u) + ' comentó: «' + t.slice(0, 60) + (t.length > 60 ? '…' : '') + '»', { name: 'feed' });
    });
    return postOut_(p.id, u);
  });
}

function votePoll(token, postId, option) {
  return run_(function () {
    warm_();
    const u = auth_(token), p = visiblePost_(postId, u), def = json_(p.poll, null);
    const i = Number(option);
    if (!def || !(i >= 0 && i < def.length)) fail_('Opción no válida.');
    withLock_(function () {
      removeWhere_('PollVotes', function (v) { return v.postId === p.id && v.userId === u.id; });
      insert_('PollVotes', { postId: p.id, userId: u.id, option: String(i), createdAt: iso_() });
    });
    return postOut_(p.id, u);
  });
}

function savePost(token, postId) {
  return run_(function () {
    const u = auth_(token), p = visiblePost_(postId, u);
    return withLock_(function () {
      const ex = rows_('Saved', true).find(function (s) { return s.userId === u.id && s.postId === p.id; });
      if (ex) { remove_('Saved', [ex._row]); return false; }
      insert_('Saved', { userId: u.id, postId: p.id, createdAt: iso_() });
      return true;
    });
  });
}
function hidePost(token, postId) {
  return run_(function () {
    const u = auth_(token);
    withLock_(function () { insert_('Hidden', { userId: u.id, postId: String(postId), createdAt: iso_() }); });
    return true;
  });
}
function reportPost(token, postId, reason) {
  return run_(function () {
    const u = auth_(token), p = visiblePost_(postId, u), why = str_(reason, { min: 3, max: 300, label: 'Motivo' });
    return withLock_(function () {
      const all = rows_('PostReports', true).filter(function (r) { return r.postId === p.id; });
      if (all.some(function (r) { return r.reporterId === u.id; })) fail_('Ya reportaste esta publicación. Gracias.');
      insert_('PostReports', { id: id_('R'), postId: p.id, reporterId: u.id, reason: why, createdAt: iso_() });
      const fresh = rows_('Posts', true).find(function (x) { return x.id === p.id; });
      fresh.reports = String(all.length + 1);
      if (all.length + 1 >= CFG.REPORTS_TO_AUTOPAUSE) fresh.status = 'hidden';
      update_('Posts', fresh);
      if (CFG.ADMIN_EMAIL) { try { MailApp.sendEmail(CFG.ADMIN_EMAIL, CFG.APP_NAME + ': publicación reportada ' + p.id, 'Motivo: ' + why); } catch (e) { /* cuota */ } }
      return true;
    });
  });
}
function deletePost(token, postId) {
  return run_(function () {
    const u = auth_(token);
    const p = rows_('Posts', true).find(function (x) { return x.id === String(postId); });
    if (!p || p.authorId !== u.id) fail_('No puedes eliminar esta publicación.');
    json_(p.images, []).forEach(trashImage_);
    withLock_(function () { purgePosts_([p.id]); });
    bumpFeed_();
    return true;
  });
}
/** Borra publicaciones y todo lo que cuelga de ellas. */
function purgePosts_(ids) {
  if (!ids.length) return;
  const s = new Set(ids);
  removeWhere_('Posts', function (x) { return s.has(x.id); });
  ['Comments', 'Reactions', 'PollVotes', 'Saved', 'Hidden'].forEach(function (n) { removeWhere_(n, function (x) { return s.has(x.postId); }); });
}

/* ═══════════════════════════ HISTORIAS ═══════════════════════════ */

function stories(token) {
  return run_(function () {
    warm_(['Stories', 'Chats']);
    const v = auth_(token, false), c = socialCtx_(v), now = iso_();
    const own = rows_('Stories').filter(function (s) {
      const a = c.users[s.authorId];
      if (!liveAuthor_(a) || s.expiresAt < now) return false;
      if (!v) return false;
      return s.authorId === v.id || c.following.has(s.authorId) || (a.university && a.university === v.university);
    }).sort(byNewest_).slice(0, 20).map(function (s) {
      return { id: s.id, author: person_(c.users[s.authorId]), tag: 'Historia', title: s.text, sub: '', color: s.color || PALETTE[0], icon: s.icon || 'sparkles', image: s.image || '', createdAt: s.createdAt, mine: !!v && s.authorId === v.id };
    });
    const rs = groupBy_(rows_('Rsvps'), 'eventId'), nowD = Date.now() - 6 * 36e5;
    const evs = rows_('Events').filter(function (e) {
      if (e.status !== 'active' || new Date(e.date).getTime() < nowD) return false;
      const g = e.groupId && c.groups[e.groupId];
      return !(g && g.privacy === 'Privado' && !isMember_(c.myRoles[g.id]));
    }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 4).map(function (e) {
      const d = new Date(e.date);
      return { id: 'ev-' + e.id, author: person_(c.users[e.createdBy]), tag: 'Evento', title: e.title, sub: Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM · h:mm a') + ' · ' + e.place + ' · ' + (rs[e.id] || []).length + ' asistirán', color: e.color || PALETTE[3], icon: e.icon || 'calendar', image: '', createdAt: e.createdAt, eventId: e.id };
    });
    return own.concat(evs);
  });
}
function createStory(token, d) {
  return run_(function () {
    const u = auth_(token);
    d = d || {};
    const text = str_(d.text, { max: 140, label: 'Historia' });
    if (!text && !d.image) fail_('Escribe algo o agrega una foto a tu historia.');
    const color = PALETTE.indexOf(d.color) > -1 ? d.color : PALETTE[0];
    rate_('st_' + u.id, 10, 3600, 'Ya publicaste varias historias. Intenta más tarde.');
    const sid = id_('H');
    const image = d.image ? resolveImages_(u, [d.image], 'story_' + sid)[0] : '';
    withLock_(function () {
      insert_('Stories', { id: sid, authorId: u.id, text: text, color: color, icon: 'sparkles', image: image, createdAt: iso_(), expiresAt: new Date(Date.now() + CFG.STORY_HOURS * 36e5).toISOString() });
    });
    return true;
  });
}
function deleteStory(token, id) {
  return run_(function () {
    const u = auth_(token);
    const s = rows_('Stories', true).find(function (x) { return x.id === String(id); });
    if (!s || s.authorId !== u.id) fail_('No puedes borrar esta historia.');
    if (s.image) trashImage_(s.image);
    withLock_(function () { removeWhere_('Stories', function (x) { return x.id === s.id; }); });
    return true;
  });
}

/* ═══════════════════════════ GRUPOS ═══════════════════════════ */

function mapGroup_(g, uid, members) {
  const ms = (members[g.id] || []);
  const mine = uid ? ms.find(function (m) { return m.userId === uid; }) : null;
  const role = mine ? mine.role : '';
  return {
    id: g.id, name: g.name, desc: g.desc, color: g.color || PALETTE[3], icon: g.icon || 'users', privacy: g.privacy,
    members: ms.filter(function (m) { return isMember_(m.role); }).length, joined: isMember_(role), pending: role === 'pending',
    isOwner: role === 'owner', requests: role === 'owner' ? ms.filter(function (m) { return m.role === 'pending'; }).length : 0
  };
}
function groups(token) {
  return run_(function () {
    warm_(['Stories', 'Chats']);
    const v = auth_(token, false), uid = v && v.id, members = groupBy_(rows_('GroupMembers'), 'groupId');
    return rows_('Groups').filter(function (g) { return g.status === 'active'; }).map(function (g) { return mapGroup_(g, uid, members); })
      .sort(function (a, b) { return (b.joined - a.joined) || (b.members - a.members); });
  });
}
function group(token, id) {
  return run_(function () {
    const v = auth_(token, false), g = rows_('Groups').find(function (x) { return x.id === String(id) && x.status === 'active'; });
    if (!g) fail_('Este grupo no existe.');
    return mapGroup_(g, v && v.id, groupBy_(rows_('GroupMembers'), 'groupId'));
  });
}
function createGroup(token, d) {
  return run_(function () {
    const u = auth_(token);
    d = d || {};
    const name = str_(d.name, { min: 3, max: 60, label: 'Nombre del grupo' });
    const desc = str_(d.desc, { min: 10, max: 300, label: 'Descripción' });
    const privacy = oneOf_(String(d.privacy || 'Público'), ['Público', 'Privado'], 'Elige si el grupo es público o privado.');
    const color = PALETTE.indexOf(d.color) > -1 ? d.color : PALETTE[3];
    const icon = GROUP_ICONS.indexOf(d.icon) > -1 ? d.icon : 'users';
    return withLock_(function () {
      if (rows_('Groups', true).some(function (g) { return g.status === 'active' && norm_(g.name) === norm_(name); })) fail_('Ya existe un grupo con ese nombre.');
      if (rows_('Groups').filter(function (g) { return g.ownerId === u.id && g.status === 'active'; }).length >= CFG.MAX_GROUPS_OWNED) fail_('Puedes administrar hasta ' + CFG.MAX_GROUPS_OWNED + ' grupos.');
      const g = { id: id_('G'), name: name, desc: desc, color: color, icon: icon, privacy: privacy, ownerId: u.id, createdAt: iso_(), status: 'active' };
      insert_('Groups', g);
      insert_('GroupMembers', { groupId: g.id, userId: u.id, role: 'owner', createdAt: iso_() });
      return mapGroup_(g, u.id, groupBy_(rows_('GroupMembers', true), 'groupId'));
    });
  });
}
function joinGroup(token, id) {
  return run_(function () {
    const u = auth_(token);
    return withLock_(function () {
      const g = rows_('Groups').find(function (x) { return x.id === String(id) && x.status === 'active'; });
      if (!g) fail_('Este grupo no existe.');
      const m = rows_('GroupMembers', true).find(function (x) { return x.groupId === g.id && x.userId === u.id; });
      if (m) {
        if (m.role === 'owner') fail_('Eres quien administra este grupo; no puedes salir.');
        remove_('GroupMembers', [m._row]);
      } else {
        const role = g.privacy === 'Privado' ? 'pending' : 'member';
        insert_('GroupMembers', { groupId: g.id, userId: u.id, role: role, createdAt: iso_() });
        if (role === 'pending' && g.ownerId !== 'system') notify_(g.ownerId, 'users', firstName_(u) + ' pidió unirse a ' + g.name + '.', { name: 'group', id: g.id });
      }
      return mapGroup_(g, u.id, groupBy_(rows_('GroupMembers', true), 'groupId'));
    });
  });
}
function groupRequests(token, id) {
  return run_(function () {
    const u = auth_(token), g = rows_('Groups').find(function (x) { return x.id === String(id); });
    if (!g || g.ownerId !== u.id) fail_('Solo quien administra el grupo puede ver las solicitudes.');
    const users = indexBy_(rows_('Users'), 'id');
    return rows_('GroupMembers').filter(function (m) { return m.groupId === g.id && m.role === 'pending' && users[m.userId]; })
      .map(function (m) { return Object.assign(person_(users[m.userId]), { requestedAt: m.createdAt }); });
  });
}
function answerRequest(token, groupId, userId, approve) {
  return run_(function () {
    const u = auth_(token);
    return withLock_(function () {
      const g = rows_('Groups').find(function (x) { return x.id === String(groupId); });
      if (!g || g.ownerId !== u.id) fail_('Solo quien administra el grupo puede responder solicitudes.');
      const m = rows_('GroupMembers', true).find(function (x) { return x.groupId === g.id && x.userId === String(userId) && x.role === 'pending'; });
      if (!m) fail_('La solicitud ya no existe.');
      if (approve) { m.role = 'member'; update_('GroupMembers', m); notify_(m.userId, 'check', 'Te aceptaron en ' + g.name + '.', { name: 'group', id: g.id }); }
      else remove_('GroupMembers', [m._row]);
      return true;
    });
  });
}

/* ═══════════════════════════ EVENTOS ═══════════════════════════ */

function events(token) {
  return run_(function () {
    warm_(['Stories', 'Chats']);
    const v = auth_(token, false), c = socialCtx_(v), rs = groupBy_(rows_('Rsvps'), 'eventId'), from = Date.now() - 6 * 36e5;
    return rows_('Events').filter(function (e) {
      if (e.status !== 'active' || new Date(e.date).getTime() < from) return false;
      const g = e.groupId && c.groups[e.groupId];
      return !(g && g.privacy === 'Privado' && !isMember_(c.myRoles[g.id]));
    }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (e) { return mapEvent_(e, v && v.id, rs, c.groups); });
  });
}
function createEvent(token, d) {
  return run_(function () {
    const u = auth_(token);
    d = d || {};
    const title = str_(d.title, { min: 4, max: 80, label: 'Título del evento' });
    const place = str_(d.place, { min: 2, max: 120, label: 'Lugar' });
    const text = str_(d.text, { max: 600, label: 'Descripción', multiline: true });
    const when = new Date(d.date);
    if (isNaN(when) || when.getTime() < Date.now() - 36e5 || when.getTime() > Date.now() + 365 * 864e5) fail_('Elige una fecha válida (dentro del próximo año).');
    let groupId = '';
    if (d.groupId) {
      const m = rows_('GroupMembers').find(function (x) { return x.groupId === String(d.groupId) && x.userId === u.id; });
      if (!m || !isMember_(m.role)) fail_('Únete al grupo para crear eventos en él.');
      groupId = String(d.groupId);
    }
    rate_('ev_' + u.id, 5, 3600, 'Ya creaste varios eventos. Intenta más tarde.');
    const color = PALETTE.indexOf(d.color) > -1 ? d.color : PALETTE[3];
    const icon = GROUP_ICONS.concat(['calendar']).indexOf(d.icon) > -1 ? d.icon : 'calendar';
    const eid = id_('E');
    withLock_(function () {
      insert_('Events', { id: eid, groupId: groupId, title: title, date: when.toISOString(), place: place, color: color, icon: icon, createdBy: u.id, createdAt: iso_(), status: 'active' });
      insert_('Rsvps', { eventId: eid, userId: u.id, createdAt: iso_() });
      insert_('Posts', { id: id_('S'), authorId: u.id, groupId: groupId, kind: 'event', audience: 'publico', text: text || ('¡Nuevo evento! ' + title), images: [], poll: '', productId: '', eventId: eid, createdAt: iso_(), status: 'active', reports: '0' });
    });
    bumpFeed_();
    const c = socialCtx_(u);
    return mapEvent_(rows_('Events', true).find(function (e) { return e.id === eid; }), u.id, groupBy_(rows_('Rsvps', true), 'eventId'), c.groups);
  });
}
function rsvp(token, id) {
  return run_(function () {
    const u = auth_(token);
    return withLock_(function () {
      const e = rows_('Events').find(function (x) { return x.id === String(id) && x.status === 'active'; });
      if (!e) fail_('Este evento ya no existe.');
      const ex = rows_('Rsvps', true).find(function (r) { return r.eventId === e.id && r.userId === u.id; });
      if (ex) remove_('Rsvps', [ex._row]); else insert_('Rsvps', { eventId: e.id, userId: u.id, createdAt: iso_() });
      return mapEvent_(e, u.id, groupBy_(rows_('Rsvps', true), 'eventId'), socialCtx_(u).groups);
    });
  });
}
function deleteEvent(token, id) {
  return run_(function () {
    const u = auth_(token);
    return withLock_(function () {
      const e = rows_('Events', true).find(function (x) { return x.id === String(id); });
      if (!e || e.createdBy !== u.id) fail_('Solo quien creó el evento puede eliminarlo.');
      e.status = 'deleted'; update_('Events', e);
      return true;
    });
  });
}

/* ═══════════════════════════ PERSONAS ═══════════════════════════ */

function followersOf_(uid) { return rows_('Follows').filter(function (f) { return f.followeeId === uid; }).length; }
function follow(token, uid) {
  return run_(function () {
    const u = auth_(token);
    if (uid === u.id) fail_('No puedes seguirte a ti mismo.');
    const t = userById_(String(uid));
    if (!t || t.status !== 'active') fail_('Este perfil no existe.');
    rate_('fw_' + u.id, 60, 600);
    return withLock_(function () {
      const ex = rows_('Follows', true).find(function (f) { return f.followerId === u.id && f.followeeId === t.id; });
      if (ex) remove_('Follows', [ex._row]);
      else { insert_('Follows', { followerId: u.id, followeeId: t.id, createdAt: iso_() }); notify_(t.id, 'users', u.name + ' empezó a seguirte.', { name: 'user', id: u.id }); }
      return { following: !ex, followers: followersOf_(t.id) };
    });
  });
}
function people(token) {
  return run_(function () {
    warm_(['Stories', 'Chats']);
    const v = auth_(token, false);
    if (!v) return [];
    const c = socialCtx_(v);
    const theirs = groupBy_(rows_('Follows'), 'followerId');
    return rows_('Users').filter(function (x) { return x.status === 'active' && x.id !== v.id && !c.following.has(x.id) && privacyOf_(x).suggestible; })
      .map(function (x) {
        const mutual = (theirs[x.id] || []).filter(function (f) { return c.following.has(f.followeeId); }).length;
        const same = !!x.university && x.university === v.university;
        return { u: x, score: mutual * 2 + (same ? 3 : 0) + (x.career && x.career === v.career ? 1 : 0), mutual: mutual, same: same };
      })
      .filter(function (r) { return r.score > 0 || !v.university; })
      .sort(function (a, b) { return b.score - a.score; }).slice(0, 5)
      .map(function (r) { return Object.assign(person_(r.u), { following: false, reason: r.mutual ? r.mutual + ' en común' : r.same ? 'Estudia en tu universidad' : 'Nuevo en Pupitre' }); });
  });
}
function userProfile(token, uid) {
  return run_(function () {
    warm_(['Stories', 'Chats']);
    const v = auth_(token, false), u = userById_(String(uid));
    if (!u || u.status !== 'active') fail_('Este perfil no existe.');
    const isMe = !!v && v.id === u.id;
    const following = !!v && rows_('Follows').some(function (f) { return f.followerId === v.id && f.followeeId === u.id; });
    const followsMe = !!v && rows_('Follows').some(function (f) { return f.followerId === u.id && f.followeeId === v.id; });
    const restricted = !isMe && privacyOf_(u).profileUniOnly && !(v && v.university && v.university === u.university) && !following && !followsMe;
    const p = person_(u);
    const user = restricted ? Object.assign(p, { name: p.name.split(/\s+/)[0], career: '', university: '', bio: '' }) : Object.assign(p, { bio: u.bio || '' });
    return {
      user: user, isMe: isMe, following: following, restricted: restricted, canDm: !!v && !isMe && canDm_(v, u),
      stats: {
        posts: rows_('Posts').filter(function (x) { return x.authorId === u.id && x.status === 'active'; }).length,
        followers: followersOf_(u.id), following: rows_('Follows').filter(function (f) { return f.followerId === u.id; }).length
      },
      listings: rows_('Products').filter(function (x) { return x.sellerId === u.id && x.status === 'active'; }).map(function (x) { return card_(toProduct_(x), u); })
    };
  });
}
function updateSocialPrivacy(token, patch) {
  return run_(function () {
    const u = auth_(token);
    return withLock_(function () {
      const f = freshUser_(u.id), cur = privacyOf_(f);
      Object.keys(DEFAULT_PRIVACY).forEach(function (k) { if (patch && typeof patch[k] === 'boolean') cur[k] = patch[k]; });
      f.socialPrivacy = JSON.stringify(cur); f.updatedAt = iso_();
      update_('Users', f);
      return cur;
    });
  });
}

/* ═══════════════════════════ MENSAJES PRIVADOS ═══════════════════════════ */

function canDm_(from, to) {
  if (!from || !to || from.id === to.id || to.status !== 'active') return false;
  if (!privacyOf_(to).dmFollowingOnly) return true;
  return rows_('Follows').some(function (f) { return f.followerId === to.id && f.followeeId === from.id; });
}
function chatFor_(chatId, u) {
  const c = rows_('Chats', true).find(function (x) { return x.id === String(chatId); });
  if (!c || (c.userA !== u.id && c.userB !== u.id)) fail_('Conversación no encontrada.');
  return c;
}
function conversations(token) {
  return run_(function () {
    warm_(['Stories', 'Chats']);
    const u = auth_(token), users = indexBy_(rows_('Users'), 'id');
    return rows_('Chats').filter(function (c) { return (c.userA === u.id || c.userB === u.id); })
      .map(function (c) {
        const other = users[c.userA === u.id ? c.userB : c.userA];
        return { id: c.id, with: person_(other), last: c.lastText || 'Nueva conversación', lastMine: c.lastFrom === u.id, at: c.lastAt || c.createdAt, unread: Number(c.userA === u.id ? c.unreadA : c.unreadB) || 0 };
      })
      .filter(function (c) { return c.with.id; })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  });
}
function openConversation(token, uid) {
  return run_(function () {
    const u = auth_(token), t = userById_(String(uid));
    if (!t || t.status !== 'active') fail_('Esta persona no está disponible.');
    if (t.id === u.id) fail_('No puedes escribirte a ti mismo.');
    return withLock_(function () {
      const ex = rows_('Chats', true).find(function (c) { return (c.userA === u.id && c.userB === t.id) || (c.userA === t.id && c.userB === u.id); });
      if (ex) return ex.id;
      if (!canDm_(u, t)) fail_('Esta persona solo recibe mensajes de quienes sigue.');
      const c = { id: id_('C'), userA: u.id, userB: t.id, createdAt: iso_(), lastAt: iso_(), lastText: '', lastFrom: '', unreadA: '0', unreadB: '0' };
      insert_('Chats', c);
      return c.id;
    });
  });
}
function messages(token, chatId) {
  return run_(function () {
    const u = auth_(token), c = chatFor_(chatId, u), meA = c.userA === u.id;
    if (Number(meA ? c.unreadA : c.unreadB) > 0) {
      withLock_(function () { const f = chatFor_(chatId, u); f[meA ? 'unreadA' : 'unreadB'] = '0'; update_('Chats', f); });
      dropPulse_(u.id);
    }
    const msgs = rows_('ChatMessages').filter(function (m) { return m.chatId === c.id; }).sort(byOldest_).slice(-150);
    return { with: person_(userById_(meA ? c.userB : c.userA)), messages: msgs.map(function (m) { return { mine: m.fromId === u.id, text: m.text, at: m.createdAt }; }) };
  });
}
function sendMessage(token, chatId, text) {
  return run_(function () {
    const u = auth_(token), t = str_(text, { min: 1, max: 1000, label: 'Mensaje', multiline: true });
    rate_('dm_' + u.id, 30, 60, 'Estás enviando mensajes muy rápido. Espera un momento.');
    let otherId;
    withLock_(function () {
      const c = chatFor_(chatId, u), meA = c.userA === u.id;
      otherId = meA ? c.userB : c.userA;
      const other = userById_(otherId);
      if (!other || other.status !== 'active') fail_('Esta persona ya no está disponible.');
      insert_('ChatMessages', { id: id_('M'), chatId: c.id, fromId: u.id, text: t, createdAt: iso_() });
      Object.assign(c, { lastAt: iso_(), lastText: t.slice(0, 80), lastFrom: u.id });
      c[meA ? 'unreadB' : 'unreadA'] = String((Number(c[meA ? 'unreadB' : 'unreadA']) || 0) + 1);
      update_('Chats', c);
    });
    dropPulse_(otherId);
    // Aviso por correo SIN el contenido, máximo uno cada 30 min por conversación
    const cache = CacheService.getScriptCache(), mk = 'mn_' + chatId + '_' + otherId;
    if (!cache.get(mk)) {
      cache.put(mk, '1', 1800);
      try {
        const other = userById_(otherId);
        if (other.email && MailApp.getRemainingDailyQuota() > 5) {
          MailApp.sendEmail({ to: other.email, name: CFG.APP_NAME, subject: firstName_(u) + ' te escribió en ' + CFG.APP_NAME,
            body: firstName_(u) + ' te envió un mensaje privado. Entra a Pupitre para leerlo.',
            htmlBody: mailWrap_('<h2 style="margin:0 0 10px">Tienes un mensaje nuevo</h2><p><strong>' + esc_(firstName_(u)) + '</strong> te escribió por mensaje privado. Por tu privacidad, el contenido solo se ve dentro de Pupitre.</p>') });
        }
      } catch (e) { /* cuota agotada */ }
    }
    return true;
  });
}

/* ═══════════════════════════ NOTIFICACIONES ═══════════════════════════ */

function notifications(token) {
  return run_(function () {
    const u = auth_(token);
    return rows_('Notifications').filter(function (n) { return n.userId === u.id; }).sort(byNewest_).slice(0, 30)
      .map(function (n) { return { id: n.id, icon: n.icon, text: n.text, at: n.createdAt, read: n.read === 'true', link: json_(n.link, { name: 'feed' }) }; });
  });
}
function markNotifs(token) {
  return run_(function () {
    const u = auth_(token);
    withLock_(function () {
      rows_('Notifications', true).filter(function (n) { return n.userId === u.id && n.read !== 'true'; })
        .forEach(function (n) { n.read = 'true'; update_('Notifications', n); });
    });
    dropPulse_(u.id);
    return true;
  });
}
/** Consultado cada pocos segundos: se guarda en caché 20 s por usuario. */
function socialPulse(token) {
  return run_(function () {
    const u = auth_(token, false);
    if (!u) return { version: feedVersion_(), unread: 0, unreadMsgs: 0 };
    const cache = CacheService.getScriptCache(), k = 'pl_' + u.id;
    let r = json_(cache.get(k), null);
    if (!r) {
      r = {
        unread: rows_('Notifications').filter(function (n) { return n.userId === u.id && n.read !== 'true'; }).length,
        unreadMsgs: rows_('Chats').filter(function (c) { return (c.userA === u.id && Number(c.unreadA) > 0) || (c.userB === u.id && Number(c.unreadB) > 0); }).length
      };
      cache.put(k, JSON.stringify(r), 20);
    }
    r.version = feedVersion_();
    return r;
  });
}
