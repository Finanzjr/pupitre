/**
 * ════════════════════════════════════════════════════════════════════
 *  Admin.gs · Panel de métricas (KPI) y Google Analytics 4
 * ════════════════════════════════════════════════════════════════════
 *  ACCESO AL PANEL
 *   Propiedades del script → ADMIN_EMAILS = tu@correo.com, otra@persona.com
 *   (las cuentas con esos correos ven "Métricas" en su menú).
 *
 *  GOOGLE ANALYTICS 4
 *   1. analytics.google.com → Administrar → Crear propiedad "Pupitre" → Flujo de datos Web
 *      (URL: la de tu app web). Copia el ID de medición G-XXXXXXX.
 *   2. Propiedades del script → GA_MEASUREMENT_ID = G-XXXXXXX
 *   3. Solo se activa si la persona acepta "Analítica" en el aviso de cookies.
 *   4. En GA → Administrar → Eventos, marca como "evento clave": sign_up, listing_create,
 *      generate_lead, item_sold y post_create.
 *   5. En GA → Definiciones personalizadas, registra los parámetros que quieras filtrar:
 *      method, audience, has_photo, item_category, privacy, content_type.
 *   Nunca se envían nombres, correos, teléfonos ni textos de mensajes a Google Analytics.
 */

function isAdmin_(u) {
  if (!u || !u.email) return false;
  const list = String(prop_('ADMIN_EMAILS') || CFG.ADMIN_EMAIL || '').toLowerCase().split(/[,;\s]+/).filter(Boolean);
  return list.indexOf(String(u.email).toLowerCase()) > -1;
}

