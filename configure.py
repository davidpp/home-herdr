#!/usr/bin/env python3
"""Configure macOS SSH through the local 1Password agent and SOCKS proxy."""
import argparse
import datetime
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

BEGIN = "# BEGIN home-herdr (managed by home-herdr config)"
END = "# END home-herdr"


def op(*args):
    return subprocess.run(["op", *args], check=True, capture_output=True, text=True).stdout


def choose(items, label, saved=""):
    if not items:
        raise ValueError(f"No {label} found in 1Password.")
    default = next((i for i, item in enumerate(items, 1) if item[0] == saved), 1)
    for index, (_, title) in enumerate(items, 1):
        print(f"  {index}. {title}")
    choice = input(f"Select {label} [{default}]: ").strip() or str(default)
    if not choice.isdigit() or not 1 <= int(choice) <= len(items):
        raise ValueError("Invalid selection.")
    return items[int(choice) - 1][0]


def validate_host(address):
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        labels = address.rstrip(".").split(".")
        if (len(address) > 253 or re.fullmatch(r"[0-9.]+", address)
                or not all(re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", label)
                           for label in labels)):
            raise ValueError("Use a Tailscale device name, MagicDNS full name, or Tailscale IPv4.")
    else:
        if ip not in ipaddress.ip_network("100.64.0.0/10"):
            raise ValueError("Use a Tailscale IPv4 address (100.64.0.0/10).")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", "--ip", dest="host", help="Remote Tailscale name or IPv4 address")
    parser.add_argument("--user", help="Remote SSH username")
    parser.add_argument("--account", help="1Password account ID or sign-in domain")
    parser.add_argument("--key", help="1Password SSH-key item ID or title")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing files")
    args = parser.parse_args()
    ssh_dir = Path.home() / ".ssh"
    config = ssh_dir / "config"
    public_file = ssh_dir / "home-herdr.pub"
    settings = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "home-herdr/config.json"
    saved = json.loads(settings.read_text()) if settings.exists() else {}
    existing = config.read_text() if config.exists() else ""
    managed = re.compile(re.escape(BEGIN) + r"\n.*?" + re.escape(END) + r"\n?", re.S)
    matches = list(managed.finditer(existing))
    if len(matches) > 1 or (BEGIN in existing and not matches) or (END in existing and not matches):
        raise ValueError("Malformed managed block in ~/.ssh/config; inspect it first.")
    previous = matches[0].group() if matches else ""
    remaining = managed.sub("", existing)
    if re.search(r"^\s*Host\s+.*\bhome-herdr\b", remaining, re.M | re.I):
        raise ValueError("An unmanaged home-herdr Host block already exists; reconcile it first.")
    if config.is_symlink() or public_file.is_symlink() or settings.is_symlink():
        raise ValueError("Refusing to replace a symlinked configuration or public-key file.")

    def prompt(label, setting):
        default = re.search(r"^\s*" + setting + r"\s+(\S+)", previous, re.M)
        default = default.group(1) if default else ""
        return input(label + (f" [{default}]" if default else "") + ": ").strip() or default

    address = args.host or prompt("Remote Tailscale name or IPv4 (e.g. home-mac)", "HostName")
    user = args.user or prompt("Remote SSH username", "User")
    validate_host(address)
    if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_.-]*", user):
        raise ValueError("Invalid SSH username.")
    agent = Path.home() / "Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
    if not agent.is_socket():
        raise ValueError("1Password SSH agent is not running; enable it in 1Password settings.")

    account = args.account
    if not account:
        accounts = json.loads(op("account", "list", "--format", "json"))
        account = choose([(a["account_uuid"], a["url"] + " — " + a["email"]) for a in accounts],
                         "account", saved.get("account", ""))
    item = args.key
    if not item:
        keys = json.loads(op("item", "list", "--account", account, "--categories", "SSH Key", "--format", "json"))
        item = choose([(k["id"], k["title"] + " (" + k["vault"]["name"] + ")") for k in keys],
                      "SSH key", saved.get("item", ""))
    print("Reading only the selected public key; approve 1Password if prompted…", flush=True)
    public_key = op("item", "get", item, "--account", account, "--fields", "label=public key").strip()
    if "\n" in public_key or not public_key.startswith(("ssh-", "ecdsa-")):
        raise ValueError("1Password did not return an SSH public key.")
    fingerprint = subprocess.run(
        ["ssh-keygen", "-lf", "-"], input=public_key + "\n",
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    print(f"Key: {fingerprint}")
    offered = subprocess.run(
        ["ssh-add", "-L"], env={**os.environ, "SSH_AUTH_SOCK": str(agent)},
        capture_output=True, text=True,
    )
    if public_key.split()[1] not in offered.stdout:
        print("Warning: this key is not currently offered by the 1Password agent. Enable\n"
              "access to it in 1Password's SSH-agent settings before connecting.", file=sys.stderr)

    block = f'''{BEGIN}
Host home-herdr
    HostName {address}
    User {user}
    IdentityFile "{public_file}"
    IdentityAgent "{agent}"
    IdentitiesOnly yes
    ProxyCommand /usr/bin/nc -X 5 -x 127.0.0.1:1055 %h %p
    ForwardAgent no
    ForwardX11 no
    ForwardX11Trusted no
    ClearAllForwardings yes
    PermitLocalCommand no
    StrictHostKeyChecking yes
{END}
'''
    print("\n" + block)
    if args.dry_run:
        print("Dry run: no files changed.")
        return
    if input("Write this SSH configuration and public key? [y/N] ").lower() not in ("y", "yes"):
        print("Cancelled; no files changed.")
        return
    ssh_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if config.exists():
        backup = config.with_name("config.backup-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
        shutil.copy2(config, backup)
        backup.chmod(0o600)
        print(f"Existing config backed up to {backup}")
    # No private key leaves 1Password. The public file selects its agent identity.
    public_file.write_text(public_key + "\n")
    public_file.chmod(0o600)
    config.write_text(block + "\n" + remaining)
    config.chmod(0o600)
    settings.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    settings.write_text(json.dumps({"account": account, "item": item}, indent=2) + "\n")
    settings.chmod(0o600)
    print("Configured. Next:\n"
          "  home-herdr login\n"
          "  ssh -o StrictHostKeyChecking=ask home-herdr\n"
          "  home-herdr window\n\n"
          "Verify the remote SSH host-key fingerprint independently before accepting it.\n"
          "Restrict the proxy's tailnet policy as described in README.md.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError, EOFError) as error:
        print(f"Configuration failed: {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        sys.exit(130)
