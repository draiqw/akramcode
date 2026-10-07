from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def to_amount(value):
    """Convert a price given as str/int/Decimal into a Decimal."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    return Decimal(value)


def to_cents(amount):
    return amount.quantize(CENT, rounding=ROUND_HALF_UP)


def fmt(amount):
    """Format an amount with two decimals."""
    return str(to_cents(to_amount(amount)))
