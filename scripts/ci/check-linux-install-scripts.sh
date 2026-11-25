#!/bin/bash
# Fails unless every Linux package in the given directory installs with our
# post-install script (build/linux-after-install.tpl), which makes chrome-sandbox SUID.
set -euo pipefail

dist="${1:-dist}"
checked=0

for package in "$dist"/*.deb "$dist"/*.rpm "$dist"/*.pacman; do
  [ -e "$package" ] || continue
  case "$package" in
    *.deb) script="$(ar p "$package" control.tar.gz | tar -xzOf - ./postinst)" ;;
    *.rpm) script="$(rpm -qp --scripts "$package")" ;;
    *.pacman)
      script="$(tar -xOf "$package" .INSTALL)"
      # pacman only runs post_upgrade when it replaces an installed version.
      if ! sed -n '/^post_upgrade()/,/^}/p' <<<"$script" | grep -q "^chmod 4755 '/opt/PandaSuite-Studio/chrome-sandbox'"; then
        echo "Upgrade script does not make chrome-sandbox SUID: $package"
        exit 1
      fi
      ;;
  esac
  if ! grep -q 'PandaSuite Studio: chrome-sandbox is always SUID' <<<"$script" \
    || ! grep -q "^chmod 4755 '/opt/PandaSuite-Studio/chrome-sandbox'" <<<"$script" \
    || grep -q 'unshare' <<<"$script"; then
    echo "Post-install script does not always make chrome-sandbox SUID: $package"
    exit 1
  fi
  checked=$((checked + 1))
done

[ "$checked" -gt 0 ] || { echo "No Linux package found in $dist"; exit 1; }
echo "Post-install script checked in $checked Linux package(s)"
