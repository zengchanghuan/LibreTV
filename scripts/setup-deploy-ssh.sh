#!/usr/bin/env bash
# Install only this Mac's public key; preserve existing server keys.
set -euo pipefail
mode=${1:-install}
[[ $# -le 1 && ( "$mode" == install || "$mode" == --prepare ) ]] || {
  echo 'Usage: bash scripts/setup-deploy-ssh.sh [--prepare]' >&2; exit 2;
}
key=${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_fixepub}
host=fixepub@8.153.158.141
umask 077
mkdir -p "$(dirname "$key")"
if [[ ! -e "$key" ]]; then
  [[ ! -e "$key.pub" ]] || { echo 'Public key exists without private key; refusing to overwrite.' >&2; exit 1; }
  ssh-keygen -t ed25519 -N '' -C hometv-deploy -f "$key"
fi
ssh-keygen -lf "$key.pub"
if [[ "$mode" == --prepare ]]; then
  echo "Public key ready: $key.pub (private key stays on this Mac)."
  exit 0
fi
ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=ask -o IdentitiesOnly=yes -i "$key" "$host" \
  'umask 077; mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"; touch "$HOME/.ssh/authorized_keys"; chmod 600 "$HOME/.ssh/authorized_keys"; IFS= read -r key; case "$key" in "ssh-ed25519 "*) ;; *) exit 2 ;; esac; grep -qxF "$key" "$HOME/.ssh/authorized_keys" || printf "%s\n" "$key" >> "$HOME/.ssh/authorized_keys"' < "$key.pub"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 -i "$key" "$host" \
  'sudo -n -l /usr/bin/systemctl restart hometv.service >/dev/null && echo "Passwordless SSH and HomeTV deployment permission verified."'
