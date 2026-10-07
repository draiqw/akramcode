from . import store
from .validators import is_valid_email, normalize_phone


def register_customer(name: str, email: str, phone: str) -> dict:
    if not name.strip():
        raise ValueError("name is required")
    if not is_valid_email(email):
        raise ValueError("invalid email")
    customer = {"name": name.strip(), "email": email.strip().lower(), "phone": normalize_phone(phone)}
    store.CUSTOMERS[customer["email"]] = customer
    return customer


def change_contact(email: str, new_phone: str) -> dict:
    customer = store.CUSTOMERS[email.strip().lower()]
    customer["phone"] = normalize_phone(new_phone)
    return customer
