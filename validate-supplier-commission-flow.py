#!/usr/bin/env python3
"""HTTP contract test for supplier invitation, attribution and commission creation."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.cookiejar import CookieJar
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PORT = 4193
BASE = f"http://127.0.0.1:{PORT}"


class Client:
    def __init__(self) -> None:
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ""

    def request(self, method: str, path: str, body: dict | None = None) -> dict:
        payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {"Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if method != "GET" and self.csrf:
            headers["X-KAI-CSRF"] = self.csrf
        request = urllib.request.Request(BASE + path, data=payload, method=method, headers=headers)
        try:
            with self.opener.open(request, timeout=10) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = json.loads(error.read().decode("utf-8"))
            raise AssertionError(f"{method} {path} -> {error.code}: {detail}") from error
        if result.get("csrf_token"):
            self.csrf = result["csrf_token"]
        return result

    def login(self, account: str) -> None:
        result = self.request("POST", "/api/auth/login", {"account": account, "password": "ReferralFlow#2026"})
        self.csrf = result["csrf_token"]


def wait_ready(process: subprocess.Popen) -> None:
    deadline = time.time() + 15
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError("test server exited before becoming ready")
        try:
            with urllib.request.urlopen(BASE + "/api/health", timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(.2)
    raise RuntimeError("test server did not start")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="cloudpay-referral-http-", ignore_cleanup_errors=True) as directory:
        db_path = Path(directory) / "flow.db"
        env = os.environ.copy()
        env.update({
            "KAI_HOST": "127.0.0.1", "KAI_PORT": str(PORT), "KAI_DB_PATH": str(db_path),
            "KAI_ALLOW_DEMO": "true", "KAI_SEED_CATALOG": "false", "KAI_REQUIRE_SMS": "false",
            "KAI_AUTH_PROVIDER": "local", "KAI_WORKER_INTERVAL_SECONDS": "60",
        })
        os.environ.update({key: value for key, value in env.items() if key.startswith("KAI_")})
        import server

        server.initialize_database()
        created = server.now_iso()
        valid_until = (datetime.now(timezone.utc) + timedelta(days=30)).replace(microsecond=0).isoformat()
        password_hash = server.hash_password("ReferralFlow#2026")
        with server.db_connect() as connection:
            connection.executemany(
                """INSERT INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                [
                    ("supplier_http", "HTTP 供应商", "supplier-http@example.test", password_hash, "supplier", "certified", created, created),
                    ("partner_http", "HTTP 推广伙伴", "partner-http@example.test", password_hash, "buyer", "unverified", created, created),
                    ("buyer_http", "HTTP 采购方", "buyer-http@example.test", password_hash, "buyer", "unverified", created, created),
                    ("admin_http", "HTTP 平台管理员", "admin-http@example.test", password_hash, "admin", "verified", created, created),
                ],
            )
            connection.execute(
                """INSERT INTO listings(id,supplier_user_id,kind,product_code,gpu,provider,region,unit,
                   unit_price_cents,verified_quantity,delivering,status,valid_from,valid_until,created_at,updated_at)
                   VALUES('listing_http','supplier_http','gpu','H100','H100','HTTP 供应商','成都','GPU 时',
                   100000,10,10,'active',?,?,?,?)""",
                (created, valid_until, created, created),
            )

        process = subprocess.Popen(
            [sys.executable, "server.py"], cwd=ROOT, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        try:
            wait_ready(process)
            supplier = Client(); supplier.login("supplier-http@example.test")
            partner = Client(); partner.login("partner-http@example.test")
            buyer = Client(); buyer.login("buyer-http@example.test")
            admin = Client(); admin.login("admin-http@example.test")

            supplier.request("POST", "/api/supplier-referral/program", {
                "commission_rate_percent": 10, "status": "active",
            })
            invitation = supplier.request("POST", "/api/supplier-referral/invitations", {
                "partner_account": "partner-http@example.test",
            })["invitation"]
            assert invitation["status"] == "pending_confirmation"
            assert invitation["commission_rate_bps"] == 1000

            partner_overview = partner.request("GET", "/api/supplier-referral/overview")
            assert len(partner_overview["partner"]["invitations"]) == 1
            partnership = partner.request(
                "POST", f"/api/supplier-referral/invitations/{invitation['id']}/accept", {}
            )["partnership"]
            assert partnership["status"] == "active"

            claim = buyer.request("POST", "/api/supplier-referral/claim", {
                "referral_code": partnership["referral_code"],
            })
            assert claim["attribution"]["status"] == "active"

            with server.db_connect() as connection:
                connection.execute(
                    """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,
                       unit_price_cents,amount_cents,currency,status,idempotency_key,quote_snapshot_json,
                       delivered_at,acceptance_due_at,created_at,updated_at,kind,product_code,settlement_mode)
                       VALUES('order_http','KAI-REFERRAL-HTTP','buyer_http','listing_http','H100','成都','HTTP 供应商',
                       10,'GPU 时',100000,1000000,'CNY','delivered','referral-http-order','{}',?,?,?,?,
                       'gpu','H100','cash')""",
                    (created, valid_until, created, created),
                )
                for source in ("supplier", "kai_gateway"):
                    connection.execute(
                        """INSERT INTO metering_records(id,order_id,source,resource_kind,started_at,ended_at,
                           quantity,performance_json,evidence_digest,signature,status,created_by,created_at)
                           VALUES(?,?,?,?,?,?,?,?,?,?,'received',?,?)""",
                        (f"meter_{source}", "order_http", source, "gpu", created, valid_until, 10,
                         "{}", f"evidence-{source}", f"signature-{source}", "buyer_http", created),
                    )

            accepted = buyer.request("POST", "/api/orders/order_http/accept", {})
            assert accepted["order"]["status"] == "accepted"
            supplier_result = supplier.request("GET", "/api/supplier-referral/overview")
            partner_result = partner.request("GET", "/api/supplier-referral/overview")
            supplier_ledger = supplier_result["supplier"]["commissions"]
            partner_ledger = partner_result["partner"]["commissions"]
            assert len(supplier_ledger) == len(partner_ledger) == 1
            assert supplier_ledger[0]["amount_cents"] == 50000
            with server.db_connect() as connection:
                settlement = connection.execute("SELECT * FROM settlements WHERE order_id='order_http'").fetchone()
                assert settlement["referral_commission_cents"] == 50000
                assert settlement["supplier_net_cents"] == 900000
                elapsed = (datetime.now(timezone.utc) - timedelta(minutes=1)).replace(microsecond=0).isoformat()
                connection.execute("UPDATE settlements SET hold_until=? WHERE order_id='order_http'", (elapsed,))
                connection.execute("UPDATE supplier_referral_commissions SET hold_until=? WHERE order_id='order_http'", (elapsed,))

            maintenance = server.run_maintenance_cycle()
            assert maintenance["payable_settlements"] == 1
            assert maintenance["available_supplier_commissions"] == 1
            admin_overview = admin.request("GET", "/api/admin/overview")
            available = next(row for row in admin_overview["supplier_commissions"] if row["order_id"] == "order_http")
            assert available["status"] == "available"
            paid = admin.request(
                "POST", f"/api/admin/supplier-commissions/{available['id']}/mark-paid",
                {"payout_ref": "LICENSED-REFERRAL-HTTP-001"},
            )
            assert paid["status"] == "paid"
            partner_paid = partner.request("GET", "/api/supplier-referral/overview")
            assert partner_paid["partner"]["commissions"][0]["status"] == "paid"

            print("supplier commission HTTP flow: PASS")
        finally:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    main()
