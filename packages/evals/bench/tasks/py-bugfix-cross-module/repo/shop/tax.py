from .money import to_amount


def compute_tax(amount, rate):
    return round(to_amount(amount) * to_amount(rate), 2)
