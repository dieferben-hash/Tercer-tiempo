from flask import Blueprint, redirect, render_template, request, url_for, flash
from flask_login import login_required

from decorators import admin_required
from extensions import db
from models import PrecioEspacio, ROLES, TIPOS_ESPACIO, Usuario

bp = Blueprint("configuracion", __name__, url_prefix="/configuracion")


@bp.route("/")
@login_required
@admin_required
def inicio():
    precios = {p.tipo_espacio: p for p in PrecioEspacio.query.all()}
    return render_template("configuracion.html", precios=precios, tipos_espacio=TIPOS_ESPACIO)


@bp.route("/precios", methods=["POST"])
@login_required
@admin_required
def actualizar_precios():
    for tipo in TIPOS_ESPACIO:
        precio_config = PrecioEspacio.query.filter_by(tipo_espacio=tipo).first()
        if precio_config is None:
            continue
        valor = request.form.get(f"precio_{tipo}", "0").replace(".", "").strip()
        try:
            precio_config.precio_hora = int(valor or 0)
        except ValueError:
            pass
    db.session.commit()
    flash("Precios actualizados correctamente.", "exito")
    return redirect(url_for("configuracion.inicio"))


@bp.route("/usuarios")
@login_required
@admin_required
def usuarios():
    lista = Usuario.query.order_by(Usuario.nombre).all()
    return render_template("usuarios.html", usuarios=lista, roles=ROLES)


@bp.route("/usuarios/nuevo", methods=["GET", "POST"])
@login_required
@admin_required
def usuario_nuevo():
    if request.method == "POST":
        nombre = request.form.get("nombre", "").strip()
        usuario_login = request.form.get("usuario", "").strip()
        password = request.form.get("password", "")
        rol = request.form.get("rol", "cajero")
        if rol not in ROLES:
            rol = "cajero"

        if not nombre or not usuario_login or not password:
            flash("Completá todos los campos.", "error")
            return render_template("usuario_form.html", usuario=None, roles=ROLES)

        if Usuario.query.filter_by(usuario=usuario_login).first():
            flash("Ya existe un usuario con ese nombre de acceso.", "error")
            return render_template("usuario_form.html", usuario=None, roles=ROLES)

        nuevo_usuario = Usuario(nombre=nombre, usuario=usuario_login, rol=rol)
        nuevo_usuario.set_password(password)
        db.session.add(nuevo_usuario)
        db.session.commit()
        flash("Usuario creado correctamente.", "exito")
        return redirect(url_for("configuracion.usuarios"))

    return render_template("usuario_form.html", usuario=None, roles=ROLES)


@bp.route("/usuarios/<int:usuario_id>/editar", methods=["GET", "POST"])
@login_required
@admin_required
def usuario_editar(usuario_id):
    usuario = Usuario.query.get_or_404(usuario_id)

    if request.method == "POST":
        usuario.nombre = request.form.get("nombre", "").strip()
        rol = request.form.get("rol", "cajero")
        usuario.rol = rol if rol in ROLES else "cajero"
        usuario.activo = bool(request.form.get("activo"))

        password = request.form.get("password", "")
        if password:
            usuario.set_password(password)

        db.session.commit()
        flash("Usuario actualizado correctamente.", "exito")
        return redirect(url_for("configuracion.usuarios"))

    return render_template("usuario_form.html", usuario=usuario, roles=ROLES)
