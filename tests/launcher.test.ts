import { expect, test } from "bun:test";
import { join } from "node:path";

const launcher = join(import.meta.dir, "../home-herdr");

test("help describes the default window action", () => {
  const result = Bun.spawnSync([launcher, "--help"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Open or focus the dedicated Home window");
});

test("inline attach from Herdr fails before starting any services", () => {
  for (const command of ["run", "remote"]) {
    const result = Bun.spawnSync([launcher, command], {
      env: { ...process.env, HERDR_ENV: "1" }, stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("separate Home window");
    expect(result.stdout.toString()).toBe("");
  }
});

test("config help is reachable through the launcher using Bun", () => {
  const result = Bun.spawnSync([launcher, "config", "--help"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("--key ITEM");
});
