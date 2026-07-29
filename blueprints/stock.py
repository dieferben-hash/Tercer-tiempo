from flask import Blueprint, redirect, render_template, request, url_for, flash
from flask_login import login_required, current_user

from decorators import admin_required
from extensions import db
import services
from models import CATEGORIAS_PRODUCTO, MovimientoStock, Producto

bp = Blueprint("stock", __name__, url_prefix="/stock")


@bp.route("/")
@login_required
def inicio():
    productos = Producto.query.filter_by(activo=True).order_by(Producto.categoria, Producto.nombre).all()
    return render_template("stock.html", productos=productos, categorias=CATEGORIAS_PRODUCTO)


@bp.route("/nuevo", methods=["GET", "POST"])
@login_required
@admin_required
def nuevo():
    if request.method == "POST":
        producto = Producto(
            nombre=request.form.get("nombre", "").strip(),
            categoria=request.form.get("categoria", "otro"),
            precio_venta=_a_entero(request.form.get("precio_venta")),
            precio_costo=_a_entero(request.form.get("precio_costo")),
            stock=_a_entero(request.form.get("stock")),
            stock_minimo=_a_entero(request.form.get("stock_minimo", "5")),
        )
        db.session.add(producto)
        db.session.commit()
        flash("Producto creado correctamente.", "exito")
        return redirect(url_for("stock.inicio"))

    return render_template("stock_form.html", producto=None, categorias=CATEGORIAS_PRODUCTO)


@bp.route("/<int:producto_id>/editar", methods=["GET", "POST"])
@login_required
@admin_required
def editar(producto_id):
    producto = Producto.query.get_or_404(producto_id)

    if request.method == "POST":
        producto.nombre = request.form.get("nombre", "").strip()
        producto.categoria = request.form.get("categoria", "otro")
        producto.precio_venta = _a_entero(request.form.get("precio_venta"))
        producto.precio_costo = _a_entero(request.form.get("precio_costo"))
        producto.stock_minimo = _a_entero(request.form.get("stock_minimo", "5"))
        db.session.commit()
        flash("Producto actualizado correctamente.", "exito")
        return redirect(url_for("stock.inicio"))

    return render_template("stock_form.html", producto=producto, categorias=CATEGORIAS_PRODUCTO)


@bp.route("/<int:producto_id>/eliminar", methods=["POST"])
@login_required
@admin_required
def eliminar(producto_id):
    producto = Producto.query.get_or_404(producto_id)
    producto.activo = False
    db.session.commit()
    flash("Producto eliminado.", "exito")
    return redirect(url_for("stock.inicio"))


@bp.route("/<int:producto_id>/reponer", methods=["POST"])
@login_required
@admin_required
def reponer(producto_id):
    producto = Producto.query.get_or_404(producto_id)
    cantidad = _a_entero(request.form.get("cantidad"))
    motivo = request.form.get("motivo", "Reposición de stock").strip()

    if cantidad <= 0:
        flash("Ingresá una cantidad válida para reponer.", "error")
        return redirect(url_for("stock.inicio"))

    services.registrar_movimiento_stock(producto, "entrada", cantidad, motivo, current_user.id)
    db.session.commit()
    flash(f"Se repusieron {cantidad} unidades de '{producto.nombre}'.", "exito")
    return redirect(url_for("stock.inicio"))


@bp.route("/movimientos")
@login_required
@admin_required
def movimientos():
    movimientos = MovimientoStock.query.order_by(MovimientoStock.fecha.desc()).limit(200).all()
    return render_template("stock_movimientos.html", movimientos=movimientos)


def _a_entero(valor) -> int:
    try:
        return int(str(valor).replace(".", "").strip() or 0)
    except (TypeError, ValueError):
        return 0
