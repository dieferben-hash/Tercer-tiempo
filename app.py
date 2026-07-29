import os

from flask import Flask, redirect, url_for

from config import Config
from extensions import db, login_manager
from helpers import gs
from models import (
    Configuracion,
    Producto,
    PrecioEspacio,
    Usuario,
)


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    os.makedirs(os.path.join(os.path.dirname(__file__), "instance"), exist_ok=True)

    db.init_app(app)
    login_manager.init_app(app)

    app.jinja_env.filters["gs"] = gs

    from blueprints.auth import bp as auth_bp
    from blueprints.dashboard import bp as dashboard_bp
    from blueprints.caja import bp as caja_bp
    from blueprints.alquileres import bp as alquileres_bp
    from blueprints.kiosco import bp as kiosco_bp
    from blueprints.stock import bp as stock_bp
    from blueprints.reportes import bp as reportes_bp
    from blueprints.configuracion import bp as configuracion_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(caja_bp)
    app.register_blueprint(alquileres_bp)
    app.register_blueprint(kiosco_bp)
    app.register_blueprint(stock_bp)
    app.register_blueprint(reportes_bp)
    app.register_blueprint(configuracion_bp)

    @app.route("/")
    def index():
        return redirect(url_for("dashboard.inicio"))

    @login_manager.user_loader
    def cargar_usuario(user_id):
        return db.session.get(Usuario, int(user_id))

    @app.context_processor
    def inyectar_globales():
        from datetime import date
        from flask_login import current_user
        import services

        caja_actual = None
        if current_user.is_authenticated:
            caja_actual = services.caja_abierta()
        return {"caja_actual": caja_actual, "hoy_global": date.today()}

    with app.app_context():
        db.create_all()
        _sembrar_datos_iniciales()

    return app


def _sembrar_datos_iniciales():
    if Usuario.query.count() == 0:
        admin = Usuario(nombre="Administrador", usuario="admin", rol="administrador")
        admin.set_password("admin123")
        db.session.add(admin)

    precios_por_defecto = {
        "futsal": 100000,
        "voley": 60000,
        "billar": 20000,
        "otro": 15000,
    }
    for tipo, precio in precios_por_defecto.items():
        if not PrecioEspacio.query.filter_by(tipo_espacio=tipo).first():
            db.session.add(PrecioEspacio(tipo_espacio=tipo, precio_hora=precio))

    if not Configuracion.query.filter_by(clave="nombre_negocio").first():
        db.session.add(Configuracion(clave="nombre_negocio", valor="Tercer Tiempo"))

    if Producto.query.count() == 0:
        productos_ejemplo = [
            ("Coca-Cola 500ml", "bebida_sin_alcohol", 8000, 5000, 24, 6),
            ("Agua mineral 500ml", "bebida_sin_alcohol", 5000, 3000, 24, 6),
            ("Cerveza Brahma lata", "bebida_alcoholica", 10000, 6500, 24, 6),
            ("Whisky trago", "bebida_alcoholica", 25000, 15000, 10, 3),
            ("Pancho completo", "comida_rapida", 12000, 6000, 20, 5),
            ("Hamburguesa", "comida_rapida", 18000, 9000, 15, 5),
            ("Papas fritas", "comida_rapida", 10000, 4000, 15, 5),
        ]
        for nombre, categoria, precio_venta, precio_costo, stock, stock_minimo in productos_ejemplo:
            db.session.add(
                Producto(
                    nombre=nombre,
                    categoria=categoria,
                    precio_venta=precio_venta,
                    precio_costo=precio_costo,
                    stock=stock,
                    stock_minimo=stock_minimo,
                )
            )

    db.session.commit()


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
