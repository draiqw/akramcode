import re

from .context import MISSING, resolve
from .errors import TemplateError

TAG = re.compile(r'\{\{\s*([\w.]+)((?:\s*\|\s*\w+(?::"[^"|]*")?)*)\s*\}\}')
FILTER = re.compile(r'\s*\|\s*(\w+)(?::"([^"|]*)")?')


def _apply(name, arg, value):
    if name == "upper":
        return value if value is MISSING else str(value).upper()
    if name == "lower":
        return value if value is MISSING else str(value).lower()
    if name == "default":
        return arg if value is MISSING or value is None or value == "" else value
    raise TemplateError(f"unknown filter: {name}")


def _to_text(value):
    if value is MISSING or value is None:
        return ""
    return str(value)


def render(template, context):
    """Render `template`, replacing {{ path|filter }} tags with values from `context`."""

    def replace(match):
        value = resolve(match.group(1), context)
        for name, arg in FILTER.findall(match.group(2)):
            value = _apply(name, arg, value)
        return _to_text(value)

    return TAG.sub(replace, template)
