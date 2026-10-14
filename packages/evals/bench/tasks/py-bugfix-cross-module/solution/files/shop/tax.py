from .money import to_amount, to_cents


def compute_tax(amount, rate):
    return to_cents(to_amount(amount) * to_amount(rate))
