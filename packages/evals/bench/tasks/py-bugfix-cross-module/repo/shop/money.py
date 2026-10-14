def to_amount(value):
    """Convert a price given as str/int/float into a number."""
    return float(value)


def fmt(amount):
    """Format an amount with two decimals."""
    return f"{amount:.2f}"
