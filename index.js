import { Hono } from 'hono';
import { getSignedCookie, setSignedCookie, getCookie, setCookie, deleteCookie } from 'hono/cookie';

// ============================================================
//  Constantes (equivalen a models.py)
// ============================================================
const ROLES = ['administrador', 'cajero'];
const TIPOS_ESPACIO = ['futsal', 'voley', 'billar', 'otro'];
const ETIQUETAS_ESPACIO = { futsal: 'Futsal / Fútbol', voley: 'Vóley / Piki', billar: 'Billar', otro: 'Otros juegos' };
// Como se cobra cada espacio: por hora, por juego o por ficha
const UNIDADES = ['hora', 'juego', 'ficha'];
const ETIQUETAS_UNIDAD = { hora: 'Por hora', juego: 'Por juego', ficha: 'Por ficha' };
const UNIDAD_SINGULAR = { hora: 'hora', juego: 'juego', ficha: 'ficha' };
const UNIDAD_PLURAL = { hora: 'horas', juego: 'juegos', ficha: 'fichas' };
const UNIDAD_CAMPO = { hora: 'Cantidad de horas', juego: 'Cantidad de juegos', ficha: 'Cantidad de fichas' };
const UNIDAD_DEFECTO = { futsal: 'hora', voley: 'juego', billar: 'ficha', otro: 'hora' };
const CATEGORIAS_PRODUCTO = ['bebida_sin_alcohol', 'bebida_alcoholica', 'comida_rapida', 'otro'];
const ETIQUETAS_CATEGORIA = { bebida_sin_alcohol: 'Bebida sin alcohol', bebida_alcoholica: 'Bebida alcohólica', comida_rapida: 'Comida rápida', otro: 'Otro' };
const METODOS_PAGO = ['efectivo', 'transferencia', 'tarjeta'];
// 'mixto' no es una caja de dinero: es un cobro repartido entre las tres de arriba
// La tarjeta no se usa en el complejo: queda la columna en la base, pero no se ofrece.
// Para volver a habilitarla basta con agregar 'tarjeta' de nuevo a esta lista.
const METODOS_FORM = ['efectivo', 'transferencia', 'mixto'];
const ETIQUETAS_PAGO = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', mixto: 'Mixto' };

const TZ = 'America/Asuncion';

// ============================================================
//  Utilidades
// ============================================================
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function gs(valor) {
  let n = Math.round(Number(valor) || 0);
  const signo = n < 0 ? '-' : '';
  n = Math.abs(n);
  const texto = n.toLocaleString('en-US').replace(/,/g, '.');
  return `${signo}₲ ${texto}`;
}

function aEntero(valor) {
  const n = parseInt(String(valor ?? '').replace(/\./g, '').trim() || '0', 10);
  return Number.isNaN(n) ? 0 : n;
}

// ---- Fecha/hora en horario de Paraguay ----
function partesAhora(d = new Date()) {
  // 'sv-SE' produce "YYYY-MM-DD HH:MM:SS"
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d).replace(' ', ' ');
}
const ahoraTS = () => partesAhora();               // "YYYY-MM-DD HH:MM:SS"
const fechaHoy = () => partesAhora().slice(0, 10);  // "YYYY-MM-DD"
const horaActual = () => partesAhora().slice(11, 16); // "HH:MM"

function fmtFechaHora(s) {
  if (!s) return '-';
  const t = String(s).replace('T', ' ');
  const f = t.slice(0, 10), h = t.slice(11, 16);
  const [a, m, d] = f.split('-');
  return `${d}/${m}/${a}${h ? ' ' + h : ''}`;
}
// "1,5 horas" / "3 juegos" / "2 fichas"
function fmtCantidad(cant, unidad) {
  const u = UNIDADES.includes(unidad) ? unidad : 'hora';
  const n = Number(cant) || 0;
  const texto = Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
  return `${texto} ${n === 1 ? UNIDAD_SINGULAR[u] : UNIDAD_PLURAL[u]}`;
}

function fmtFecha(s) {
  if (!s) return '-';
  const [a, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

// ---- Hash de contraseñas (PBKDF2-SHA256, compatible con el seed) ----
const enc = new TextEncoder();
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}
function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function pbkdf2(password, saltBytes, iterations, dkLen = 32) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, key, dkLen * 8);
  return new Uint8Array(bits);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const dk = await pbkdf2(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${bytesToHex(salt)}$${bytesToHex(dk)}`;
}
async function verifyPassword(password, stored) {
  try {
    const [algo, iterStr, saltHex, hashHex] = String(stored).split('$');
    if (algo !== 'pbkdf2_sha256') return false;
    const dk = await pbkdf2(password, hexToBytes(saltHex), parseInt(iterStr, 10), hashHex.length / 2);
    return bytesToHex(dk) === hashHex;
  } catch {
    return false;
  }
}

// ============================================================
//  Acceso a datos (D1)
// ============================================================
const all = async (env, sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results ?? [];
const first = async (env, sql, ...a) => await env.DB.prepare(sql).bind(...a).first();
const run = async (env, sql, ...a) => await env.DB.prepare(sql).bind(...a).run();

const cajaAbierta = (env) => first(env, "SELECT * FROM cajas WHERE estado='abierta' ORDER BY id DESC LIMIT 1");
const rangoDia = (f) => [`${f} 00:00:00`, `${f} 23:59:59`];

async function totalAlquileresDia(env, f) {
  const [i, fin] = rangoDia(f);
  const r = await first(env, 'SELECT COALESCE(SUM(total),0) AS t FROM alquileres WHERE fecha_registro>=? AND fecha_registro<=?', i, fin);
  return r ? r.t : 0;
}
async function totalKioscoDia(env, f) {
  const [i, fin] = rangoDia(f);
  const r = await first(env, 'SELECT COALESCE(SUM(total),0) AS t FROM ventas WHERE fecha>=? AND fecha<=?', i, fin);
  return r ? r.t : 0;
}
async function alquileresDelDia(env, f) {
  const [i, fin] = rangoDia(f);
  return all(env, 'SELECT * FROM alquileres WHERE fecha_registro>=? AND fecha_registro<=? ORDER BY fecha_registro DESC', i, fin);
}
async function alquileresPorTipoDia(env, f) {
  const [i, fin] = rangoDia(f);
  return all(env, 'SELECT tipo_espacio, COUNT(id) AS cantidad, COALESCE(SUM(total),0) AS total FROM alquileres WHERE fecha_registro>=? AND fecha_registro<=? GROUP BY tipo_espacio', i, fin);
}
async function productosMasVendidosDia(env, f, limite = 5) {
  const [i, fin] = rangoDia(f);
  return all(env,
    `SELECT p.nombre AS nombre, COALESCE(SUM(vd.cantidad),0) AS cantidad, COALESCE(SUM(vd.subtotal),0) AS total,
            COALESCE(SUM(COALESCE(NULLIF(vd.costo_unitario,0), p.precio_costo, 0) * vd.cantidad),0) AS costo
     FROM venta_detalles vd JOIN ventas v ON vd.venta_id=v.id JOIN productos p ON vd.producto_id=p.id
     WHERE v.fecha>=? AND v.fecha<=? GROUP BY p.id ORDER BY SUM(vd.cantidad) DESC LIMIT ?`, i, fin, limite);
}
const productosStockBajo = (env) => all(env, 'SELECT * FROM productos WHERE activo=1 AND stock<=stock_minimo');
async function totalesRango(env, fi, ff) {
  const i = `${fi} 00:00:00`, fin = `${ff} 23:59:59`;
  const a = await first(env, 'SELECT COALESCE(SUM(total),0) AS t FROM alquileres WHERE fecha_registro>=? AND fecha_registro<=?', i, fin);
  const k = await first(env, 'SELECT COALESCE(SUM(total),0) AS t FROM ventas WHERE fecha>=? AND fecha<=?', i, fin);
  return [a ? a.t : 0, k ? k.t : 0];
}

// ---- Arqueo de caja: los totales se calculan POR CAJA (no por dia) ----
const COSTO_SQL = 'COALESCE(NULLIF(vd.costo_unitario,0), p.precio_costo, 0)';

// Reparto del cobro por caja de dinero. Si las columnas nuevas estan en cero
// (filas viejas), cae al metodo_pago de la fila para no perder plata en el arqueo.
const SQL_REPARTO = `
  COALESCE(SUM(CASE
    WHEN COALESCE(pago_efectivo,0)+COALESCE(pago_transferencia,0)+COALESCE(pago_tarjeta,0) > 0 THEN COALESCE(pago_efectivo,0)
    WHEN metodo_pago='efectivo' THEN total ELSE 0 END),0) AS efectivo,
  COALESCE(SUM(CASE
    WHEN COALESCE(pago_efectivo,0)+COALESCE(pago_transferencia,0)+COALESCE(pago_tarjeta,0) > 0 THEN COALESCE(pago_transferencia,0)
    WHEN metodo_pago='transferencia' THEN total ELSE 0 END),0) AS transferencia,
  COALESCE(SUM(CASE
    WHEN COALESCE(pago_efectivo,0)+COALESCE(pago_transferencia,0)+COALESCE(pago_tarjeta,0) > 0 THEN COALESCE(pago_tarjeta,0)
    WHEN metodo_pago='tarjeta' THEN total ELSE 0 END),0) AS tarjeta,
  COALESCE(SUM(total),0) AS t, COUNT(id) AS n`;

// Toma lo que vino del formulario y devuelve como se reparte el cobro.
// Devuelve { error } si el reparto mixto no cuadra con el total.
function repartoPago(b, total) {
  const num = (v) => {
    const n = parseInt(String(v == null ? '0' : v).replace(/[^0-9]/g, ''), 10);
    return Number.isNaN(n) ? 0 : n;
  };
  let metodo = String(b.metodo_pago || 'efectivo');
  if (!METODOS_FORM.includes(metodo)) metodo = 'efectivo';

  if (metodo !== 'mixto') {
    const r = { metodo, efectivo: 0, transferencia: 0, tarjeta: 0 };
    r[metodo] = total;
    return r;
  }

  const efectivo = num(b.pago_efectivo);
  const transferencia = num(b.pago_transferencia);
  const tarjeta = num(b.pago_tarjeta);
  const suma = efectivo + transferencia + tarjeta;
  if (suma !== total) {
    const dif = total - suma;
    return { error: 'El pago mixto no cuadra: el total es ' + gs(total) + ' y repartiste ' + gs(suma) + '. '
      + (dif > 0 ? 'Falta ' + gs(dif) + '.' : 'Te pasaste por ' + gs(-dif) + '.') };
  }
  // Si al final cargo una sola forma de pago, se guarda como pago simple
  const usadas = METODOS_PAGO.filter((m) => ({ efectivo, transferencia, tarjeta })[m] > 0);
  if (usadas.length === 1) return { metodo: usadas[0], efectivo, transferencia, tarjeta };
  return { metodo: 'mixto', efectivo, transferencia, tarjeta };
}

// Celda "Pago" de las tablas: los mixtos muestran el desglose
function fmtPago(r) {
  if (r.metodo_pago !== 'mixto') return esc(ETIQUETAS_PAGO[r.metodo_pago] || r.metodo_pago);
  const partes = [];
  if (r.pago_efectivo > 0) partes.push('efvo. ' + gs(r.pago_efectivo));
  if (r.pago_transferencia > 0) partes.push('transf. ' + gs(r.pago_transferencia));
  if (r.pago_tarjeta > 0) partes.push('tarj. ' + gs(r.pago_tarjeta));
  return 'Mixto' + (partes.length ? ' <small class="texto-suave">(' + esc(partes.join(' · ')) + ')</small>' : '');
}

// Bloque de montos que aparece al elegir "Mixto"
const BLOQUE_MIXTO = `
<div id="bloque-mixto" class="panel-mixto" style="display:none">
  <div class="formulario-fila">
    <div><label for="pago_efectivo">Efectivo</label>
      <input type="number" class="mixto-input" id="pago_efectivo" name="pago_efectivo" min="0" step="1000" value="0"></div>
    <div><label for="pago_transferencia">Transferencia</label>
      <input type="number" class="mixto-input" id="pago_transferencia" name="pago_transferencia" min="0" step="1000" value="0"></div>
  </div>
  <p class="ayuda-texto" id="mixto-aviso"></p>
</div>`;

async function resumenCaja(env, cajaId) {
  const alqR = await first(env, 'SELECT ' + SQL_REPARTO + ' FROM alquileres WHERE caja_id=?', cajaId);
  const venR = await first(env, 'SELECT ' + SQL_REPARTO + ' FROM ventas WHERE caja_id=?', cajaId);
  const movRows = await all(env, 'SELECT tipo, COALESCE(SUM(monto),0) AS t FROM movimientos_caja WHERE caja_id=? GROUP BY tipo', cajaId);
  const cmv = await first(env,
    `SELECT COALESCE(SUM(${COSTO_SQL} * vd.cantidad),0) AS t
     FROM venta_detalles vd JOIN ventas v ON vd.venta_id=v.id JOIN productos p ON vd.producto_id=p.id
     WHERE v.caja_id=?`, cajaId);

  const reparto = (row) => ({
    efectivo: row ? row.efectivo : 0,
    transferencia: row ? row.transferencia : 0,
    tarjeta: row ? row.tarjeta : 0,
  });
  const alq = reparto(alqR), kio = reparto(venR);
  const alqTotal = alqR ? alqR.t : 0, kioTotal = venR ? venR.t : 0;
  const alqCant = alqR ? alqR.n : 0, kioCant = venR ? venR.n : 0;
  let egresos = 0, ingresos = 0;
  for (const r of movRows) { if (r.tipo === 'egreso') egresos += r.t; else ingresos += r.t; }
  const porMetodo = {
    efectivo: alq.efectivo + kio.efectivo,
    transferencia: alq.transferencia + kio.transferencia,
    tarjeta: alq.tarjeta + kio.tarjeta,
  };
  const costoKiosco = cmv ? cmv.t : 0;
  return {
    alq, kio, alqTotal, kioTotal, alqCant, kioCant, porMetodo, egresos, ingresos,
    totalGeneral: alqTotal + kioTotal,
    costoKiosco, utilidadKiosco: kioTotal - costoKiosco,
  };
}

// Efectivo que TIENE que haber en la caja (solo efectivo, no transferencias ni tarjeta)
const efectivoEsperado = (caja, r) => (caja.monto_inicial || 0) + r.porMetodo.efectivo + r.ingresos - r.egresos;

const movimientosDeCaja = (env, cajaId) => all(env,
  `SELECT m.*, u.nombre AS usuario FROM movimientos_caja m
   LEFT JOIN usuarios u ON m.usuario_id=u.id WHERE m.caja_id=? ORDER BY m.id DESC`, cajaId);

const alquileresDeCaja = (env, cajaId) => all(env, 'SELECT * FROM alquileres WHERE caja_id=? ORDER BY id DESC', cajaId);
const ventasDeCaja = (env, cajaId) => all(env, 'SELECT * FROM ventas WHERE caja_id=? ORDER BY id DESC', cajaId);

// ---- Costo / ganancia del kiosco por fecha o rango ----
async function utilidadKiosco(env, desde, hasta) {
  const r = await first(env,
    `SELECT COALESCE(SUM(vd.subtotal),0) AS venta, COALESCE(SUM(${COSTO_SQL} * vd.cantidad),0) AS costo
     FROM venta_detalles vd JOIN ventas v ON vd.venta_id=v.id JOIN productos p ON vd.producto_id=p.id
     WHERE v.fecha>=? AND v.fecha<=?`, desde, hasta);
  const venta = r ? r.venta : 0, costo = r ? r.costo : 0;
  return { venta, costo, utilidad: venta - costo };
}
const utilidadKioscoDia = (env, f) => { const [i, fin] = rangoDia(f); return utilidadKiosco(env, i, fin); };
const utilidadKioscoRango = (env, fi, ff) => utilidadKiosco(env, `${fi} 00:00:00`, `${ff} 23:59:59`);

// Margen de un producto en % sobre el precio de venta
function margenPct(precioVenta, precioCosto) {
  const v = Number(precioVenta) || 0, cst = Number(precioCosto) || 0;
  if (!v || !cst) return null;
  return Math.round(((v - cst) / v) * 1000) / 10;
}

// ============================================================
//  Plantillas (equivalen a templates/*.html)
// ============================================================
function opciones(lista, etiquetas, seleccionado, dataPrecios) {
  return lista.map((v) => {
    const dp = dataPrecios ? ` data-precio="${dataPrecios[v] || 0}"` : '';
    const sel = v === seleccionado ? ' selected' : '';
    const extra = dataPrecios ? ` (${gs(dataPrecios[v] || 0)}/hora)` : '';
    return `<option value="${v}"${dp}${sel}>${esc(etiquetas[v] || v)}${extra}</option>`;
  }).join('');
}

function opcionesEspacio(precios, unidades) {
  return TIPOS_ESPACIO.map((t) => {
    const u = unidades[t] || UNIDAD_DEFECTO[t] || 'hora';
    const precio = precios[t] || 0;
    return `<option value="${t}" data-precio="${precio}" data-unidad="${u}">` +
      `${esc(ETIQUETAS_ESPACIO[t] || t)} (${gs(precio)} por ${UNIDAD_SINGULAR[u]})</option>`;
  }).join('');
}

function layout(c, { title, body, publico = false }) {
  const user = c.get('user');
  const caja = c.get('cajaActual');
  const flashes = tomarFlashes(c);
  const bloqueFlashes = (clase) => flashes.length
    ? `<div class="flashes ${clase}">${flashes.map(([cat, msg]) => `<div class="flash flash-${esc(cat)}">${esc(msg)}</div>`).join('')}</div>`
    : '';

  if (publico || !user) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/static/css/style.css"></head>
<body class="pagina-login">
${bloqueFlashes('flashes-login')}
${body}
<script src="/static/js/main.js"></script></body></html>`;
  }

  const navItem = (href, bp, actualBp, txt) => `<a href="${href}" class="${bp === actualBp ? 'activo' : ''}">${txt}</a>`;
  const bp = c.get('seccion') || '';
  const esAdmin = user.rol === 'administrador';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/static/css/style.css"></head>
