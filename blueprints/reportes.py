import csv
import io
from datetime import date, datetime

from flask import Blueprint, Response, render_template, request
from flask_login import login_required

from decorators import admin_required
import services
from helpers import gs
from models import Caja, ETIQUETAS_ESPACIO

bp = Blueprint("reportes", __name__, url_prefix="/reportes")


def _parsear_fecha(valor: str, defecto: date) -> date:
    try:
        return datetime.strptime(valor, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return defecto


@bp.route("/")
@login_required
@admin_required
def diario():
    fecha = _parsear_fecha(request.args.get("fecha"), date.today())

    total_alquileres = services.total_alquileres_dia(fecha)
    total_kiosco = services.total_kiosco_dia(fecha)
    total_general = total_alquileres + total_kiosco
    alquileres_por_tipo = services.alquileres_por_tipo_dia(fecha)
    productos_top = services.productos_mas_vendidos_dia(fecha)

    caja_del_dia = (
        Caja.query.filter(Caja.fecha_apertura >= datetime.combine(fecha, datetime.min.time()))
        .filter(Caja.fecha_apertura <= datetime.combine(fecha, datetime.max.time()))
        .order_by(Caja.id.desc())
        .first()
    )

    return render_template(
        "reportes_diario.html",
        fecha=fecha,
        total_alquileres=total_alquileres,
        total_kiosco=total_kiosco,
        total_general=total_general,
        alquileres_por_tipo=alquileres_por_tipo,
        etiquetas_espacio=ETIQUETAS_ESPACIO,
        productos_top=productos_top,
        caja=caja_del_dia,
    )


@bp.route("/rango")
@login_required
@admin_required
def rango():
    hoy = date.today()
    fecha_inicio = _parsear_fecha(request.args.get("fecha_inicio"), hoy)
    fecha_fin = _parsear_fecha(request.args.get("fecha_fin"), hoy)

    total_alquileres, total_kiosco = services.totales_rango(fecha_inicio, fecha_fin)
    total_general = total_alquileres + total_kiosco

    return render_template(
        "reportes_rango.html",
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        total_alquileres=total_alquileres,
        total_kiosco=total_kiosco,
        total_general=total_general,
    )


@bp.route("/exportar")
@login_required
@admin_required
def exportar():
    fecha = _parsear_fecha(request.args.get("fecha"), date.today())

    total_alquileres = services.total_alquileres_dia(fecha)
    total_kiosco = services.total_kiosco_dia(fecha)

    salida = io.StringIO()
    escritor = csv.writer(salida)
    escritor.writerow(["Reporte diario - Tercer Tiempo", fecha.strftime("%d/%m/%Y")])
    escritor.writerow([])
    escritor.writerow(["Concepto", "Total (Gs.)"])
    escritor.writerow(["Alquileres", total_alquileres])
    escritor.writerow(["Kiosco", total_kiosco])
    escritor.writerow(["Total general", total_alquileres + total_kiosco])
    escritor.writerow([])
    escritor.writerow(["Alquileres por tipo de espacio"])
    escritor.writerow(["Tipo", "Cantidad", "Total (Gs.)"])
    for tipo, cantidad, total in services.alquileres_por_tipo_dia(fecha):
        escritor.writerow([ETIQUETAS_ESPACIO.get(tipo, tipo), cantidad, total])
    escritor.writerow([])
    escritor.writerow(["Productos más vendidos"])
    escritor.writerow(["Producto", "Cantidad", "Total (Gs.)"])
    for nombre, cantidad, total in services.productos_mas_vendidos_dia(fecha, limite=100):
        escritor.writerow([nombre, cantidad, total])

    nombre_archivo = f"reporte_{fecha.isoformat()}.csv"
    return Response(
        salida.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={nombre_archivo}"},
    )
