import re

ZONES = {"0": 4.5, "1": 4.5, "2": 5.0, "3": 5.0, "4": 6.25, "5": 6.25, "6": 7.0, "7": 7.0, "8": 8.5, "9": 8.5}


def _is_postcode(code):
    return re.fullmatch(r"\d{5}(?:-\d{4})?", code.strip()) is not None


def _normalize_phone(raw):
    cleaned = "".join(ch for ch in raw if ch not in " \t\n-().")
    if cleaned[:2] == "00":
        cleaned = "+" + cleaned[2:]
    if re.fullmatch(r"\+[0-9]{8,15}", cleaned) is None:
        raise ValueError(f"invalid phone number: {raw!r}")
    return cleaned


def quote_shipping(postcode: str, weight_kg: float) -> float:
    if not _is_postcode(postcode):
        raise ValueError("invalid postcode")
    if weight_kg <= 0:
        raise ValueError("weight must be positive")
    base = ZONES[postcode.strip()[0]]
    extra = max(0.0, weight_kg - 1.0) * 1.2
    return round(base + extra, 2)


def courier_contact(phone: str) -> str:
    return "courier:" + _normalize_phone(phone)