<body>
<div class="app-shell">
  <button id="btn-menu" class="btn-menu" aria-label="Abrir menú">☰</button>
  <aside id="sidebar" class="sidebar">
    <div class="sidebar-logo"><span class="logo-icono">🏟️</span><span class="logo-texto">Tercer Tiempo</span></div>
    <div class="sidebar-usuario"><span>${esc(user.nombre)}</span><span class="badge-rol">${esAdmin ? 'Administrador' : 'Cajero'}</span></div>
    <nav class="sidebar-nav">
      ${navItem('/dashboard', 'dashboard', bp, '🏠 Dashboard')}
      ${navItem('/caja', 'caja', bp, '💵 Caja')}
      ${navItem('/alquileres', 'alquileres', bp, '🏐 Alquileres')}
      ${navItem('/kiosco', 'kiosco', bp, '🥤 Kiosco')}
      ${navItem('/stock', 'stock', bp, '📦 Stock')}
      ${esAdmin ? navItem('/reportes', 'reportes', bp, '📈 Reportes') : ''}
      ${esAdmin ? navItem('/configuracion', 'configuracion', bp, '⚙️ Configuración') : ''}
    </nav>
    <a href="/logout" class="salir">🚪 Cerrar sesión</a>
  </aside>
  <div id="overlay" class="overlay"></div>
  <main class="contenido">
    <div class="topbar">
      <div class="caja-estado ${caja ? 'abierta' : 'cerrada'}">${caja ? 'Caja abierta · ' + gs(caja.monto_inicial) : 'Caja cerrada'}</div>
    </div>
    ${bloqueFlashes('')}
    ${body}
  </main>
</div>
<script src="/static/js/main.js"></script>
${c.get('extraScript') || ''}
</body></html>`;
}

// ---- Flash helpers ----
function addFlash(c, categoria, mensaje) {
  const arr = c.get('_flash') || [];
  arr.push([categoria, mensaje]);
  c.set('_flash', arr);
}
function tomarFlashes(c) {
  let arr = [];
  const ck = getCookie(c, 'flash');
  if (ck) { try { arr = JSON.parse(decodeURIComponent(ck)); } catch {} deleteCookie(c, 'flash', { path: '/' }); }
  return arr.concat(c.get('_flash') || []);
}
function irA(c, path) {
  const arr = c.get('_flash') || [];
  if (arr.length) setCookie(c, 'flash', encodeURIComponent(JSON.stringify(arr)), { path: '/', httpOnly: true, sameSite: 'Lax' });
  return c.redirect(path);
}

function paginaError(codigo, mensaje) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Error ${codigo}</title>
<link rel="stylesheet" href="/static/css/style.css"></head><body class="pagina-login">
<div class="login-envoltorio"><div class="login-card" style="text-align:center">
<h1 style="color:#145c2e">Error ${codigo}</h1><p>${esc(mensaje || 'No tenés permiso para acceder a esta página.')}</p>
<a href="/dashboard" class="btn btn-primario btn-grande">Volver al inicio</a></div></div></body></html>`;
}

// ============================================================
//  App
// ============================================================
const app = new Hono();

// Middleware: cargar usuario actual y estado de caja
app.use('*', async (c, next) => {
  c.set('user', null);
  try {
    const uid = await getSignedCookie(c, c.env.SECRET_KEY, 'sesion');
    if (uid) {
      const u = await first(c.env, 'SELECT * FROM usuarios WHERE id=? AND activo=1', Number(uid));
      if (u) {
        c.set('user', u);
        c.set('cajaActual', await cajaAbierta(c.env));
      }
    }
  } catch {}
  await next();
});

const requiereLogin = async (c, next) => {
  if (!c.get('user')) return c.redirect('/login?next=' + encodeURIComponent(c.req.path));
  await next();
};
const requiereAdmin = async (c, next) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login');
  if (u.rol !== 'administrador') return c.html(paginaError(403), 403);
  await next();
};

// -------------------- AUTH --------------------
app.get('/', (c) => c.redirect('/dashboard'));

app.get('/login', (c) => {
  if (c.get('user')) return c.redirect('/dashboard');
  return c.html(layout(c, { title: 'Iniciar sesión · Tercer Tiempo', publico: true, body: `
<div class="login-envoltorio"><div class="login-card">
  <div class="login-logo"><span class="logo-icono">🏟️</span><h1>Tercer Tiempo</h1><p>Gestión de canchas, juegos y kiosco</p></div>
  <form method="post" action="/login" class="login-form">
    <label for="usuario">Usuario</label>
    <input type="text" id="usuario" name="usuario" autocomplete="username" autofocus required>
    <label for="password">Contraseña</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    <button type="submit" class="btn btn-primario btn-grande">Ingresar</button>
  </form>
</div></div>` }));
});

app.post('/login', async (c) => {
  if (c.get('user')) return c.redirect('/dashboard');
  const b = await c.req.parseBody();
  const usuarioInput = String(b.usuario || '').trim();
  const password = String(b.password || '');
  const u = await first(c.env, 'SELECT * FROM usuarios WHERE usuario=?', usuarioInput);
  if (u && u.activo && await verifyPassword(password, u.password_hash)) {
    await setSignedCookie(c, 'sesion', String(u.id), c.env.SECRET_KEY, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 30 });
    const next = c.req.query('next');
    return c.redirect(next || '/dashboard');
  }
  addFlash(c, 'error', 'Usuario o contraseña incorrectos.');
  c.set('user', null);
  return c.html(layout(c, { title: 'Iniciar sesión · Tercer Tiempo', publico: true, body: `
<div class="login-envoltorio"><div class="login-card">
  <div class="login-logo"><span class="logo-icono">🏟️</span><h1>Tercer Tiempo</h1><p>Gestión de canchas, juegos y kiosco</p></div>
  <form method="post" action="/login" class="login-form">
    <label for="usuario">Usuario</label>
    <input type="text" id="usuario" name="usuario" autocomplete="username" autofocus required>
    <label for="password">Contraseña</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    <button type="submit" class="btn btn-primario btn-grande">Ingresar</button>
  </form>
</div></div>` }));
});

app.get('/logout', requiereLogin, (c) => {
  deleteCookie(c, 'sesion', { path: '/' });
  return c.redirect('/login');
});

