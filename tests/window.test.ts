import { expect, test } from "bun:test";
import { launchArgs, matchingPids } from "../window";

const ghostty = "/Applications/Ghostty.app/Contents/MacOS/ghostty";

test("matches only the dedicated Ghostty instance, including checkout paths with spaces", () => {
  const profile = "/tmp/home helper/ghostty-home.conf";
  const processes = `
    10 ${ghostty}
    11 ${ghostty} --config-file=${profile} --command=/bin/bash
    12 bun --config-file=${profile}
    13 ${ghostty} --config-file=${profile}.bak
    14 ${ghostty} --config-file=/tmp/other.conf
  `;
  expect(matchingPids(processes, profile)).toEqual([11]);
});

test("finds multiple instances without matching other applications", () => {
  const profile = "/tmp/ghostty-home.conf";
  const processes = `
    21 ${ghostty} --config-file=${profile}
    22 ${ghostty} --config-file=${profile}
    23 /bin/bash -c ${ghostty} --config-file=${profile}
  `;
  expect(matchingPids(processes, profile)).toEqual([21, 22]);
});

test("ignores malformed process-list entries", () => {
  expect(matchingPids("garbage\n1\n", "/tmp/profile")).toEqual([]);
});

test("launches a separate surface with no inherited pane identity and preserves Bun's PATH", () => {
  const args = launchArgs("/tmp/home helper", { PATH: "/custom/bun/bin", HERDR_ENV: "1", HERDR_PANE_ID: "pane" });
  expect(args.slice(0, 6)).toEqual(["/usr/bin/env", "-u", "HERDR_ENV", "-u", "HERDR_PANE_ID", "/usr/bin/open"]);
  expect(args).toContain("PATH=/custom/bun/bin");
  expect(args.filter((arg, index) => args[index - 1] === "--env")).toEqual(["PATH=/custom/bun/bin"]);
  expect(args).toContain("--command=/bin/bash '/tmp/home helper/home-herdr' remote");
});

test("unsets empty and populated Herdr variables rather than exporting empty socket paths", () => {
  const env = { ...process.env, HERDR_ENV: "1", HERDR_SOCKET_PATH: "", HERDR_PANE_ID: "pane", HERDR_CUSTOM: "value", KEEP_ME: "kept" };
  const args = launchArgs("/tmp/home helper", env);
  const prefix = args.slice(0, args.indexOf("/usr/bin/open"));
  const result = Bun.spawnSync([...prefix, process.execPath, "-e",
    'console.log(JSON.stringify({herdr: Object.keys(process.env).filter(key => key.startsWith("HERDR_")), kept: process.env.KEEP_ME}))'],
    { env, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual({ herdr: [], kept: "kept" });
});
