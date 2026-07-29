import os

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "tercer-tiempo-clave-secreta-cambiar")
    SQLALCHEMY_DATABASE_URI = "sqlite:///" + os.path.join(BASE_DIR, "instance", "tercer_tiempo.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
