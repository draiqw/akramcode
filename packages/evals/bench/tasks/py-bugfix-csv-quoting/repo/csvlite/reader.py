from .parser import parse_line


def read_records(text, delimiter=","):
    """Parse text with a header line into a list of dicts. Blank lines are skipped."""
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return []
    header = parse_line(lines[0], delimiter)
    records = []
    for number, line in enumerate(lines[1:], start=2):
        values = parse_line(line, delimiter)
        if len(values) != len(header):
            raise ValueError(f"line {number}: expected {len(header)} fields, got {len(values)}")
        records.append(dict(zip(header, values)))
    return records
