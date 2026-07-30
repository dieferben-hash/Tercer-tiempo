-- ============================================================
--  Tercer Tiempo - Migracion: arqueo de caja + precio de costo
--  Ejecutar UNA SOLA VEZ sobre la base ya existente:
--    npx wrangler d1 execute tercer-tiempo-db --remote --file=./migracion-arqueo.sql
--  (o pegando el contenido en la consola de D1 en el panel de Cloudflare)
-- ============================================================

-- Nuevas columnas de arqueo en cajas
ALTER TABLE cajas ADD COLUMN total_efectivo INTEGER DEFAULT 0;
ALTER TABLE cajas ADD COLUMN total_transferencia INTEGER DEFAULT 0;
ALTER TABLE cajas ADD COLUMN total_tarjeta INTEGER DEFAULT 0;
ALTER TABLE cajas ADD COLUMN total_egresos INTEGER DEFAULT 0;
ALTER TABLE cajas ADD COLUMN total_ingresos_extra INTEGER DEFAULT 0;
ALTER TABLE cajas ADD COLUMN costo_kiosco INTEGER DEFAULT 0;
ALTER TABLE cajas ADD COLUMN observaciones TEXT DEFAULT '';

-- Costo con el que se vendio cada producto (congela la ganancia historica)
ALTER TABLE venta_detalles ADD COLUMN costo_unitario INTEGER DEFAULT 0;

-- Egresos / ingresos de efectivo durante el turno
CREATE TABLE IF NOT EXISTS movimientos_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caja_id INTEGER NOT NULL REFERENCES cajas(id),
  tipo TEXT NOT NULL,                -- egreso | ingreso
  concepto TEXT DEFAULT '',
  monto INTEGER NOT NULL DEFAULT 0,
  fecha TEXT DEFAULT (datetime('now')),
  usuario_id INTEGER REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_mov_caja ON movimientos_caja(caja_id);

-- Rellenar el costo unitario de las ventas ya registradas con el costo actual
UPDATE venta_detalles
SET costo_unitario = COALESCE((SELECT precio_costo FROM productos WHERE productos.id = venta_detalles.producto_id), 0)
WHERE costo_unitario IS NULL OR costo_unitario = 0;

-- ============================================================
--  Unidad de cobro por espacio: hora / juego / ficha
--  (billar se cobra por ficha, voley/piki por juego)
-- ============================================================
ALTER TABLE precios_espacio ADD COLUMN unidad TEXT NOT NULL DEFAULT 'hora';
ALTER TABLE alquileres ADD COLUMN unidad TEXT DEFAULT 'hora';

UPDATE precios_espacio SET unidad = 'ficha' WHERE tipo_espacio = 'billar';
UPDATE precios_espacio SET unidad = 'juego' WHERE tipo_espacio = 'voley';
-- Los alquileres ya registrados quedan como 'hora', que es como se cobraron.
