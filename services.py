from datetime import date, datetime, time

from sqlalchemy import func

from extensions import db
from models import Alquiler, Caja, MovimientoStock, Producto, Venta, VentaDetalle


def caja_abierta() -> Caja | None:
    return Caja.query.filter_by(estado="abierta").order_by(Caja.id.desc()).first()


def _rango_dia(fecha: date):
    inicio = datetime.combine(fecha, time.min)
    fin = datetime.combine(fecha, time.max)
    return inicio, fin


def total_alquileres_dia(fecha: date) -> int:
    inicio, fin = _rango_dia(fecha)
    total = (
        db.session.query(func.coalesce(func.sum(Alquiler.total), 0))
        .filter(Alquiler.fecha_registro >= inicio, Alquiler.fecha_registro <= fin)
        .scalar()
    )
    return int(total or 0)


def total_kiosco_dia(fecha: date) -> int:
    inicio, fin = _rango_dia(fecha)
    total = (
        db.session.query(func.coalesce(func.sum(Venta.total), 0))
        .filter(Venta.fecha >= inicio, Venta.fecha <= fin)
        .scalar()
    )
    return int(total or 0)


def alquileres_del_dia(fecha: date):
    inicio, fin = _rango_dia(fecha)
    return (
        Alquiler.query.filter(Alquiler.fecha_registro >= inicio, Alquiler.fecha_registro <= fin)
        .order_by(Alquiler.fecha_registro.desc())
        .all()
    )


def ventas_del_dia(fecha: date):
    inicio, fin = _rango_dia(fecha)
    return (
        Venta.query.filter(Venta.fecha >= inicio, Venta.fecha <= fin)
        .order_by(Venta.fecha.desc())
        .all()
    )


def alquileres_por_tipo_dia(fecha: date):
    inicio, fin = _rango_dia(fecha)
    filas = (
        db.session.query(Alquiler.tipo_espacio, func.count(Alquiler.id), func.coalesce(func.sum(Alquiler.total), 0))
        .filter(Alquiler.fecha_registro >= inicio, Alquiler.fecha_registro <= fin)
        .group_by(Alquiler.tipo_espacio)
        .all()
    )
    return filas


def productos_mas_vendidos_dia(fecha: date, limite: int = 5):
    inicio, fin = _rango_dia(fecha)
    filas = (
        db.session.query(
            Producto.nombre,
            func.coalesce(func.sum(VentaDetalle.cantidad), 0).label("cantidad"),
            func.coalesce(func.sum(VentaDetalle.subtotal), 0).label("total"),
        )
        .join(Venta, VentaDetalle.venta_id == Venta.id)
        .join(Producto, VentaDetalle.producto_id == Producto.id)
        .filter(Venta.fecha >= inicio, Venta.fecha <= fin)
        .group_by(Producto.id)
        .order_by(func.sum(VentaDetalle.cantidad).desc())
        .limit(limite)
        .all()
    )
    return filas


def productos_stock_bajo():
    return Producto.query.filter(Producto.activo.is_(True), Producto.stock <= Producto.stock_minimo).all()


def registrar_movimiento_stock(producto: Producto, tipo: str, cantidad: int, motivo: str, usuario_id: int | None):
    if tipo == "entrada":
        producto.stock += cantidad
    else:
        producto.stock -= cantidad
    movimiento = MovimientoStock(
        producto_id=producto.id, tipo=tipo, cantidad=cantidad, motivo=motivo, usuario_id=usuario_id
    )
    db.session.add(movimiento)


def totales_rango(fecha_inicio: date, fecha_fin: date):
    inicio = datetime.combine(fecha_inicio, time.min)
    fin = datetime.combine(fecha_fin, time.max)

    total_alquileres = (
        db.session.query(func.coalesce(func.sum(Alquiler.total), 0))
        .filter(Alquiler.fecha_registro >= inicio, Alquiler.fecha_registro <= fin)
        .scalar()
    )
    total_kiosco = (
        db.session.query(func.coalesce(func.sum(Venta.total), 0))
        .filter(Venta.fecha >= inicio, Venta.fecha <= fin)
        .scalar()
    )
    return int(total_alquileres or 0), int(total_kiosco or 0)
