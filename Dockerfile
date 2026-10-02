FROM debian:13.4@sha256:e2d08da6f42ef4b09b165d55528a12727aeed8240dc9edf888e3ec07e10ef9da AS sqlite_build
ARG SQLITE_AUTOCONF_VERSION=3530400
ARG SQLITE_SHA256=0e9483900e92cd5de8fd48d16bf9200145a61f7fd5be542a5ac81d8a9516eb9c
RUN apt-get -o Acquire::Retries=3 update && \
    apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
        build-essential ca-certificates curl && \
    rm -rf /var/lib/apt/lists/* && \
    (curl -fsSL --retry 1 --retry-all-errors --connect-timeout 15 --max-time 60 \
        -o /tmp/sqlite.tar.gz \
        "https://sqlite.org/2026/sqlite-autoconf-${SQLITE_AUTOCONF_VERSION}.tar.gz" || \
     curl -fsSL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 120 \
        -o /tmp/sqlite.tar.gz \
        "https://sources.buildroot.net/sqlite/sqlite-autoconf-${SQLITE_AUTOCONF_VERSION}.tar.gz") && \
    printf '%s  %s\n' "${SQLITE_SHA256}" /tmp/sqlite.tar.gz > /tmp/sqlite.sha256 && \
    sha256sum -c /tmp/sqlite.sha256 && \
    tar -xzf /tmp/sqlite.tar.gz -C /tmp && \
    cd "/tmp/sqlite-autoconf-${SQLITE_AUTOCONF_VERSION}" && \
    CFLAGS="-O2 \
        -DSQLITE_ENABLE_FTS3 \
        -DSQLITE_ENABLE_FTS3_PARENTHESIS \
        -DSQLITE_ENABLE_FTS4 \
        -DSQLITE_ENABLE_FTS5 \
        -DSQLITE_ENABLE_RTREE \
        -DSQLITE_ENABLE_GEOPOLY \
        -DSQLITE_ENABLE_COLUMN_METADATA \
        -DSQLITE_ENABLE_UNLOCK_NOTIFY \
        -DSQLITE_ENABLE_DBSTAT_VTAB \
        -DSQLITE_ENABLE_DBPAGE_VTAB \
        -DSQLITE_ENABLE_MATH_FUNCTIONS \
        -DSQLITE_ENABLE_PREUPDATE_HOOK \
        -DSQLITE_ENABLE_SESSION \
        -DSQLITE_SECURE_DELETE \
        -DSQLITE_THREADSAFE=1 \
        -DSQLITE_MAX_VARIABLE_NUMBER=250000" \
        ./configure --prefix=/opt/sqlite-fixed --disable-static && \
    make -j"$(nproc)" && \
    make install

FROM debian:13.4@sha256:e2d08da6f42ef4b09b165d55528a12727aeed8240dc9edf888e3ec07e10ef9da AS runtime_base

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/hermes/tools

RUN apt-get -o Acquire::Retries=3 update && \
    apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    ca-certificates curl iputils-ping python3 python-is-python3 gcc g++ make cmake python3-dev python3-venv libffi-dev libolm-dev libatomic1 procps git openssh-client docker-cli xz-utils \
    libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 && \
    rm -rf /var/lib/apt/lists/*

ARG HERMES_BOT_DESKTOP=0
RUN if [ "$HERMES_BOT_DESKTOP" = "1" ]; then \
        apt-get -o Acquire::Retries=3 update && \
        DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
        tigervnc-standalone-server xfce4-panel xfwm4 xfdesktop4 xfce4-settings xfce4-terminal \
        dbus-x11 x11-xserver-utils x11-utils x11-xkb-utils xauth fonts-dejavu-core chromium && \
        rm -rf /var/lib/apt/lists/*; \
    fi

COPY --from=sqlite_build /opt/sqlite-fixed/lib/libsqlite3.so.3.53.4 /usr/local/lib/
RUN ln -sf libsqlite3.so.3.53.4 /usr/local/lib/libsqlite3.so.0 && \
    ln -sf libsqlite3.so.3.53.4 /usr/local/lib/libsqlite3.so && \
    printf '/usr/local/lib\n' > /etc/ld.so.conf.d/000-sqlite-fixed.conf && \
    ldconfig && \
    python3 -c "import sqlite3, sys; \
v = sqlite3.sqlite_version_info; \
sys.exit(f'linked SQLite {sqlite3.sqlite_version} still has the WAL-reset bug') if v < (3, 51, 3) else None; \
db = sqlite3.connect(':memory:'); \
db.execute(\"CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='trigram')\"); \
db.execute(\"INSERT INTO docs VALUES ('hermes')\"); \
sys.exit('SQLite FTS5 trigram self-test failed') if db.execute(\"SELECT count(*) FROM docs WHERE docs MATCH 'erm'\").fetchone()[0] != 1 else None; \
db.close()"

ARG TARGETARCH
ARG S6_OVERLAY_VERSION=3.2.3.0
ARG S6_OVERLAY_NOARCH_SHA256=b720f9d9340efc8bb07528b9743813c836e4b02f8693d90241f047998b4c53cf
ARG S6_OVERLAY_X86_64_SHA256=a93f02882c6ed46b21e7adb5c0add86154f01236c93cd82c7d682722e8840563
ARG S6_OVERLAY_AARCH64_SHA256=0952056ff913482163cc30e35b2e944b507ba1025d78f5becbb89367bf344581
ARG S6_OVERLAY_SYMLINKS_SHA256=a60dc5235de3ecbcf874b9c1f18d73263ab99b289b9329aa950e8729c4789f0e
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
        amd64) s6_arch="x86_64"; s6_arch_sha="${S6_OVERLAY_X86_64_SHA256}" ;; \
        arm64) s6_arch="aarch64"; s6_arch_sha="${S6_OVERLAY_AARCH64_SHA256}" ;; \
        *) echo "Unsupported TARGETARCH=${TARGETARCH} for s6-overlay" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}"; \
    curl -fsSL --retry 3 -o /tmp/s6-overlay-noarch.tar.xz \
        "${base}/s6-overlay-noarch.tar.xz"; \
    curl -fsSL --retry 3 -o /tmp/s6-overlay-symlinks-noarch.tar.xz \
        "${base}/s6-overlay-symlinks-noarch.tar.xz"; \
    curl -fsSL --retry 3 -o /tmp/s6-overlay-arch.tar.xz \
        "${base}/s6-overlay-${s6_arch}.tar.xz"; \
    { \
        printf '%s  %s\n' "${S6_OVERLAY_NOARCH_SHA256}" /tmp/s6-overlay-noarch.tar.xz; \
        printf '%s  %s\n' "${s6_arch_sha}" /tmp/s6-overlay-arch.tar.xz; \
        printf '%s  %s\n' "${S6_OVERLAY_SYMLINKS_SHA256}" /tmp/s6-overlay-symlinks-noarch.tar.xz; \
    } > /tmp/s6-overlay.sha256; \
    sha256sum -c /tmp/s6-overlay.sha256; \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz; \
    tar -C / -Jxpf /tmp/s6-overlay-arch.tar.xz; \
    tar -C / -Jxpf /tmp/s6-overlay-symlinks-noarch.tar.xz; \
    rm /tmp/s6-overlay-*.tar.xz /tmp/s6-overlay.sha256

COPY --chmod=0755 docker/tini-shim.sh /usr/bin/tini

RUN useradd -u 10000 -m -d /opt/data hermes


WORKDIR /opt/hermes

ENV HERMES_RUNTIME_DIR=/opt/hermes/tools
COPY pm/ pm/
COPY hermes_constants.py hermes_constants.py
COPY akramcode_cli/__init__.py akramcode_cli/runtime_state.py akramcode_cli/
COPY scripts/bundles/payload.py scripts/bundles/payload.py
RUN set -eu; \
    python3 -c 'from pm import ensure; [ensure(name, explicit=True) for name in ("uv", "chromium", "npm", "ffmpeg", "ripgrep")]'; \
    python3 -c 'from pathlib import Path; from pm import installed_package; [Path("/usr/local/bin", command).symlink_to(installed_package(package).binary) for command, package in (("python3", "python"), ("node", "node"), ("npm", "npm"), ("ffmpeg", "ffmpeg"), ("rg", "ripgrep"))]; Path("/usr/local/bin/ffprobe").symlink_to(installed_package("ffmpeg").binary.with_name("ffprobe"))'; \
    ffmpeg -version >/dev/null; ffprobe -version >/dev/null; rg --version >/dev/null; \
    python3 -c 'import shutil; from pathlib import Path; from pm import env_for; Path("/usr/local/bin/npx").symlink_to(shutil.which("npx", path=env_for("npm", base_env={})["PATH"]))'; \
    node --version; npm --version; \
    browser_bin="$(python3 -c 'from pm import installed_package; print(installed_package("chromium").binary)')"; \
    test -n "$browser_bin"; \
    "$browser_bin" --version; \
    mkdir -p /etc/hermes; \
    printf '%s' "$browser_bin" > /etc/hermes/agent-browser-executable-path

RUN python3 -c 'from pathlib import Path; from pm import stage_manager_runtime; from scripts.bundles.payload import seal_pm_runtime; root = Path("/opt/hermes"); python = Path("/usr/local/bin/python3").resolve(); stage_manager_runtime(python=python, destination=root / "pm-runtime", project=root / "pm"); seal_pm_runtime(root, python)'

ENV HERMES_PYTHON=/usr/local/bin/python3
ENV CC=gcc CXX=g++

FROM runtime_base AS python_deps
COPY pyproject.toml uv.lock ./
RUN touch ./README.md
RUN python3 -m pm.build_env --source /opt/hermes --python /usr/local/bin/python3 \
    --out /opt/hermes/.venv --no-install-project --sealed \
    --extra all --extra messaging --extra otlp --extra anthropic --extra bedrock \
    --extra azure-identity --extra matrix --extra google-chat

FROM runtime_base AS frontend_build
COPY package.json package-lock.json ./
COPY ui-tui/package.json ui-tui/
COPY ui-tui/packages/akramcode-ink/ ui-tui/packages/akramcode-ink/
COPY apps/shared/ apps/shared/
COPY scripts/build/node-deps.mjs scripts/build/node-deps.mjs
ENV npm_config_install_links=false
RUN node scripts/build/node-deps.mjs --source /opt/hermes --workspace ui-tui

COPY pyproject.toml uv.lock ./
COPY ui-tui/ ui-tui/
COPY scripts/build/*.mjs scripts/build/
RUN node scripts/build/tui.mjs --source /opt/hermes --out /opt/products/tui

FROM python_deps AS runtime
COPY --from=frontend_build /opt/hermes/node_modules/typescript /opt/hermes/node_modules/typescript
RUN mkdir -p /opt/hermes/node_modules/.bin && \
    ln -s ../typescript/bin/tsc /opt/hermes/node_modules/.bin/tsc

COPY plugins/platforms/photon/sidecar/package.json \
     plugins/platforms/photon/sidecar/package-lock.json \
     plugins/platforms/photon/sidecar/patch-spectrum-mixed-attachments.mjs \
     plugins/platforms/photon/sidecar/
RUN cd plugins/platforms/photon/sidecar && \
    npm ci --no-audit --fetch-retries=5 && \
    npm cache clean --force

COPY --from=frontend_build /opt/products/tui /opt/hermes/ui-tui
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

RUN mkdir -p /tmp/hermes-runtime && chmod 0700 /tmp/hermes-runtime

COPY --link --chmod=a+rX,go-w . .

RUN /opt/hermes/.venv/bin/python -m docker.build_agent


USER root
RUN mkdir -p /opt/hermes/bin && \
    cp /opt/hermes/docker/hermes-exec-shim.sh /opt/hermes/bin/hermes && \
    chmod 0755 /opt/hermes /opt/hermes/bin/hermes && \
    printf 'docker\n' > /opt/hermes/.install_method

RUN set -eu; \
    if [ ! -f /opt/hermes/install-stamp.json ]; then \
        printf '{"schemaVersion":2,"commit":"0000000000000000000000000000000000000000","distribution":"docker","source":"fallback","updateMechanism":"external"}\n' \
            > /opt/hermes/install-stamp.json; \
    fi; \
    python3 -c 'import json; from pathlib import Path; path = Path("/opt/hermes/install-stamp.json"); stamp = json.loads(path.read_text()); stamp["pmRuntime"] = "/opt/hermes/pm-runtime"; path.write_text(json.dumps(stamp) + "\n")'; \
    mkdir -p /etc/hermes; \
    python3 -c 'import json, pathlib, tomllib; project = tomllib.loads(pathlib.Path("/opt/hermes/pyproject.toml").read_text(encoding="utf-8"))["project"]; stamp = json.loads(pathlib.Path("/opt/hermes/install-stamp.json").read_text(encoding="utf-8")); commit = stamp.get("commit"); revision = commit if commit and set(commit) != {"0"} else None; marker = pathlib.Path("/etc/hermes/image-provenance.json"); marker.write_text(json.dumps({"schema": 1, "deployment_kind": "image", "manager": "docker", "image": "nousresearch/hermes-agent", "version": project["version"], "revision": revision}, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8"); marker.chmod(0o444)'

COPY docker/s6-rc.d/ /etc/s6-overlay/s6-rc.d/

RUN mkdir -p /etc/cont-init.d && \
    printf '#!/command/with-contenv sh\nexec /opt/hermes/docker/stage2-hook.sh\n' \
        > /etc/cont-init.d/01-hermes-setup && \
    chmod +x /etc/cont-init.d/01-hermes-setup
COPY --chmod=0755 docker/cont-init.d/015-supervise-perms /etc/cont-init.d/015-supervise-perms
COPY --chmod=0755 docker/cont-init.d/02-reconcile-profiles /etc/cont-init.d/02-reconcile-profiles

ENV HERMES_TUI_DIR=/opt/hermes/ui-tui
ENV HERMES_HOME=/opt/data
ENV HERMES_WRITE_SAFE_ROOT=/opt/data

ENV XDG_RUNTIME_DIR=/tmp/hermes-runtime

COPY --chmod=0755 docker/hermes-exec-shim.sh /opt/hermes/bin/hermes
COPY --chmod=0755 docker/entrypoint-dispatch.sh /opt/hermes/docker/entrypoint-dispatch.sh

ENV PATH="/opt/hermes/bin:/opt/hermes/.venv/bin:/opt/data/.local/bin:${PATH}"
RUN mkdir -p /opt/data && chmod 0644 /opt/hermes/tools/facts.json && \
    rm -f /opt/hermes/.venv/.lock /opt/hermes/pm-runtime/.lock
ENV HERMES_PYTHON=/opt/hermes/.venv/bin/python
VOLUME [ "/opt/data" ]

ENTRYPOINT [ "/opt/hermes/docker/entrypoint-dispatch.sh" ]
CMD [ ]
