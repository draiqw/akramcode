import re

from . import store

is_email = lambda s: (  # noqa: E731
    s.strip().count("@") == 1
    and bool(s.strip().split("@")[0])
    and "." in s.strip().split("@")[1]
    and not s.strip().split("@")[1].startswith(".")
    and not s.strip().split("@")[1].endswith(".")
)


def _sms_number(value):
    value = re.sub(r"[\s\-().]", "", value)
    if value.startswith("00"):
        value = "+" + value[2:]
    if not re.fullmatch(r"\+\d{8,15}", value):
        raise ValueError(f"invalid phone number: {value!r}")
    return value


def subscribe(email: str) -> bool:
    if not is_email(email):
        return False
    store.SUBSCRIBERS.add(email.strip().lower())
    return True


def subscribe_sms(phone: str) -> str:
    number = _sms_number(phone)
    store.SUBSCRIBERS.add("sms:" + number)
    return number


def subscriber_count() -> int:
    return len(store.SUBSCRIBERS)
