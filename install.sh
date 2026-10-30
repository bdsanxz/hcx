#!/bin/sh
# Installs the `hcx` CLI from its GitHub releases.
#
#   curl -fsSL https://raw.githubusercontent.com/bdsanxz/hcx/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/bdsanxz/hcx/main/install.sh | sh -s -- --version v0.1.0 --dir ~/bin
#
# On macOS arm64 it downloads the standalone `hcx-darwin-arm64` binary; on
# every other platform it downloads `hcx.js`, which runs with node. The
# release's SHA256SUMS is always checked before installing into
# ~/.local/bin/hcx (or --dir). --from-source builds dist/hcx.js from the
# release source with Bun instead. Run with --help for every option.
set -eu

REPO="bdsanxz/hcx"
VERSION="${HCX_VERSION:-latest}"
DIR="${HCX_INSTALL_DIR:-$HOME/.local/bin}"
FROM_SOURCE=0
FORCE="${HCX_FORCE:-0}"
# Test hooks (not options): HCX_BASE_URL fetches the assets from a directory
# or URL instead of the GitHub release (for example file://$TMP/fake-release);
# HCX_ASSET installs one asset name instead of detecting the platform.
BASE_URL="${HCX_BASE_URL:-}"
ASSET_OVERRIDE="${HCX_ASSET:-}"

