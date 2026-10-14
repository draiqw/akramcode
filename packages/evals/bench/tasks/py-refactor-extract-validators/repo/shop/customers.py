import re

from . import store

_PHONE_STRIP = re.compile(r"[\s\-().]")


def _valid_email(value):
    value = value.strip()
    if value.count("@") != 1:
        return False
    local, domain = value.split("@")
    if not local:
        return False
    if "." not in domain or domain.startswith(".") or domain.endswith("."):
        return False
    return True


def _clean_phone(value):
    digits = _PHONE_STRIP.sub("", value)
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if not re.fullmatch(r"\+\d{8,15}", digits):
        raise ValueError(f"invalid phone number: {value!r}")
    return digits


def register_customer(name: str, email: str, phone: str) -> dict:
    if not name.strip():
        raise ValueError("name is required")
    if not _valid_email(email):
        raise ValueError("invalid email")
    customer = {"name": name.strip(), "email": email.strip().lower(), "phone": _clean_phone(phone)}
    store.CUSTOMERS[customer["email"]] = customer
    return customer


def change_contact(email: str, new_phone: str) -> dict:
    customer = store.CUSTOMERS[email.strip().lower()]
    customer["phone"] = _clean_phone(new_phone)
    return customer
