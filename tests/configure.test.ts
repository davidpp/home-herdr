import { expect, test } from "bun:test";
import { validateHost } from "../configure";

test("accepts names and Tailscale IPv4", () => {
  for (const host of ["home-mac", "home-mac.tailTEST.ts.net", "home-mac.tailTEST.ts.net.", "100.64.0.1", "100.127.255.254"]) {
    expect(() => validateHost(host)).not.toThrow();
  }
});

test("rejects non-tailnet IPs", () => {
  for (const host of ["127.0.0.1", "192.168.1.1", "100.63.255.255", "100.128.0.1", "::1"]) {
    expect(() => validateHost(host)).toThrow();
  }
});

test("rejects invalid names and SSH-config injection", () => {
  for (const host of ["", "-host", "host-", "host..example", "a;command", "a b", "host\nHost other", "100.999.1.1", "a".repeat(64) + ".test"]) {
    expect(() => validateHost(host)).toThrow();
  }
});