// -------------------- DASHBOARD --------------------
app.get('/dashboard', requiereLogin, async (c) => {
  c.set('seccion', 'dashboard');
  const user = c.get('user');
  const hoy = fechaHoy();
  const caja = c.get('cajaActual');
  const totalAlq = await totalAlquileresDia(c.env, hoy);
  const totalKio = await totalKioscoDia(c.env, hoy);
  const totalDia = totalAlq + totalKio;
  const alertas = await productosStockBajo(c.env);

  const accesos = [
    `<a href="/alquileres" class="acceso"><span class="acceso-icono">🏐</span><span>Registrar alquiler</span></a>`,
    `<a href="/kiosco" class="acceso"><span class="acceso-icono">🥤</span><span>Venta de kiosco</span></a>`,
    `<a href="/stock" class="acceso"><span class="acceso-icono">📦</span><span>Ver stock</span></a>`,
    user.rol === 'administrador' ? `<a href="/reportes" class="acceso"><span class="acceso-icono">📈</span><span>Reportes</span></a>` : '',
    !caja ? `<a href="/caja/abrir" class="acceso acceso-naranja"><span class="acceso-icono">💵</span><span>Abrir caja</span></a>`
          : `<a href="/caja/cerrar" class="acceso acceso-naranja"><span class="acceso-icono">💵</span><span>Cerrar caja</span></a>`,
  ].join('');

  const alertasHtml = alertas.length ? `
<h2 class="titulo-seccion">⚠️ Stock bajo</h2>
<section class="lista-alertas">${alertas.map((p) => `
  <div class="alerta-item"><span>${esc(p.nombre)}</span><span class="alerta-cantidad">${p.stock} en stock (mínimo ${p.stock_minimo})</span></div>`).join('')}
</section>` : '';

  return c.html(layout(c, { title: 'Dashboard · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Hola, ${esc(user.nombre)} 👋</h1>
<p class="subtitulo-pagina">${fmtFecha(hoy)}</p>
<section class="tarjetas-resumen">
  <div class="tarjeta tarjeta-verde"><span class="tarjeta-etiqueta">Ventas de hoy</span><span class="tarjeta-monto">${gs(totalDia)}</span></div>
  <div class="tarjeta"><span class="tarjeta-etiqueta">Alquileres</span><span class="tarjeta-monto">${gs(totalAlq)}</span></div>
  <div class="tarjeta"><span class="tarjeta-etiqueta">Kiosco</span><span class="tarjeta-monto">${gs(totalKio)}</span></div>
  <div class="tarjeta ${caja ? 'tarjeta-naranja' : 'tarjeta-gris'}"><span class="tarjeta-etiqueta">Caja</span>
    <span class="tarjeta-monto">${caja ? 'Abierta' : 'Cerrada'}</span>
    ${caja ? `<span class="tarjeta-subtexto">Inicial: ${gs(caja.monto_inicial)}</span>` : ''}
  </div>
</section>
<h2 class="titulo-seccion">Accesos rápidos</h2>
<section class="accesos-rapidos">${accesos}</section>
${alertasHtml}` }));
});

// -------------------- CAJA --------------------
// Bloque de arqueo reutilizable (se usa en /caja, /caja/cerrar y /caja/:id)
function bloqueArqueo(caja, r, { titulo = 'Arqueo de caja' } = {}) {
  const esp = efectivoEsperado(caja, r);
  return `
<h2 class="titulo-seccion">${esc(titulo)}</h2>
<div class="panel panel-resumen">
  <div class="resumen-fila"><span>Monto inicial (efectivo)</span><strong>${gs(caja.monto_inicial)}</strong></div>
  <div class="resumen-fila"><span>Alquileres (${r.alqCant})</span><strong>${gs(r.alqTotal)}</strong></div>
  <div class="resumen-fila"><span>Kiosco (${r.kioCant})</span><strong>${gs(r.kioTotal)}</strong></div>
  <div class="resumen-fila resumen-total"><span>Total facturado</span><strong>${gs(r.totalGeneral)}</strong></div>
</div>
<div class="panel panel-resumen">
  <div class="resumen-fila"><span>Cobrado en efectivo</span><strong>${gs(r.porMetodo.efectivo)}</strong></div>
  <div class="resumen-fila"><span>Cobrado por transferencia</span><strong>${gs(r.porMetodo.transferencia)}</strong></div>
  ${r.porMetodo.tarjeta > 0 ? `<div class="resumen-fila"><span>Cobrado con tarjeta</span><strong>${gs(r.porMetodo.tarjeta)}</strong></div>` : ''}
  <div class="resumen-fila"><span>Otros ingresos en efectivo</span><strong>${gs(r.ingresos)}</strong></div>
  <div class="resumen-fila"><span>Egresos / retiros en efectivo</span><strong class="texto-rojo">${gs(-r.egresos)}</strong></div>
  <div class="resumen-fila resumen-esperado"><span>Efectivo que debe haber en caja</span><strong>${gs(esp)}</strong></div>
</div>
<p class="ayuda-texto">Las transferencias no entran en el conteo de efectivo: no pasan por la caja.</p>`;
}

app.get('/caja', requiereLogin, async (c) => {
  c.set('seccion', 'caja');
  const caja = c.get('cajaActual');
  if (!caja) {
    return c.html(layout(c, { title: 'Caja · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Caja</h1>
<div class="panel panel-gris"><h2>No hay una caja abierta</h2>
  <p>Abrí la caja para empezar a registrar ventas del día.</p>
  <a href="/caja/abrir" class="btn btn-primario btn-grande">Abrir caja</a>
</div>
<a href="/caja/historial" class="link-secundario">Ver historial de aperturas y cierres →</a>` }));
  }

  const ua = caja.usuario_apertura_id ? await first(c.env, 'SELECT nombre FROM usuarios WHERE id=?', caja.usuario_apertura_id) : null;
  const r = await resumenCaja(c.env, caja.id);
  const movs = await movimientosDeCaja(c.env, caja.id);
  const filasMov = movs.length ? movs.map((m) => `<tr>
      <td>${fmtFechaHora(m.fecha)}</td>
      <td><span class="etiqueta ${m.tipo === 'egreso' ? 'etiqueta-roja' : 'etiqueta-verde'}">${m.tipo === 'egreso' ? 'Egreso' : 'Ingreso'}</span></td>
      <td>${esc(m.concepto || '-')}</td>
      <td class="${m.tipo === 'egreso' ? 'texto-rojo' : 'texto-verde'}">${gs(m.monto)}</td>
      <td>${esc(m.usuario || '-')}</td>
      <td class="acciones-tabla"><form method="post" action="/caja/movimiento/${m.id}/eliminar" onsubmit="return confirm('¿Eliminar este movimiento?');" class="form-inline">
        <button type="submit" class="btn btn-chico btn-peligro">Eliminar</button></form></td>
    </tr>`).join('') : `<tr><td colspan="6" class="tabla-vacia">Sin movimientos de efectivo en esta caja.</td></tr>`;

  return c.html(layout(c, { title: 'Caja · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Caja</h1>
<div class="panel panel-verde"><h2>Caja abierta</h2>
  <p>Apertura: ${fmtFechaHora(caja.fecha_apertura)}</p>
  <p>Monto inicial: <strong>${gs(caja.monto_inicial)}</strong></p>
  <p>Responsable: ${esc(ua ? ua.nombre : '-')}</p>
  <a href="/caja/cerrar" class="btn btn-naranja btn-grande">Cerrar caja</a>
</div>
${bloqueArqueo(caja, r, { titulo: 'Arqueo parcial (en vivo)' })}
<h2 class="titulo-seccion">Movimientos de efectivo</h2>
<form method="post" action="/caja/movimiento" class="formulario formulario-tarjeta">
  <div class="formulario-fila">
    <div><label for="tipo">Tipo</label>
      <select id="tipo" name="tipo">
        <option value="egreso">Egreso / retiro</option>
        <option value="ingreso">Ingreso extra</option>
      </select></div>
    <div><label for="monto">Monto (₲)</label>
      <input type="text" inputmode="numeric" id="monto" name="monto" class="input-monto" placeholder="0" required></div>
  </div>
  <label for="concepto">Concepto</label>
  <input type="text" id="concepto" name="concepto" placeholder="Ej: compra de hielo, retiro del dueño, vuelto extra" required>
  <button type="submit" class="btn btn-secundario">Registrar movimiento</button>
</form>
<div class="tabla-envoltorio"><table class="tabla">
  <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Monto</th><th>Usuario</th><th>Acciones</th></tr></thead>
  <tbody>${filasMov}</tbody>
</table></div>
<a href="/caja/historial" class="link-secundario">Ver historial de aperturas y cierres →</a>` }));
});

app.post('/caja/movimiento', requiereLogin, async (c) => {
  const caja = c.get('cajaActual');
  if (!caja) { addFlash(c, 'error', 'No hay una caja abierta.'); return irA(c, '/caja'); }
  const b = await c.req.parseBody();
  const tipo = String(b.tipo || 'egreso') === 'ingreso' ? 'ingreso' : 'egreso';
  const monto = aEntero(b.monto);
  const concepto = String(b.concepto || '').trim();
  if (monto <= 0) { addFlash(c, 'error', 'El monto tiene que ser mayor a cero.'); return irA(c, '/caja'); }
  await run(c.env, 'INSERT INTO movimientos_caja (caja_id, tipo, concepto, monto, fecha, usuario_id) VALUES (?,?,?,?,?,?)',
    caja.id, tipo, concepto, monto, ahoraTS(), c.get('user').id);
  addFlash(c, 'exito', tipo === 'egreso' ? 'Egreso registrado.' : 'Ingreso registrado.');
  return irA(c, '/caja');
});

app.post('/caja/movimiento/:id/eliminar', requiereLogin, async (c) => {
  const caja = c.get('cajaActual');
  if (!caja) { addFlash(c, 'error', 'No hay una caja abierta.'); return irA(c, '/caja'); }
  await run(c.env, 'DELETE FROM movimientos_caja WHERE id=? AND caja_id=?', Number(c.req.param('id')), caja.id);
  addFlash(c, 'exito', 'Movimiento eliminado.');
  return irA(c, '/caja');
});

app.get('/caja/abrir', requiereLogin, async (c) => {
  c.set('seccion', 'caja');
  if (c.get('cajaActual')) { addFlash(c, 'error', 'Ya hay una caja abierta.'); return irA(c, '/caja'); }
  return c.html(layout(c, { title: 'Abrir caja · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Abrir caja</h1>
<form method="post" action="/caja/abrir" class="formulario">
  <label for="monto_inicial">Monto inicial (efectivo con el que arranca el día)</label>
  <input type="text" inputmode="numeric" id="monto_inicial" name="monto_inicial" class="input-monto" placeholder="0" required>
  <button type="submit" class="btn btn-primario btn-grande">Abrir caja</button>
</form>` }));
});

app.post('/caja/abrir', requiereLogin, async (c) => {
  if (c.get('cajaActual')) { addFlash(c, 'error', 'Ya hay una caja abierta.'); return irA(c, '/caja'); }
  const b = await c.req.parseBody();
  const monto = aEntero(b.monto_inicial);
  await run(c.env, 'INSERT INTO cajas (fecha_apertura, monto_inicial, usuario_apertura_id, estado) VALUES (?,?,?,?)',
    ahoraTS(), monto, c.get('user').id, 'abierta');
  addFlash(c, 'exito', 'Caja abierta correctamente.');
  return irA(c, '/dashboard');
});

app.get('/caja/cerrar', requiereLogin, async (c) => {
  c.set('seccion', 'caja');
  const caja = c.get('cajaActual');
  if (!caja) { addFlash(c, 'error', 'No hay ninguna caja abierta para cerrar.'); return irA(c, '/caja'); }
  const r = await resumenCaja(c.env, caja.id);
  const esperado = efectivoEsperado(caja, r);
  return c.html(layout(c, { title: 'Cerrar caja · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Cerrar caja</h1>
${bloqueArqueo(caja, r)}
<form method="post" action="/caja/cerrar" class="formulario formulario-tarjeta">
  <label for="monto_contado">Efectivo real contado en caja</label>
  <input type="text" inputmode="numeric" id="monto_contado" name="monto_contado" class="input-monto" placeholder="0" data-esperado="${esperado}" required>
  <p class="ayuda-texto" id="diferencia-preview"></p>
  <label for="observaciones">Observaciones (opcional)</label>
  <input type="text" id="observaciones" name="observaciones" placeholder="Ej: faltó vuelto de una mesa">
  <button type="submit" class="btn btn-naranja btn-grande">Confirmar cierre</button>
</form>` }));
});

app.post('/caja/cerrar', requiereLogin, async (c) => {
  const caja = c.get('cajaActual');
  if (!caja) { addFlash(c, 'error', 'No hay ninguna caja abierta para cerrar.'); return irA(c, '/caja'); }
  const b = await c.req.parseBody();
  const r = await resumenCaja(c.env, caja.id);
  const esperado = efectivoEsperado(caja, r);
  const contado = aEntero(b.monto_contado);
  await run(c.env,
    `UPDATE cajas SET total_alquileres=?, total_kiosco=?, total_general=?,
     total_efectivo=?, total_transferencia=?, total_tarjeta=?, total_egresos=?, total_ingresos_extra=?,
     costo_kiosco=?, monto_esperado=?, monto_contado=?, diferencia=?, observaciones=?,
     estado='cerrada', fecha_cierre=?, usuario_cierre_id=? WHERE id=?`,
    r.alqTotal, r.kioTotal, r.totalGeneral,
    r.porMetodo.efectivo, r.porMetodo.transferencia, r.porMetodo.tarjeta, r.egresos, r.ingresos,
    r.costoKiosco, esperado, contado, contado - esperado, String(b.observaciones || '').trim(),
    ahoraTS(), c.get('user').id, caja.id);
  const dif = contado - esperado;
  addFlash(c, dif === 0 ? 'exito' : 'error',
    dif === 0 ? 'Caja cerrada: cerró exacta.' : (dif > 0 ? `Caja cerrada con un sobrante de ${gs(dif)}.` : `Caja cerrada con un faltante de ${gs(Math.abs(dif))}.`));
  return irA(c, '/caja/' + caja.id);
});

app.get('/caja/historial', requiereLogin, async (c) => {
  c.set('seccion', 'caja');
  const cajas = await all(c.env, 'SELECT * FROM cajas ORDER BY id DESC');
  const filas = cajas.length ? cajas.map((k) => {
    const dif = k.diferencia;
    const claseDif = dif === null || dif === undefined ? '' : (dif < 0 ? 'texto-rojo' : (dif ? 'texto-verde' : ''));
    return `<tr>
      <td>${fmtFechaHora(k.fecha_apertura)}</td>
      <td>${k.fecha_cierre ? fmtFechaHora(k.fecha_cierre) : '-'}</td>
      <td><span class="etiqueta ${k.estado === 'abierta' ? 'etiqueta-verde' : 'etiqueta-gris'}">${k.estado === 'abierta' ? 'Abierta' : 'Cerrada'}</span></td>
      <td>${gs(k.monto_inicial)}</td>
      <td>${gs(k.total_general || 0)}</td>
      <td>${gs(k.total_efectivo || 0)}</td>
      <td>${gs(k.monto_esperado || 0)}</td>
      <td>${k.monto_contado === null || k.monto_contado === undefined ? '-' : gs(k.monto_contado)}</td>
      <td class="${claseDif}">${dif === null || dif === undefined ? '-' : gs(dif)}</td>
      <td><a href="/caja/${k.id}" class="btn btn-chico btn-secundario">Ver arqueo</a></td>
    </tr>`;
  }).join('') : `<tr><td colspan="10" class="tabla-vacia">Todavía no hay registros de caja.</td></tr>`;
  return c.html(layout(c, { title: 'Historial de caja · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Historial de caja</h1>
<div class="tabla-envoltorio"><table class="tabla">
  <thead><tr><th>Apertura</th><th>Cierre</th><th>Estado</th><th>Inicial</th><th>Facturado</th><th>Efectivo</th><th>Esperado</th><th>Contado</th><th>Diferencia</th><th></th></tr></thead>
  <tbody>${filas}</tbody>
</table></div>` }));
});

