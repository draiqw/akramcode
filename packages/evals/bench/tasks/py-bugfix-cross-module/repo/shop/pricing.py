from .money import to_amount


def line_discount(unit_price, qty, discount_pct=0):
    gross = to_amount(unit_price) * qty
    return round(gross * to_amount(discount_pct) / 100, 2)


def line_total(unit_price, qty, discount_pct=0):
    gross = to_amount(unit_price) * qty
    return round(gross - line_discount(unit_price, qty, discount_pct), 2)
