"""Parser for deploy/*.env files (KEY=VALUE, optional `export`, # comments, optional quotes)."""


def parse_env_file(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        result[key.strip()] = value
    return result


def read_env_file(path: str) -> dict[str, str]:
    with open(path, encoding="utf-8") as fh:
        return parse_env_file(fh.read())
