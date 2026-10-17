#!/bin/zsh
set -euo pipefail
caption_repo_dir="${0:A:h:h}"
caption_source_dir="$caption_repo_dir/cep"
caption_extensions_dir="$HOME/Library/Application Support/Adobe/CEP/extensions"
caption_destination="$caption_extensions_dir/ca.swen.bettercaptions"
caption_private_root="$HOME/Library/Application Support/Better Captions"
for caption_private_dir in "$caption_private_root" "$caption_private_root/agent" "$caption_private_root/agent/instances" "$caption_private_root/agent/requests" "$caption_private_root/agent/responses" "$caption_private_root/service" "$caption_private_root/service/requests" "$caption_private_root/service/responses"; do
  if [[ -L "$caption_private_dir" ]]; then
    print -u2 'A caption service folder is a symbolic link. The installation was stopped.'
    exit 1
  fi
  mkdir -p "$caption_private_dir"
  chmod 700 "$caption_private_dir"
done
caption_upi='/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent'
caption_native_packages=("$caption_repo_dir"/dist/Better-Captions-Swen-*.ccx(Nom[1]))
if [[ ! -f "$caption_source_dir/service-client/service.html" ]]; then
  print -u2 'Build Better Captions first with npm run build.'
  exit 1
fi
if [[ ! -x "$caption_upi" || ${#caption_native_packages} -ne 1 ]]; then
  print -u2 'Build the package first with npm run package and install Adobe Creative Cloud Desktop.'
  exit 1
fi
caption_native_result=$("$caption_upi" --install "${caption_native_packages[1]}")
print -r -- "$caption_native_result"
if [[ "$caption_native_result" != *'Installation Successful'* ]]; then
  print -u2 'Adobe did not confirm Better Captions installation. Review the installer result above.'
  exit 1
fi
if [[ -L "$caption_destination" ]]; then
  if [[ "${caption_destination:A}" != "${caption_source_dir:A}" ]]; then
    print -u2 "Another Better Captions installation already exists at $caption_destination. It was preserved."
    exit 1
  fi
elif [[ -e "$caption_destination" ]]; then
  print -u2 "The destination is occupied: $caption_destination. It was preserved."
  exit 1
else
  mkdir -p "$caption_extensions_dir"
  ln -s "$caption_source_dir" "$caption_destination"
fi
# Unsigned, locally reviewed CEP source requires Adobe's documented developer flag.
defaults write com.adobe.CSXS.12 PlayerDebugMode -string 1
print "Installed Better Captions: $caption_destination"
print 'Open Window > UXP Plugins > Better Captions. This is the only visible panel.'
print 'Restart Premiere once after first installation to start the invisible render service. Save your work first.'
