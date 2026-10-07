import re

from .context import MISSING, resolve

TAG = re.compile(r"\{\{\s*([\w.]+)\s*\}\}")


def _to_text(value):
    if value is MISSING or value is None:
        return ""
    return str(value)


def render(template, context):
    """Render `template`, replacing {{ path }} tags with values from `context`."""

    def replace(match):
        return _to_text(resolve(match.group(1), context))

    return TAG.sub(replace, template)
