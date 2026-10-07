#!/usr/bin/env bun
import { join } from "node:path";

const GHOSTTY = "/Applications/Ghostty.app";
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function matchingPids(processes: string, profile: string): number[] {
  const marker = new RegExp(escapeRegex(`--config-file=${profile}`) + "(?=\\s|$)");
  return processes.split("\n").flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match || !match[2]!.startsWith(GHOSTTY + "/Contents/MacOS/ghostty ") || !marker.test(match[2]!)) return [];
    return [Number(match[1])];
  });
}

function output(cmd: string[]) {
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(result.stderr.toString().trim() || `${cmd[0]} failed`);
  return result.stdout.toString();
}

function findWindows(profile: string) {
  return matchingPids(output(["/bin/ps", "-axo", "pid=,command="]), profile);
}

export function launchArgs(project: string, env: NodeJS.ProcessEnv): string[] {
  // A new terminal isn't a nested pane. Clear the calling pane's identity only
  // for this instance, and preserve PATH for Bun installed through mise/Homebrew.
  const paneVars = [...new Set(["HERDR_ENV", ...Object.keys(env).filter(key => key.startsWith("HERDR_"))])].sort();
  const environmentArgs = paneVars.flatMap(key => ["--env", key]);
  const launcher = join(project, "home-herdr").replace(/'/g, "'\\''");
  return ["/usr/bin/open", "-na", GHOSTTY, "--env", `PATH=${env.PATH || ""}`, ...environmentArgs, "--args",
    `--config-file=${join(project, "ghostty-home.conf")}`, `--command=/bin/bash '${launcher}' remote`];
}

async function main() {
  const profile = join(import.meta.dir, "ghostty-home.conf");
  if (process.argv[2] === "--status") {
    console.log("Home window: " + (findWindows(profile).length ? "open" : "closed"));
    return;
  }
  // The Bash launcher holds macOS lockf's kernel lock across this operation.
  const pids = findWindows(profile);
  if (pids.length) {
    output(["/usr/bin/osascript", "-l", "JavaScript", "-e", `ObjC.import("AppKit");
function run(argv) {
  var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]));
  if (!app.activateWithOptions(3)) throw new Error("Could not focus the Home window");
}`, String(pids[0])]);
    console.log("Home window already open; focused it.");
    return;
  }
  output(launchArgs(import.meta.dir, process.env));
  for (let attempt = 0; attempt < 50; attempt++) {
    if (findWindows(profile).length) {
      console.log("Opened Home window.");
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error("Ghostty launch was requested, but its Home instance did not appear.");
}

if (import.meta.main) {
  try { await main(); }
  catch (error) {
    console.error(`Home window failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
