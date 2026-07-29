from datetime import datetime, date

from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

from extensions import db

ROLES = ("administrador", "cajero")

TIPOS_ESPACIO = ("futsal", "voley", "billar", "otro")
ETIQUETAS_ESPACIO = {
    "futsal": "Futsal / Fútbol",
    "voley": "Vóley",
    "billar": "Billar",
    "otro": "Otros juegos",
}

CATEGORIAS_PRODUCTO = ("bebida_sin_alcohol", "bebida_alcoholica", "comida_rapida", "otro")
ETIQUETAS_CATEGORIA = {
    "bebida_sin_alcohol": "Bebida sin alcohol",
    "bebida_alcoholica": "Bebida alcohólica",
    "comida_rapida": "Comida rápida",
    "otro": "Otro",
}

METODOS_PAGO = ("efectivo", "transferencia", "tarjeta")
ETIQUETAS_PAGO = {
    "efectivo": "Efectivo",
    "transferencia": "Transferencia",
    "tarjeta": "Tarjeta",
}


class Usuario(UserMixin, db.Model):
    __tablename__ = "usuarios"

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(120), nullable=False)
    usuario = db.Column(db.String(60), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    rol = db.Column(db.String(20), nullable=False, default="cajero")
    activo = db.Column(db.Boolean, nullable=False, default=True)
    creado_en = db.Column(db.DateTime, default=datetime.now)

    def set_password(self, password: str):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    @property
    def es_admin(self) -> bool:
        return self.rol == "administrador"


class PrecioEspacio(db.Model):
    __tablename__ = "precios_espacio"

    id = db.Column(db.Integer, primary_key=True)
    tipo_espacio = db.Column(db.String(20), unique=True, nullable=False)
    precio_hora = db.Column(db.Integer, nullable=False, default=0)

    @property
    def etiqueta(self):
        return ETIQUETAS_ESPACIO.get(self.tipo_espacio, self.tipo_espacio)


class Configuracion(db.Model):
    __tablename__ = "configuracion"

    id = db.Column(db.Integer, primary_key=True)
    clave = db.Column(db.String(60), unique=True, nullable=False)
    valor = db.Column(db.String(255), nullable=False, default="")


class Producto(db.Model):
    __tablename__ = "productos"

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(120), nullable=False)
    categoria = db.Column(db.String(30), nullable=False, default="otro")
    precio_venta = db.Column(db.Integer, nullable=False, default=0)
    precio_costo = db.Column(db.Integer, nullable=True, default=0)
    stock = db.Column(db.Integer, nullable=False, default=0)
    stock_minimo = db.Column(db.Integer, nullable=False, default=5)
    activo = db.Column(db.Boolean, nullable=False, default=True)

    @property
    def etiqueta_categoria(self):
        return ETIQUETAS_CATEGORIA.get(self.categoria, self.categoria)

    @property
    def stock_bajo(self) -> bool:
        return self.stock <= self.stock_minimo


class MovimientoStock(db.Model):
    __tablename__ = "movimientos_stock"

    id = db.Column(db.Integer, primary_key=True)
    producto_id = db.Column(db.Integer, db.ForeignKey("productos.id"), nullable=False)
    tipo = db.Column(db.String(10), nullable=False)  # entrada | salida
    cantidad = db.Column(db.Integer, nullable=False)
    motivo = db.Column(db.String(255), nullable=True, default="")
    fecha = db.Column(db.DateTime, default=datetime.now)
    usuario_id = db.Column(db.Integer, db.ForeignKey("usuarios.id"), nullable=True)

    producto = db.relationship("Producto", backref="movimientos")
    usuario = db.relationship("Usuario")


class Caja(db.Model):
    __tablename__ = "cajas"

    id = db.Column(db.Integer, primary_key=True)
    fecha_apertura = db.Column(db.DateTime, default=datetime.now)
    monto_inicial = db.Column(db.Integer, nullable=False, default=0)
    usuario_apertura_id = db.Column(db.Integer, db.ForeignKey("usuarios.id"), nullable=True)

    estado = db.Column(db.String(10), nullable=False, default="abierta")  # abierta | cerrada
    fecha_cierre = db.Column(db.DateTime, nullable=True)
    usuario_cierre_id = db.Column(db.Integer, db.ForeignKey("usuarios.id"), nullable=True)

    total_alquileres = db.Column(db.Integer, nullable=True, default=0)
    total_kiosco = db.Column(db.Integer, nullable=True, default=0)
    total_general = db.Column(db.Integer, nullable=True, default=0)
    monto_esperado = db.Column(db.Integer, nullable=True, default=0)
    monto_contado = db.Column(db.Integer, nullable=True)
    diferencia = db.Column(db.Integer, nullable=True)

    usuario_apertura = db.relationship("Usuario", foreign_keys=[usuario_apertura_id])
    usuario_cierre = db.relationship("Usuario", foreign_keys=[usuario_cierre_id])

    @property
    def esta_abierta(self) -> bool:
        return self.estado == "abierta"


class Alquiler(db.Model):
    __tablename__ = "alquileres"

    id = db.Column(db.Integer, primary_key=True)
    caja_id = db.Column(db.Integer, db.ForeignKey("cajas.id"), nullable=False)
    tipo_espacio = db.Column(db.String(20), nullable=False)
    cliente = db.Column(db.String(120), nullable=True, default="")
    fecha = db.Column(db.Date, default=date.today)
    hora_inicio = db.Column(db.String(5), nullable=False)  # HH:MM
    duracion_horas = db.Column(db.Float, nullable=False, default=1.0)
    precio_hora = db.Column(db.Integer, nullable=False, default=0)
    total = db.Column(db.Integer, nullable=False, default=0)
    metodo_pago = db.Column(db.String(20), nullable=False, default="efectivo")
    usuario_id = db.Column(db.Integer, db.ForeignKey("usuarios.id"), nullable=True)
    fecha_registro = db.Column(db.DateTime, default=datetime.now)

    caja = db.relationship("Caja", backref="alquileres")
    usuario = db.relationship("Usuario")

    @property
    def etiqueta_espacio(self):
        return ETIQUETAS_ESPACIO.get(self.tipo_espacio, self.tipo_espacio)


class Venta(db.Model):
    __tablename__ = "ventas"

    id = db.Column(db.Integer, primary_key=True)
    caja_id = db.Column(db.Integer, db.ForeignKey("cajas.id"), nullable=False)
    fecha = db.Column(db.DateTime, default=datetime.now)
    total = db.Column(db.Integer, nullable=False, default=0)
    metodo_pago = db.Column(db.String(20), nullable=False, default="efectivo")
    usuario_id = db.Column(db.Integer, db.ForeignKey("usuarios.id"), nullable=True)

    caja = db.relationship("Caja", backref="ventas")
    usuario = db.relationship("Usuario")


class VentaDetalle(db.Model):
    __tablename__ = "venta_detalles"

    id = db.Column(db.Integer, primary_key=True)
    venta_id = db.Column(db.Integer, db.ForeignKey("ventas.id"), nullable=False)
    producto_id = db.Column(db.Integer, db.ForeignKey("productos.id"), nullable=False)
    cantidad = db.Column(db.Integer, nullable=False)
    precio_unitario = db.Column(db.Integer, nullable=False)
    subtotal = db.Column(db.Integer, nullable=False)

    venta = db.relationship("Venta", backref="detalles")
    producto = db.relationship("Producto")
