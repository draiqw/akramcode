QUOTE = '"'


def parse_line(line, delimiter=","):
    """Split one CSV line into fields, honouring double-quoted fields."""
    fields = []
    for raw in line.split(delimiter):
        if len(raw) >= 2 and raw[0] == QUOTE and raw[-1] == QUOTE:
            raw = raw[1:-1]
        fields.append(raw)
    return fields
