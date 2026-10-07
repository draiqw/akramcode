from .money import to_amount, to_cents


def line_discount(unit_price, qty, discount_pct=0):
    gross = to_amount(unit_price) * qty
    return to_cents(gross * to_amount(discount_pct) / 100)


def line_total(unit_price, qty, discount_pct=0):
    gross = to_amount(unit_price) * qty
    return to_cents(gross - line_discount(unit_price, qty, discount_pct))
