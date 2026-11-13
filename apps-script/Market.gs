/**
 * Market.gs · Marketplace: publicaciones de venta, favoritos y reportes.
 */

/* ═══════════════════════════ PRODUCTOS ═══════════════════════════ */

function toProduct_(r) {
  return {
    id: r.id, sellerId: r.sellerId, title: r.title, description: r.description, category: r.category,
    condition: r.condition, price: Number(r.price) || 0, currency: r.currency || 'USD', campus: r.campus,
    images: json_(r.images, []), status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
    views: Number(r.views) || 0
  };
}
function card_(p, u) {
  const s = seller_(u);
  return {
    id: p.id, title: p.title, price: p.price, currency: p.currency, category: p.category,
    condition: p.condition, campus: p.campus, cover: p.images[0] || '', createdAt: p.createdAt,
    status: p.status, views: p.views, seller: { id: s.id, firstName: s.firstName, university: s.university },
    demo: !!u && u.status === 'demo'
  };
}
function liveUsers_() {
  return indexBy_(rows_('Users').filter(function (u) { return u.status === 'active' || u.status === 'demo'; }), 'id');
}

function listProducts(params) {
  return run_(function () {
    loadTables_(['Users', 'Products']);
    const p = params || {};
    const words = norm_(String(p.q || '').slice(0, 80)).split(/\s+/).filter(Boolean);
    const min = parseFloat(p.min), max = parseFloat(p.max);
    const users = liveUsers_();

    let items = rows_('Products').map(toProduct_).filter(function (x) {
      if (x.status !== 'active' || !users[x.sellerId]) return false;
      if (words.length) {
        const hay = norm_([x.title, x.description, x.campus, users[x.sellerId].university, x.category].join(' '));
        if (!words.every(function (w) { return hay.indexOf(w) > -1; })) return false;
      }
      if (p.cond && x.condition !== p.cond) return false;
      if (p.currency && x.currency !== p.currency) return false;
      if (!isNaN(min) && x.price < min) return false;
      if (!isNaN(max) && x.price > max) return false;
      return true;
    });

    const facets = {};
    items.forEach(function (x) { facets[x.category] = (facets[x.category] || 0) + 1; });
    const totalAll = items.length;
    if (p.cat) items = items.filter(function (x) { return x.category === p.cat; });

    const sorters = {
      recent: function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; },
      price_asc: function (a, b) { return a.price - b.price; },
      price_desc: function (a, b) { return b.price - a.price; },
      popular: function (a, b) { return b.views - a.views; }
    };
    items.sort(sorters[p.sort] || sorters.recent);

    const pages = Math.max(1, Math.ceil(items.length / CFG.PAGE_SIZE));
    const page = Math.min(pages, Math.max(1, parseInt(p.page, 10) || 1));
    const slice = items.slice((page - 1) * CFG.PAGE_SIZE, page * CFG.PAGE_SIZE);
    return {
      total: items.length, totalAll: totalAll, facets: facets, page: page, pages: pages,
      items: slice.map(function (x) { return card_(x, users[x.sellerId]); })
    };
  });
}

