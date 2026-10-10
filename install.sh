#!/bin/sh
# Install the slackwater CLI.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/openwatersio/slackwater/main/install.sh | sh
#
# Environment variables:
#   SLACKWATER_VERSION     - version to install, e.g. 1.0.0-beta.1 (default: the newest
#                            stable release, or the newest beta when none is stable)
#   SLACKWATER_INSTALL_DIR - installation directory (default: /usr/local/bin)

set -e

REPO="openwatersio/slackwater"
INSTALL_DIR="${SLACKWATER_INSTALL_DIR:-/usr/local/bin}"

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Linux)  os="linux" ;;
  Darwin) os="darwin" ;;
  *)      echo "Error: unsupported OS: $OS" >&2; exit 1 ;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)        arch="x64" ;;
  aarch64|arm64) arch="arm64" ;;
  *)             echo "Error: unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

TARGET="${os}-${arch}"

# Only linux-x64 and darwin-arm64 binaries are available
if [ "$TARGET" != "linux-x64" ] && [ "$TARGET" != "darwin-arm64" ]; then
  echo "Error: no pre-built binary for ${TARGET}." >&2
  echo "Install via npm instead: npm install -g @slackwater/cli" >&2
  exit 1
fi

# Resolve the release tag. Every package in the repo gets its own GitHub release,
# and only @slackwater/cli releases carry binaries, so releases/latest can't be used.
# Takes the newest stable CLI release, or the newest prerelease when none is stable.
TAG_PREFIX="@slackwater/cli@"
if [ -n "$SLACKWATER_VERSION" ]; then
  case "$SLACKWATER_VERSION" in
    "$TAG_PREFIX"*) TAG="$SLACKWATER_VERSION" ;;
    *)              TAG="${TAG_PREFIX}${SLACKWATER_VERSION#v}" ;;
  esac
else
  TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=100" \
    | awk -F'"' -v prefix="$TAG_PREFIX" '
        $2 == "tag_name" { tag = $4 }
        $2 == "draft" { draft = ($3 ~ /true/) }
        $2 == "prerelease" && !draft && index(tag, prefix) == 1 {
          if ($3 ~ /false/ && stable == "") stable = tag
          if (newest == "") newest = tag
        }
        END { print (stable != "" ? stable : newest) }')
fi

if [ -z "$TAG" ]; then
  echo "Error: could not find a slackwater CLI release." >&2
  exit 1
fi

ARCHIVE="slackwater-${TARGET}.tar.gz"
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"

echo "Installing slackwater ${TAG#"$TAG_PREFIX"} (${TARGET})..."

# Download archive and checksums
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL "${BASE_URL}/${ARCHIVE}" -o "${TMPDIR}/${ARCHIVE}"
curl -fsSL "${BASE_URL}/checksums.txt" -o "${TMPDIR}/checksums.txt"

# Verify checksum
EXPECTED=$(grep "${ARCHIVE}" "${TMPDIR}/checksums.txt" | cut -d' ' -f1)

if [ -z "$EXPECTED" ]; then
  echo "Error: no checksum found for ${ARCHIVE}" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "${TMPDIR}/${ARCHIVE}" | cut -d' ' -f1)
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL=$(shasum -a 256 "${TMPDIR}/${ARCHIVE}" | cut -d' ' -f1)
else
  echo "Error: no sha256sum or shasum command found" >&2
  exit 1
fi

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "Error: checksum verification failed" >&2
  echo "  expected: ${EXPECTED}" >&2
  echo "  got:      ${ACTUAL}" >&2
  exit 1
fi

# Extract
tar xzf "${TMPDIR}/${ARCHIVE}" -C "$TMPDIR"

# Install
if [ -w "$INSTALL_DIR" ]; then
  SUDO=""
else
  echo "Writing to ${INSTALL_DIR} requires elevated permissions."
  SUDO="sudo"
fi

$SUDO mv "${TMPDIR}/slackwater" "${INSTALL_DIR}/slackwater"
$SUDO chmod +x "${INSTALL_DIR}/slackwater"

echo "Installed slackwater to ${INSTALL_DIR}/slackwater"

# The binary embeds the station database, whose attribution terms are in NOTICE
if [ -f "${TMPDIR}/NOTICE" ]; then
  RELEASE_URL="https://github.com/${REPO}/releases/tag/${TAG}"
  case "$INSTALL_DIR" in
    /bin | /bin/ | /*/bin | /*/bin/)
      PREFIX="$(dirname "$INSTALL_DIR")"
      DOC_DIR="${PREFIX%/}/share/doc/slackwater"
      if $SUDO mkdir -p "$DOC_DIR" 2>/dev/null && $SUDO cp "${TMPDIR}/LICENSE" "${TMPDIR}/NOTICE" "$DOC_DIR/"; then
        echo "Installed license and data attribution to ${DOC_DIR}"
      else
        echo "Could not write to ${DOC_DIR}; LICENSE and NOTICE are in the ${ARCHIVE} download at ${RELEASE_URL}" >&2
      fi
      ;;
    *)
      echo "LICENSE and NOTICE (data attribution) are in the ${ARCHIVE} download at ${RELEASE_URL}"
      ;;
  esac
fi
