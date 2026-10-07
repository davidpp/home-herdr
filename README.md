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
- Bun, the 1Password CLI (`op`), and an enabled 1Password SSH agent
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

The helper scripts are Bun/TypeScript with no third-party packages. The small
Bash entry point uses macOS's built-in `lockf` to serialize window launches.
Existing SSH settings and `config.json` are retained across helper updates.

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
home-herdr
```

Opens the dedicated Ghostty Home window if it is closed, or brings the existing
one to the front. `home-herdr window` is an alias for the same action. Repeated
calls do not create duplicate windows or restart the proxy. Concurrent launches
are serialized with a local lock; no stale PID file is used.

The window has a fixed **HOME — remote** title and Rose Pine colors in Ghostty
and Herdr. It attaches only to the remote server, not local work panes. Pane
identity inherited from a calling Herdr session is cleared only for the new
terminal instance; nested Herdr is never enabled. The helper does not modify
normal Ghostty/Herdr configuration.

The home profile has its own shortcuts: Cmd-T creates a Herdr tab, Cmd-D and
Cmd-Shift-D split panes, and Cmd-1…9 switch tabs. **Cmd-W closes the Ghostty
surface**, detaching rather than killing a remote pane or agent.

Detach with **Ctrl-space, then q**, or close the window. If this client started
the proxy, it stops it on exit; a proxy already running from an earlier `start`
or `login` is left running. Remote panes and agents always keep running.

After the command exits, Ghostty retains its output until a keypress, so startup
errors do not vanish. An existing error window is focused rather than hidden by
a duplicate: press a key to close it, fix the issue, then run `home-herdr` again.
Closing this instance does not quit your normal Ghostty.

To attach in the current terminal:

```fish
home-herdr remote
```

### Named website previews

```fish
home-herdr web preview 3000
# Opens http://preview.localhost:3000

home-herdr web docs 3000 --local-port 13000
# Opens http://docs.localhost:13000 if local port 3000 is already occupied
```

The command opens a foreground SSH local forward: **local 127.0.0.1 → SSH over
Tailscale → remote 127.0.0.1**. The website can remain bound to loopback on the
remote Mac; only its SSH port needs tailnet access. Names use the `.localhost`
namespace, so no DNS server, `/etc/hosts` edit, or administrator access is needed.
This is a named local URL with a port, not a shared hostname router on port 80.

Use Ctrl-C to close the tunnel. The same proxy ownership rules apply: a proxy
started by this command is cleaned up, while one already running is preserved.
Use `--no-open` to print the URL without launching a browser, or `--https` for
an HTTPS backend. TLS is passed through, not terminated or automatically trusted.

Local ports must be 1024–65535. A busy port fails rather than redirecting you to
an unrelated local website. No remote/reverse forwarding is requested, and agent
and X11 forwarding remain disabled. This one SSH connection overrides the host's
`ClearAllForwardings` only for its explicit local forward; inherited forwarding
settings are rejected. Your persisted SSH config is unchanged.

HTTP headers, URLs, and WebSockets pass through unchanged. If a dev server
rejects `preview.localhost`, explicitly allow that name in its host/origin
settings. Apps that hardcode localhost URLs or HMR ports may need their public
URL configured, or the same local/remote port.

Remote HTML/JavaScript runs in your local browser and can attempt requests to
other local/LAN services, subject to browser policy. The tunnel does not isolate
that code. A separate profile isolates cookies/storage, not network access. For
a strict compromised-remote-machine boundary, use a browser in a network-isolated
VM/sandbox rather than assuming outbound SSH alone protects local web services.

Other commands:

| Command | Behavior |
| --- | --- |
| `home-herdr` / `home-herdr window` | Open or focus the dedicated Home window |
| `home-herdr run` | Open local Herdr with the shared Home sidebar |
| `home-herdr setup` | Save the remote host as Home in the local Herdr sidebar |
| `home-herdr start` | Start proxy without opening Herdr |
| `home-herdr stop` | Stop proxy, preserving its identity |
| `home-herdr status` | Show Home window and proxy state, including when stopped |
| `home-herdr build` | Explicitly rebuild the proxy image |
| `home-herdr web NAME PORT` | Open a named preview of a remote loopback website |
| `home-herdr logs` | Show recent container logs |
| `home-herdr config` | Configure SSH and select a 1Password key |
| `home-herdr login` | Authenticate/re-authenticate the proxy |

For an already-open local Herdr, run `setup` once, use `start`, select Home
in its sidebar, and use `stop` when finished.

Startup reuses a running container. It builds the image only if missing; after
changing Dockerfile or its Tailscale version, use `home-herdr build` and restart
the proxy to use the new image.

Use one automatically managed client at a time. The client that originally
started the proxy owns its shutdown; another inline client can reuse it but will
lose its connection if that owner exits. Calling `start` after that owner is
already attached does not transfer ownership. For multiple clients, run `start`
before attaching and manage shutdown with `stop`. A forced kill cannot run
cleanup; use `stop` afterward. Docker Desktop itself is never stopped globally.

### Plain normal terminal, Home multiplexer

If your normal Ghostty starts Herdr automatically, change its `command` to a
plain login shell, for example `command = /opt/homebrew/bin/fish -l` (use your
actual fish path). Remove normal-window keybindings that send Herdr prefixes;
the Home profile contains its own. Reload Ghostty configuration before opening
new normal windows. Existing Herdr servers and panes do not need to be stopped.

`remote` and `run` require a plain terminal. Invoked from a Herdr pane, they fail
before starting Docker and direct you to `home-herdr`, which opens a genuinely
separate terminal instead of nesting.

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

**Nested Herdr:** run `home-herdr` for a separate window, not `remote` inside a
Herdr pane. No nesting option is enabled.

**Wrong shortcuts:** `herdr-home.toml` sets a Ctrl-space prefix and
`ghostty-home.conf` supplies matching Home-only shortcuts. Keep those profiles
aligned. The project does not modify normal-window bindings.

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
Tailscale SSH, Serve, or Funnel on the proxy. Local website previews are a
separate, explicitly requested local forward; they do not expose a local service
to the remote peer. Do not put local/work credentials
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
| Window-launch lock (no credentials) | `~/.config/home-herdr/window.lock` |
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
settings. The default `home-herdr` command was exercised on macOS: it opens the
remote session, a second invocation focuses the same Ghostty instance, and an
already-running proxy is reused without a rebuild. Authenticated remote Herdr
attachment and the separate normal fish window were verified visually. Startup
failure output was also checked to stay visible. macOS `nc` sends destination
names through SOCKS5 rather than resolving locally.

A named web preview was also exercised through `home-herdr web` with a temporary
HTTP server bound only to the remote Mac's loopback. A browser rendered the exact
fixture at `preview.localhost`; closing the test left the shared proxy intact.
The fixture and test tunnel were removed afterward.

Remote-to-proxy denial still requires verification in your own tailnet.

Basic checks:

```sh
bash -n home-herdr
docker compose config --quiet
bun test
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
