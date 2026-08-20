#!/usr/bin/env python3
"""HTTP flow for supplier-submitted automatic and reviewed card-hour rebates."""

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
        result = self.request("POST", "/api/auth/login", {
            "account": account, "password": "SupplierRebateFlow#2026",
        })
        self.csrf = result["csrf_token"]

    def request_error(self, method: str, path: str, body: dict, expected_status: int) -> dict:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.csrf:
            headers["X-KAI-CSRF"] = self.csrf
        request = urllib.request.Request(BASE + path, data=payload, method=method, headers=headers)
        try:
            self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            detail = json.loads(error.read().decode("utf-8"))
            assert error.code == expected_status, detail
            return detail
        raise AssertionError(f"{method} {path} unexpectedly succeeded")


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


def insert_delivered_order(server, order_id: str, amount_cents: int, created: str, valid_until: str) -> None:
    with server.db_connect() as connection:
        connection.execute(
            """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,
               unit_price_cents,amount_cents,currency,status,idempotency_key,quote_snapshot_json,
               delivered_at,acceptance_due_at,created_at,updated_at,kind,product_code,settlement_mode)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,'CNY','delivered',?,'{}',?,?,?,?,?,'H100','cash')""",
            (
                order_id, f"KAI-{order_id.upper()}", "buyer_http", "listing_http", "H100", "成都", "HTTP 供应商",
                1000, "GPU 时", max(1, amount_cents // 1000), amount_cents, f"idem-{order_id}",
                created, valid_until, created, created, "gpu",
            ),
        )
        for source in ("supplier", "kai_gateway"):
            connection.execute(
                """INSERT INTO metering_records(id,order_id,source,resource_kind,started_at,ended_at,
                   quantity,performance_json,evidence_digest,signature,status,created_by,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,'received',?,?)""",
                (
                    f"meter_{order_id}_{source}", order_id, source, "gpu", created, valid_until, 1000,
                    "{}", f"evidence-{order_id}-{source}", f"signature-{order_id}-{source}", "buyer_http", created,
                ),
            )


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="cloudpay-rebate-http-", ignore_cleanup_errors=True) as directory:
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
        password_hash = server.hash_password("SupplierRebateFlow#2026")
        with server.db_connect() as connection:
            connection.executemany(
                """INSERT INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                [
                    ("supplier_http", "HTTP 供应商", "supplier-http@example.test", password_hash, "supplier", "certified", created, created),
                    ("buyer_http", "HTTP 采购方", "buyer-http@example.test", password_hash, "buyer", "unverified", created, created),
                    ("admin_http", "HTTP 平台管理员", "admin-http@example.test", password_hash, "admin", "verified", created, created),
                ],
            )
            connection.execute(
                """INSERT INTO listings(id,supplier_user_id,kind,product_code,gpu,provider,region,unit,
                   unit_price_cents,verified_quantity,delivering,status,valid_from,valid_until,created_at,updated_at)
                   VALUES('listing_http','supplier_http','gpu','H100','H100','HTTP 供应商','成都','GPU 时',
                   6000,2000,2000,'active',?,?,?,?)""",
                (created, valid_until, created, created),
            )
        insert_delivered_order(server, "order_auto", 1_000_000, created, valid_until)
        insert_delivered_order(server, "order_review", 6_000_000, created, valid_until)

        process = subprocess.Popen(
            [sys.executable, "server.py"], cwd=ROOT, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        try:
            wait_ready(process)
            supplier = Client(); supplier.login("supplier-http@example.test")
            buyer = Client(); buyer.login("buyer-http@example.test")
            admin = Client(); admin.login("admin-http@example.test")

            buyer_overview = buyer.request("GET", "/api/supplier-rebate/overview")
            assert buyer_overview["eligible"] is False and len(buyer_overview["policy"]["tiers"]) == 5
            buyer_rejected = buyer.request_error("POST", "/api/supplier-rebate/submissions", {
                "order_id": "order_auto", "submission_band": "up_to_50000",
                "transaction_summary": "普通采购账户不能冒充供应商提交返佣申请",
            }, 403)
            assert buyer_rejected["error"]["code"] == "permission_denied"

            auto_accept = buyer.request("POST", "/api/orders/order_auto/accept", {})
            assert auto_accept["order"]["status"] == "accepted"
            supplier_overview = supplier.request("GET", "/api/supplier-rebate/overview")
            assert supplier_overview["rebates"] == []
            eligible_auto = next(row for row in supplier_overview["eligible_orders"] if row["id"] == "order_auto")
            assert eligible_auto["submission_band"] == "up_to_50000"
            auto_submission = supplier.request("POST", "/api/supplier-rebate/submissions", {
                "order_id": "order_auto", "submission_band": "up_to_50000",
                "transaction_summary": "H100 算力资源已经按订单完成交付并通过验收",
            })
            auto_rebate = auto_submission["rebate"]
            assert auto_rebate["rebate_rate_bps"] == 80
            assert auto_rebate["rebate_card_hours"] == 8
            assert auto_rebate["status"] == "issued"
            replay = supplier.request("POST", "/api/supplier-rebate/submissions", {
                "order_id": "order_auto", "submission_band": "up_to_50000",
                "transaction_summary": "重复提交应返回同一条返佣记录而不能重复发放卡时",
            })
            assert replay["idempotent_replay"] is True and replay["rebate"]["id"] == auto_rebate["id"]
            assets = supplier.request("GET", "/api/assets")["assets"]
            auto_asset = next(row for row in assets if row["provider"] == "CloudPay 供应商返佣")
            assert auto_asset["quantity"] == 8
            with server.db_connect() as connection:
                settlement = connection.execute("SELECT * FROM settlements WHERE order_id='order_auto'").fetchone()
                assert settlement["referral_commission_cents"] == 0
                assert settlement["supplier_net_cents"] == 950_000

            review_accept = buyer.request("POST", "/api/orders/order_review/accept", {})
            assert review_accept["order"]["status"] == "accepted"
            mismatch = supplier.request_error("POST", "/api/supplier-rebate/submissions", {
                "order_id": "order_review", "submission_band": "up_to_50000",
                "transaction_summary": "故意选择错误金额区间用于验证服务端订单金额校验",
            }, 422)
            assert mismatch["error"]["code"] == "rebate_band_mismatch"
            review_submission = supplier.request("POST", "/api/supplier-rebate/submissions", {
                "order_id": "order_review", "submission_band": "over_50000",
                "transaction_summary": "大额 H100 算力资源已完成交付，提交平台复核计量与结算内容",
            })
            supplier_overview = supplier.request("GET", "/api/supplier-rebate/overview")
            review_rebate = next(row for row in supplier_overview["rebates"] if row["order_id"] == "order_review")
            assert review_submission["rebate"]["id"] == review_rebate["id"]
            assert review_rebate["rebate_rate_bps"] == 20
            assert review_rebate["rebate_card_hours"] == 2
            assert review_rebate["status"] == "pending_review"
            assert review_rebate["allocation_id"] is None

            admin_overview = admin.request("GET", "/api/admin/overview")
            pending = next(row for row in admin_overview["supplier_rebates"] if row["order_id"] == "order_review")
            approved = admin.request(
                "POST", f"/api/admin/supplier-rebates/{pending['id']}/review",
                {"decision": "approve", "reason": "订单计量与交付记录核验通过"},
            )
            assert approved["status"] == "issued"
            final_overview = supplier.request("GET", "/api/supplier-rebate/overview")
            final_rebate = next(row for row in final_overview["rebates"] if row["order_id"] == "order_review")
            assert final_rebate["status"] == "issued" and final_rebate["allocation_id"]
            final_assets = supplier.request("GET", "/api/assets")["assets"]
            assert sorted(row["quantity"] for row in final_assets if row["provider"] == "CloudPay 供应商返佣") == [2, 8]

            print("supplier card-hour rebate HTTP flow: PASS")
        finally:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    main()
