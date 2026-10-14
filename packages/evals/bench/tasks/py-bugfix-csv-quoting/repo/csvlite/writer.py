QUOTE = '"'


def format_field(value, delimiter=","):
    text = str(value)
    if delimiter in text or QUOTE in text or "\n" in text:
        return QUOTE + text.replace(QUOTE, QUOTE * 2) + QUOTE
    return text


def format_line(values, delimiter=","):
    """Format values as one CSV line (quoting where needed)."""
    return delimiter.join(format_field(value, delimiter) for value in values)
