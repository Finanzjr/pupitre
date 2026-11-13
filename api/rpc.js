// POST /api/rpc  { fn, args }  →  la función de Apps Script con ese nombre.
const { callGas, GAS_URL } = require('./_gas');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    // Chequeo rápido: abre /api/rpc en el navegador para ver si la conexión funciona.
    const r = await callGas('getConfig', [], 20000);
    return res.status(200).json(r.ok
      ? { conexion: 'OK', app: r.data.appName, appsScript: GAS_URL.replace(/\/s\/([\w-]{6})[\w-]+/, '/s/$1…') }
      : { conexion: 'ERROR', detalle: r.error });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body.fn !== 'string' || !/^[a-zA-Z]{2,40}$/.test(body.fn)) {
    return res.status(400).json({ ok: false, error: 'Petición no válida.', code: 'BAD' });
  }
  const args = Array.isArray(body.args) ? body.args : [];
  const r = await callGas(body.fn, args);
  return res.status(200).json(r);
};
