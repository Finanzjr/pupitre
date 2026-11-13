// Puente con Apps Script. Solo necesita la URL /exec de tu implementación: nada de claves JSON.
const GAS_URL = (process.env.GAS_URL || '').trim();
const PROXY_KEY = (process.env.PROXY_KEY || '').trim();

async function callGas(fn, args, timeoutMs = 55000) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(GAS_URL)) {
    return { ok: false, error: 'Falta configurar GAS_URL en Vercel (URL /exec de Apps Script).', code: 'CONFIG' };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // text/plain evita que Apps Script lo trate como formulario; fetch sigue la redirección de Google sola.
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn, args, k: PROXY_KEY || undefined }),
      redirect: 'follow',
      signal: ctrl.signal
    });
    const text = await res.text();
    try { return JSON.parse(text); }
    catch {
      const login = /accounts\.google\.com|ServiceLogin/i.test(text);
      return { ok: false, code: 'SERVER', error: login
        ? 'Apps Script pide iniciar sesión: implementa la app con acceso "Cualquier usuario".'
        : 'El servidor de Apps Script no respondió correctamente. Intenta de nuevo.' };
    }
  } catch (e) {
    return { ok: false, code: e.name === 'AbortError' ? 'TIMEOUT' : 'NET', error: 'No pudimos conectar con el servidor. Intenta de nuevo.' };
  } finally { clearTimeout(t); }
}
module.exports = { callGas, GAS_URL };