// Arqueo detallado de una caja (imprimible). Va DESPUES de /caja/abrir, /cerrar e /historial.
app.get('/caja/:id', requiereLogin, async (c) => {
  c.set('seccion', 'caja');
  const id = Number(c.req.param('id'));
  const caja = Number.isNaN(id) ? null : await first(c.env, 'SELECT * FROM cajas WHERE id=?', id);
  if (!caja) { addFlash(c, 'error', 'No se encontró esa caja.'); return irA(c, '/caja/historial'); }

  const r = await resumenCaja(c.env, caja.id);
  const esperado = caja.estado === 'cerrada' ? (caja.monto_esperado || 0) : efectivoEsperado(caja, r);
  const contado = caja.monto_contado;
  const dif = caja.diferencia;
  const ua = caja.usuario_apertura_id ? await first(c.env, 'SELECT nombre FROM usuarios WHERE id=?', caja.usuario_apertura_id) : null;
  const uc = caja.usuario_cierre_id ? await first(c.env, 'SELECT nombre FROM usuarios WHERE id=?', caja.usuario_cierre_id) : null;
  const movs = await movimientosDeCaja(c.env, caja.id);
  const alqs = await alquileresDeCaja(c.env, caja.id);
  const vtas = await ventasDeCaja(c.env, caja.id);

  const filasMov = movs.length ? movs.map((m) => `<tr>
      <td>${fmtFechaHora(m.fecha)}</td>
      <td>${m.tipo === 'egreso' ? 'Egreso' : 'Ingreso'}</td>
      <td>${esc(m.concepto || '-')}</td>
      <td class="${m.tipo === 'egreso' ? 'texto-rojo' : 'texto-verde'}">${gs(m.tipo === 'egreso' ? -m.monto : m.monto)}</td>
      <td>${esc(m.usuario || '-')}</td></tr>`).join('')
    : `<tr><td colspan="5" class="tabla-vacia">Sin movimientos de efectivo.</td></tr>`;

  const filasAlq = alqs.length ? alqs.map((a) => `<tr>
      <td>${fmtFechaHora(a.fecha_registro)}</td>
      <td>${esc(ETIQUETAS_ESPACIO[a.tipo_espacio] || a.tipo_espacio)}</td>
      <td>${esc(a.cliente || '-')}</td>
      <td>${fmtCantidad(a.duracion_horas, a.unidad)}</td>
      <td>${fmtPago(a)}</td>
      <td>${gs(a.total)}</td></tr>`).join('')
    : `<tr><td colspan="6" class="tabla-vacia">Sin alquileres en esta caja.</td></tr>`;

  const filasVta = vtas.length ? vtas.map((v) => `<tr>
      <td>#${v.id}</td>
      <td>${fmtFechaHora(v.fecha)}</td>
      <td>${fmtPago(v)}</td>
      <td>${gs(v.total)}</td></tr>`).join('')
    : `<tr><td colspan="4" class="tabla-vacia">Sin ventas de kiosco en esta caja.</td></tr>`;

  const bloqueCierre = caja.estado === 'cerrada' ? `
<div class="panel panel-resumen">
  <div class="resumen-fila"><span>Efectivo esperado</span><strong>${gs(esperado)}</strong></div>
  <div class="resumen-fila"><span>Efectivo contado</span><strong>${gs(contado || 0)}</strong></div>
  <div class="resumen-fila resumen-total"><span>${dif === 0 ? 'Cerró exacta' : (dif > 0 ? 'Sobrante' : 'Faltante')}</span>
    <strong class="${dif === 0 ? '' : (dif > 0 ? 'texto-verde' : 'texto-rojo')}">${gs(dif || 0)}</strong></div>
</div>
${caja.observaciones ? `<p class="ayuda-texto">Observaciones: ${esc(caja.observaciones)}</p>` : ''}
<p class="ayuda-texto">Cerrada el ${fmtFechaHora(caja.fecha_cierre)} por ${esc(uc ? uc.nombre : '-')}.</p>`
    : `<p class="ayuda-texto">Esta caja todavía está abierta: los totales son parciales.</p>`;

  return c.html(layout(c, { title: `Arqueo de caja #${caja.id} · Tercer Tiempo`, body: `
<div class="cabecera-con-boton">
  <h1 class="titulo-pagina">Arqueo de caja #${caja.id}</h1>
  <div class="botones-cabecera no-imprimir">
    <button onclick="window.print()" class="btn btn-secundario">🖨 Imprimir</button>
    <a href="/caja/historial" class="btn btn-secundario">← Historial</a>
  </div>
</div>
<p class="ayuda-texto">Apertura: ${fmtFechaHora(caja.fecha_apertura)} · Responsable: ${esc(ua ? ua.nombre : '-')} ·
  <span class="etiqueta ${caja.estado === 'abierta' ? 'etiqueta-verde' : 'etiqueta-gris'}">${caja.estado === 'abierta' ? 'Abierta' : 'Cerrada'}</span></p>
${bloqueArqueo(caja, r, { titulo: 'Detalle del arqueo' })}
<h2 class="titulo-seccion">Cierre</h2>
${bloqueCierre}
<h2 class="titulo-seccion">Ganancia del kiosco</h2>
<div class="panel panel-resumen">
  <div class="resumen-fila"><span>Venta de productos</span><strong>${gs(r.kioTotal)}</strong></div>
  <div class="resumen-fila"><span>Costo de la mercadería vendida</span><strong class="texto-rojo">${gs(-r.costoKiosco)}</strong></div>
  <div class="resumen-fila resumen-total"><span>Ganancia bruta</span><strong class="texto-verde">${gs(r.utilidadKiosco)}</strong></div>
</div>
<h2 class="titulo-seccion">Movimientos de efectivo</h2>
<div class="tabla-envoltorio"><table class="tabla">
  <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Monto</th><th>Usuario</th></tr></thead>
  <tbody>${filasMov}</tbody></table></div>
<h2 class="titulo-seccion">Alquileres</h2>
<div class="tabla-envoltorio"><table class="tabla">
  <thead><tr><th>Fecha</th><th>Espacio</th><th>Cliente</th><th>Cantidad</th><th>Pago</th><th>Total</th></tr></thead>
  <tbody>${filasAlq}</tbody></table></div>
<h2 class="titulo-seccion">Ventas de kiosco</h2>
<div class="tabla-envoltorio"><table class="tabla">
  <thead><tr><th>Venta</th><th>Fecha</th><th>Pago</th><th>Total</th></tr></thead>
  <tbody>${filasVta}</tbody></table></div>` }));
});