function getProduct(id, token) {
  return run_(function () {
    loadTables_(['Sessions', 'Users', 'Products', 'Favorites', 'Follows']);
    const viewer = auth_(token, false);
    const row = rows_('Products').find(function (r) { return r.id === String(id); });
    if (!row) fail_('Esta publicación ya no existe.');
    const p = toProduct_(row);
    const u = userById_(p.sellerId);
    const isOwner = !!viewer && viewer.id === p.sellerId;
    if (!isOwner && (!u || (u.status !== 'active' && u.status !== 'demo'))) fail_('Esta publicación ya no está disponible.');
    if (!isOwner && p.status === 'paused') fail_('Esta publicación está pausada por su autor.');

    if (!isOwner) {
      const l = LockService.getScriptLock();
      if (l.tryLock(1500)) {
        try {
          const fresh = rows_('Products', true).find(function (r) { return r.id === p.id; });
          if (fresh) { fresh.views = String((Number(fresh.views) || 0) + 1); update_('Products', fresh); p.views++; }
        } finally { l.releaseLock(); }
      }
    }

    const listings = rows_('Products').filter(function (r) { return r.sellerId === p.sellerId && r.status === 'active'; }).length;
    const out = card_(p, u);
    out.description = p.description;
    out.images = p.images;
    out.updatedAt = p.updatedAt;
    out.isOwner = isOwner;
    out.isFav = viewer ? favIds_(viewer.id).indexOf(p.id) > -1 : false;
    out.seller = Object.assign(seller_(u), { listings: listings });
    out.contact = viewer ? {
      canMessage: !isOwner && !!u && u.status === 'active' && canDm_(viewer, u),
      whatsapp: (u && u.showPhone === 'true' && u.phone) ? String(u.phone).replace(/\D/g, '') : ''
    } : null;
    return out;
  });
}

function saveProduct(token, data) {
  return run_(function () {
    const user = auth_(token);
    data = data || {};
    const title = str_(data.title, { min: 4, max: 80, label: 'Título' });
    const description = str_(data.description, { min: 10, max: 2000, label: 'Descripción', multiline: true });
    const category = String(data.category || '');
    if (!CATEGORIES.some(function (c) { return c.id === category; })) fail_('Elige una categoría válida.');
    const condition = String(data.condition || '');
    if (CONDITIONS.indexOf(condition) < 0) fail_('Elige el estado del artículo.');
    const currency = String(data.currency || 'USD');
    if (CURRENCIES.indexOf(currency) < 0) fail_('Moneda no válida.');
    const price = Math.round(Number(data.price) * 100) / 100;
    if (!isFinite(price) || price < 0 || price > 100000000) fail_('Escribe un precio válido (0 = gratis).');
    const campus = str_(data.campus, { max: 80, label: 'Campus o zona' });

    const incoming = Array.isArray(data.images) ? data.images.slice(0, CFG.MAX_IMAGES) : [];
    if (!incoming.length && NO_PHOTO_OK.indexOf(category) < 0) fail_('Agrega al menos una foto de tu artículo.');

    let existing = null;
    if (data.id) {
      const r = rows_('Products').find(function (x) { return x.id === String(data.id); });
      if (!r || r.sellerId !== user.id) fail_('No puedes editar esta publicación.');
      existing = toProduct_(r);
    } else {
      const active = rows_('Products').filter(function (x) { return x.sellerId === user.id && x.status === 'active'; }).length;
      if (active >= CFG.MAX_ACTIVE_PER_USER) fail_('Llegaste al máximo de ' + CFG.MAX_ACTIVE_PER_USER + ' publicaciones activas.');
    }
    const pid = existing ? existing.id : id_('P');

    // Subidas a Drive fuera del bloqueo (son lentas)
    const images = [];
    incoming.forEach(function (im, i) {
      if (im && im.id && existing && existing.images.indexOf(im.id) > -1) images.push(im.id);
      else if (im && (im.uploaded || im.dataUrl)) images.push(resolveImages_(user, [im], pid)[0]);
    });
    if (existing) {
      existing.images.filter(function (f) { return images.indexOf(f) < 0; }).forEach(trashImage_);
    }

    return withLock_(function () {
      const now = iso_();
      if (existing) {
        const r = rows_('Products', true).find(function (x) { return x.id === pid; });
        if (!r) fail_('La publicación fue eliminada mientras la editabas.');
        Object.assign(r, { title: title, description: description, category: category, condition: condition, price: String(price), currency: currency, campus: campus, images: images, updatedAt: now });
        update_('Products', r);
      } else {
        insert_('Products', { id: pid, sellerId: user.id, title: title, description: description, category: category, condition: condition, price: String(price), currency: currency, campus: campus, images: images, status: 'active', createdAt: now, updatedAt: now, views: '0' });
      }
      return { id: pid };
    });
  });
}

