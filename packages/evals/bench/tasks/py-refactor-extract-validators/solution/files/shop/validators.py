"""Shared validation helpers."""

import re

_PHONE_STRIP = re.compile(r"[\s\-().]")
_POSTCODE_RE = re.compile(r"\d{5}(?:-\d{4})?")


def is_valid_email(value: str) -> bool:
    value = value.strip()
    if value.count("@") != 1:
        return False
    local, domain = value.split("@")
    if not local:
        return False
    return "." in domain and not domain.startswith(".") and not domain.endswith(".")


def normalize_phone(value: str) -> str:
    digits = _PHONE_STRIP.sub("", value)
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if not re.fullmatch(r"\+\d{8,15}", digits):
        raise ValueError(f"invalid phone number: {value!r}")
    return digits


def is_valid_postcode(value: str) -> bool:
    return _POSTCODE_RE.fullmatch(value.strip()) is not None
