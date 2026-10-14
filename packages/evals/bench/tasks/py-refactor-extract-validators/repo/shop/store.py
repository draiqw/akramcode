"""In-memory persistence used by the shop modules."""

CUSTOMERS: dict[str, dict] = {}
ORDERS: list[dict] = []
SUBSCRIBERS: set[str] = set()


def reset() -> None:
    CUSTOMERS.clear()
    ORDERS.clear()
    SUBSCRIBERS.clear()
