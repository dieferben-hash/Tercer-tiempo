from flask import Blueprint, redirect, render_template, request, url_for, flash
from flask_login import login_user, logout_user, login_required, current_user

from models import Usuario

bp = Blueprint("auth", __name__)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("dashboard.inicio"))

    if request.method == "POST":
        usuario_input = request.form.get("usuario", "").strip()
        password = request.form.get("password", "")

        usuario = Usuario.query.filter_by(usuario=usuario_input).first()
        if usuario and usuario.activo and usuario.check_password(password):
            login_user(usuario)
            siguiente = request.args.get("next")
            return redirect(siguiente or url_for("dashboard.inicio"))

        flash("Usuario o contraseña incorrectos.", "error")

    return render_template("login.html")


@bp.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("auth.login"))
