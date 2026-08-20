#!/usr/bin/env python3
"""End-to-end acceptance test for the phase-1 marketplace workflow."""

from __future__ import annotations

import json
import base64
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from http.cookiejar import CookieJar
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PORT = 4186
BASE = f"http://127.0.0.1:{PORT}"


class Client:
    def __init__(self) -> None:
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ""

    def request(self, method: str, path: str, body: dict | None = None, idem: str | None = None) -> dict:
        payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {"Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if method != "GET" and self.csrf:
            headers["X-KAI-CSRF"] = self.csrf
        if idem:
            headers["Idempotency-Key"] = idem
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

    def get(self, path: str) -> dict:
        return self.request("GET", path)

    def post(self, path: str, body: dict, idem: str | None = None) -> dict:
        return self.request("POST", path, body, idem)


def wait_ready() -> None:
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(BASE + "/api/health", timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(.2)
    raise RuntimeError("test server did not start")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="kai-marketplace-", ignore_cleanup_errors=True) as temp:
        db_path = Path(temp) / "marketplace.db"
        env = os.environ.copy()
        env.update({
            "KAI_HOST": "127.0.0.1", "KAI_PORT": str(PORT), "KAI_DB_PATH": str(db_path),
            "KAI_ALLOW_DEMO": "true", "KAI_SEED_CATALOG": "true", "KAI_REQUIRE_SMS": "false",
            "KAI_AUTH_PROVIDER": "local",
            "KAI_SMS_PROVIDER": "mock", "KAI_ADMIN_ACCOUNT": "ops@kai.test",
            "KAI_ADMIN_PASSWORD": "KaiOpsSecure#2026", "KAI_SETTLEMENT_HOLD_HOURS": "0",
            "KAI_WORKER_INTERVAL_SECONDS": "5", "KAI_ORDER_RESERVATION_MINUTES": "5",
        })
        process = subprocess.Popen(
            [sys.executable, str(ROOT / "server.py")], cwd=ROOT, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        try:
            wait_ready()
            buyer = Client()
            buyer.post("/api/auth/demo-login", {})
            purchase_request = buyer.post("/api/purchase-requests", {
                "product_code": "NVIDIA H100 SXM 80GB", "region": "北京",
                "service_mode": "slice_20gb", "service_hours": 120,
                "cpu_cores": 16, "memory_gb": 64, "storage": "ssd_500",
                "environment": "ubuntu_cuda", "start_at": "2026-08-10T09:00:00+08:00",
            }, "h100-purchase-request-000001")["request"]
            assert purchase_request["requested_gpu_hours"] == 30
            assert buyer.get("/api/purchase-requests")["requests"][0]["id"] == purchase_request["id"]

            admin = Client()
            admin.post("/api/auth/login", {"account": "ops@kai.test", "password": "KaiOpsSecure#2026"})

            supplier = Client()
            supplier.post("/api/auth/register", {
                "name": "首单 GPU 供应企业", "account": "supplier@example.com", "password": "Supplier2026",
            })
            application = supplier.post("/api/suppliers/applications", {
                "enterprise_name": "首单 GPU 供应企业", "credit_code": "91310000MA1K123456",
                "legal_representative": "企业法人", "agent_name": "授权经办人", "contact_phone": "13800138000",
                "declaration_accepted": True, "license_file_name": "business-license.png",
                "license_content_base64": base64.b64encode(
                    b"\x89PNG\r\n\x1a\n" + b"KAI-LICENSE-TEST-EVIDENCE"
                ).decode("ascii"),
            })["application"]
            admin.post(f"/api/admin/suppliers/{application['id']}/review", {
                "decision": "certified", "reason": "企业主体、账户、开票、许可和资源归属核验通过",
                "bank_account_verified": True, "invoice_verified": True,
                "resource_proof_verified": True, "license_verified": True,
            })

            intake = supplier.post("/api/assets/intake", {
                "kind": "gpu", "product_code": "NVIDIA H100 80GB", "region": "成都",
                "quantity": 1000, "unit": "GPU 时", "evidence_summary": "六项验真材料及不可逆 UUID 摘要已提交",
            })["intake"]
            admin.post(f"/api/admin/intakes/{intake['id']}/review", {
                "decision": "verified", "verification_summary": "权属、规格、基准任务、显存、网络、温度、心跳和重复承诺检查通过",
            })
            listing = supplier.post("/api/supplier/listings", {
                "intake_id": intake["id"], "kind": "gpu", "product_code": "NVIDIA H100 80GB · 单卡实例",
                "gpu": "H100", "region": "成都", "sla": "99.5% 标准保障", "trade_mode": "fixed",
                "quantity": 1000, "minimum_quantity": 1, "target_price_cny": 14.9, "floor_price_cny": 13.5,
                "valid_from": "2026-08-06T00:00:00+00:00", "valid_until": "2027-08-06T00:00:00+00:00",
                "price_source": {"type": "platform_reference", "observed_price_cny": 14.6},
            })["listing"]
            admin.post(f"/api/admin/listings/{listing['id']}/review", {
                "decision": "approve", "reason": "规格、容量、价格和有效期符合首单标准产品规则",
            })
            catalog_listing = next(item for item in buyer.get("/api/catalog")["listings"] if item["id"] == listing["id"])

            order = buyer.post("/api/orders", {
                "listing_id": listing["id"], "quantity": 100,
                "quote_snapshot": {
                    "source": "h100_checkout", "listing_version": catalog_listing["version"],
                    "h100_configuration": {
                        "service_mode": "exclusive", "service_hours": 100,
                        "cpu_cores": 32, "memory_gb": 128, "storage": "nvme_1tb",
                        "environment": "pytorch", "start_at": "2026-08-10T09:00:00+08:00",
                    },
                },
            }, "market-order-000001")["order"]
            assert order["service_configuration"]["service_mode"] == "exclusive"
            assert order["service_configuration"]["billable_gpu_hours"] == 100
            payment = buyer.post("/api/payments/create", {"order_id": order["id"], "provider": "alipay"})["payment"]
            assert buyer.post("/api/payments/mock-complete", {"payment_id": payment["id"]})["order"]["status"] == "paid"
            supplier.post(f"/api/supplier/orders/{order['id']}/confirm", {})
            delivered = supplier.post(f"/api/supplier/orders/{order['id']}/deliver", {
                "endpoint_summary": "一次性领取链接已通过安全通道交付", "evidence_digest": "delivery-evidence-0000000001",
            })["order"]
            metering_end = (datetime.fromisoformat(delivered["delivered_at"]) + timedelta(hours=1)).isoformat()
            supplier.post("/api/metering", {
                "order_id": order["id"], "source": "supplier", "started_at": delivered["delivered_at"],
                "ended_at": metering_end, "quantity": 100,
                "performance": {"memory_errors": 0}, "evidence_digest": "supplier-meter-evidence-0001",
                "signature": "supplier-signature-evidence-0001",
            })
            reconciliation = admin.post("/api/metering", {
                "order_id": order["id"], "source": "kai_gateway", "started_at": delivered["delivered_at"],
                "ended_at": metering_end, "quantity": 100,
                "performance": {"probe_errors": 0}, "evidence_digest": "gateway-meter-evidence-00001",
                "signature": "gateway-signature-evidence-00001",
            })["reconciliation"]
            assert reconciliation["ready"] and reconciliation["status"] == "matched"
            assert buyer.post(f"/api/orders/{order['id']}/accept", {})["order"]["status"] == "accepted"

            def verified_listing(kind: str, product_code: str, unit: str, quantity: float, price: float, suffix: str) -> dict:
                intake_row = supplier.post("/api/assets/intake", {
                    "kind": kind, "product_code": product_code, "region": "华东",
                    "quantity": quantity, "unit": unit,
                    "evidence_summary": f"{product_code} ownership, quota and delivery evidence {suffix}",
                })["intake"]
                admin.post(f"/api/admin/intakes/{intake_row['id']}/review", {
                    "decision": "verified", "verification_summary": "Ownership, capacity, delivery and duplicate commitment checks passed",
                })
                listing_row = supplier.post("/api/supplier/listings", {
                    "intake_id": intake_row["id"], "kind": kind, "product_code": product_code,
                    "provider": "KAI verified supplier", "region": "华东", "sla": "99.5% standard SLA",
                    "trade_mode": "fixed", "quantity": quantity, "minimum_quantity": 0.1,
                    "target_price_cny": price, "floor_price_cny": round(price * .9, 4),
                    "valid_from": "2026-08-06T00:00:00+00:00", "valid_until": "2027-08-06T00:00:00+00:00",
                    "price_source": {"type": "verified_supplier_quote", "observed_price_cny": price},
                })["listing"]
                admin.post(f"/api/admin/listings/{listing_row['id']}/review", {
                    "decision": "approve", "reason": "Standard product, valuation scope, SLA and verified inventory passed review",
                })
                return next(item for item in buyer.get("/api/catalog")["listings"] if item["id"] == listing_row["id"])

            token_product = "Qwen3-Max · Alibaba Cloud · 32K · input · cn-east · 2026Q3"
            token_listing = verified_listing("tokenusage", token_product, "百万 Token", 1000, 1.0, "token-usage")
            rack_product = "AIDC 8kW · T3 · dual-carrier · cabinet-month"
            rack_listing = verified_listing("rack", rack_product, "柜月", 5, 6800, "rack-month")

            rack_order = buyer.post("/api/orders", {
                "listing_id": rack_listing["id"], "quantity": 1,
                "quote_snapshot": {"source": "rack_checkout", "listing_version": rack_listing["version"]},
            }, "rack-order-000001")["order"]
            rack_payment = buyer.post("/api/payments/create", {"order_id": rack_order["id"], "provider": "wechat"})["payment"]
            buyer.post("/api/payments/mock-complete", {"payment_id": rack_payment["id"]})
            supplier.post(f"/api/supplier/orders/{rack_order['id']}/confirm", {})
            rack_delivered = supplier.post(f"/api/supplier/orders/{rack_order['id']}/deliver", {
                "endpoint_summary": "Cabinet position, power and network delivery pack issued",
                "evidence_digest": "rack-delivery-evidence-000001",
            })["order"]
            rack_meter_end = (datetime.fromisoformat(rack_delivered["delivered_at"]) + timedelta(hours=1)).isoformat()
            for client, source, digest in ((supplier, "supplier", "rack-supplier-meter-0001"), (admin, "kai_gateway", "rack-gateway-meter-00001")):
                client.post("/api/metering", {
                    "order_id": rack_order["id"], "source": source, "started_at": rack_delivered["delivered_at"],
                    "ended_at": rack_meter_end, "quantity": 1, "performance": {"power_kw": 8, "network": "ready"},
                    "evidence_digest": digest, "signature": f"signed-{digest}",
                })
            assert buyer.post(f"/api/orders/{rack_order['id']}/accept", {})["order"]["status"] == "accepted"

            gpu_asset = next(asset for asset in buyer.get("/api/assets")["assets"] if asset["order_id"] == order["id"])
            swap = buyer.post("/api/swaps", {
                "source_allocation_id": gpu_asset["id"], "source_quantity": 10,
                "target_kind": "tokenusage", "target_product_code": token_product,
                "target_region": "华东", "target_listing_id": token_listing["id"],
            }, "gpu-token-swap-000001")["swap"]
            quoted_swap = admin.post(f"/api/admin/swaps/{swap['id']}/quote", {"target_listing_id": token_listing["id"]})
            assert abs(quoted_swap["target_quantity"] - 149) < 1e-6
            swap_order = buyer.post(f"/api/swaps/{swap['id']}/accept", {})["order"]
            assert swap_order["status"] == "paid" and swap_order["settlement_mode"] == "swap"
            supplier.post(f"/api/supplier/orders/{swap_order['id']}/confirm", {})
            swap_delivered = supplier.post(f"/api/supplier/orders/{swap_order['id']}/deliver", {
                "endpoint_summary": "Token quota and model endpoint delivery package issued",
                "evidence_digest": "swap-token-delivery-evidence-001",
            })["order"]
            swap_meter_end = (datetime.fromisoformat(swap_delivered["delivered_at"]) + timedelta(hours=1)).isoformat()
            for client, source, digest in ((supplier, "supplier", "swap-token-supplier-meter-01"), (admin, "kai_gateway", "swap-token-gateway-meter-001")):
                client.post("/api/metering", {
                    "order_id": swap_order["id"], "source": source, "started_at": swap_delivered["delivered_at"],
                    "ended_at": swap_meter_end, "quantity": quoted_swap["target_quantity"],
                    "performance": {"model": token_product, "error_rate": 0},
                    "evidence_digest": digest, "signature": f"signed-{digest}",
                })
            assert buyer.post(f"/api/orders/{swap_order['id']}/accept", {})["order"]["status"] == "accepted"
            completed_swap = next(item for item in buyer.get("/api/swaps")["swaps"] if item["id"] == swap["id"])
            assert completed_swap["status"] == "completed"

            closing_user = Client()
            closing_user.post("/api/auth/register", {
                "name": "Account Closure Test Enterprise", "account": "closure@example.com", "password": "Closure2026",
            })
            deletion = closing_user.post("/api/account/deletion-request", {
                "password": "Closure2026", "reason": "Release readiness account deletion validation",
            })["request"]
            assert deletion["status"] == "scheduled"
            assert closing_user.post("/api/account/deletion-cancel", {})["status"] == "cancelled"
            deletion = closing_user.post("/api/account/deletion-request", {
                "password": "Closure2026", "reason": "Release readiness account deletion validation",
            })["request"]
            admin.post(f"/api/admin/account-deletions/{deletion['id']}/complete", {})
            with sqlite3.connect(db_path) as database:
                assert database.execute("SELECT lifecycle_status FROM users WHERE id=(SELECT user_id FROM account_deletion_requests WHERE id=?)", (deletion["id"],)).fetchone()[0] == "anonymized"

            dispute = buyer.post("/api/disputes", {
                "order_id": order["id"], "category": "metering", "reason": "采购方发起一次争议流程验收演练",
            })["dispute"]
            admin.post(f"/api/admin/disputes/{dispute['id']}/resolve", {
                "decision": "reject", "resolution": "双源计量与合同约定一致，争议不成立并恢复订单状态",
            })
            invoice = buyer.post("/api/invoices", {
                "order_id": order["id"], "invoice_title": "首单采购测试企业",
                "tax_id": "91310000MA1K654321", "email": "finance@example.com",
            })["invoice"]
            admin.post(f"/api/admin/invoices/{invoice['id']}/issue", {"invoice_ref": "INV-20260806-0001"})
            admin.post("/api/admin/maintenance/run", {})
            overview = admin.get("/api/admin/overview")
            settlement = next(item for item in overview["settlements"] if item["order_id"] == order["id"])
            assert settlement["status"] == "payable"
            admin.post(f"/api/admin/settlements/{settlement['id']}/mark-paid", {"payout_ref": "LICENSED-SPLIT-000001"})

            catalog_listing = next(item for item in buyer.get("/api/catalog")["listings"] if item["id"] == listing["id"])
            refund_order = buyer.post("/api/orders", {
                "listing_id": listing["id"], "quantity": 10,
                "quote_snapshot": {
                    "source": "h100_checkout", "listing_version": catalog_listing["version"],
                    "h100_configuration": {
                        "service_mode": "slice_20gb", "service_hours": 40,
                        "cpu_cores": 16, "memory_gb": 64, "storage": "ssd_500",
                        "environment": "ubuntu_cuda", "start_at": "2026-08-10T10:00:00+08:00",
                    },
                },
            }, "market-order-refund-001")["order"]
            assert refund_order["service_configuration"]["service_mode"] == "slice_20gb"
            assert refund_order["service_configuration"]["billable_gpu_hours"] == 10
            refund_payment = buyer.post("/api/payments/create", {"order_id": refund_order["id"], "provider": "wechat"})["payment"]
            buyer.post("/api/payments/mock-complete", {"payment_id": refund_payment["id"]})
            refund = buyer.post("/api/refunds", {
                "order_id": refund_order["id"], "reason": "首单上线前执行完整退款回滚演练",
            }, "market-refund-000001")["refund"]
            assert admin.post(f"/api/admin/refunds/{refund['id']}/review", {"decision": "approve", "reason": "退款演练批准"})["status"] == "success"

            expiring = buyer.post("/api/orders", {"listing_id": listing["id"], "quantity": 5}, "market-order-expire-001")["order"]
            with sqlite3.connect(db_path) as database:
                database.execute("UPDATE orders SET reservation_expires_at='2020-01-01T00:00:00+00:00' WHERE id=?", (expiring["id"],))
            maintenance = admin.post("/api/admin/maintenance/run", {})["result"]
            assert maintenance["expired_orders"] == 1
            assert next(item for item in buyer.get("/api/orders")["orders"] if item["id"] == expiring["id"])["status"] == "expired"
            admin.post("/api/admin/maintenance/run", {})
            with sqlite3.connect(db_path) as database:
                assert database.execute("SELECT COUNT(*) FROM outbox WHERE status='pending'").fetchone()[0] == 0
                assert database.execute("SELECT COUNT(*) FROM event_deliveries").fetchone()[0] > 0

            print(json.dumps({
                "supplier_certification": "PASS", "resource_verification": "PASS", "server_listing": "PASS",
                "atomic_purchase": "PASS", "supplier_delivery": "PASS", "dual_source_metering": "PASS",
                "h100_demand_registration": "PASS",
                "buyer_acceptance": "PASS", "dispute_resolution": "PASS", "invoice_workflow": "PASS",
                "settlement_ledger": "PASS", "refund_rollback": "PASS", "reservation_expiry": "PASS",
                "outbox_consumer": "PASS", "token_listing_and_swap": "PASS", "rack_cash_purchase": "PASS",
                "account_deletion": "PASS",
            }, ensure_ascii=False, indent=2))
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            output = process.stdout.read() if process.stdout else ""
            if output:
                print(output, file=sys.stderr)


if __name__ == "__main__":
    main()