/** KPI del período elegido (7, 30 o 90 días) comparados con el período anterior. */
function adminMetrics(token, days) {
  return run_(function () {
    loadTables_(['Sessions', 'Users', 'Products', 'Favorites', 'Posts', 'Comments', 'Reactions', 'PollVotes', 'Follows', 'Groups', 'GroupMembers', 'Events', 'Rsvps', 'Chats', 'ChatMessages', 'Stories', 'PostReports', 'Reports']);
    const me = auth_(token);
    if (!isAdmin_(me)) fail_('Solo las cuentas administradoras pueden ver las métricas.');
    days = [7, 30, 90].indexOf(Number(days)) > -1 ? Number(days) : 30;
    const tz = 'America/Caracas', now = Date.now();
    const from = new Date(now - days * 864e5).toISOString(), prev = new Date(now - 2 * days * 864e5).toISOString();
    const inR = function (d) { return !!d && d >= from; };
    const inP = function (d) { return !!d && d >= prev && d < from; };
    const pair = function (list, key) { return { value: list.filter(function (x) { return inR(x[key]); }).length, prev: list.filter(function (x) { return inP(x[key]); }).length }; };

    const users = rows_('Users').filter(function (u) { return u.status === 'active'; });
    const prods = rows_('Products'), posts = rows_('Posts').filter(function (p) { return p.status !== 'deleted'; });
    const comments = rows_('Comments'), reacts = rows_('Reactions'), msgs = rows_('ChatMessages'), chats = rows_('Chats');
    const favs = rows_('Favorites'), follows = rows_('Follows'), votes = rows_('PollVotes');
    const sold = prods.filter(function (p) { return p.status === 'sold'; });
    const gmv = function (list) { const o = { USD: 0, VES: 0 }; list.forEach(function (p) { o[p.currency] = (o[p.currency] || 0) + (Number(p.price) || 0); }); return o; };
    const soldNow = sold.filter(function (p) { return inR(p.updatedAt); }), soldPrev = sold.filter(function (p) { return inP(p.updatedAt); });
    const gNow = gmv(soldNow), gPrev = gmv(soldPrev);

    // Serie diaria
    const dayKey = function (iso) { return Utilities.formatDate(new Date(iso), tz, 'yyyy-MM-dd'); };
    const daysList = [];
    for (let i = days - 1; i >= 0; i--) daysList.push(dayKey(new Date(now - i * 864e5).toISOString()));
    const series = function (list, key, pred) {
      const m = {};
      list.forEach(function (x) { if (inR(x[key]) && (!pred || pred(x))) { const k = dayKey(x[key]); m[k] = (m[k] || 0) + 1; } });
      return daysList.map(function (d) { return { d: d, v: m[d] || 0 }; });
    };

    // Categorías
    const cats = {};
    CATEGORIES.forEach(function (c) { cats[c.id] = { id: c.id, label: c.label, active: 0, sold: 0, views: 0 }; });
    prods.forEach(function (p) {
      const c = cats[p.category]; if (!c) return;
      if (p.status === 'active') c.active++;
      if (p.status === 'sold') c.sold++;
      c.views += Number(p.views) || 0;
    });

    const byPost = groupBy_(reacts, 'postId'), byPostC = groupBy_(comments, 'postId'), uIdx = indexBy_(users, 'id');
    const topPosts = posts.filter(function (p) { return inR(p.createdAt) && p.status === 'active'; }).map(function (p) {
      const l = (byPost[p.id] || []).length, c = (byPostC[p.id] || []).length;
      return { id: p.id, text: String(p.text || '').slice(0, 90), author: uIdx[p.authorId] ? String(uIdx[p.authorId].name).split(/\s+/)[0] : '—', likes: l, comments: c, score: l + 2 * c };
    }).sort(function (a, b) { return b.score - a.score; }).slice(0, 5);
    const topListings = prods.filter(function (p) { return p.status !== 'paused'; }).sort(function (a, b) { return (Number(b.views) || 0) - (Number(a.views) || 0); }).slice(0, 5)
      .map(function (p) { return { id: p.id, title: p.title, views: Number(p.views) || 0, price: Number(p.price) || 0, currency: p.currency, status: p.status, favorites: favs.filter(function (f) { return f.productId === p.id; }).length }; });
    const uni = {};
    users.forEach(function (u) { const k = u.university || 'Sin universidad'; uni[k] = (uni[k] || 0) + 1; });

    const views = prods.reduce(function (s, p) { return s + (Number(p.views) || 0); }, 0);
    return {
      days: days, generatedAt: iso_(), gaId: (getConfig().data || {}).gaId || '',
      kpis: {
        newUsers: pair(users, 'createdAt'), activeUsers: pair(users, 'lastLogin'),
        newListings: pair(prods, 'createdAt'), sold: { value: soldNow.length, prev: soldPrev.length },
        gmvUSD: { value: gNow.USD, prev: gPrev.USD }, gmvVES: { value: gNow.VES, prev: gPrev.VES },
        favorites: pair(favs, 'createdAt'), chats: pair(chats, 'createdAt'),
        posts: pair(posts, 'createdAt'), comments: pair(comments, 'createdAt'), likes: pair(reacts, 'createdAt'),
        messages: pair(msgs, 'createdAt'), follows: pair(follows, 'createdAt'), pollVotes: pair(votes, 'createdAt')
      },
      totals: {
        users: users.length, listingsActive: prods.filter(function (p) { return p.status === 'active'; }).length, listingsSold: sold.length,
        posts: posts.length, groups: rows_('Groups').filter(function (g) { return g.status === 'active'; }).length,
        upcomingEvents: rows_('Events').filter(function (e) { return e.status === 'active' && new Date(e.date).getTime() > now; }).length,
        sso: users.filter(function (u) { return u.googleSub || u.appleSub; }).length
      },
      series: {
        signups: series(users, 'createdAt'), posts: series(posts, 'createdAt'),
        listings: series(prods, 'createdAt'), messages: series(msgs, 'createdAt'),
        sold: series(sold, 'updatedAt')
      },
      funnel: [
        { k: 'Vistas de artículos', v: views },
        { k: 'Guardados en favoritos', v: favs.length },
        { k: 'Conversaciones iniciadas', v: chats.length },
        { k: 'Marcados como vendidos', v: sold.length }
      ],
      categories: Object.keys(cats).map(function (k) { return cats[k]; }).sort(function (a, b) { return (b.active + b.sold) - (a.active + a.sold); }),
      topPosts: topPosts, topListings: topListings,
      universities: Object.keys(uni).map(function (k) { return { k: k, v: uni[k] }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 6),
      moderation: {
        productReports: rows_('Reports').filter(function (r) { return r.status === 'open'; }).length,
        postReports: rows_('PostReports').filter(function (r) { return inR(r.createdAt); }).length,
        hiddenPosts: posts.filter(function (p) { return p.status === 'hidden'; }).length,
        pausedListings: prods.filter(function (p) { return p.status === 'paused'; }).length
      }
    };
  });
}
