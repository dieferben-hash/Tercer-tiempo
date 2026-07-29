from functools import wraps

from flask import abort
from flask_login import current_user


def admin_required(vista):
    @wraps(vista)
    def envoltorio(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.es_admin:
            abort(403)
        return vista(*args, **kwargs)

    return envoltorio