function setProductStatus(token, id, status) {
  return run_(function () {
    const u = auth_(token);
    if (STATUSES.indexOf(status) < 0) fail_('Estado no válido.');
    return withLock_(function () {
      const r = rows_('Products', true).find(function (x) { return x.id === String(id); });
      if (!r || r.sellerId !== u.id) fail_('No puedes modificar esta publicación.');
      r.status = status;
      r.updatedAt = iso_();
      update_('Products', r);
      return card_(toProduct_(r), u);
    });
  });
}

function deleteProduct(token, id) {
  return run_(function () {
    const u = auth_(token);
    const r = rows_('Products', true).find(function (x) { return x.id === String(id); });
    if (!r || r.sellerId !== u.id) fail_('No puedes eliminar esta publicación.');
    json_(r.images, []).forEach(trashImage_);
    withLock_(function () {
      const fresh = rows_('Products', true).find(function (x) { return x.id === String(id); });
      if (fresh) remove_('Products', [fresh._row]);
      const favs = rows_('Favorites', true).filter(function (f) { return f.productId === String(id); });
      if (favs.length) remove_('Favorites', favs.map(function (f) { return f._row; }));
    });
    return true;
  });
}

function myProducts(token) {
  return run_(function () {
    const u = auth_(token);
    return rows_('Products').filter(function (r) { return r.sellerId === u.id; })
      .map(toProduct_).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })
      .map(function (p) { return card_(p, u); });
  });
}

/* ─────────── Favoritos ─────────── */

function favIds_(userId) {
  return rows_('Favorites').filter(function (f) { return f.userId === userId; }).map(function (f) { return f.productId; });
}
function toggleFavorite(token, productId) {
  return run_(function () {
    const u = auth_(token);
    return withLock_(function () {
      const ex = rows_('Favorites', true).find(function (f) { return f.userId === u.id && f.productId === String(productId); });
      if (ex) { remove_('Favorites', [ex._row]); return false; }
      if (!rows_('Products').some(function (p) { return p.id === String(productId); })) fail_('La publicación ya no existe.');
      insert_('Favorites', { userId: u.id, productId: String(productId), createdAt: iso_() });
      return true;
    });
  });
}
function myFavorites(token) {
  return run_(function () {
    const u = auth_(token);
    const ids = favIds_(u.id), users = liveUsers_();
    return rows_('Products').map(toProduct_)
      .filter(function (p) { return ids.indexOf(p.id) > -1 && p.status !== 'paused' && users[p.sellerId]; })
      .map(function (p) { return card_(p, users[p.sellerId]); });
  });
}

/* ─────────── Reportes / moderación ─────────── */

function reportProduct(token, productId, reason) {
  return run_(function () {
    const u = auth_(token);
    const why = str_(reason, { min: 3, max: 300, label: 'Motivo' });
    return withLock_(function () {
      const all = rows_('Reports', true).filter(function (r) { return r.productId === String(productId); });
      if (all.some(function (r) { return r.reporterId === u.id; })) fail_('Ya reportaste esta publicación. Gracias.');
      insert_('Reports', { id: id_('R'), productId: String(productId), reporterId: u.id, reason: why, createdAt: iso_(), status: 'open' });
      if (all.length + 1 >= CFG.REPORTS_TO_AUTOPAUSE) {
        const p = rows_('Products', true).find(function (x) { return x.id === String(productId); });
        if (p && p.status === 'active') { p.status = 'paused'; update_('Products', p); }
      }
      if (CFG.ADMIN_EMAIL) {
        try { MailApp.sendEmail(CFG.ADMIN_EMAIL, CFG.APP_NAME + ': nuevo reporte ' + productId, 'Motivo: ' + why); } catch (e) { /* cuota */ }
      }
      return true;
    });
  });
}

