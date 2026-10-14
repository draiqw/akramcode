from . import store
from .validators import is_valid_email, is_valid_postcode


def order_total(items: list[tuple[str, int, float]]) -> float:
    return round(sum(qty * price for _, qty, price in items), 2)


def place_order(customer_email: str, items: list[tuple[str, int, float]], postcode: str) -> dict:
    if not is_valid_email(customer_email):
        raise ValueError("invalid email")
    if not is_valid_postcode(postcode):
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
