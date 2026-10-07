"""Request handlers for the quote service."""

from service.pricing import format_cents, quote_total


class UpstreamError(Exception):
    pass


def handle_quote(request):
    """Handle a quote request: {"amount": "12.50", "country": "DE"}."""
    raw = request["amount"]
    country = request.get("country", "US")
    net, tax, gross = quote_total(raw, country)
    return {
        "net": format_cents(net),
        "tax": format_cents(tax),
        "gross": format_cents(gross),
    }
