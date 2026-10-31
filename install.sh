#!/bin/sh
# Installs the `hcx` CLI from its GitHub releases.
#
#   curl -fsSL https://raw.githubusercontent.com/bdsanxz/hcx/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/bdsanxz/hcx/main/install.sh | sh -s -- --version v0.1.0 --dir ~/bin
#
# On macOS arm64 it downloads the standalone `hcx-darwin-arm64` binary; on
# every other platform it downloads `hcx.js`, which runs with node. The
# release's SHA256SUMS is always checked before installing into
# ~/.local/bin/hcx (or --dir). --from-source builds a standalone binary from
# source with Bun instead (latest builds the default branch, a tag builds that
# tag). Run with --help for every option.
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
  --from-source     Build a standalone binary from source with Bun instead of downloading
                    it (latest builds the default branch, a tag builds that tag).
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

# Tokens for a private repository. The token is only looked up after an
# unauthenticated request fails with a 404, and it never appears on a command
# line: curl reads it from its stdin config (`-K -`), git from the environment.
token() { # token : GITHUB_TOKEN, else the GitHub CLI's, else nothing.
    if [ -n "${GITHUB_TOKEN:-}" ]; then printf '%s' "$GITHUB_TOKEN"; return 0; fi
    if command -v gh >/dev/null 2>&1; then gh auth token 2>/dev/null || true; fi
}

auth_config() { # auth_config : a curl stdin config carrying the token header, or fail.
    TOKEN="$(token)"
    [ -n "$TOKEN" ] || return 1
    printf 'header = "Authorization: Bearer %s"\n' "$TOKEN"
}

get() { # get <out> <url> [accept] : download url to out, retrying with a token after a 404.
    if curl -fsSL -H "Accept: ${3:-application/octet-stream}" -o "$1" "$2" 2>/dev/null; then return 0; fi
    # Only a 404 justifies the token; anything else is a real failure.
    code="$(curl -sSL -o /dev/null -w "%{http_code}" -H "Accept: ${3:-application/octet-stream}" "$2" 2>/dev/null || true)"
    [ "$code" = "404" ] || return 1
    auth_config | curl -fsSL -K - -H "Accept: ${3:-application/octet-stream}" -o "$1" "$2"
}

api() { # api <path> : GET a GitHub API path, printing the JSON.
    get "$TMP/api.json" "https://api.github.com/$1" "application/vnd.github+json" || return 1
    cat "$TMP/api.json"
}

asset_url() { # asset_url <release json> <asset name> : the asset's API URL, or nothing.
    # Each asset object lists its "url" before its "name".
    printf '%s\n' "$1" | awk -v want="\"name\": \"$2\"," '
        /"url": "https:\/\/api.github.com\/repos\/.*\/releases\/assets\/[0-9]+"/ { url = $0 }
        index($0, want) { sub(/.*"url": "/, "", url); sub(/".*/, "", url); print url; exit }'
}

download() { # download <asset API URL> <file> : GET an asset's bytes.
    get "$2" "$1" "application/octet-stream"
}

need_node() { # need_node <asset> : die unless node can run the asset.
    [ "$1" = "hcx.js" ] || return 0
    command -v node >/dev/null 2>&1 && return 0
    if command -v bun >/dev/null 2>&1; then
        die "node is required to run hcx.js on this platform ($(uname -s)/$(uname -m)); install node from https://nodejs.org, or pass --from-source to build a standalone binary with Bun"
    else
        die "node is required to run hcx.js on this platform ($(uname -s)/$(uname -m)); install node from https://nodejs.org, or install Bun from https://bun.sh and pass --from-source to build a standalone binary"
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
SRC=""
trap 'rm -rf "$TMP"; [ -n "${SRC:-}" ] && rm -rf "$SRC"; rm -f "$OUT.tmp.$$"' EXIT

install_file() { # install_file <file> : move it to $OUT atomically.
    chmod +x "$1"
    cp "$1" "$OUT.tmp.$$"
    chmod +x "$OUT.tmp.$$"
    mv -f "$OUT.tmp.$$" "$OUT"
}

finish() { # finish : report the installed command and its version.
    say "installed $OUT ($VERSION)"
    "$OUT" --version 2>/dev/null | head -2 || "$OUT" --help | head -1
}

if [ "$FROM_SOURCE" = 1 ]; then
    command -v git >/dev/null 2>&1 || die "git is required for --from-source"
    command -v bun >/dev/null 2>&1 || die "bun is required for --from-source; install it from https://bun.sh and run again"
    SRC="$(mktemp -d)"
    if [ "$VERSION" = "latest" ]; then
        # "latest" is not a branch; clone the default branch.
        CLONE_BRANCH=""
    else
        CLONE_BRANCH="--branch $VERSION"
    fi
    # shellcheck disable=SC2086
    if ! git clone --depth 1 $CLONE_BRANCH "https://github.com/$REPO.git" "$SRC/repo" >&2; then
        # Maybe a private repository: retry with a token from the environment (never argv).
        TOKEN="$(token)"
        [ -n "$TOKEN" ] || die "could not clone $REPO $VERSION (a private repository needs GITHUB_TOKEN or gh auth login)"
        # shellcheck disable=SC2086
        GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="http.extraHeader" GIT_CONFIG_VALUE_0="Authorization: Bearer $TOKEN" \
            git clone --depth 1 $CLONE_BRANCH "https://github.com/$REPO.git" "$SRC/repo" >&2 \
            || die "could not clone $REPO $VERSION (a private repository needs GITHUB_TOKEN or gh auth login)"
    fi
    (cd "$SRC/repo" && bun install >&2 && bun run build:bin >&2) || die "bun install && bun run build:bin failed in the cloned $VERSION source"
    [ -f "$SRC/repo/dist/hcx" ] || die "build did not produce dist/hcx"
    install_file "$SRC/repo/dist/hcx"
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
