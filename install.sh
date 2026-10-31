#!/bin/sh
# Install the akramcode standalone binary from GitHub Releases.
#
#   curl -fsSL https://github.com/draiqw/akramcode/releases/latest/download/install.sh | sh
#
# Environment:
#   AKRAMCODE_VERSION      Release tag to install, e.g. v1.0.20 (default: latest)
#   AKRAMCODE_INSTALL_DIR  Where the release is unpacked (default: ~/.akramcode/bin-release)
#   AKRAMCODE_BIN_DIR      Where the akramcode launcher goes (default: ~/.local/bin)

set -eu

REPO="draiqw/akramcode"
VERSION="${AKRAMCODE_VERSION:-latest}"
INSTALL_DIR="${AKRAMCODE_INSTALL_DIR:-$HOME/.akramcode/bin-release}"
BIN_DIR="${AKRAMCODE_BIN_DIR:-$HOME/.local/bin}"

fail() {
	echo "akramcode install: $*" >&2
	exit 1
}

case "$(uname -s)" in
	Darwin) os="darwin" ;;
	Linux) os="linux" ;;
	*) fail "unsupported OS: $(uname -s) (supported: macOS, Linux)" ;;
esac

case "$(uname -m)" in
	arm64 | aarch64) arch="arm64" ;;
	x86_64 | amd64) arch="x64" ;;
	*) fail "unsupported architecture: $(uname -m) (supported: arm64, x64)" ;;
esac

# Rosetta reports x86_64 on Apple Silicon; prefer the native build.
if [ "$os" = "darwin" ] && [ "$arch" = "x64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
	arch="arm64"
fi

asset="akramcode-$os-$arch.tar.gz"
if [ "$VERSION" = "latest" ]; then
	base_url="https://github.com/$REPO/releases/latest/download"
else
	base_url="https://github.com/$REPO/releases/download/$VERSION"
fi

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "Downloading $asset ($VERSION)..."
curl -fsSL "$base_url/$asset" -o "$tmp/$asset" || fail "download failed: $base_url/$asset"
curl -fsSL "$base_url/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "download failed: $base_url/SHA256SUMS"

expected="$(awk -v f="$asset" '$2 == f { print $1 }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "$asset is missing from SHA256SUMS"
if command -v sha256sum >/dev/null 2>&1; then
	actual="$(sha256sum "$tmp/$asset" | awk '{ print $1 }')"
else
	actual="$(shasum -a 256 "$tmp/$asset" | awk '{ print $1 }')"
fi
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset"

tar -xzf "$tmp/$asset" -C "$tmp"
[ -x "$tmp/akramcode/akramcode" ] || fail "archive does not contain akramcode/akramcode"

# The binary loads themes and native helpers from its own directory, so the
# whole release directory is kept together and a launcher goes on PATH.
mkdir -p "$(dirname "$INSTALL_DIR")" "$BIN_DIR"
rm -rf "$INSTALL_DIR"
mv "$tmp/akramcode" "$INSTALL_DIR"

cat >"$BIN_DIR/akramcode" <<EOF
#!/bin/sh
exec "$INSTALL_DIR/akramcode" "\$@"
EOF
chmod +x "$BIN_DIR/akramcode"

echo "Installed akramcode $("$INSTALL_DIR/akramcode" --version 2>/dev/null || echo "$VERSION") to $INSTALL_DIR"
echo "Launcher: $BIN_DIR/akramcode"

case ":$PATH:" in
	*":$BIN_DIR:"*) ;;
	*)
		echo
		echo "$BIN_DIR is not on PATH. Add it to your shell profile:"
		echo "  export PATH=\"$BIN_DIR:\$PATH\""
		;;
esac
