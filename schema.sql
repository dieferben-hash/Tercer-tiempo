-- ============================================================
--  Tercer Tiempo - Esquema de base de datos (Cloudflare D1)
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  usuario TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'cajero',
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS precios_espacio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_espacio TEXT UNIQUE NOT NULL,
  precio_hora INTEGER NOT NULL DEFAULT 0,   -- precio por unidad (hora, juego o ficha)
  unidad TEXT NOT NULL DEFAULT 'hora'       -- hora | juego | ficha
);

CREATE TABLE IF NOT EXISTS configuracion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT UNIQUE NOT NULL,
  valor TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'otro',
  precio_venta INTEGER NOT NULL DEFAULT 0,
  precio_costo INTEGER DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  stock_minimo INTEGER NOT NULL DEFAULT 5,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS movimientos_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  tipo TEXT NOT NULL,               -- entrada | salida
  cantidad INTEGER NOT NULL,
  motivo TEXT DEFAULT '',
  fecha TEXT DEFAULT (datetime('now')),
  usuario_id INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS cajas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha_apertura TEXT DEFAULT (datetime('now')),
  monto_inicial INTEGER NOT NULL DEFAULT 0,
  usuario_apertura_id INTEGER REFERENCES usuarios(id),
  estado TEXT NOT NULL DEFAULT 'abierta',   -- abierta | cerrada
  fecha_cierre TEXT,
  usuario_cierre_id INTEGER REFERENCES usuarios(id),
  total_alquileres INTEGER DEFAULT 0,
  total_kiosco INTEGER DEFAULT 0,
  total_general INTEGER DEFAULT 0,
  total_efectivo INTEGER DEFAULT 0,
  total_transferencia INTEGER DEFAULT 0,
  total_tarjeta INTEGER DEFAULT 0,
  total_egresos INTEGER DEFAULT 0,
  total_ingresos_extra INTEGER DEFAULT 0,
  costo_kiosco INTEGER DEFAULT 0,
  monto_esperado INTEGER DEFAULT 0,
  monto_contado INTEGER,
  diferencia INTEGER,
  observaciones TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS movimientos_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caja_id INTEGER NOT NULL REFERENCES cajas(id),
  tipo TEXT NOT NULL,                -- egreso | ingreso
  concepto TEXT DEFAULT '',
  monto INTEGER NOT NULL DEFAULT 0,
  fecha TEXT DEFAULT (datetime('now')),
  usuario_id INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS alquileres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caja_id INTEGER NOT NULL REFERENCES cajas(id),
  tipo_espacio TEXT NOT NULL,
  cliente TEXT DEFAULT '',
  fecha TEXT,
  hora_inicio TEXT NOT NULL,
  duracion_horas REAL NOT NULL DEFAULT 1.0,  -- cantidad: horas, juegos o fichas
  unidad TEXT DEFAULT 'hora',
  precio_hora INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  metodo_pago TEXT NOT NULL DEFAULT 'efectivo',  -- efectivo | transferencia | tarjeta | mixto
  pago_efectivo INTEGER DEFAULT 0,
  pago_transferencia INTEGER DEFAULT 0,
  pago_tarjeta INTEGER DEFAULT 0,
  usuario_id INTEGER REFERENCES usuarios(id),
  fecha_registro TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caja_id INTEGER NOT NULL REFERENCES cajas(id),
  fecha TEXT DEFAULT (datetime('now')),
  total INTEGER NOT NULL DEFAULT 0,
  metodo_pago TEXT NOT NULL DEFAULT 'efectivo',  -- efectivo | transferencia | tarjeta | mixto
  pago_efectivo INTEGER DEFAULT 0,
  pago_transferencia INTEGER DEFAULT 0,
  pago_tarjeta INTEGER DEFAULT 0,
  usuario_id INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS venta_detalles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id INTEGER NOT NULL REFERENCES ventas(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL,
  precio_unitario INTEGER NOT NULL,
  costo_unitario INTEGER DEFAULT 0,
  subtotal INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alq_fecha ON alquileres(fecha_registro);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_fecha ON movimientos_stock(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_caja ON movimientos_caja(caja_id);

-- ============================================================
--  Datos iniciales (se insertan solo si no existen)
-- ============================================================

-- Usuario administrador por defecto  (usuario: admin  /  contrasena: admin123)
INSERT INTO usuarios (nombre, usuario, password_hash, rol)
SELECT 'Administrador', 'admin',
       'pbkdf2_sha256$100000$1cc3e3ddbe8ad127c033281417b349b6$2085457709b974e71682ca94a5402f149602d9cb67951550323f9d5994b04d88',
       'administrador'
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE usuario = 'admin');

-- Precios por hora por defecto
INSERT INTO precios_espacio (tipo_espacio, precio_hora, unidad)
SELECT 'futsal', 100000, 'hora' WHERE NOT EXISTS (SELECT 1 FROM precios_espacio WHERE tipo_espacio='futsal');
INSERT INTO precios_espacio (tipo_espacio, precio_hora, unidad)
SELECT 'voley', 20000, 'juego' WHERE NOT EXISTS (SELECT 1 FROM precios_espacio WHERE tipo_espacio='voley');
INSERT INTO precios_espacio (tipo_espacio, precio_hora, unidad)
SELECT 'billar', 5000, 'ficha' WHERE NOT EXISTS (SELECT 1 FROM precios_espacio WHERE tipo_espacio='billar');
INSERT INTO precios_espacio (tipo_espacio, precio_hora, unidad)
SELECT 'otro', 15000, 'hora' WHERE NOT EXISTS (SELECT 1 FROM precios_espacio WHERE tipo_espacio='otro');

-- Nombre del negocio
INSERT INTO configuracion (clave, valor)
SELECT 'nombre_negocio', 'Tercer Tiempo'
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave='nombre_negocio');

