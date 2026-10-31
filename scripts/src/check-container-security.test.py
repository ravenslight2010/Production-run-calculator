import importlib.util
from pathlib import Path
import unittest
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("security", Path(__file__).with_name("check-container-security.py"))
security = importlib.util.module_from_spec(spec)
spec.loader.exec_module(security)


class ContainerSecurityTest(unittest.TestCase):
    def test_kernel_prefix_is_equivalent_for_only_the_expected_capability(self):
        for cap in ("CHOWN", "NET_BIND_SERVICE"):
            for actual in (cap, "CAP_" + cap):
                self.assertTrue(security.matches(f'1001:1001|["ALL"]|["{actual}"]', "1001:1001", '["ALL"]', f'["{cap}"]'))

    def test_empty_capabilities_are_null_or_empty(self):
        for actual in ("null", "[]"):
            self.assertTrue(security.matches(f'node|["ALL"]|{actual}', "node", '["ALL"]', '[]'))

    def test_extra_missing_wrong_or_duplicate_capabilities_are_rejected(self):
        for added in ('[]', 'null', '["CHOWN"]', '["CAP_SYS_ADMIN"]', '["CAP_NET_BIND_SERVICE","CAP_SYS_ADMIN"]', '["NET_BIND_SERVICE","CAP_NET_BIND_SERVICE"]', '"NET_BIND_SERVICE"', '[1]'):
            self.assertFalse(security.matches('1001:1001|["ALL"]|' + added, "1001:1001", '["ALL"]', '["NET_BIND_SERVICE"]'))

    def test_user_and_drop_contract_remain_exact(self):
        for actual in ('root|["ALL"]|["CAP_NET_BIND_SERVICE"]', '1001:1001|[]|["NET_BIND_SERVICE"]', '1001:1001|null|["NET_BIND_SERVICE"]', '1001:1001|["ALL","SYS_ADMIN"]|["NET_BIND_SERVICE"]', 'not inspect data'):
            self.assertFalse(security.matches(actual, "1001:1001", '["ALL"]', '["NET_BIND_SERVICE"]'))


if __name__ == "__main__":
    unittest.main()
