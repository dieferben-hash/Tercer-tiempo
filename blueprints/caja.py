from datetime import date, datetime

from flask import Blueprint, redirect, render_template, request, url_for, flash
from flask_login import login_required, current_user

import services
from extensions import db
from models import Caja

bp = Blueprint("caja", __name__, url_prefix="/caja")


@bp.route("/")
@login_required
def inicio():
    caja = services.caja_abierta()
    return render_template("caja.html", caja=caja)


@bp.route("/abrir", methods=["GET", "POST"])
@login_required
def abrir():
    if services.caja_abierta():
        flash("Ya hay una caja abierta.", "error")
        return redirect(url_for("caja.inicio"))

    if request.method == "POST":
        try:
            monto_inicial = int(request.form.get("monto_inicial", "0").replace(".", "").strip() or 0)
        except ValueError:
            monto_inicial = 0

        caja = Caja(monto_inicial=monto_inicial, usuario_apertura_id=current_user.id, estado="abierta")
        db.session.add(caja)
        db.session.commit()
        flash("Caja abierta correctamente.", "exito")
        return redirect(url_for("dashboard.inicio"))

    return render_template("caja_abrir.html")


@bp.route("/cerrar", methods=["GET", "POST"])
@login_required
def cerrar():
    caja = services.caja_abierta()
    if not caja:
        flash("No hay ninguna caja abierta para cerrar.", "error")
        return redirect(url_for("caja.inicio"))

    hoy = date.today()
    total_alquileres = services.total_alquileres_dia(hoy)
    total_kiosco = services.total_kiosco_dia(hoy)
    total_general = total_alquileres + total_kiosco
    monto_esperado = caja.monto_inicial + total_general

    if request.method == "POST":
        try:
            monto_contado = int(request.form.get("monto_contado", "0").replace(".", "").strip() or 0)
        except ValueError:
            monto_contado = 0

        caja.total_alquileres = total_alquileres
        caja.total_kiosco = total_kiosco
        caja.total_general = total_general
        caja.monto_esperado = monto_esperado
        caja.monto_contado = monto_contado
        caja.diferencia = monto_contado - monto_esperado
        caja.estado = "cerrada"
        caja.fecha_cierre = datetime.now()
        caja.usuario_cierre_id = current_user.id
        db.session.commit()
        flash("Caja cerrada correctamente.", "exito")
        return redirect(url_for("caja.historial"))

    return render_template(
        "caja_cerrar.html",
        caja=caja,
        total_alquileres=total_alquileres,
        total_kiosco=total_kiosco,
        total_general=total_general,
        monto_esperado=monto_esperado,
    )


@bp.route("/historial")
@login_required
def historial():
    cajas = Caja.query.order_by(Caja.id.desc()).all()
    return render_template("caja_historial.html", cajas=cajas)
