from decimal import Decimal

from .catalog import get_name, get_price
from .money import fmt
from .pricing import line_discount, line_total
from .tax import compute_tax


def build_invoice(items, tax_rate, catalog=None):
    """Build an invoice.

    items: list of dicts with keys "sku", "qty" and optional "discount_pct".
    Returns a dict with "lines" (sku, name, qty, unit_price, discount, total),
    "subtotal", "discount", "tax" and "total"; money values are strings.
    """
    lines = []
    subtotal = Decimal("0")
    discount_sum = Decimal("0")
    for item in items:
        price = get_price(item["sku"], catalog)
        pct = item.get("discount_pct", 0)
        discount = line_discount(price, item["qty"], pct)
        total = line_total(price, item["qty"], pct)
        subtotal += total
        discount_sum += discount
        lines.append(
            {
                "sku": item["sku"],
                "name": get_name(item["sku"], catalog),
                "qty": item["qty"],
                "unit_price": fmt(price),
                "discount": fmt(discount),
                "total": fmt(total),
            }
        )
    tax = compute_tax(subtotal, tax_rate)
    return {
        "lines": lines,
        "subtotal": fmt(subtotal),
        "discount": fmt(discount_sum),
        "tax": fmt(tax),
        "total": fmt(subtotal + tax),
    }
