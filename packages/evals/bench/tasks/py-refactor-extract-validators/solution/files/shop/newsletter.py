from . import store
from .validators import is_valid_email, normalize_phone


def subscribe(email: str) -> bool:
    if not is_valid_email(email):
        return False
    store.SUBSCRIBERS.add(email.strip().lower())
    return True


def subscribe_sms(phone: str) -> str:
    number = normalize_phone(phone)
    store.SUBSCRIBERS.add("sms:" + number)
    return number


def subscriber_count() -> int:
    return len(store.SUBSCRIBERS)