// -------------------- ALQUILERES --------------------
app.get('/alquileres', requiereLogin, async (c) => {
  c.set('seccion', 'alquileres');
  const caja = c.get('cajaActual');
  const preciosRows = await all(c.env, 'SELECT tipo_espacio, precio_hora, unidad FROM precios_espacio');
  const precios = {}, unidades = {};
  for (const p of preciosRows) {
    precios[p.tipo_espacio] = p.precio_hora;
    unidades[p.tipo_espacio] = UNIDADES.includes(p.unidad) ? p.unidad : (UNIDAD_DEFECTO[p.tipo_espacio] || 'hora');
  }
  const alquileresHoy = await alquileresDelDia(c.env, fechaHoy());
  const totalHoy = alquileresHoy.reduce((s, a) => s + a.total, 0);

  const avisoCaja = !caja ? `<div class="aviso-caja">⚠️ La caja está cerrada. <a href="/caja/abrir">Abrila</a> para poder registrar alquileres.</div>` : '';
  const filas = alquileresHoy.length ? alquileresHoy.map((a) => `<tr>
    <td>${esc(a.hora_inicio)}</td><td>${esc(ETIQUETAS_ESPACIO[a.tipo_espacio] || a.tipo_espacio)}</td>
    <td>${esc(a.cliente || '-')}</td><td>${fmtCantidad(a.duracion_horas, a.unidad)}</td><td>${gs(a.total)}</td>
    <td>${fmtPago(a)}</td></tr>`).join('')
    : `<tr><td colspan="6" class="tabla-vacia">Todavía no hay alquileres registrados hoy.</td></tr>`;

  return c.html(layout(c, { title: 'Alquileres · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Alquiler de canchas y juegos</h1>
${avisoCaja}
<form method="post" action="/alquileres/nuevo" class="formulario formulario-tarjeta">
  <label for="tipo_espacio">Espacio</label>
  <select id="tipo_espacio" name="tipo_espacio" required>${opcionesEspacio(precios, unidades)}</select>
  <label for="cliente">Cliente / equipo (opcional)</label>
  <input type="text" id="cliente" name="cliente" placeholder="Nombre del cliente o equipo">
  <div class="formulario-fila">
    <div><label for="hora_inicio">Hora de inicio</label><input type="time" id="hora_inicio" name="hora_inicio" required></div>
    <div><label for="duracion_horas" id="label-cantidad">Cantidad</label><input type="number" id="duracion_horas" name="duracion_horas" min="1" step="1" value="1" required></div>
  </div>
  <label for="metodo_pago">Método de pago</label>
  <select id="metodo_pago" name="metodo_pago">${opciones(METODOS_FORM, ETIQUETAS_PAGO, null)}</select>
  ${BLOQUE_MIXTO}
  <div class="total-preview">Total: <span id="total-alquiler">${gs(0)}</span></div>
  <button type="submit" class="btn btn-primario btn-grande" ${caja ? '' : 'disabled'}>Registrar alquiler</button>
</form>
<h2 class="titulo-seccion">Hoy · Total ${gs(totalHoy)}</h2>
<div class="tabla-envoltorio"><table class="tabla">
  <thead><tr><th>Hora</th><th>Espacio</th><th>Cliente</th><th>Cantidad</th><th>Total</th><th>Pago</th></tr></thead>
  <tbody>${filas}</tbody>
</table></div>` }));
});

app.post('/alquileres/nuevo', requiereLogin, async (c) => {
  const caja = c.get('cajaActual');
  if (!caja) { addFlash(c, 'error', 'Tenés que abrir la caja antes de registrar un alquiler.'); return irA(c, '/caja/abrir'); }
  const b = await c.req.parseBody();
  const tipo = String(b.tipo_espacio || '');
  if (!TIPOS_ESPACIO.includes(tipo)) { addFlash(c, 'error', 'Tipo de espacio inválido.'); return irA(c, '/alquileres'); }
  const cliente = String(b.cliente || '').trim();
  let horaInicio = String(b.hora_inicio || '').trim();
  const pc = await first(c.env, 'SELECT precio_hora, unidad FROM precios_espacio WHERE tipo_espacio=?', tipo);
  const precioUnitario = pc ? pc.precio_hora : 0;
  const unidad = pc && UNIDADES.includes(pc.unidad) ? pc.unidad : (UNIDAD_DEFECTO[tipo] || 'hora');
  let cant = parseFloat(String(b.duracion_horas || '1').replace(',', '.'));
  if (Number.isNaN(cant) || cant <= 0) cant = 1;
  // Los juegos y las fichas se cuentan de a uno; solo las horas admiten medias horas
  if (unidad !== 'hora') cant = Math.max(1, Math.round(cant));
  const total = Math.round(precioUnitario * cant);
  const pago = repartoPago(b, total);
  if (pago.error) { addFlash(c, 'error', pago.error); return irA(c, '/alquileres'); }
  await run(c.env,
    `INSERT INTO alquileres (caja_id, tipo_espacio, cliente, fecha, hora_inicio, duracion_horas, unidad, precio_hora, total, metodo_pago, pago_efectivo, pago_transferencia, pago_tarjeta, usuario_id, fecha_registro)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    caja.id, tipo, cliente, fechaHoy(), horaInicio || horaActual(), cant, unidad, precioUnitario, total, pago.metodo,
    pago.efectivo, pago.transferencia, pago.tarjeta, c.get('user').id, ahoraTS());
  addFlash(c, 'exito', 'Alquiler registrado correctamente.');
  return irA(c, '/alquileres');
});

// -------------------- KIOSCO --------------------
app.get('/kiosco', requiereLogin, async (c) => {
  c.set('seccion', 'kiosco');
  const caja = c.get('cajaActual');
  const productos = await all(c.env, 'SELECT * FROM productos WHERE activo=1 ORDER BY categoria, nombre');
  const avisoCaja = !caja ? `<div class="aviso-caja">⚠️ La caja está cerrada. <a href="/caja/abrir">Abrila</a> para poder registrar ventas.</div>` : '';

  let html = '', categoriaActual = null, abierto = false;
  for (const p of productos) {
    if (p.categoria !== categoriaActual) {
      if (abierto) html += '</div>';
      html += `<h2 class="titulo-seccion">${esc(ETIQUETAS_CATEGORIA[p.categoria] || p.categoria)}</h2><div class="grilla-productos">`;
      categoriaActual = p.categoria; abierto = true;
    }
    html += `
    <div class="producto-card ${p.stock <= 0 ? 'producto-sin-stock' : ''}">
      <div class="producto-nombre">${esc(p.nombre)}</div>
      <div class="producto-precio">${gs(p.precio_venta)}</div>
      <div class="producto-stock">Stock: ${p.stock}</div>
      <div class="stepper">
        <button type="button" class="stepper-btn" data-accion="restar">−</button>
        <input type="number" class="stepper-input" name="cantidad" value="0" min="0" max="${p.stock}" data-precio="${p.precio_venta}" data-stock="${p.stock}" readonly>
        <button type="button" class="stepper-btn" data-accion="sumar">+</button>
      </div>
      <input type="hidden" name="producto_id" value="${p.id}">
    </div>`;
  }
  if (abierto) html += '</div>';

  c.set('extraScript', '<script src="/static/js/kiosco.js"></script>');
  return c.html(layout(c, { title: 'Kiosco · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Venta de kiosco</h1>
${avisoCaja}
<form method="post" action="/kiosco/vender" id="form-venta">
  ${html}
  <div class="panel-venta-fija">
    <label for="metodo_pago">Método de pago</label>
    <select id="metodo_pago" name="metodo_pago">${opciones(METODOS_FORM, ETIQUETAS_PAGO, null)}</select>
    ${BLOQUE_MIXTO}
    <div class="total-preview">Total: <span id="total-venta">${gs(0)}</span></div>
    <button type="submit" class="btn btn-primario btn-grande" ${caja ? '' : 'disabled'}>Confirmar venta</button>
  </div>
</form>` }));
});

app.post('/kiosco/vender', requiereLogin, async (c) => {
  const caja = c.get('cajaActual');
  if (!caja) { addFlash(c, 'error', 'Tenés que abrir la caja antes de registrar una venta.'); return irA(c, '/caja/abrir'); }
  const b = await c.req.parseBody({ all: true });
  const ids = [].concat(b.producto_id ?? []);
  const cants = [].concat(b.cantidad ?? []);

  const items = [];
  for (let i = 0; i < ids.length; i++) {
    const cant = parseInt(cants[i], 10);
    if (!Number.isNaN(cant) && cant > 0) items.push([parseInt(ids[i], 10), cant]);
  }
  if (!items.length) { addFlash(c, 'error', 'Elegí al menos un producto con cantidad mayor a cero.'); return irA(c, '/kiosco'); }

  const idList = items.map((i) => i[0]);
  const marcadores = idList.map(() => '?').join(',');
  const prodRows = await all(c.env, `SELECT * FROM productos WHERE id IN (${marcadores})`, ...idList);
  const productos = {};
  for (const p of prodRows) productos[p.id] = p;

  for (const [pid, cant] of items) {
    const p = productos[pid];
    if (!p) continue;
    if (cant > p.stock) { addFlash(c, 'error', `No hay stock suficiente de '${p.nombre}' (disponible: ${p.stock}).`); return irA(c, '/kiosco'); }
  }

  let total = 0;
  for (const [pid, cant] of items) total += productos[pid].precio_venta * cant;

  // parseBody({all:true}) puede devolver arrays; para el pago tomamos el primer valor
  const unico = (v) => (Array.isArray(v) ? v[0] : v);
  const pago = repartoPago({
    metodo_pago: unico(b.metodo_pago),
    pago_efectivo: unico(b.pago_efectivo),
    pago_transferencia: unico(b.pago_transferencia),
    pago_tarjeta: unico(b.pago_tarjeta),
  }, total);
  if (pago.error) { addFlash(c, 'error', pago.error); return irA(c, '/kiosco'); }

  const ts = ahoraTS();
  const resVenta = await run(c.env,
    'INSERT INTO ventas (caja_id, fecha, total, metodo_pago, pago_efectivo, pago_transferencia, pago_tarjeta, usuario_id) VALUES (?,?,?,?,?,?,?,?)',
    caja.id, ts, total, pago.metodo, pago.efectivo, pago.transferencia, pago.tarjeta, c.get('user').id);
  const ventaId = resVenta.meta.last_row_id;

  const lote = [];
  for (const [pid, cant] of items) {
    const p = productos[pid];
    const subtotal = p.precio_venta * cant;
    lote.push(c.env.DB.prepare('INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal) VALUES (?,?,?,?,?,?)')
      .bind(ventaId, p.id, cant, p.precio_venta, p.precio_costo || 0, subtotal));
    lote.push(c.env.DB.prepare('UPDATE productos SET stock = stock - ? WHERE id=?').bind(cant, p.id));
    lote.push(c.env.DB.prepare('INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, fecha, usuario_id) VALUES (?,?,?,?,?,?)')
      .bind(p.id, 'salida', cant, `Venta #${ventaId}`, ts, c.get('user').id));
  }
  await c.env.DB.batch(lote);
  addFlash(c, 'exito', 'Venta registrada correctamente.');
  return irA(c, '/kiosco');
});

// -------------------- STOCK --------------------
app.get('/stock', requiereLogin, async (c) => {
  c.set('seccion', 'stock');
  const esAdmin = c.get('user').rol === 'administrador';
  const productos = await all(c.env, 'SELECT * FROM productos WHERE activo=1 ORDER BY categoria, nombre');
  const botones = esAdmin ? `<div class="botones-cabecera">
    <a href="/stock/movimientos" class="btn btn-secundario">Movimientos</a>
    <a href="/stock/nuevo" class="btn btn-primario">+ Nuevo producto</a></div>` : '';
  const thAcc = esAdmin ? '<th>Acciones</th>' : '';
  const filas = productos.length ? productos.map((p) => {
    const bajo = p.stock <= p.stock_minimo;
    const acciones = esAdmin ? `<td class="acciones-tabla">
      <form method="post" action="/stock/${p.id}/reponer" class="form-inline">
        <input type="number" name="cantidad" min="1" placeholder="Cant." class="input-chico" required>
        <button type="submit" class="btn btn-chico btn-secundario">Reponer</button></form>
      <a href="/stock/${p.id}/editar" class="btn btn-chico btn-secundario">Editar</a>
      <form method="post" action="/stock/${p.id}/eliminar" onsubmit="return confirm('¿Eliminar ${esc(p.nombre).replace(/'/g, "\\'")}?');" class="form-inline">
        <button type="submit" class="btn btn-chico btn-peligro">Eliminar</button></form></td>` : '';
    const costo = p.precio_costo || 0;
    const margen = margenPct(p.precio_venta, costo);
    const ganancia = costo ? p.precio_venta - costo : null;
    const colsCosto = esAdmin ? `
      <td>${costo ? gs(costo) : '<span class="ayuda-texto">sin costo</span>'}</td>
      <td>${margen === null ? '-' : margen + '%'}</td>
      <td class="${ganancia !== null && ganancia > 0 ? 'texto-verde' : (ganancia !== null && ganancia < 0 ? 'texto-rojo' : '')}">${ganancia === null ? '-' : gs(ganancia)}</td>` : '';
    return `<tr class="${bajo ? 'fila-alerta' : ''}">
      <td>${esc(p.nombre)}</td><td>${esc(ETIQUETAS_CATEGORIA[p.categoria] || p.categoria)}</td>
      <td>${gs(p.precio_venta)}</td>${colsCosto}<td>${p.stock}${bajo ? ' ⚠️' : ''}</td><td>${p.stock_minimo}</td>${acciones}</tr>`;
  }).join('') : `<tr><td colspan="9" class="tabla-vacia">No hay productos cargados.</td></tr>`;

  const thCosto = esAdmin ? '<th>Precio costo</th><th>Margen</th><th>Ganancia unit.</th>' : '';
  let valorizacion = '';
  if (esAdmin) {
    let valCosto = 0, valVenta = 0, sinCosto = 0;
    for (const p of productos) {
      valCosto += (p.precio_costo || 0) * p.stock;
      valVenta += p.precio_venta * p.stock;
      if (!p.precio_costo) sinCosto++;
    }
    valorizacion = `
<section class="tarjetas-resumen">
  <div class="tarjeta"><span class="tarjeta-etiqueta">Stock valorizado a costo</span><span class="tarjeta-monto">${gs(valCosto)}</span></div>
  <div class="tarjeta"><span class="tarjeta-etiqueta">Stock valorizado a venta</span><span class="tarjeta-monto">${gs(valVenta)}</span></div>
  <div class="tarjeta tarjeta-verde"><span class="tarjeta-etiqueta">Ganancia potencial</span><span class="tarjeta-monto">${gs(valVenta - valCosto)}</span></div>
</section>
${sinCosto ? `<p class="ayuda-texto">⚠️ ${sinCosto} producto(s) sin precio de costo cargado: la ganancia de esos productos no se puede calcular.</p>` : ''}`;
  }

  return c.html(layout(c, { title: 'Stock · Tercer Tiempo', body: `
<div class="cabecera-con-boton"><h1 class="titulo-pagina">Stock / Inventario</h1>${botones}</div>
${valorizacion}
<div class="tabla-envoltorio"><table class="tabla">
  <thead><tr><th>Producto</th><th>Categoría</th><th>Precio venta</th>${thCosto}<th>Stock</th><th>Mínimo</th>${thAcc}</tr></thead>
  <tbody>${filas}</tbody>
</table></div>` }));
});

function formProducto(c, producto) {
  const editar = !!producto;
  const catOpts = CATEGORIAS_PRODUCTO.map((cat) =>
    `<option value="${cat}" ${producto && producto.categoria === cat ? 'selected' : ''}>${esc(ETIQUETAS_CATEGORIA[cat])}</option>`).join('');
  return layout(c, { title: `${editar ? 'Editar producto' : 'Nuevo producto'} · Tercer Tiempo`, body: `
<h1 class="titulo-pagina">${editar ? 'Editar producto' : 'Nuevo producto'}</h1>
<form method="post" class="formulario formulario-tarjeta">
  <label for="nombre">Nombre</label>
  <input type="text" id="nombre" name="nombre" value="${producto ? esc(producto.nombre) : ''}" required>
  <label for="categoria">Categoría</label>
  <select id="categoria" name="categoria">${catOpts}</select>
  <div class="formulario-fila">
    <div><label for="precio_venta">Precio de venta (₲)</label>
      <input type="text" inputmode="numeric" id="precio_venta" name="precio_venta" value="${producto ? producto.precio_venta : ''}" required></div>
    <div><label for="precio_costo">Precio de costo (₲)</label>
      <input type="text" inputmode="numeric" id="precio_costo" name="precio_costo" value="${producto ? (producto.precio_costo ?? '') : ''}"></div>
  </div>
  <p class="ayuda-texto">Cargá el precio de costo para que el sistema calcule el margen y la ganancia real de cada venta.</p>
  ${!editar ? `<label for="stock">Stock inicial</label><input type="number" id="stock" name="stock" value="0" min="0">` : ''}
  <label for="stock_minimo">Stock mínimo (para alertas)</label>
  <input type="number" id="stock_minimo" name="stock_minimo" value="${producto ? producto.stock_minimo : 5}" min="0">
  <button type="submit" class="btn btn-primario btn-grande">Guardar</button>
</form>` });
}

app.get('/stock/nuevo', requiereLogin, requiereAdmin, (c) => { c.set('seccion', 'stock'); return c.html(formProducto(c, null)); });

app.post('/stock/nuevo', requiereLogin, requiereAdmin, async (c) => {
  const b = await c.req.parseBody();
  let cat = String(b.categoria || 'otro');
  if (!CATEGORIAS_PRODUCTO.includes(cat)) cat = 'otro';
  await run(c.env, 'INSERT INTO productos (nombre, categoria, precio_venta, precio_costo, stock, stock_minimo) VALUES (?,?,?,?,?,?)',
    String(b.nombre || '').trim(), cat, aEntero(b.precio_venta), aEntero(b.precio_costo), aEntero(b.stock), aEntero(b.stock_minimo ?? 5));
  addFlash(c, 'exito', 'Producto creado correctamente.');
  return irA(c, '/stock');
});

app.get('/stock/:id/editar', requiereLogin, requiereAdmin, async (c) => {
  c.set('seccion', 'stock');
  const p = await first(c.env, 'SELECT * FROM productos WHERE id=?', Number(c.req.param('id')));
  if (!p) return c.html(paginaError(404, 'Producto no encontrado.'), 404);
  return c.html(formProducto(c, p));
});

app.post('/stock/:id/editar', requiereLogin, requiereAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const p = await first(c.env, 'SELECT * FROM productos WHERE id=?', id);
  if (!p) return c.html(paginaError(404, 'Producto no encontrado.'), 404);
  const b = await c.req.parseBody();
  let cat = String(b.categoria || 'otro');
  if (!CATEGORIAS_PRODUCTO.includes(cat)) cat = 'otro';
  await run(c.env, 'UPDATE productos SET nombre=?, categoria=?, precio_venta=?, precio_costo=?, stock_minimo=? WHERE id=?',
    String(b.nombre || '').trim(), cat, aEntero(b.precio_venta), aEntero(b.precio_costo), aEntero(b.stock_minimo ?? 5), id);
  addFlash(c, 'exito', 'Producto actualizado correctamente.');
  return irA(c, '/stock');
});

app.post('/stock/:id/eliminar', requiereLogin, requiereAdmin, async (c) => {
  await run(c.env, 'UPDATE productos SET activo=0 WHERE id=?', Number(c.req.param('id')));
  addFlash(c, 'exito', 'Producto eliminado.');
  return irA(c, '/stock');
});

app.post('/stock/:id/reponer', requiereLogin, requiereAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const p = await first(c.env, 'SELECT * FROM productos WHERE id=?', id);
  if (!p) return c.html(paginaError(404, 'Producto no encontrado.'), 404);
  const b = await c.req.parseBody();
  const cant = aEntero(b.cantidad);
  const motivo = String(b.motivo || 'Reposición de stock').trim();
  if (cant <= 0) { addFlash(c, 'error', 'Ingresá una cantidad válida para reponer.'); return irA(c, '/stock'); }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE productos SET stock = stock + ? WHERE id=?').bind(cant, id),
    c.env.DB.prepare('INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, fecha, usuario_id) VALUES (?,?,?,?,?,?)')
      .bind(id, 'entrada', cant, motivo, ahoraTS(), c.get('user').id),
  ]);
  addFlash(c, 'exito', `Se repusieron ${cant} unidades de '${p.nombre}'.`);
  return irA(c, '/stock');
});

