#!/usr/bin/env bun
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const BEGIN = "# BEGIN home-herdr (managed by home-herdr config)";
const END = "# END home-herdr";
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function output(cmd: string[], options: { stdin?: Uint8Array; env?: NodeJS.ProcessEnv } = {}) {
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", ...options });
  if (!result.success) throw new Error(result.stderr.toString().trim() || `${cmd[0]} failed`);
  return result.stdout.toString();
}

function ask(label: string, fallback = "") {
  const answer = prompt(label + (fallback ? ` [${fallback}]` : "") + ": ");
  if (answer === null) throw new Error("Cancelled; no files changed.");
  return answer.trim() || fallback;
}

function choose(items: [string, string][], label: string, saved = "") {
  if (!items.length) throw new Error(`No ${label} found in 1Password.`);
  const defaultIndex = Math.max(0, items.findIndex(([id]) => id === saved)) + 1;
  items.forEach(([, title], index) => console.log(`  ${index + 1}. ${title}`));
  const answer = ask(`Select ${label}`, String(defaultIndex));
  if (!/^\d+$/.test(answer) || Number(answer) < 1 || Number(answer) > items.length) {
    throw new Error("Invalid selection.");
  }
  return items[Number(answer) - 1]![0];
}

export function validateHost(address: string) {
  if (isIP(address) === 4) {
    const [first, second] = address.split(".").map(Number);
    if (first !== 100 || second! < 64 || second! > 127) {
      throw new Error("Use a Tailscale IPv4 address (100.64.0.0/10).");
    }
    return;
  }
  const labels = address.replace(/\.$/, "").split(".");
  if (address.length > 253 || /^[0-9.]+$/.test(address)
      || !labels.every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) {
    throw new Error("Use a Tailscale device name, MagicDNS full name, or Tailscale IPv4.");
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      host: { type: "string" }, ip: { type: "string" }, user: { type: "string" },
      account: { type: "string" }, key: { type: "string" },
      "dry-run": { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`Configure SSH through the local 1Password agent and SOCKS proxy.

home-herdr config [--host NAME_OR_IP] [--user USER] [--account ACCOUNT] [--key ITEM] [--dry-run]

--ip is an alias for --host. Without options, configuration is interactive.`);
    return;
  }
  const sshDir = join(homedir(), ".ssh");
  const config = join(sshDir, "config");
  const publicFile = join(sshDir, "home-herdr.pub");
  const settingsDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "home-herdr");
  const settings = join(settingsDir, "config.json");
  const saved: { account?: string; item?: string } = existsSync(settings) ? await Bun.file(settings).json() : {};
  const existing = existsSync(config) ? await Bun.file(config).text() : "";
  const managed = new RegExp(escapeRegex(BEGIN) + "\\n[\\s\\S]*?" + escapeRegex(END) + "\\n?", "g");
  const matches = [...existing.matchAll(managed)];
  if (matches.length > 1 || existing.split(BEGIN).length - 1 !== matches.length
      || existing.split(END).length - 1 !== matches.length) {
    throw new Error("Malformed managed block in ~/.ssh/config; inspect it first.");
  }
  const previous = matches[0]?.[0] || "";
  const remaining = existing.replace(managed, "");
  if (/^\s*Host\s+.*\bhome-herdr\b/im.test(remaining)) {
    throw new Error("An unmanaged home-herdr Host block already exists; reconcile it first.");
  }
  if ([config, publicFile, settings].some(path => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())) {
    throw new Error("Refusing to replace a symlinked configuration or public-key file.");
  }
  const setting = (name: string) => previous.match(new RegExp(`^\\s*${name}\\s+(\\S+)`, "m"))?.[1] || "";
  const address = values.host || values.ip || ask("Remote Tailscale name or IPv4 (e.g. home-mac)", setting("HostName"));
  const user = values.user || ask("Remote SSH username", setting("User"));
  validateHost(address);
  if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(user)) throw new Error("Invalid SSH username.");
  const agent = join(homedir(), "Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock");
  if (!existsSync(agent) || !statSync(agent).isSocket()) {
    throw new Error("1Password SSH agent is not running; enable it in 1Password settings.");
  }
  let account = values.account;
  if (!account) {
    const accounts: { account_uuid: string; url: string; email: string }[] = JSON.parse(output(["op", "account", "list", "--format", "json"]));
    account = choose(accounts.map(a => [a.account_uuid, `${a.url} — ${a.email}`]), "account", saved.account);
  }
  let item = values.key;
  if (!item) {
    const keys: { id: string; title: string; vault: { name: string } }[] = JSON.parse(output([
      "op", "item", "list", "--account", account, "--categories", "SSH Key", "--format", "json",
    ]));
    item = choose(keys.map(k => [k.id, `${k.title} (${k.vault.name})`]), "SSH key", saved.item);
  }
  console.log("Reading only the selected public key; approve 1Password if prompted…");
  const publicKey = output(["op", "item", "get", item, "--account", account, "--fields", "label=public key"]).trim();
  if (publicKey.includes("\n") || !/^(ssh-|ecdsa-)/.test(publicKey)) {
    throw new Error("1Password did not return an SSH public key.");
  }
  console.log(`Key: ${output(["ssh-keygen", "-lf", "-"], { stdin: Buffer.from(publicKey + "\n") }).trim()}`);
  const offered = Bun.spawnSync(["ssh-add", "-L"], {
    env: { ...process.env, SSH_AUTH_SOCK: agent }, stdout: "pipe", stderr: "pipe",
  });
  if (!offered.stdout.toString().includes(publicKey.split(/\s+/)[1]!)) {
    console.error("Warning: this key is not offered by the 1Password agent. Enable access to it in its SSH-agent settings.");
  }
  const block = `${BEGIN}
Host home-herdr
    HostName ${address}
    User ${user}
    IdentityFile "${publicFile}"
    IdentityAgent "${agent}"
    IdentitiesOnly yes
    ProxyCommand /usr/bin/nc -X 5 -x 127.0.0.1:1055 %h %p
    ForwardAgent no
    ForwardX11 no
    ForwardX11Trusted no
    ClearAllForwardings yes
    PermitLocalCommand no
    StrictHostKeyChecking yes
${END}
`;
  console.log("\n" + block);
  if (values["dry-run"]) {
    console.log("Dry run: no files changed.");
    return;
  }
  if (!/^(y|yes)$/i.test(ask("Write this SSH configuration and public key?", "N"))) {
    console.log("Cancelled; no files changed.");
    return;
  }
  mkdirSync(sshDir, { mode: 0o700, recursive: true });
  if (existsSync(config)) {
    const backup = `${config}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(config, backup);
    chmodSync(backup, 0o600);
    console.log(`Existing config backed up to ${backup}`);
  }
  // The public file selects the agent identity; no private key leaves 1Password.
  await Bun.write(publicFile, publicKey + "\n");
  chmodSync(publicFile, 0o600);
  await Bun.write(config, block + "\n" + remaining);
  chmodSync(config, 0o600);
  mkdirSync(settingsDir, { mode: 0o700, recursive: true });
  await Bun.write(settings, JSON.stringify({ account, item }, null, 2) + "\n");
  chmodSync(settings, 0o600);
  console.log(`Configured. Next:
  home-herdr login
  ssh -o StrictHostKeyChecking=ask home-herdr
  home-herdr

Verify the remote SSH host-key fingerprint independently before accepting it.
Restrict the proxy's tailnet policy as described in README.md.`);
}

if (import.meta.main) {
  try { await main(); }
  catch (error) {
    console.error(`Configuration failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