-- Productos de ejemplo
INSERT INTO productos (nombre, categoria, precio_venta, precio_costo, stock, stock_minimo)
SELECT 'Coca-Cola 500ml', 'bebida_sin_alcohol', 8000, 5000, 24, 6
WHERE NOT EXISTS (SELECT 1 FROM productos);
INSERT INTO productos (nombre, categoria, precio_venta, precio_costo, stock, stock_minimo)
SELECT 'Agua mineral 500ml', 'bebida_sin_alcohol', 5000, 3000, 24, 6
WHERE (SELECT COUNT(*) FROM productos) = 1;
INSERT INTO productos (nombre, categoria, precio_venta, precio_costo, stock, stock_minimo)
SELECT 'Cerveza Brahma lata', 'bebida_alcoholica', 10000, 6500, 24, 6
WHERE (SELECT COUNT(*) FROM productos) = 2;
INSERT INTO productos (nombre, categoria, precio_venta, precio_costo, stock, stock_minimo)
SELECT 'Whisky trago', 'bebida_alcoholica', 25000, 15000, 10, 3
WHERE (SELECT COUNT(*) FROM productos) = 3;
INSERT INTO productos (nombre, categoria, precio_venta, precio_costo, stock, stock_minimo)
SELECT 'Pancho completo', 'comida_rapida', 12000, 6000, 20, 5
WHERE (SELECT COUNT(*) FROM productos) = 4;
INSERT INTO productos (nombre, categoria, precio_venta, precio_costo, stock, stock_minimo)
SELECT 'Hamburguesa', 'comida_rapida', 18000, 9000, 15, 5
WHERE (SELECT COUNT(*) FROM productos) = 5;
INSERT INTO productos (nombre, categoria, precio_venta, precio_costo, stock, stock_minimo)
SELECT 'Papas fritas', 'comida_rapida', 10000, 4000, 15, 5
WHERE (SELECT COUNT(*) FROM productos) = 6;
