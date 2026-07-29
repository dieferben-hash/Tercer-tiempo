from datetime import date, datetime

from flask import Blueprint, redirect, render_template, request, url_for, flash
from flask_login import login_required, current_user

import services
from extensions import db
from models import Alquiler, PrecioEspacio, TIPOS_ESPACIO, METODOS_PAGO

bp = Blueprint("alquileres", __name__, url_prefix="/alquileres")


@bp.route("/")
@login_required
def inicio():
    caja = services.caja_abierta()
    precios = {p.tipo_espacio: p.precio_hora for p in PrecioEspacio.query.all()}
    hoy = date.today()
    alquileres_hoy = services.alquileres_del_dia(hoy)
    total_hoy = sum(a.total for a in alquileres_hoy)

    return render_template(
        "alquileres.html",
        caja=caja,
        precios=precios,
        tipos_espacio=TIPOS_ESPACIO,
        metodos_pago=METODOS_PAGO,
        alquileres_hoy=alquileres_hoy,
        total_hoy=total_hoy,
    )


@bp.route("/nuevo", methods=["POST"])
@login_required
def nuevo():
    caja = services.caja_abierta()
    if not caja:
        flash("Tenés que abrir la caja antes de registrar un alquiler.", "error")
        return redirect(url_for("caja.abrir"))

    tipo_espacio = request.form.get("tipo_espacio")
    if tipo_espacio not in TIPOS_ESPACIO:
        flash("Tipo de espacio inválido.", "error")
        return redirect(url_for("alquileres.inicio"))

    cliente = request.form.get("cliente", "").strip()
    hora_inicio = request.form.get("hora_inicio", "").strip()
    metodo_pago = request.form.get("metodo_pago", "efectivo")
    if metodo_pago not in METODOS_PAGO:
        metodo_pago = "efectivo"

    try:
        duracion_horas = float(request.form.get("duracion_horas", "1").replace(",", "."))
    except ValueError:
        duracion_horas = 1.0
    if duracion_horas <= 0:
        duracion_horas = 1.0

    precio_config = PrecioEspacio.query.filter_by(tipo_espacio=tipo_espacio).first()
    precio_hora = precio_config.precio_hora if precio_config else 0
    total = round(precio_hora * duracion_horas)

    alquiler = Alquiler(
        caja_id=caja.id,
        tipo_espacio=tipo_espacio,
        cliente=cliente,
        fecha=date.today(),
        hora_inicio=hora_inicio or datetime.now().strftime("%H:%M"),
        duracion_horas=duracion_horas,
        precio_hora=precio_hora,
        total=total,
        metodo_pago=metodo_pago,
        usuario_id=current_user.id,
    )
    db.session.add(alquiler)
    db.session.commit()
    flash("Alquiler registrado correctamente.", "exito")
    return redirect(url_for("alquileres.inicio"))
