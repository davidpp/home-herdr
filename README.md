# home-herdr

A home-only [Herdr](https://herdr.dev) window, reached through an outbound
Tailscale proxy—without installing Tailscale on your local Mac.

```text
Local Herdr → SSH → localhost SOCKS5 → container Tailscale → remote SSH/Herdr
```

The container is the only device that joins the tailnet. The remote machine
does not get a connection back to your local Herdr, files, or SSH agent.

## Requirements

- macOS with Docker Desktop and Docker Compose
- Herdr locally and on the remote Mac (Herdr can offer remote installation)
- Python 3, the 1Password CLI (`op`), and an enabled 1Password SSH agent
- A remote Mac in your tailnet with SSH/Remote Login enabled and your key authorized
- Ghostty for the dedicated themed window; any terminal works for `remote`

## Install

Clone this repository and run commands from its directory:

```sh
./home-herdr --help
```

Optional fish function, generated from the current checkout path:

```fish
mkdir -p ~/.config/fish/functions
printf 'function home-herdr\n    "%s/home-herdr" $argv\nend\n' "$PWD" > ~/.config/fish/functions/home-herdr.fish
```

The examples below use that function. Without it, use `./home-herdr`.

## Configure once

```fish
home-herdr config
home-herdr login
```

`config` asks for the remote Tailscale name/IP, SSH username, 1Password account,
and SSH-key item. It previews the SSH host block and asks before writing.

- Fetches only the public key; the private key stays in 1Password.
- Uses the local 1Password agent without forwarding it to the remote machine.
- Backs up `~/.ssh/config` and preserves unrelated host entries.
- Saves a managed `Host home-herdr` block and `~/.ssh/home-herdr.pub`.
- Saves account/item preferences in `~/.config/home-herdr/config.json`
  (or under `$XDG_CONFIG_HOME`), outside this repository.
- Does not change 1Password agent policy automatically. Enable access to the
  selected key in 1Password if the helper warns that it is not offered.

For a non-writing preview:

```sh
home-herdr config --host home-mac --user YOUR_REMOTE_USER --dry-run
```

Optional `--account` and `--key` arguments select a 1Password account and item
without the selection menus. `--ip` is an alias for `--host`.

Names are resolved by the proxy, not by the local Mac. With MagicDNS enabled,
a name such as `home-mac` should work. If needed, use the full name shown in
Tailscale's admin console, such as `home-mac.tailXXXX.ts.net`, or the Tailscale IPv4.

`login` starts Docker Desktop if necessary, starts the proxy, and prints a
browser login URL. It enables shields-up and disables DNS changes, subnet-route
acceptance, and Tailscale SSH. Authentication persists in a Docker named volume.

### Verify the SSH server

Independently obtain the remote Mac's SSH host-key fingerprint. On that Mac:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Then, locally:

```sh
ssh -o StrictHostKeyChecking=ask home-herdr
```

Accept only a matching fingerprint. Exit the remote shell afterward.
Do not disable host-key checking.

### Restrict tailnet access

Tag the proxy device and allow only **proxy → remote Mac, TCP 22**. Merge this
example into your existing Tailscale policy, replacing the destination IP:

```json
{
  "tagOwners": {
    "tag:work-outbound-proxy": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["tag:work-outbound-proxy"],
      "dst": ["100.64.0.10"],
      "ip": ["tcp:22"]
    }
  ]
}
```

Assign the tag to the proxy in the admin console. Grants and ACLs are additive:
a broader allow-all rule can defeat the outbound restriction. Preserve unrelated
access deliberately rather than replacing your entire policy blindly.

Shields-up independently blocks new incoming tailnet connections. Replies to
connections initiated locally still work.

## Daily use

```fish
home-herdr window
```

Opens a separate Ghostty instance with a fixed **HOME — remote** title and
Rose Pine colors in Ghostty and Herdr. It attaches only to the remote server,
not your local work panes. Your normal Ghostty/Herdr configs are unchanged.

The local Herdr profile uses **Ctrl-space** as its prefix, matching the included
Ghostty shortcut assumption. Detach with **Ctrl-space, then q**. The proxy stops;
remote panes and agents keep running. Closing the window also triggers cleanup.

After the command exits, Ghostty retains its output until a keypress, so startup
errors do not vanish. Successful detach also leaves the final output visible
until you press a key. Closing this instance does not quit your normal Ghostty.

To attach in the current terminal:

```fish
home-herdr remote
```

Other commands:

| Command | Behavior |
| --- | --- |
| `home-herdr` | Start proxy, open local Herdr, stop proxy on detach |
| `home-herdr setup` | Save the remote host as Home in the local Herdr sidebar |
| `home-herdr start` | Start proxy without opening Herdr |
| `home-herdr stop` | Stop proxy, preserving its identity |
| `home-herdr status` | Show container and tailnet status |
| `home-herdr logs` | Show recent container logs |
| `home-herdr config` | Configure SSH and select a 1Password key |
| `home-herdr login` | Authenticate/re-authenticate the proxy |

For an already-open local Herdr, run `setup` once, use `start`, select Home
in its sidebar, and use `stop` when finished.

Use one proxy-owning client at a time. Exiting `remote` or the default launcher
stops the shared proxy and disconnects other clients using it. For multiple
clients, manage the proxy with `start`/`stop` and launch Herdr separately.
A forced kill cannot run cleanup; use `stop` afterward. Docker Desktop itself
is never stopped globally.

## Troubleshooting

**Window disappears:** the included Ghostty profile sets
`wait-after-command = true`. Run `home-herdr remote` from an existing terminal
to inspect errors independently of Ghostty.

**Starting / NoState:** startup waits for Tailscale's backend to become
`Running`, then probes the remote SSH port before attaching; a reachable local
socket is not proof that the tailnet is ready. If it times out, check `status`
and `logs`.

**NeedsLogin:** run `home-herdr login`. Key expiry can require reauthentication.

**NeedsMachineAuth:** approve the proxy device in Tailscale's admin console.

**Host key verification failed:** verify and enroll the remote host key as above.

**Permission denied (publickey):** confirm the public key is authorized on the
remote Mac and the 1Password agent offers it. Verify plain
`ssh home-herdr` before debugging Herdr.

**Wrong shortcuts:** `herdr-home.toml` sets a Ctrl-space prefix. Ghostty inherits
your normal shortcuts; if those send another prefix, align the two configs.
The project does not modify your normal terminal configuration.

## Security boundary

The image is `FROM scratch`: only `tailscaled`, the Tailscale CLI, and CA
certificates from a pinned official release. No shell, package manager, SSH
server, or Herdr. This stripped image is not an official supported runtime.

Compose uses:

- Userspace networking; no TUN device, host networking, or privileged mode.
- Non-root UID, all capabilities dropped, and no-new-privileges.
- Read-only root filesystem with private runtime tmpfs.
- Proxy published only on `127.0.0.1:1055`.
- A named state volume; no host files, private keys, Docker socket, or agent mounts.

Limitations:

- Any local process can use the unauthenticated localhost proxy.
- The container has ordinary Docker egress; this is not a full host/LAN egress jail.
- The remote server supplies untrusted terminal/protocol output over the
  connection you initiate. Local Herdr/terminal parsing is not sandboxed here.
- The theme is a visual cue, not a security control.
- The home profile disables Herdr's clipboard-image shortcut. Deliberate
  clipboard paste can still send local content remotely.
- No automatic upgrades. Update `TAILSCALE_VERSION`, rebuild, and repeat checks.

Do not enable reverse forwarding, agent forwarding, route advertisement,
Tailscale SSH, Serve, or Funnel on the proxy. Do not put local/work credentials
or a connection back to the local machine on the remote server.

### Verify the boundary

Check effective SSH settings:

```sh
ssh -G home-herdr
```

Check Tailscale preferences without sharing their full output:

```sh
docker compose exec proxy /usr/local/bin/tailscale --socket=/run/tailscaled.sock debug prefs
```

Confirm `ShieldsUp=true`, `CorpDNS=false`, `RouteAll=false`, and `RunSSH=false`,
including after restart.

While the proxy is running, try from the remote Mac:

```sh
nc -vz -w 5 PROXY_TAILSCALE_IP 1055
```

A new incoming connection must fail while local SSH/Herdr access succeeds.
Do not treat an internal healthcheck as proof of that boundary.

## Publishing and private data

Source files contain no machine-specific hostnames, usernames, key IDs, vault
names, or absolute checkout paths. Configuration and credentials live outside
the checkout:

| Data | Location |
| --- | --- |
| Private SSH key | 1Password |
| Public key, SSH host block, backups | `~/.ssh/` |
| 1Password account/item preferences | `~/.config/home-herdr/config.json` |
| Tailscale identity and authentication | Docker `tailscale-state` volume |
| Runtime logs | Docker / Herdr / terminal scrollback |

The state volume is sensitive. Logs, screenshots, `status`, and preference dumps
can reveal tailnet identities and hostnames; review them before publishing.
`.gitignore` excludes common local config, key, log, and backup artifacts.
Do not copy your Docker state or local configuration into the repository.

To retire the proxy, stop it, delete its device from Tailscale's admin console,
then delete local state with `docker compose down -v`.

## Verification

The scratch image builds and its non-root daemon runs under the hardened Compose
settings. Startup was exercised through `home-herdr window`: it reconnects,
reaches the remote SSH port, and retains the themed window and failure output
when strict host-key checking refuses an unverified server. macOS `nc` was also
checked to send destination names through SOCKS5 rather than resolving locally.
Authenticated remote Herdr attachment and remote-to-proxy denial remain unverified.

Basic checks:

```sh
bash -n home-herdr
docker compose config --quiet
python3 -B -m unittest discover -s tests
```

CI runs shell syntax checks, configuration-validation tests, Compose validation,
and an image build on pushes and pull requests. It does not authenticate to a
tailnet or claim to test remote SSH/Herdr access.

## License

MIT. Tailscale, Herdr, Ghostty, and 1Password retain their respective licenses.

References:
- [Tailscale userspace networking](https://tailscale.com/docs/concepts/userspace-networking)
- [Tailscale shields-up](https://tailscale.com/docs/features/client/manage-preferences)
- [Herdr remote access](https://herdr.dev/docs/persistence-remote/)
- [1Password SSH agent](https://developer.1password.com/docs/ssh/agent/advanced/)
