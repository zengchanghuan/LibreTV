#!/usr/bin/env bash
# Publish the latest pushed personal commit after its Linux CI build passes.
set -euo pipefail
repo=zengchanghuan/LibreTV
sha=$(gh api "repos/$repo/git/ref/heads/personal" --jq .object.sha)
run=
for attempt in {1..20}; do
  run=$(gh run list -R "$repo" --workflow web-ci.yml --branch personal --commit "$sha" --limit 10 --json databaseId,event --jq '[.[] | select(.event == "push" or .event == "workflow_dispatch")][0].databaseId // empty')
  [[ -n "$run" ]] && break
  sleep 3
done
test -n "$run"
gh run watch "$run" -R "$repo" --exit-status
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
gh run download "$run" -R "$repo" -n "hometv-linux-$sha" -D "$tmp"
key=${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_fixepub}
host=fixepub@8.153.158.141
opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -i "$key")
# Stream directly to a unique directory. The server serializes activation.
[[ "$(gh api "repos/$repo/git/ref/heads/personal" --jq .object.sha)" == "$sha" ]]
ssh "${opts[@]}" "$host" "/opt/hometv/publish/activate '$sha'" < "$tmp/hometv.tgz"
curl -fsS --max-time 15 https://tv.fixepub.com/api/auth
printf '\nPublished %s\n' "$sha"
