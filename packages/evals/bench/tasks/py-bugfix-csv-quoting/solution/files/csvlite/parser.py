QUOTE = '"'


def parse_line(line, delimiter=","):
    """Split one CSV line into fields, honouring double-quoted fields."""
    fields = []
    i = 0
    n = len(line)
    while True:
        if i < n and line[i] == QUOTE:
            i += 1
            buf = []
            while True:
                if i >= n:
                    raise ValueError("unterminated quoted field")
                ch = line[i]
                if ch == QUOTE:
                    if i + 1 < n and line[i + 1] == QUOTE:
                        buf.append(QUOTE)
                        i += 2
                        continue
                    i += 1
                    break
                buf.append(ch)
                i += 1
            fields.append("".join(buf))
            if i == n:
                return fields
            if line[i] != delimiter:
                raise ValueError(f"unexpected character after closing quote at position {i}")
            i += 1
        else:
            end = line.find(delimiter, i)
            if end == -1:
                fields.append(line[i:])
                return fields
            fields.append(line[i:end])
            i = end + 1