app.get('/stock/movimientos', requiereLogin, requiereAdmin, async (c) => {
  c.set('seccion', 'stock');
  const movs = await all(c.env,
    `SELECT m.*, p.nombre AS producto_nombre, u.nombre AS usuario_nombre
     FROM movimientos_stock m JOIN productos p ON m.producto_id=p.id LEFT JOIN usuarios u ON m.usuario_id=u.id
     ORDER BY m.fecha DESC, m.id DESC LIMIT 200`);
  const filas = movs.length ? movs.map((m) => `<tr>
    <td>${fmtFechaHora(m.fecha)}</td><td>${esc(m.producto_nombre)}</td>
    <td><span class="etiqueta ${m.tipo === 'entrada' ? 'etiqueta-verde' : 'etiqueta-naranja'}">${m.tipo === 'entrada' ? 'Entrada' : 'Salida'}</span></td>
    <td>${m.cantidad}</td><td>${esc(m.motivo || '-')}</td><td>${esc(m.usuario_nombre || '-')}</td></tr>`).join('')
    : `<tr><td colspan="6" class="tabla-vacia">No hay movimientos registrados.</td></tr>`;
  return c.html(layout(c, { title: 'Movimientos de stock · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Movimientos de stock</h1>
<div class="tabla-envoltorio"><table class="tabla">
  <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th>Usuario</th></tr></thead>
  <tbody>${filas}</tbody>
</table></div>` }));
});

// -------------------- REPORTES --------------------
function parsearFecha(valor, defecto) {
  if (valor && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  return defecto;
}

app.get('/reportes', requiereLogin, requiereAdmin, async (c) => {
  c.set('seccion', 'reportes');
  const fecha = parsearFecha(c.req.query('fecha'), fechaHoy());
  const totalAlq = await totalAlquileresDia(c.env, fecha);
  const totalKio = await totalKioscoDia(c.env, fecha);
  const totalGen = totalAlq + totalKio;
  const porTipo = await alquileresPorTipoDia(c.env, fecha);
  const top = await productosMasVendidosDia(c.env, fecha);
  const uk = await utilidadKioscoDia(c.env, fecha);
  const [ini, fin] = rangoDia(fecha);
  const caja = await first(c.env, 'SELECT * FROM cajas WHERE fecha_apertura>=? AND fecha_apertura<=? ORDER BY id DESC LIMIT 1', ini, fin);

  const filasTipo = porTipo.length ? porTipo.map((r) => `<tr><td>${esc(ETIQUETAS_ESPACIO[r.tipo_espacio] || r.tipo_espacio)}</td><td>${r.cantidad}</td><td>${gs(r.total)}</td></tr>`).join('')
    : `<tr><td colspan="3" class="tabla-vacia">Sin alquileres en esta fecha.</td></tr>`;
  const filasTop = top.length ? top.map((r) => `<tr><td>${esc(r.nombre)}</td><td>${r.cantidad}</td><td>${gs(r.total)}</td><td>${gs(r.costo)}</td><td class="texto-verde">${gs(r.total - r.costo)}</td></tr>`).join('')
    : `<tr><td colspan="5" class="tabla-vacia">Sin ventas de kiosco en esta fecha.</td></tr>`;
  const bloqueCaja = (caja && caja.estado === 'cerrada') ? `
<div class="panel panel-resumen">
  <div class="resumen-fila"><span>Monto inicial</span><strong>${gs(caja.monto_inicial)}</strong></div>
  <div class="resumen-fila"><span>Total general</span><strong>${gs(caja.total_general || 0)}</strong></div>
  <div class="resumen-fila"><span>Monto esperado</span><strong>${gs(caja.monto_esperado || 0)}</strong></div>
  <div class="resumen-fila"><span>Monto contado</span><strong>${gs(caja.monto_contado || 0)}</strong></div>
  <div class="resumen-fila resumen-total"><span>Diferencia</span><strong>${gs(caja.diferencia || 0)}</strong></div>
</div>` : `<p class="ayuda-texto">La caja de este día todavía no fue cerrada.</p>`;

  return c.html(layout(c, { title: 'Reporte diario · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Reporte diario</h1>
<form method="get" class="formulario-filtro">
  <label for="fecha">Fecha</label>
  <input type="date" id="fecha" name="fecha" value="${fecha}" onchange="this.form.submit()">
  <a href="/reportes/rango" class="link-secundario">Ver reporte por rango de fechas →</a>
</form>
<div class="botones-cabecera no-imprimir">
  <a href="/reportes/exportar?fecha=${fecha}" class="btn btn-secundario">⬇ Exportar CSV</a>
  <button onclick="window.print()" class="btn btn-secundario">🖨 Imprimir</button>
</div>
<section class="tarjetas-resumen">
  <div class="tarjeta tarjeta-verde"><span class="tarjeta-etiqueta">Total general</span><span class="tarjeta-monto">${gs(totalGen)}</span></div>
  <div class="tarjeta"><span class="tarjeta-etiqueta">Alquileres</span><span class="tarjeta-monto">${gs(totalAlq)}</span></div>
  <div class="tarjeta"><span class="tarjeta-etiqueta">Kiosco</span><span class="tarjeta-monto">${gs(totalKio)}</span></div>
</section>
<h2 class="titulo-seccion">Ganancia del kiosco</h2>
<div class="panel panel-resumen">
  <div class="resumen-fila"><span>Venta de productos</span><strong>${gs(uk.venta)}</strong></div>
  <div class="resumen-fila"><span>Costo de la mercadería vendida</span><strong class="texto-rojo">${gs(-uk.costo)}</strong></div>
  <div class="resumen-fila resumen-total"><span>Ganancia bruta</span><strong class="texto-verde">${gs(uk.utilidad)}</strong></div>
</div>
<h2 class="titulo-seccion">Alquileres por tipo de espacio</h2>
<div class="tabla-envoltorio"><table class="tabla"><thead><tr><th>Tipo</th><th>Cantidad</th><th>Total</th></tr></thead><tbody>${filasTipo}</tbody></table></div>
<h2 class="titulo-seccion">Productos más vendidos</h2>
<div class="tabla-envoltorio"><table class="tabla"><thead><tr><th>Producto</th><th>Cantidad</th><th>Venta</th><th>Costo</th><th>Ganancia</th></tr></thead><tbody>${filasTop}</tbody></table></div>
<h2 class="titulo-seccion">Cierre de caja</h2>
${bloqueCaja}` }));
});

app.get('/reportes/rango', requiereLogin, requiereAdmin, async (c) => {
  c.set('seccion', 'reportes');
  const hoy = fechaHoy();
  const fi = parsearFecha(c.req.query('fecha_inicio'), hoy);
  const ff = parsearFecha(c.req.query('fecha_fin'), hoy);
  const [totalAlq, totalKio] = await totalesRango(c.env, fi, ff);
  const totalGen = totalAlq + totalKio;
  const uk = await utilidadKioscoRango(c.env, fi, ff);
  return c.html(layout(c, { title: 'Reporte por rango · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Reporte por rango de fechas</h1>
<form method="get" class="formulario-filtro">
  <label for="fecha_inicio">Desde</label><input type="date" id="fecha_inicio" name="fecha_inicio" value="${fi}">
  <label for="fecha_fin">Hasta</label><input type="date" id="fecha_fin" name="fecha_fin" value="${ff}">
  <button type="submit" class="btn btn-primario">Ver</button>
</form>
<a href="/reportes" class="link-secundario">← Volver al reporte diario</a>
<section class="tarjetas-resumen">
  <div class="tarjeta tarjeta-verde"><span class="tarjeta-etiqueta">Total general</span><span class="tarjeta-monto">${gs(totalGen)}</span></div>
  <div class="tarjeta"><span class="tarjeta-etiqueta">Alquileres</span><span class="tarjeta-monto">${gs(totalAlq)}</span></div>
  <div class="tarjeta"><span class="tarjeta-etiqueta">Kiosco</span><span class="tarjeta-monto">${gs(totalKio)}</span></div>
</section>
<div class="panel panel-resumen">
  <div class="resumen-fila"><span>Venta de productos</span><strong>${gs(uk.venta)}</strong></div>
  <div class="resumen-fila"><span>Costo de la mercadería vendida</span><strong class="texto-rojo">${gs(-uk.costo)}</strong></div>
  <div class="resumen-fila resumen-total"><span>Ganancia bruta del kiosco</span><strong class="texto-verde">${gs(uk.utilidad)}</strong></div>
</div>
<p class="ayuda-texto">Del ${fmtFecha(fi)} al ${fmtFecha(ff)}</p>` }));
});

app.get('/reportes/exportar', requiereLogin, requiereAdmin, async (c) => {
  const fecha = parsearFecha(c.req.query('fecha'), fechaHoy());
  const totalAlq = await totalAlquileresDia(c.env, fecha);
  const totalKio = await totalKioscoDia(c.env, fecha);
  const porTipo = await alquileresPorTipoDia(c.env, fecha);
  const top = await productosMasVendidosDia(c.env, fecha, 100);
  const uk = await utilidadKioscoDia(c.env, fecha);
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [];
  lineas.push(['Reporte diario - Tercer Tiempo', fmtFecha(fecha)].map(q).join(','));
  lineas.push('');
  lineas.push(['Concepto', 'Total (Gs.)'].map(q).join(','));
  lineas.push(['Alquileres', totalAlq].map(q).join(','));
  lineas.push(['Kiosco', totalKio].map(q).join(','));
  lineas.push(['Total general', totalAlq + totalKio].map(q).join(','));
  lineas.push(['Costo mercaderia vendida', uk.costo].map(q).join(','));
  lineas.push(['Ganancia bruta kiosco', uk.utilidad].map(q).join(','));
  lineas.push('');
  lineas.push(q('Alquileres por tipo de espacio'));
  lineas.push(['Tipo', 'Cantidad', 'Total (Gs.)'].map(q).join(','));
  for (const r of porTipo) lineas.push([ETIQUETAS_ESPACIO[r.tipo_espacio] || r.tipo_espacio, r.cantidad, r.total].map(q).join(','));
  lineas.push('');
  lineas.push(q('Productos más vendidos'));
  lineas.push(['Producto', 'Cantidad', 'Venta (Gs.)', 'Costo (Gs.)', 'Ganancia (Gs.)'].map(q).join(','));
  for (const r of top) lineas.push([r.nombre, r.cantidad, r.total, r.costo, r.total - r.costo].map(q).join(','));
  const csv = '﻿' + lineas.join('\r\n');
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename=reporte_${fecha}.csv` },
  });
});

// -------------------- CONFIGURACION --------------------
app.get('/configuracion', requiereLogin, requiereAdmin, async (c) => {
  c.set('seccion', 'configuracion');
  const rows = await all(c.env, 'SELECT tipo_espacio, precio_hora, unidad FROM precios_espacio');
  const precios = {}, unidades = {};
  for (const r of rows) {
    precios[r.tipo_espacio] = r.precio_hora;
    unidades[r.tipo_espacio] = UNIDADES.includes(r.unidad) ? r.unidad : (UNIDAD_DEFECTO[r.tipo_espacio] || 'hora');
  }
  const campos = TIPOS_ESPACIO.map((t) => {
    const u = unidades[t] || UNIDAD_DEFECTO[t] || 'hora';
    const opts = UNIDADES.map((v) => `<option value="${v}" ${v === u ? 'selected' : ''}>${esc(ETIQUETAS_UNIDAD[v])}</option>`).join('');
    return `
  <div class="formulario-fila">
    <div><label for="precio_${t}">${esc(ETIQUETAS_ESPACIO[t])} (₲ por ${UNIDAD_SINGULAR[u]})</label>
      <input type="text" inputmode="numeric" id="precio_${t}" name="precio_${t}" value="${precios[t] ?? 0}"></div>
    <div><label for="unidad_${t}">Se cobra</label>
      <select id="unidad_${t}" name="unidad_${t}">${opts}</select></div>
  </div>`;
  }).join('');
  return c.html(layout(c, { title: 'Configuración · Tercer Tiempo', body: `
<h1 class="titulo-pagina">Configuración</h1>
<h2 class="titulo-seccion">Precios de los espacios</h2>
<p class="ayuda-texto">Cada espacio se puede cobrar por hora, por juego o por ficha. El billar se cobra por ficha y el vóley/piki por juego.</p>
<form method="post" action="/configuracion/precios" class="formulario formulario-tarjeta">
  ${campos}
  <button type="submit" class="btn btn-primario btn-grande">Guardar precios</button>
</form>
<h2 class="titulo-seccion">Usuarios</h2>
<a href="/configuracion/usuarios" class="btn btn-secundario">Gestionar usuarios →</a>` }));
});

