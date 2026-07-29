from flask import Blueprint, redirect, render_template, request, url_for, flash
from flask_login import login_required, current_user

import services
from extensions import db
from models import Producto, Venta, VentaDetalle, METODOS_PAGO

bp = Blueprint("kiosco", __name__, url_prefix="/kiosco")


@bp.route("/")
@login_required
def inicio():
    caja = services.caja_abierta()
    productos = Producto.query.filter_by(activo=True).order_by(Producto.categoria, Producto.nombre).all()
    return render_template("kiosco.html", caja=caja, productos=productos, metodos_pago=METODOS_PAGO)


@bp.route("/vender", methods=["POST"])
@login_required
def vender():
    caja = services.caja_abierta()
    if not caja:
        flash("Tenés que abrir la caja antes de registrar una venta.", "error")
        return redirect(url_for("caja.abrir"))

    metodo_pago = request.form.get("metodo_pago", "efectivo")
    if metodo_pago not in METODOS_PAGO:
        metodo_pago = "efectivo"

    productos_ids = request.form.getlist("producto_id")
    cantidades = request.form.getlist("cantidad")

    items = []
    for producto_id, cantidad_str in zip(productos_ids, cantidades):
        try:
            cantidad = int(cantidad_str)
        except ValueError:
            cantidad = 0
        if cantidad > 0:
            items.append((int(producto_id), cantidad))

    if not items:
        flash("Elegí al menos un producto con cantidad mayor a cero.", "error")
        return redirect(url_for("kiosco.inicio"))

    productos = {p.id: p for p in Producto.query.filter(Producto.id.in_([i[0] for i in items])).all()}

    for producto_id, cantidad in items:
        producto = productos.get(producto_id)
        if producto is None:
            continue
        if cantidad > producto.stock:
            flash(f"No hay stock suficiente de '{producto.nombre}' (disponible: {producto.stock}).", "error")
            return redirect(url_for("kiosco.inicio"))

    total_venta = 0
    venta = Venta(caja_id=caja.id, total=0, metodo_pago=metodo_pago, usuario_id=current_user.id)
    db.session.add(venta)
    db.session.flush()

    for producto_id, cantidad in items:
        producto = productos[producto_id]
        subtotal = producto.precio_venta * cantidad
        total_venta += subtotal
        db.session.add(
            VentaDetalle(
                venta_id=venta.id,
                producto_id=producto.id,
                cantidad=cantidad,
                precio_unitario=producto.precio_venta,
                subtotal=subtotal,
            )
        )
        services.registrar_movimiento_stock(
            producto, "salida", cantidad, f"Venta #{venta.id}", current_user.id
        )

    venta.total = total_venta
    db.session.commit()
    flash("Venta registrada correctamente.", "exito")
    return redirect(url_for("kiosco.inicio"))
