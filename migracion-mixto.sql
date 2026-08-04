-- ============================================================
--  Tercer Tiempo - Migracion: cobro mixto (efectivo + transferencia + tarjeta)
--  Ejecutar UNA SOLA VEZ sobre la base ya existente.
--  En la consola de D1 hay que correr cada sentencia por separado.
-- ============================================================

-- Como se reparte el cobro de cada alquiler
ALTER TABLE alquileres ADD COLUMN pago_efectivo INTEGER DEFAULT 0;
ALTER TABLE alquileres ADD COLUMN pago_transferencia INTEGER DEFAULT 0;
ALTER TABLE alquileres ADD COLUMN pago_tarjeta INTEGER DEFAULT 0;

-- Como se reparte el cobro de cada venta de kiosco
ALTER TABLE ventas ADD COLUMN pago_efectivo INTEGER DEFAULT 0;
ALTER TABLE ventas ADD COLUMN pago_transferencia INTEGER DEFAULT 0;
ALTER TABLE ventas ADD COLUMN pago_tarjeta INTEGER DEFAULT 0;

-- Los registros que ya existen pasan todo su total a la forma de pago con la que se cobraron
UPDATE alquileres SET pago_efectivo = CASE WHEN metodo_pago='efectivo' THEN total ELSE 0 END, pago_transferencia = CASE WHEN metodo_pago='transferencia' THEN total ELSE 0 END, pago_tarjeta = CASE WHEN metodo_pago='tarjeta' THEN total ELSE 0 END;

UPDATE ventas SET pago_efectivo = CASE WHEN metodo_pago='efectivo' THEN total ELSE 0 END, pago_transferencia = CASE WHEN metodo_pago='transferencia' THEN total ELSE 0 END, pago_tarjeta = CASE WHEN metodo_pago='tarjeta' THEN total ELSE 0 END;