app.post('/configuracion/precios', requiereLogin, requiereAdmin, async (c) => {
  const b = await c.req.parseBody();
  for (const t of TIPOS_ESPACIO) {
    const existe = await first(c.env, 'SELECT id FROM precios_espacio WHERE tipo_espacio=?', t);
    if (!existe) continue;
    let u = String(b[`unidad_${t}`] || '');
    if (!UNIDADES.includes(u)) u = UNIDAD_DEFECTO[t] || 'hora';
    await run(c.env, 'UPDATE precios_espacio SET precio_hora=?, unidad=? WHERE tipo_espacio=?', aEntero(b[`precio_${t}`]), u, t);
  }
  addFlash(c, 'exito', 'Precios actualizados correctamente.');
  return irA(c, '/configuracion');
});

app.get('/configuracion/usuarios', requiereLogin, requiereAdmin, async (c) => {
  c.set('seccion', 'configuracion');
  const usuarios = await all(c.env, 'SELECT * FROM usuarios ORDER BY nombre');
  const filas = usuarios.map((u) => `<tr>
    <td>${esc(u.nombre)}</td><td>${esc(u.usuario)}</td>
    <td>${u.rol === 'administrador' ? 'Administrador' : 'Cajero'}</td>
    <td><span class="etiqueta ${u.activo ? 'etiqueta-verde' : 'etiqueta-gris'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
    <td><a href="/configuracion/usuarios/${u.id}/editar" class="btn btn-chico btn-secundario">Editar</a></td></tr>`).join('');
  return c.html(layout(c, { title: 'Usuarios · Tercer Tiempo', body: `
<div class="cabecera-con-boton"><h1 class="titulo-pagina">Usuarios</h1>
  <a href="/configuracion/usuarios/nuevo" class="btn btn-primario">+ Nuevo usuario</a></div>
<div class="tabla-envoltorio"><table class="tabla">
  <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
  <tbody>${filas}</tbody>
</table></div>
<a href="/configuracion" class="link-secundario">← Volver a configuración</a>` }));
});

function formUsuario(c, usuario) {
  const editar = !!usuario;
  const rolOpts = ROLES.map((r) => `<option value="${r}" ${usuario && usuario.rol === r ? 'selected' : ''}>${r === 'administrador' ? 'Administrador' : 'Cajero'}</option>`).join('');
  return layout(c, { title: `${editar ? 'Editar usuario' : 'Nuevo usuario'} · Tercer Tiempo`, body: `
<h1 class="titulo-pagina">${editar ? 'Editar usuario' : 'Nuevo usuario'}</h1>
<form method="post" class="formulario formulario-tarjeta">
  <label for="nombre">Nombre completo</label>
  <input type="text" id="nombre" name="nombre" value="${usuario ? esc(usuario.nombre) : ''}" required>
  ${!editar ? `<label for="usuario">Usuario (para iniciar sesión)</label><input type="text" id="usuario" name="usuario" required>` : ''}
  <label for="password">${editar ? 'Nueva contraseña (dejar en blanco para no cambiar)' : 'Contraseña'}</label>
  <input type="password" id="password" name="password" ${editar ? '' : 'required'}>
  <label for="rol">Rol</label>
  <select id="rol" name="rol">${rolOpts}</select>
  ${editar ? `<label class="check-linea"><input type="checkbox" name="activo" ${usuario.activo ? 'checked' : ''}> Usuario activo</label>` : ''}
  <button type="submit" class="btn btn-primario btn-grande">Guardar</button>
</form>` });
}

app.get('/configuracion/usuarios/nuevo', requiereLogin, requiereAdmin, (c) => { c.set('seccion', 'configuracion'); return c.html(formUsuario(c, null)); });

app.post('/configuracion/usuarios/nuevo', requiereLogin, requiereAdmin, async (c) => {
  c.set('seccion', 'configuracion');
  const b = await c.req.parseBody();
  const nombre = String(b.nombre || '').trim();
  const usuarioLogin = String(b.usuario || '').trim();
  const password = String(b.password || '');
  let rol = String(b.rol || 'cajero');
  if (!ROLES.includes(rol)) rol = 'cajero';
  if (!nombre || !usuarioLogin || !password) { addFlash(c, 'error', 'Completá todos los campos.'); return c.html(formUsuario(c, null)); }
  const existe = await first(c.env, 'SELECT id FROM usuarios WHERE usuario=?', usuarioLogin);
  if (existe) { addFlash(c, 'error', 'Ya existe un usuario con ese nombre de acceso.'); return c.html(formUsuario(c, null)); }
  await run(c.env, 'INSERT INTO usuarios (nombre, usuario, password_hash, rol, creado_en) VALUES (?,?,?,?,?)',
    nombre, usuarioLogin, await hashPassword(password), rol, ahoraTS());
  addFlash(c, 'exito', 'Usuario creado correctamente.');
  return irA(c, '/configuracion/usuarios');
});

app.get('/configuracion/usuarios/:id/editar', requiereLogin, requiereAdmin, async (c) => {
  c.set('seccion', 'configuracion');
  const u = await first(c.env, 'SELECT * FROM usuarios WHERE id=?', Number(c.req.param('id')));
  if (!u) return c.html(paginaError(404, 'Usuario no encontrado.'), 404);
  return c.html(formUsuario(c, u));
});

app.post('/configuracion/usuarios/:id/editar', requiereLogin, requiereAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const u = await first(c.env, 'SELECT * FROM usuarios WHERE id=?', id);
  if (!u) return c.html(paginaError(404, 'Usuario no encontrado.'), 404);
  const b = await c.req.parseBody();
  const nombre = String(b.nombre || '').trim();
  let rol = String(b.rol || 'cajero');
  if (!ROLES.includes(rol)) rol = 'cajero';
  const activo = b.activo ? 1 : 0;
  const password = String(b.password || '');
  if (password) {
    await run(c.env, 'UPDATE usuarios SET nombre=?, rol=?, activo=?, password_hash=? WHERE id=?', nombre, rol, activo, await hashPassword(password), id);
  } else {
    await run(c.env, 'UPDATE usuarios SET nombre=?, rol=?, activo=? WHERE id=?', nombre, rol, activo, id);
  }
  addFlash(c, 'exito', 'Usuario actualizado correctamente.');
  return irA(c, '/configuracion/usuarios');
});

