def gs(valor) -> str:
    """Formatea un monto en guaraníes: sin decimales, punto como separador de miles."""
    try:
        numero = int(round(float(valor or 0)))
    except (TypeError, ValueError):
        numero = 0
    signo = "-" if numero < 0 else ""
    numero = abs(numero)
    texto = f"{numero:,}".replace(",", ".")
    return f"{signo}₲ {texto}"
