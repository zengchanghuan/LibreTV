#!/usr/bin/env bash
set -euo pipefail
sha=${1:?missing revision}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
cd /opt/hometv/publish
exec 9>.lock
flock -w 300 9
release=$(mktemp -d "releases/$sha.XXXXXXXX")
chmod 755 "$release"
tar --no-same-owner -xzf - -C "$release"
[[ "$(cat "$release/REVISION")" == "$sha" ]]
test -f "$release/server.js"
test -d "$release/.next/static"
previous=$(readlink current)
if [[ "$previous" == releases/* && -f "$previous/REVISION" && "$(cat "$previous/REVISION")" == "$sha" ]]; then
  rm -rf -- "$release"
  curl -fsS http://127.0.0.1:8080/api/auth
  exit 0
fi
switch() {
  ln -sfn "$1" current.next || return 1
  mv -Tf current.next current || return 1
  sudo -n /usr/bin/systemctl restart hometv.service || return 1
  curl -fsS --max-time 5 --retry 8 --retry-connrefused --retry-delay 1 http://127.0.0.1:8080/api/auth
}
if ! (set -e; switch "$release"); then
  switch "$previous"
  echo 'Health check failed. Restored the previous release.' >&2
  exit 1
fi
