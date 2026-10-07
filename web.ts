#!/usr/bin/env bun
import { parseArgs } from "node:util";

export function parseWebArgs(args: string[]) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: {
      "local-port": { type: "string" }, "no-open": { type: "boolean" },
      https: { type: "boolean" }, check: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return null;
  if (positionals.length !== 2) throw new Error("Usage: home-herdr web NAME REMOTE_PORT [--local-port PORT] [--no-open] [--https]");
  const [name, remote] = positionals;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name!)) {
    throw new Error("Use a lowercase preview name containing letters, digits, and hyphens.");
  }
  const port = (value: string, minimum: number) => {
    if (!/^\d+$/.test(value) || Number(value) < minimum || Number(value) > 65535) {
      throw new Error(`Port must be an integer between ${minimum} and 65535.`);
    }
    return Number(value);
  };
  const remotePort = port(remote!, 1);
  const localPort = port(values["local-port"] || remote!, 1024);
  return { remotePort, localPort, check: !!values.check, open: !values["no-open"],
    url: `${values.https ? "https" : "http"}://${name}.localhost:${localPort}` };
}

const sshOptions = [
  "ClearAllForwardings=no", "ExitOnForwardFailure=yes", "StrictHostKeyChecking=yes", "ForwardAgent=no", "ForwardX11=no",
  "GatewayPorts=no", "Tunnel=no", "PermitLocalCommand=no", "ForkAfterAuthentication=no",
  "ControlMaster=no", "ControlPath=none", "ServerAliveInterval=30", "ServerAliveCountMax=3",
].flatMap(option => ["-o", option]);

export function sshArgs(remotePort: number, localPort: number) {
  return ["ssh", "-N", "-T", ...sshOptions, "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, "home-herdr"];
}

export function rejectExtraForwardings(config: string) {
  // The web connection overrides ClearAllForwardings for its one -L. Reject
  // inherited forwards rather than accidentally enabling a reverse tunnel.
  if (/^(localforward|remoteforward|dynamicforward)\s/im.test(config)) {
    throw new Error("Remove inherited LocalForward/RemoteForward/DynamicForward settings from home-herdr before using web previews.");
  }
}

async function main() {
  const preview = parseWebArgs(process.argv.slice(2));
  if (!preview) {
    console.log("home-herdr web NAME REMOTE_PORT [--local-port PORT] [--no-open] [--https]\n\nOpen a named, loopback-only preview of a remote localhost website. Ctrl-C closes the tunnel.");
    return;
  }
  const config = Bun.spawnSync(["ssh", "-G", ...sshOptions, "home-herdr"], { stdout: "pipe", stderr: "pipe" });
  if (!config.success) throw new Error(config.stderr.toString().trim());
  rejectExtraForwardings(config.stdout.toString());
  if (preview.check) return;

  const ssh = Bun.spawn(sshArgs(preview.remotePort, preview.localPort), {
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  let stopping = false;
  const stop = () => { stopping = true; ssh.kill("SIGTERM"); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    let listening = false;
    for (let attempt = 0; attempt < 600 && ssh.exitCode === null && !stopping; attempt++) {
      // Check this SSH process owns the listener before opening a browser; an
      // unrelated service already on that port must never be mistaken for it.
      const listener = Bun.spawnSync(["/usr/sbin/lsof", "-nP", "-a", "-p", String(ssh.pid),
        "-iTCP@127.0.0.1:" + preview.localPort, "-sTCP:LISTEN"], { stdout: "ignore", stderr: "ignore" });
      if (listener.success) { listening = true; break; }
      await Bun.sleep(200);
    }
    if (stopping) return;
    if (!listening) throw new Error("SSH preview did not start. Check authentication, the local port, and the SSH error above.");
    console.log(`Preview: ${preview.url}\nRemote target: 127.0.0.1:${preview.remotePort}\nCtrl-C closes this tunnel.`);
    if (preview.open) {
      const opened = Bun.spawnSync(["/usr/bin/open", preview.url], { stdout: "inherit", stderr: "inherit" });
      if (!opened.success) console.error("Could not open the browser; use the preview URL above.");
    }
    const code = await ssh.exited;
    if (!stopping && code !== 0) throw new Error(`SSH preview exited with status ${code}.`);
  } finally {
    if (ssh.exitCode === null) ssh.kill("SIGTERM");
    await ssh.exited;
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (import.meta.main) {
  try { await main(); }
  catch (error) {
    console.error(`Web preview failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
