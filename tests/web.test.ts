import { expect, test } from "bun:test";
import { hasBothLoopbackListeners, parseWebArgs, rejectExtraForwardings, sshArgs } from "../web";
import { join } from "node:path";

test("named previews default to the same local port", () => {
  expect(parseWebArgs(["preview", "3000"])).toEqual({
    remotePort: 3000, localPort: 3000, fixedLocalPort: false, check: false, open: true, url: "http://preview.localhost:3000",
  });
});

test("explicit local ports are fixed rather than silently replaced", () => {
  expect(parseWebArgs(["preview", "3000", "--local-port", "13000"])?.fixedLocalPort).toBe(true);
});

test("supports a separate local port and HTTPS without TLS termination", () => {
  expect(parseWebArgs(["docs", "443", "--local-port", "14443", "--https", "--no-open"])?.url)
    .toBe("https://docs.localhost:14443");
});

test("rejects invalid names, ports, and extra targets", () => {
  for (const args of [["x"], ["../site", "3000"], ["site.example", "3000"], ["site", "0"],
    ["site", "65536"], ["site", "3000", "--local-port", "80"], ["site", "3000", "extra"]]) {
    expect(() => parseWebArgs(args)).toThrow();
  }
});

test("only requests a loopback local forward, with no agent/X11 forwarding or connection reuse", () => {
  const args = sshArgs(3000, 13000);
  expect(args).toContain("127.0.0.1:13000:127.0.0.1:3000");
  expect(args).toContain("[::1]:13000:127.0.0.1:3000");
  expect(args).toContain("ForwardAgent=no");
  expect(args).toContain("ForwardX11=no");
  expect(args).toContain("StrictHostKeyChecking=yes");
  expect(args).toContain("ControlPath=none");
  expect(args).toContain("GatewayPorts=no");
  expect(args).not.toContain("-R");
  expect(args).not.toContain("-D");
});

test("readiness requires both loopback listeners owned by the tunnel", () => {
  expect(hasBothLoopbackListeners("p10\nn127.0.0.1:13000\n", 13000)).toBe(false);
  expect(hasBothLoopbackListeners("p10\nn[::1]:13000\n", 13000)).toBe(false);
  expect(hasBothLoopbackListeners("p10\nn*:13000\n", 13000)).toBe(false);
  expect(hasBothLoopbackListeners("p10\nn127.0.0.1:13000\nn[::1]:13000\n", 13000)).toBe(true);
});

test("rejects inherited forwardings before overriding ClearAllForwardings", () => {
  expect(() => rejectExtraForwardings("hostname home-mac\nclearallforwardings no")).not.toThrow();
  for (const forwarding of ["localforward", "remoteforward", "dynamicforward"]) {
    expect(() => rejectExtraForwardings(`${forwarding} 9000 localhost:9000`)).toThrow();
  }
});

test("web help and invalid arguments are handled before any services start", () => {
  const launcher = join(import.meta.dir, "../home-herdr");
  const help = Bun.spawnSync([launcher, "web", "--help"]);
  expect(help.exitCode).toBe(0);
  expect(help.stdout.toString()).toContain("Ctrl-C closes the tunnel");
  const invalid = Bun.spawnSync([launcher, "web", "../bad", "3000"]);
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stdout.toString()).toBe("");
});
