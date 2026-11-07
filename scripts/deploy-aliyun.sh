#!/usr/bin/env bash
# Build in GitHub Actions; download and publish from this Mac over SSH.
set -euo pipefail
usage() {
  echo 'Usage: bash scripts/deploy-aliyun.sh [--check | --download-only OUTPUT.tgz]'
}
mode=deploy
output=
case "${1:-}" in
  '') [[ $# == 0 ]] || { usage; exit 2; } ;;
  --check) [[ $# == 1 ]] || { usage; exit 2; }; mode=check ;;
  --download-only) [[ $# == 2 ]] || { usage; exit 2; }; mode=download; output=$2 ;;
  -h|--help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
repo=zengchanghuan/LibreTV
key=${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_fixepub}
host=fixepub@8.153.158.141
opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 -i "$key")
for command in git gh ssh curl tar; do command -v "$command" >/dev/null; done
case "$(git remote get-url origin)" in
  https://github.com/zengchanghuan/LibreTV|https://github.com/zengchanghuan/LibreTV.git|git@github.com:zengchanghuan/LibreTV.git) ;;
  *) echo 'Unexpected origin; refusing deployment.' >&2; exit 1 ;;
esac
remote_sha() { gh api "repos/$repo/git/ref/heads/personal" --jq .object.sha; }
sha=$(git rev-parse HEAD)
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$sha" == "$(remote_sha)" ]] || {
  echo 'HEAD must match the pushed personal branch. Pull or push the intended commit first.' >&2; exit 1;
}
printf 'Target: %s\n' "$sha"
if [[ "$mode" != download ]]; then
  [[ -r "$key" ]] || { echo 'Missing SSH key; run scripts/setup-deploy-ssh.sh first.' >&2; exit 1; }
  ssh "${opts[@]}" "$host" 'test -x /opt/hometv/publish/activate && sudo -n -l /usr/bin/systemctl restart hometv.service >/dev/null && systemctl is-active --quiet hometv.service'
  current=$(ssh "${opts[@]}" "$host" 'cat /opt/hometv/publish/current/REVISION')
  printf 'Current: %s\n' "$current"
  if [[ "$mode" == check ]]; then
    gh api "repos/$repo/actions/workflows/web-ci.yml" --jq '"Web CI: " + .state'
    echo 'Deployment prerequisites passed (no changes made; actual build availability is checked on deployment).'
    exit 0
  fi
  if [[ "$current" == "$sha" ]]; then
    curl -fsS --max-time 15 https://tv.fixepub.com/api/auth
    printf '\nAlready deployed: %s\n' "$sha"
    exit 0
  fi
fi
if [[ -n "$output" ]]; then
  [[ ! -e "$output" ]] || { echo 'Output already exists; refusing to overwrite.' >&2; exit 1; }
  mkdir -p "$(dirname "$output")"
  output=$(cd "$(dirname "$output")" && pwd)/$(basename "$output")
fi
latest_run() {
  gh run list -R "$repo" --workflow web-ci.yml --branch personal --commit "$sha" --limit 20 \
    --json databaseId,event --jq '[.[] | select(.event == "push" or .event == "workflow_dispatch")][0].databaseId // empty'
}
artifact="hometv-linux-$sha"
run=$(latest_run)
needs_build=false
if [[ -z "$run" ]]; then
  needs_build=true
elif [[ "$(gh run view "$run" -R "$repo" --json conclusion --jq .conclusion)" == success ]]; then
  available=$(gh api "repos/$repo/actions/runs/$run/artifacts" --jq "[.artifacts[] | select(.name == \"$artifact\" and .expired == false)] | length")
  [[ "$available" != 0 ]] || needs_build=true
fi
if [[ "$needs_build" == true ]]; then
  previous_run=$run
  # Fork-level disabling is reported here even if the workflow API says active.
  gh workflow run web-ci.yml -R "$repo" --ref personal || {
    echo "Could not start Web CI. Inspect https://github.com/$repo/actions for the reason." >&2; exit 1;
  }
  run=
  for attempt in {1..20}; do
    candidate=$(latest_run)
    if [[ -n "$candidate" && "$candidate" != "$previous_run" ]]; then run=$candidate; break; fi
    sleep 3
  done
  [[ -n "$run" ]] || { echo 'Build was requested but no run appeared; inspect Actions.' >&2; exit 1; }
fi
printf 'Waiting for Web CI: https://github.com/%s/actions/runs/%s\n' "$repo" "$run"
gh run watch "$run" -R "$repo" --exit-status
[[ "$(gh run view "$run" -R "$repo" --json headSha --jq .headSha)" == "$sha" ]]
tmp=$(mktemp -d "${TMPDIR:-/tmp}/hometv-release.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
gh run download "$run" -R "$repo" -n "$artifact" -D "$tmp"
[[ "$(tar -xOf "$tmp/hometv.tgz" ./REVISION)" == "$sha" ]] || {
  echo 'Artifact revision does not match the requested commit.' >&2; exit 1;
}
if [[ "$mode" == download ]]; then
  cp "$tmp/hometv.tgz" "$output"
  printf 'Verified release %s: %s\n' "$sha" "$output"
  exit 0
fi
# Refuse an outdated build if personal advanced while CI was running.
[[ "$(remote_sha)" == "$sha" ]] || { echo 'Remote advanced during build; rerun deployment.' >&2; exit 1; }
ssh "${opts[@]}" "$host" "/opt/hometv/publish/activate '$sha'" < "$tmp/hometv.tgz"
[[ "$(ssh "${opts[@]}" "$host" 'cat /opt/hometv/publish/current/REVISION')" == "$sha" ]]
curl -fsS --max-time 15 https://tv.fixepub.com/api/auth
printf '\nPublished %s\n' "$sha"
