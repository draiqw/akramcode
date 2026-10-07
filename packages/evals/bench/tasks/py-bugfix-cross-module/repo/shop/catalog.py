CATALOG = {
    "PEN": {"name": "Gel pen", "price": "1.15"},
    "NB-A5": {"name": "A5 notebook", "price": "10.05"},
    "MUG": {"name": "Coffee mug", "price": "8.35"},
    "BAG": {"name": "Tote bag", "price": "12.50"},
}


def get_price(sku, catalog=None):
    """Return the unit price of `sku` as a string like "10.05"."""
    catalog = CATALOG if catalog is None else catalog
    try:
        return catalog[sku]["price"]
    except KeyError:
        raise KeyError(f"unknown sku: {sku}") from None


def get_name(sku, catalog=None):
    catalog = CATALOG if catalog is None else catalog
    return catalog[sku]["name"]
