# Pupitre

Red social y marketplace universitario. Proyecto de estudiantes de la Universidad Santa María.

- **Frontend:** página estática en **Vercel** (`public/`).
- **Backend y datos:** **Google Apps Script** + Google Sheets + Drive (`apps-script/`).
- **Puente:** funciones de Vercel (`api/`) que reenvían cada llamada a Apps Script.

**No necesitas claves JSON ni cuentas de servicio de Google.** Apps Script corre con tu propia cuenta, y Vercel solo guarda la URL pública `/exec` de tu implementación.

```
navegador ──► Vercel /api/rpc ──► Apps Script (doPost) ──► Sheets / Drive
```

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `public/` | `index.html`, `styles.css`, `app.js`, `favicon.svg` (lo que ve el usuario) |
| `api/rpc.js` | Reenvía las llamadas `{ fn, args }` a Apps Script |
| `api/sso.js` | Regreso de "Continuar con Google / Apple" |
| `api/_gas.js` | Conexión compartida con Apps Script (no es una ruta pública) |
| `apps-script/` | Código del servidor para pegar en el editor de Apps Script |
| `vercel.json` | Carpeta de salida, tiempos límite y cabeceras de seguridad |

## 1. Apps Script (backend)

1. En el editor de Apps Script, crea un archivo por cada uno de `apps-script/` con el mismo nombre (`Code.gs`, `Api.gs`, `Auth.gs`, `Market.gs`, `Social.gs`, `Privacy.gs`, `Admin.gs`, `Diag.gs` y los `.html`). Reemplaza también `appsscript.json` (activa *Mostrar el archivo de manifiesto* en Configuración del proyecto).
2. Ejecuta `setup` una vez y acepta los permisos.
3. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
4. Copia la URL que termina en `/exec`.

## 2. GitHub

```bash
git init
git add .
git commit -m "Pupitre"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/pupitre.git
git push -u origin main
```

También puedes crear el repositorio en github.com y usar **Add file → Upload files** para subir todo el contenido de esta carpeta (respetando las carpetas).

## 3. Vercel

1. En vercel.com: **Add New → Project → Import** el repositorio.
2. Framework Preset: **Other**. No hace falta comando de build.
3. En **Environment Variables** agrega:
   - `GAS_URL` = la URL `/exec` del paso 1.
   - `PROXY_KEY` = *(opcional)* una frase secreta.
4. **Deploy**.
5. Abre `https://TU-PROYECTO.vercel.app/api/rpc`. Debe decir `"conexion": "OK"`.

## 4. Conectar Apps Script con Vercel

En Apps Script: **Configuración del proyecto → Propiedades del script**:

| Propiedad | Valor |
|---|---|
| `FRONTEND_URL` | `https://TU-PROYECTO.vercel.app` (sin `/` final) |
| `PROXY_KEY` | *(opcional)* la misma frase que pusiste en Vercel |

Con `FRONTEND_URL`, los enlaces compartidos apuntan a Vercel y quien abra la URL `/exec` vieja es enviado a la nueva.

Si cambias el código `.gs`, vuelve a implementar como **Nueva versión** (la URL `/exec` no cambia).

## 5. Inicio rápido con Google / Apple (opcional)

1. Agrega en Apps Script la propiedad `SSO_REDIRECT_URI` = `https://TU-PROYECTO.vercel.app/api/sso`.
2. En Google Cloud Console → Credenciales → tu ID de cliente OAuth (tipo *Aplicación web*), en **URI de redireccionamiento autorizados** agrega esa misma URL. Para Apple, regístrala en el Service ID como *Return URL*.
3. `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` (y los de Apple) siguen en las Propiedades del script, como antes.

Esto usa un **ID de cliente OAuth**, no una clave JSON de cuenta de servicio, así que funciona aunque tu organización bloquee la creación de claves.

## 6. Google Analytics (opcional)

Propiedad del script `GA_MEASUREMENT_ID` = `G-XXXXXXX`. Solo se carga si el usuario acepta las cookies de analítica.

## Problemas comunes

| Síntoma | Solución |
|---|---|
| `/api/rpc` dice "Falta configurar GAS_URL" | Agrega la variable en Vercel y vuelve a desplegar (**Deployments → Redeploy**). |
| "Apps Script pide iniciar sesión" | La implementación debe tener acceso **Cualquier usuario**. |
| "Acceso no autorizado" | `PROXY_KEY` es distinto en Vercel y en Apps Script. |
| Cambié el `.gs` y no se nota | Implementar → Gestionar implementaciones → ✏️ → **Nueva versión**. |
| Algo falla en el servidor | En el editor de Apps Script ejecuta `diagnostico` y revisa el registro. |

Las fotos se suben a Drive desde el navegador ya comprimidas, por debajo del límite de 4,5 MB por petición de Vercel.
