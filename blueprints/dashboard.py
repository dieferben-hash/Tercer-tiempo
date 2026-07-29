from datetime import date

from flask import Blueprint, render_template
from flask_login import login_required

import services

bp = Blueprint("dashboard", __name__)


@bp.route("/dashboard")
@login_required
def inicio():
    hoy = date.today()
    caja = services.caja_abierta()
    total_alquileres = services.total_alquileres_dia(hoy)
    total_kiosco = services.total_kiosco_dia(hoy)
    total_dia = total_alquileres + total_kiosco
    alertas_stock = services.productos_stock_bajo()

    return render_template(
        "dashboard.html",
        caja=caja,
        total_alquileres=total_alquileres,
        total_kiosco=total_kiosco,
        total_dia=total_dia,
        alertas_stock=alertas_stock,
        hoy=hoy,
    )
