import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("configure", Path(__file__).parents[1] / "configure.py")
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


class HostValidationTests(unittest.TestCase):
    def test_names_and_tailnet_ipv4(self):
        for host in ("home-mac", "home-mac.tailTEST.ts.net", "home-mac.tailTEST.ts.net.",
                     "100.64.0.1", "100.127.255.254"):
            with self.subTest(host=host):
                configure.validate_host(host)

    def test_rejects_non_tailnet_ips(self):
        for host in ("127.0.0.1", "192.168.1.1", "100.63.255.255", "100.128.0.1", "::1"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                configure.validate_host(host)

    def test_rejects_invalid_names_and_config_injection(self):
        for host in ("", "-host", "host-", "host..example", "a;command", "a b",
                     "host\nHost other", "100.999.1.1", "a" * 64 + ".test"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                configure.validate_host(host)


if __name__ == "__main__":
    unittest.main()
