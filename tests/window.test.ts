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
  expect(args).toContain("PATH=/custom/bun/bin");
  expect(args).toContain("HERDR_ENV");
  expect(args).toContain("HERDR_PANE_ID");
  expect(args).not.toContain("HERDR_ENV=1");
  expect(args).toContain("--command=/bin/bash '/tmp/home helper/home-herdr' remote");
});
