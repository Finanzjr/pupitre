// Regreso de "Continuar con Google / Apple". Registra https://TU-DOMINIO/api/sso como URL de redireccionamiento.
const { callGas } = require('./_gas');

module.exports = async (req, res) => {
  let p = req.method === 'POST' ? req.body : req.query;
  if (typeof p === 'string') p = Object.fromEntries(new URLSearchParams(p));
  p = p || {};
  const pick = k => (typeof p[k] === 'string' ? p[k].slice(0, 4000) : '');
  const r = await callGas('ssoCallback', [{ state: pick('state'), code: pick('code'), error: pick('error'), user: pick('user') }]);
  const q = r.ok ? 'sso_ticket=' + encodeURIComponent(r.data) : 'sso_error=' + encodeURIComponent(r.error || 'No pudimos iniciar sesión.');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 303; // 303: el navegador vuelve con GET aunque Apple haya llegado por POST
  res.setHeader('Location', '/?' + q);
  res.end();
};