// -------------------- ARCHIVOS ESTATICOS (CSS/JS embebidos) --------------------
const CSS_STYLE = `:root {
  --verde: #1b7a3d;
  --verde-oscuro: #145c2e;
  --verde-claro: #e5f4ea;
  --naranja: #f57c00;
  --naranja-oscuro: #e65100;
  --naranja-claro: #fff1e0;
  --blanco: #ffffff;
  --fondo: #f4f6f5;
  --borde: #dfe3e0;
  --texto: #1f2a24;
  --texto-secundario: #667069;
  --rojo: #d32f2f;
  --rojo-claro: #fdecea;
  --sidebar-bg: #14311f;
  --sidebar-texto: #d7e6dc;
  --sombra: 0 2px 10px rgba(0, 0, 0, 0.08);
  --radio: 12px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: "Segoe UI", Roboto, Arial, sans-serif;
  background: var(--fondo);
  color: var(--texto);
}

a { color: var(--verde); text-decoration: none; }

/* ---------- Estructura general ---------- */
.app-shell {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  background: var(--sidebar-bg);
  color: var(--sidebar-texto);
  width: 250px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 0;
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  transform: translateX(0);
  transition: transform 0.25s ease;
  z-index: 100;
  overflow-y: auto;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px 16px;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--blanco);
}
.logo-icono { font-size: 1.6rem; }

.sidebar-usuario {
  padding: 0 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9rem;
  border-bottom: 1px solid rgba(255,255,255,0.12);
  margin-bottom: 10px;
}
.badge-rol {
  align-self: flex-start;
  background: var(--naranja);
  color: var(--blanco);
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 2px;
  padding: 0 10px;
}
.sidebar-nav a {
  color: var(--sidebar-texto);
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 1rem;
}
.sidebar-nav a:hover { background: rgba(255,255,255,0.08); }
.sidebar-nav a.activo { background: var(--verde); color: var(--blanco); font-weight: 600; }

.salir {
  margin: 10px 10px 0;
  padding: 12px 14px;
  color: var(--sidebar-texto);
  border-radius: 10px;
}
.salir:hover { background: rgba(211,47,47,0.25); }

.btn-menu {
  display: none;
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 120;
  background: var(--sidebar-bg);
  color: var(--blanco);
  border: none;
  border-radius: 8px;
  width: 42px;
  height: 42px;
  font-size: 1.3rem;
  cursor: pointer;
}

.overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 90;
}

.contenido {
  margin-left: 250px;
  flex: 1;
  padding: 20px 28px 60px;
  min-width: 0;
}

.topbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}
.caja-estado {
  font-size: 0.85rem;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 999px;
}
.caja-estado.abierta { background: var(--verde-claro); color: var(--verde-oscuro); }
.caja-estado.cerrada { background: var(--rojo-claro); color: var(--rojo); }

@media (max-width: 900px) {
  .btn-menu { display: block; }
  .sidebar { transform: translateX(-100%); }
  .sidebar.abierto { transform: translateX(0); }
  .overlay.visible { display: block; }
  .contenido { margin-left: 0; padding: 70px 14px 40px; }
}

/* ---------- Login ---------- */
.pagina-login { background: linear-gradient(160deg, var(--verde) 0%, var(--verde-oscuro) 100%); min-height: 100vh; }
.login-envoltorio { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
.login-card {
  background: var(--blanco);
  border-radius: var(--radio);
  padding: 36px 30px;
  width: 100%;
  max-width: 380px;
  box-shadow: var(--sombra);
}
.login-logo { text-align: center; margin-bottom: 20px; }
.login-logo .logo-icono { font-size: 2.6rem; }
.login-logo h1 { margin: 6px 0 2px; color: var(--verde-oscuro); }
.login-logo p { margin: 0; color: var(--texto-secundario); font-size: 0.9rem; }
.login-form { display: flex; flex-direction: column; gap: 6px; }
.flashes-login { max-width: 380px; margin: 0 auto; padding-top: 20px; }

/* ---------- Textos y títulos ---------- */
.titulo-pagina { margin: 6px 0 2px; font-size: 1.6rem; color: var(--verde-oscuro); }
.subtitulo-pagina { margin: 0 0 16px; color: var(--texto-secundario); }
.titulo-seccion { margin: 28px 0 12px; font-size: 1.2rem; color: var(--texto); }
.ayuda-texto { color: var(--texto-secundario); font-size: 0.9rem; }
.texto-suave { color: var(--texto-secundario); font-weight: 400; }
.panel-mixto { border: 1px solid var(--borde); border-radius: 10px; padding: 0.75rem 0.9rem 0.25rem; margin: 0.5rem 0 0.75rem; background: rgba(0,0,0,0.02); }
.panel-mixto .formulario-fila { gap: 0.6rem; }
.panel-mixto label { font-size: 0.85rem; }
.panel-mixto .ayuda-texto { margin: 0.35rem 0 0.5rem; font-weight: 600; }
.link-secundario { display: inline-block; margin-top: 14px; font-weight: 600; }

.cabecera-con-boton {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}
.botones-cabecera { display: flex; gap: 10px; flex-wrap: wrap; }

/* ---------- Tarjetas resumen ---------- */
.tarjetas-resumen {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  margin-top: 10px;
}
.tarjeta {
  background: var(--blanco);
  border-radius: var(--radio);
  padding: 18px;
  box-shadow: var(--sombra);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tarjeta-etiqueta { color: var(--texto-secundario); font-size: 0.85rem; }
.tarjeta-monto { font-size: 1.5rem; font-weight: 700; }
.tarjeta-subtexto { font-size: 0.8rem; color: var(--texto-secundario); }
.tarjeta-verde { background: var(--verde); color: var(--blanco); }
.tarjeta-verde .tarjeta-etiqueta { color: rgba(255,255,255,0.85); }
.tarjeta-naranja { background: var(--naranja); color: var(--blanco); }
.tarjeta-naranja .tarjeta-etiqueta { color: rgba(255,255,255,0.85); }
.tarjeta-gris { background: #eceeed; }

/* ---------- Accesos rápidos ---------- */
.accesos-rapidos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 14px;
}
.acceso {
  background: var(--blanco);
  border-radius: var(--radio);
  padding: 20px 10px;
  box-shadow: var(--sombra);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--texto);
  text-align: center;
}
.acceso:hover { background: var(--verde-claro); }
.acceso-icono { font-size: 1.8rem; }
.acceso-naranja { background: var(--naranja-claro); }

/* ---------- Alertas de stock ---------- */
.lista-alertas { display: flex; flex-direction: column; gap: 8px; }
.alerta-item {
  background: var(--rojo-claro);
  border-left: 4px solid var(--rojo);
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  font-weight: 600;
}
.alerta-cantidad { color: var(--rojo); font-weight: 700; }

/* ---------- Formularios ---------- */
.formulario { display: flex; flex-direction: column; gap: 8px; max-width: 520px; }
.formulario-tarjeta {
  background: var(--blanco);
  border-radius: var(--radio);
  padding: 20px;
  box-shadow: var(--sombra);
  max-width: 520px;
}
.formulario label { font-weight: 600; font-size: 0.9rem; margin-top: 8px; }
.formulario input, .formulario select {
  padding: 12px 14px;
  border: 1px solid var(--borde);
  border-radius: 10px;
  font-size: 1rem;
  width: 100%;
}
.formulario-fila { display: flex; gap: 12px; }
.formulario-fila > div { flex: 1; }
.input-monto { font-size: 1.4rem !important; font-weight: 700; text-align: center; }
.check-linea { display: flex; align-items: center; gap: 8px; font-weight: 500; }
.check-linea input { width: auto; }

.formulario-filtro { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.formulario-filtro label { font-weight: 600; }
.formulario-filtro input { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--borde); }

.total-preview {
  font-size: 1.3rem;
  font-weight: 700;
  margin: 14px 0;
  color: var(--verde-oscuro);
}

/* ---------- Botones ---------- */
.btn {
  display: inline-block;
  border: none;
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}
.btn-grande { padding: 16px 20px; font-size: 1.1rem; width: 100%; margin-top: 10px; }
.btn-primario { background: var(--verde); color: var(--blanco); }
.btn-primario:hover { background: var(--verde-oscuro); }
.btn-naranja { background: var(--naranja); color: var(--blanco); }
.btn-naranja:hover { background: var(--naranja-oscuro); }
.btn-secundario { background: var(--blanco); color: var(--verde-oscuro); border: 1px solid var(--verde); }
.btn-secundario:hover { background: var(--verde-claro); }
.btn-peligro { background: var(--rojo-claro); color: var(--rojo); border: 1px solid var(--rojo); }
.btn-chico { padding: 6px 10px; font-size: 0.8rem; }
.btn[disabled] { opacity: 0.5; cursor: not-allowed; }

/* ---------- Paneles ---------- */
.panel {
  background: var(--blanco);
  border-radius: var(--radio);
  padding: 20px;
  box-shadow: var(--sombra);
  max-width: 520px;
}
.panel-verde { border-left: 5px solid var(--verde); }
.panel-gris { border-left: 5px solid var(--borde); }
.panel-resumen { max-width: 520px; }
.resumen-fila {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--borde);
}
.resumen-total { font-weight: 700; font-size: 1.1rem; border-bottom: none; }
.resumen-esperado { color: var(--naranja-oscuro); font-weight: 700; }

.aviso-caja {
  background: var(--naranja-claro);
  color: var(--naranja-oscuro);
  padding: 12px 16px;
  border-radius: 10px;
  margin-bottom: 16px;
  font-weight: 600;
}

/* ---------- Tablas ---------- */
.tabla-envoltorio { overflow-x: auto; margin-top: 10px; }
.tabla { width: 100%; border-collapse: collapse; background: var(--blanco); border-radius: var(--radio); overflow: hidden; }
.tabla th, .tabla td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--borde); white-space: nowrap; }
.tabla th { background: var(--verde-claro); color: var(--verde-oscuro); font-size: 0.85rem; }
.tabla tr:last-child td { border-bottom: none; }
.tabla-vacia { text-align: center !important; color: var(--texto-secundario); white-space: normal !important; }
.fila-alerta { background: var(--rojo-claro); }
.texto-rojo { color: var(--rojo); font-weight: 700; }
.texto-verde { color: var(--verde); font-weight: 700; }
.acciones-tabla { display: flex; gap: 6px; flex-wrap: wrap; }
.form-inline { display: inline-flex; gap: 4px; }
.input-chico { width: 70px; padding: 6px; border-radius: 8px; border: 1px solid var(--borde); }

.etiqueta { padding: 3px 10px; border-radius: 999px; font-size: 0.78rem; font-weight: 700; }
.etiqueta-verde { background: var(--verde-claro); color: var(--verde-oscuro); }
.etiqueta-naranja { background: var(--naranja-claro); color: var(--naranja-oscuro); }
.etiqueta-gris { background: #eceeed; color: var(--texto-secundario); }
.etiqueta-roja { background: var(--rojo-claro); color: var(--rojo); }

/* ---------- Kiosco: grilla de productos ---------- */
.grilla-productos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 10px;
}
.producto-card {
  background: var(--blanco);
  border-radius: var(--radio);
  padding: 14px;
  box-shadow: var(--sombra);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.producto-sin-stock { opacity: 0.5; }
.producto-nombre { font-weight: 700; font-size: 0.95rem; min-height: 40px; }
.producto-precio { color: var(--verde-oscuro); font-weight: 700; }
.producto-stock { font-size: 0.78rem; color: var(--texto-secundario); }
.stepper { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
.stepper-btn {
  width: 36px; height: 36px;
  border-radius: 8px;
  border: 1px solid var(--borde);
  background: var(--fondo);
  font-size: 1.2rem;
  cursor: pointer;
}
.stepper-input {
  width: 50px; text-align: center;
  border: none; background: transparent;
  font-size: 1.1rem; font-weight: 700;
}

.panel-venta-fija {
  position: sticky;
  bottom: 0;
  background: var(--blanco);
  border-radius: var(--radio);
  padding: 16px;
  box-shadow: 0 -4px 12px rgba(0,0,0,0.08);
  max-width: 420px;
  margin-top: 20px;
}

/* ---------- Flash messages ---------- */
.flashes { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.flash { padding: 12px 16px; border-radius: 10px; font-weight: 600; }
.flash-error { background: var(--rojo-claro); color: var(--rojo); }
.flash-exito { background: var(--verde-claro); color: var(--verde-oscuro); }
.flash-info { background: #e3f2fd; color: #1565c0; }

/* ---------- Impresión ---------- */
@media print {
  .sidebar, .btn-menu, .overlay, .topbar, .no-imprimir, .formulario-filtro { display: none !important; }
  .contenido { margin-left: 0; padding: 0; }
  body { background: var(--blanco); }
}
`;
const JS_MAIN = `function formatearGuaranies(numero) {
  const texto = Math.round(numero).toLocaleString("es-PY").replace(/,/g, ".");
  return "₲ " + texto;
}

document.addEventListener("DOMContentLoaded", () => {
  // ---- Menu lateral (mobile) ----
  const btnMenu = document.getElementById("btn-menu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  if (btnMenu && sidebar && overlay) {
    const abrir = () => { sidebar.classList.add("abierto"); overlay.classList.add("visible"); };
    const cerrar = () => { sidebar.classList.remove("abierto"); overlay.classList.remove("visible"); };
    btnMenu.addEventListener("click", abrir);
    overlay.addEventListener("click", cerrar);
  }

  // ---- Ocultar mensajes flash despues de 6s ----
  document.querySelectorAll(".flash").forEach((flash) => {
    setTimeout(() => { flash.style.display = "none"; }, 6000);
  });

  // ---- Cobro mixto: mostrar los montos y avisar si no cuadra ----
  var totalParaMixto = 0;
  const selMetodoPago = document.getElementById("metodo_pago");
  const bloqueMixto = document.getElementById("bloque-mixto");
  const avisoMixto = document.getElementById("mixto-aviso");
  const inputsMixto = Array.prototype.slice.call(document.querySelectorAll(".mixto-input"));

  function refrescarMixto() {
    if (!selMetodoPago || !bloqueMixto) return;
    const esMixto = selMetodoPago.value === "mixto";
    bloqueMixto.style.display = esMixto ? "block" : "none";
    if (!esMixto) { if (avisoMixto) avisoMixto.textContent = ""; return; }
    let suma = 0;
    inputsMixto.forEach((i) => { suma += parseInt(String(i.value).replace(/[^0-9]/g, ""), 10) || 0; });
    if (!avisoMixto) return;
    const dif = totalParaMixto - suma;
    if (totalParaMixto <= 0) avisoMixto.textContent = "Cargá primero lo que se cobra.";
    else if (dif === 0) avisoMixto.textContent = "✅ El reparto cuadra con el total.";
    else if (dif > 0) avisoMixto.textContent = "Falta repartir " + formatearGuaranies(dif);
    else avisoMixto.textContent = "Te pasaste por " + formatearGuaranies(-dif);
  }

  window.avisarTotalMixto = function (t) { totalParaMixto = t; refrescarMixto(); };
  if (selMetodoPago) selMetodoPago.addEventListener("change", refrescarMixto);
  inputsMixto.forEach((campo) => campo.addEventListener("input", () => {
    // Con dos formas de pago, lo que no es efectivo es transferencia: se completa solo
    if (totalParaMixto > 0 && inputsMixto.length === 2) {
      const otro = inputsMixto[0] === campo ? inputsMixto[1] : inputsMixto[0];
      const cargado = parseInt(String(campo.value).replace(/[^0-9]/g, ""), 10) || 0;
      otro.value = String(Math.max(0, totalParaMixto - cargado));
    }
    refrescarMixto();
  }));
  refrescarMixto();

  // ---- Total en vivo de alquiler ----
  const selectEspacio = document.getElementById("tipo_espacio");
  const inputDuracion = document.getElementById("duracion_horas");
  const labelCantidad = document.getElementById("label-cantidad");
  const totalSpanAlq = document.getElementById("total-alquiler");
  if (selectEspacio && inputDuracion && totalSpanAlq) {
    const textos = { hora: "Cantidad de horas", juego: "Cantidad de juegos", ficha: "Cantidad de fichas" };
    const actualizar = () => {
      const opcion = selectEspacio.options[selectEspacio.selectedIndex];
      const precio = parseFloat(opcion.dataset.precio || "0");
      const unidad = opcion.dataset.unidad || "hora";
      if (labelCantidad) labelCantidad.textContent = textos[unidad] || "Cantidad";
      // Solo las horas admiten medias horas; juegos y fichas van de a uno
      if (unidad === "hora") {
        inputDuracion.min = "0.5"; inputDuracion.step = "0.5";
      } else {
        inputDuracion.min = "1"; inputDuracion.step = "1";
        inputDuracion.value = String(Math.max(1, Math.round(parseFloat(inputDuracion.value || "1"))));
      }
      const cantidad = parseFloat(inputDuracion.value || "0");
      const totalAlq = Math.round(precio * cantidad);
      totalSpanAlq.textContent = formatearGuaranies(totalAlq);
      if (window.avisarTotalMixto) window.avisarTotalMixto(totalAlq);
    };
    selectEspacio.addEventListener("change", actualizar);
    inputDuracion.addEventListener("input", actualizar);
    actualizar();
  }

  // ---- Preview de diferencia al cerrar caja ----
  const inputContado = document.getElementById("monto_contado");
  const previewDif = document.getElementById("diferencia-preview");
  if (inputContado && previewDif && inputContado.dataset.esperado !== undefined) {
    const montoEsperado = parseInt(inputContado.dataset.esperado, 10) || 0;
    inputContado.addEventListener("input", () => {
      const valor = parseInt(inputContado.value.replace(/\D/g, ""), 10) || 0;
      const diferencia = valor - montoEsperado;
      if (!inputContado.value) { previewDif.textContent = ""; return; }
      if (diferencia === 0) {
        previewDif.textContent = "✅ La caja cierra exacta.";
      } else if (diferencia > 0) {
        previewDif.textContent = "🔵 Sobrante de " + diferencia.toLocaleString("es-PY") + " Gs.";
      } else {
        previewDif.textContent = "🔴 Faltante de " + Math.abs(diferencia).toLocaleString("es-PY") + " Gs.";
      }
    });
  }
});
`;
const JS_KIOSCO = `document.addEventListener("DOMContentLoaded", () => {
  const totalSpan = document.getElementById("total-venta");

  function actualizarTotalVenta() {
    let total = 0;
    document.querySelectorAll(".stepper-input").forEach((input) => {
      const precio = parseFloat(input.dataset.precio || "0");
      const cantidad = parseInt(input.value || "0", 10);
      total += precio * cantidad;
    });
    if (totalSpan) totalSpan.textContent = formatearGuaranies(total);
    if (window.avisarTotalMixto) window.avisarTotalMixto(total);
  }

  document.querySelectorAll(".stepper-btn").forEach((boton) => {
    boton.addEventListener("click", () => {
      const input = boton.parentElement.querySelector(".stepper-input");
      const stock = parseInt(input.dataset.stock || "0", 10);
      let valor = parseInt(input.value || "0", 10);
      if (boton.dataset.accion === "sumar") {
        valor = Math.min(valor + 1, stock);
      } else {
        valor = Math.max(valor - 1, 0);
      }
      input.value = valor;
      actualizarTotalVenta();
    });
  });

  actualizarTotalVenta();
});
`;
app.get('/static/css/style.css', (c) => c.body(CSS_STYLE, 200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }));
app.get('/static/js/main.js', (c) => c.body(JS_MAIN, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }));
app.get('/static/js/kiosco.js', (c) => c.body(JS_KIOSCO, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }));

// 404
app.notFound((c) => c.html(paginaError(404, 'Página no encontrada.'), 404));

export default app;