usage() {
    cat <<EOF
Install the hcx CLI from https://github.com/$REPO.

Usage: install.sh [--version vX.Y.Z] [--dir DIR] [--from-source] [--force]

  --version vX.Y.Z  Release to install (default: latest; env HCX_VERSION).
  --dir DIR         Directory for the command (default: ~/.local/bin; env HCX_INSTALL_DIR).
  --from-source     Build dist/hcx.js from the release source with Bun instead of downloading it.
  --force           Replace the target even when it is a symlink (see below).

On macOS arm64 the standalone hcx-darwin-arm64 binary is installed; on every
other platform hcx.js is installed, which needs node on PATH.
The release's SHA256SUMS is always verified before anything is installed.

When the target is a symlink (for example ~/.local/bin/hcx linked to a repo
build by \`bun run install:local\`), it is left alone unless --force is given.
A private repository needs a token with read access: set GITHUB_TOKEN, or sign in
with the GitHub CLI (gh auth login), whose token is then used.
EOF
}

say() { printf 'hcx-install: %s\n' "$*" >&2; }
die() { say "error: $*"; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --version) [ $# -ge 2 ] || die "--version needs a value, such as v0.1.0"; VERSION="$2"; shift 2 ;;
        --dir) [ $# -ge 2 ] || die "--dir needs a directory"; DIR="$2"; shift 2 ;;
        --from-source) FROM_SOURCE=1; shift ;;
        --force) FORCE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option '$1' (see --help)" ;;
    esac
done
case "$VERSION" in
    latest|v[0-9]*) ;;
    [0-9]*) VERSION="v$VERSION" ;;
    *) die "bad version '$VERSION': use latest or a tag such as v0.1.0" ;;
esac
case "$DIR" in
    /) ;;
    */) DIR="${DIR%/}" ;;
esac
case "$BASE_URL" in
    */) BASE_URL="${BASE_URL%/}" ;;
esac

command -v curl >/dev/null 2>&1 || die "curl is required"

# The token for a private repository: GITHUB_TOKEN, else the GitHub CLI's.
TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$TOKEN" ] && command -v gh >/dev/null 2>&1; then
    TOKEN="$(gh auth token 2>/dev/null || true)"
fi

api() { # api <path> : GET a GitHub API path, printing the JSON.
    if [ -n "$TOKEN" ]; then
        curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/$1"
    else
        curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/$1"
    fi
}

asset_url() { # asset_url <release json> <asset name> : the asset's API URL, or nothing.
    # Each asset object lists its "url" before its "name".
    printf '%s\n' "$1" | awk -v want="\"name\": \"$2\"," '
        /"url": "https:\/\/api.github.com\/repos\/.*\/releases\/assets\/[0-9]+"/ { url = $0 }
        index($0, want) { sub(/.*"url": "/, "", url); sub(/".*/, "", url); print url; exit }'
}

download() { # download <asset API URL> <file>
    if [ -n "$TOKEN" ]; then
        curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/octet-stream" -o "$2" "$1"
    else
        curl -fsSL -H "Accept: application/octet-stream" -o "$2" "$1"
    fi
}

need_node() { # need_node <asset> : die unless node can run the asset.
    [ "$1" = "hcx.js" ] || return 0
    command -v node >/dev/null 2>&1 && return 0
    if command -v bun >/dev/null 2>&1; then
        die "node is required to run hcx.js on this platform ($(uname -s)/$(uname -m)); install node from https://nodejs.org, or pass --from-source to build a standalone binary with Bun"
    else
        die "node is required to run hcx.js on this platform ($(uname -s)/$(uname -m)); install node from https://nodejs.org"
    fi
}

sha256_of() { # sha256_of <file> : print the file's SHA-256 hex digest.
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{ print $1 }'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{ print $1 }'
    else
        die "sha256sum or shasum is required to verify the download"
    fi
}

mkdir -p "$DIR"
OUT="$DIR/hcx"

if [ -L "$OUT" ] && [ "$FORCE" != 1 ]; then
    die "$OUT is a symlink to '$(readlink "$OUT")' (for example from \`bun run install:local\`); pass --force to replace it"
fi
case ":$PATH:" in
    *":$DIR:"*) ;;
    *) say "warning: $DIR is not on PATH; add it or pass --dir DIR on your PATH" ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; rm -f "$OUT.tmp.$$"' EXIT

install_file() { # install_file <file> : move it to $OUT atomically.
    chmod +x "$1"
    cp "$1" "$OUT.tmp.$$"
    chmod +x "$OUT.tmp.$$"
    mv -f "$OUT.tmp.$$" "$OUT"
}

finish() { # finish : report the installed command.
    say "installed $OUT ($VERSION)"
    "$OUT" --help | head -1
}

if [ "$FROM_SOURCE" = 1 ]; then
    command -v git >/dev/null 2>&1 || die "git is required for --from-source"
    command -v bun >/dev/null 2>&1 || die "bun is required for --from-source; install it from https://bun.sh and run again"
    need_node "hcx.js"
    SRC="$(mktemp -d)"
    if [ "$VERSION" = "latest" ]; then
        # "latest" is not a branch; clone the default branch.
        CLONE_BRANCH=""
    else
        CLONE_BRANCH="--branch $VERSION"
    fi
    if [ -n "$TOKEN" ]; then
        # shellcheck disable=SC2086
        git -c "http.extraHeader=Authorization: Bearer $TOKEN" clone --depth 1 $CLONE_BRANCH "https://github.com/$REPO.git" "$SRC/repo" >&2 || die "could not clone $REPO $VERSION"
    else
        # shellcheck disable=SC2086
        git clone --depth 1 $CLONE_BRANCH "https://github.com/$REPO.git" "$SRC/repo" >&2 || die "could not clone $REPO $VERSION (a private repository needs GITHUB_TOKEN or gh auth login)"
    fi
    (cd "$SRC/repo" && bun install >&2 && bun run build >&2) || die "bun install && bun run build failed in the cloned $VERSION source"
    [ -f "$SRC/repo/dist/hcx.js" ] || die "build did not produce dist/hcx.js"
    install_file "$SRC/repo/dist/hcx.js"
    rm -rf "$SRC"
    finish
    exit 0
fi

if [ -n "$ASSET_OVERRIDE" ]; then
    ASSET="$ASSET_OVERRIDE"
elif [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
    ASSET="hcx-darwin-arm64"
else
    ASSET="hcx.js"
fi
need_node "$ASSET"

if [ -n "$BASE_URL" ]; then
    curl -fsSL -o "$TMP/$ASSET" "$BASE_URL/$ASSET" || die "could not download $ASSET from $BASE_URL"
    curl -fsSL -o "$TMP/SHA256SUMS" "$BASE_URL/SHA256SUMS" || die "could not download SHA256SUMS from $BASE_URL"
else
    if [ "$VERSION" = "latest" ]; then
        REL="$(api "repos/$REPO/releases/latest")"
    else
        REL="$(api "repos/$REPO/releases/tags/$VERSION")"
    fi
    URL="$(asset_url "$REL" "$ASSET")"
    SUM_URL="$(asset_url "$REL" "SHA256SUMS")"
    [ -n "$URL" ] || die "no $ASSET asset in release $VERSION"
    [ -n "$SUM_URL" ] || die "no SHA256SUMS asset in release $VERSION"
    download "$URL" "$TMP/$ASSET" || die "could not download $ASSET from release $VERSION"
    download "$SUM_URL" "$TMP/SHA256SUMS" || die "could not download SHA256SUMS from release $VERSION"
fi

WANT="$(awk -v want="$ASSET" '$2 == want { print $1 }' "$TMP/SHA256SUMS")"
[ -n "$WANT" ] || die "no checksum for $ASSET in SHA256SUMS; leaving any existing $OUT untouched"
GOT="$(sha256_of "$TMP/$ASSET")"
[ "$GOT" = "$WANT" ] || die "checksum mismatch for $ASSET (expected $WANT, got $GOT); leaving any existing $OUT untouched"
install_file "$TMP/$ASSET"
finish
