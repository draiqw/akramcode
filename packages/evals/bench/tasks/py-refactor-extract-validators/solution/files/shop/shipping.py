from .validators import is_valid_postcode, normalize_phone

ZONES = {"0": 4.5, "1": 4.5, "2": 5.0, "3": 5.0, "4": 6.25, "5": 6.25, "6": 7.0, "7": 7.0, "8": 8.5, "9": 8.5}


def quote_shipping(postcode: str, weight_kg: float) -> float:
    if not is_valid_postcode(postcode):
        raise ValueError("invalid postcode")
    if weight_kg <= 0:
        raise ValueError("weight must be positive")
    base = ZONES[postcode.strip()[0]]
    extra = max(0.0, weight_kg - 1.0) * 1.2
    return round(base + extra, 2)


def courier_contact(phone: str) -> str:
    return "courier:" + normalize_phone(phone)
