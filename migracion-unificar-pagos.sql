-- ============================================================
--  Tercer Tiempo - Unificacion de columnas de pago
--
--  Quedaron dos juegos de columnas para lo mismo:
--    pago_efectivo  / pago_transferencia  / pago_tarjeta   (esta version)
--    monto_efectivo / monto_transferencia / monto_tarjeta  (version del 06/08)
--
--  Esto pasa todo lo que este en monto_* hacia pago_*, sin pisar lo que ya
--  tenga valor en pago_*. Las columnas monto_* NO se borran: quedan como
--  respaldo por si hay que revisar algo.
--
--  Ejecutar UNA SOLA VEZ. En la consola de D1, una sentencia por vez.
-- ============================================================

-- Alquileres: si pago_* esta en cero pero monto_* tiene datos, se copia
UPDATE alquileres
SET pago_efectivo      = COALESCE(monto_efectivo, 0),
    pago_transferencia = COALESCE(monto_transferencia, 0),
    pago_tarjeta       = COALESCE(monto_tarjeta, 0)
WHERE COALESCE(pago_efectivo,0) + COALESCE(pago_transferencia,0) + COALESCE(pago_tarjeta,0) = 0
  AND COALESCE(monto_efectivo,0) + COALESCE(monto_transferencia,0) + COALESCE(monto_tarjeta,0) > 0;

-- Ventas de kiosco: mismo criterio
UPDATE ventas
SET pago_efectivo      = COALESCE(monto_efectivo, 0),
    pago_transferencia = COALESCE(monto_transferencia, 0),
    pago_tarjeta       = COALESCE(monto_tarjeta, 0)
WHERE COALESCE(pago_efectivo,0) + COALESCE(pago_transferencia,0) + COALESCE(pago_tarjeta,0) = 0
  AND COALESCE(monto_efectivo,0) + COALESCE(monto_transferencia,0) + COALESCE(monto_tarjeta,0) > 0;

-- Red de seguridad: filas sin reparto en ningun lado (cargadas por versiones
-- que solo guardaban metodo_pago) se reparten segun ese metodo.
UPDATE alquileres
SET pago_efectivo      = CASE WHEN metodo_pago='efectivo'      THEN total ELSE 0 END,
    pago_transferencia = CASE WHEN metodo_pago='transferencia' THEN total ELSE 0 END,
    pago_tarjeta       = CASE WHEN metodo_pago='tarjeta'       THEN total ELSE 0 END
WHERE COALESCE(pago_efectivo,0) + COALESCE(pago_transferencia,0) + COALESCE(pago_tarjeta,0) = 0
  AND metodo_pago IN ('efectivo','transferencia','tarjeta');

UPDATE ventas
SET pago_efectivo      = CASE WHEN metodo_pago='efectivo'      THEN total ELSE 0 END,
    pago_transferencia = CASE WHEN metodo_pago='transferencia' THEN total ELSE 0 END,
    pago_tarjeta       = CASE WHEN metodo_pago='tarjeta'       THEN total ELSE 0 END
WHERE COALESCE(pago_efectivo,0) + COALESCE(pago_transferencia,0) + COALESCE(pago_tarjeta,0) = 0
  AND metodo_pago IN ('efectivo','transferencia','tarjeta');

-- Control final: ninguna fila deberia quedar con reparto en cero teniendo total > 0.
-- SELECT 'alquileres' AS tabla, COUNT(*) AS sin_reparto FROM alquileres
--  WHERE total > 0 AND COALESCE(pago_efectivo,0)+COALESCE(pago_transferencia,0)+COALESCE(pago_tarjeta,0) = 0
-- UNION ALL SELECT 'ventas', COUNT(*) FROM ventas
--  WHERE total > 0 AND COALESCE(pago_efectivo,0)+COALESCE(pago_transferencia,0)+COALESCE(pago_tarjeta,0) = 0;
