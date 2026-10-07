import os, re

for top in ("src", "test"):
    for dirpath, _, files in os.walk(top):
        for name in files:
            if not name.endswith(".ts"):
                continue
            p = os.path.join(dirpath, name)
            s = open(p).read()
            n = re.sub(r"\bfetchUserData\b", "loadUser", s)
            if n != s:
                open(p, "w").write(n)
