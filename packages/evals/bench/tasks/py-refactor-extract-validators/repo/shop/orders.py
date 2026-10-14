import re

from . import store

POSTCODE_RE = re.compile(r"^\d{5}(-\d{4})?$")


def _email_ok(addr: str) -> bool:
    addr = addr.strip()
    parts = addr.split("@")
    if len(parts) != 2:
        return False
    user, host = parts
    return bool(user) and "." in host and not host.startswith(".") and not host.endswith(".")


def _postcode_ok(code: str) -> bool:
    return bool(POSTCODE_RE.match(code.strip()))


def order_total(items: list[tuple[str, int, float]]) -> float:
    return round(sum(qty * price for _, qty, price in items), 2)


def place_order(customer_email: str, items: list[tuple[str, int, float]], postcode: str) -> dict:
    if not _email_ok(customer_email):
        raise ValueError("invalid email")
    if not _postcode_ok(postcode):
        raise ValueError("invalid postcode")
    if not items:
        raise ValueError("empty order")
    order = {
        "id": len(store.ORDERS) + 1,
        "email": customer_email.strip().lower(),
        "postcode": postcode.strip(),
        "total": order_total(items),
    }
    store.ORDERS.append(order)
    return order
