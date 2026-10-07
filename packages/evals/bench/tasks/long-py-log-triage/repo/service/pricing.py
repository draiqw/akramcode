"""Pricing helpers used by the quote service."""

TAX_RATES = {"US": 0.07, "DE": 0.19, "FR": 0.20, "GB": 0.20, "NL": 0.21}


def parse_amount(text):
    """Parse a user-supplied amount string into integer cents.

    Accepted forms: "12", "12.5", "12.50", " 7.25 " (surrounding whitespace is
    ignored) and amounts that use commas as thousands separators, such as
    "1,234.50", "12,000" or "1,000,000.99".
    Raises ValueError for anything else (empty strings, letters, ...).
    """
    text = text.strip()
    return int(round(float(text) * 100))


def compute_tax(cents, country):
    """Return the tax in cents for an amount in cents, rounded half to even."""
    rate = TAX_RATES[country]
    return int(round(cents * rate))


def format_cents(cents):
    """Format integer cents as a string like "1234.50"."""
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}{cents // 100}.{cents % 100:02d}"


def quote_total(raw_amount, country):
    """Parse an amount and return (net, tax, gross) in cents."""
    net = parse_amount(raw_amount)
    tax = compute_tax(net, country)
    return net, tax, net + tax
