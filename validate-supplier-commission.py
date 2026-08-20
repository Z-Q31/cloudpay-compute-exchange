#!/usr/bin/env python3
"""Regression checks for tiered supplier card-hour rebates."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="cloudpay-supplier-rebate-", ignore_cleanup_errors=True) as directory:
        os.environ.update({
            "KAI_DB_PATH": str(Path(directory) / "rebate.db"),
            "KAI_ALLOW_DEMO": "false",
            "KAI_SEED_CATALOG": "false",
            "KAI_REQUIRE_SMS": "false",
            "KAI_AUTH_PROVIDER": "local",
        })
        import server

        server.initialize_database()
        created = server.now_iso()
        valid_until = (datetime.now(timezone.utc) + timedelta(days=365)).replace(microsecond=0).isoformat()
        password_hash = server.hash_password("SupplierRebate#2026")
        with server.db_connect() as connection:
            connection.executemany(
                """INSERT INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                [
                    ("supplier_rebate", "返佣供应商", "supplier-rebate@test.local", password_hash, "supplier", "certified", created, created),
                    ("buyer_rebate", "返佣采购方", "buyer-rebate@test.local", password_hash, "buyer", "unverified", created, created),
                    ("admin_rebate", "返佣审核员", "admin-rebate@test.local", password_hash, "admin", "verified", created, created),
                ],
            )
            connection.execute(
                """INSERT INTO listings(id,supplier_user_id,kind,product_code,gpu,provider,region,unit,
                   unit_price_cents,verified_quantity,status,valid_from,valid_until,created_at,updated_at)
                   VALUES('listing_rebate','supplier_rebate','gpu','H100','H100','返佣供应商','成都','GPU 时',
                   10000,100000,'active',?,?,?,?)""",
                (created, valid_until, created, created),
            )

        cases = [
            ("tier_1", 100_000, 100, 10.0, "issued"),
            ("tier_2", 1_000_000, 80, 8.0, "issued"),
            ("tier_3", 3_000_000, 50, 5.0, "issued"),
            ("tier_4", 5_000_000, 30, 3.0, "issued"),
            ("tier_5", 5_000_100, 20, 2.0, "pending_review"),
        ]
        with server.db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for order_id, amount_cents, expected_bps, expected_hours, expected_status in cases:
                connection.execute(
                    """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,
                       unit_price_cents,amount_cents,currency,status,idempotency_key,quote_snapshot_json,
                       accepted_at,created_at,updated_at,kind,product_code,settlement_mode)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,'CNY','accepted',?,'{}',?,?,?,?,?,'cash')""",
                    (
                        order_id, f"KAI-{order_id.upper()}", "buyer_rebate", "listing_rebate", "H100", "成都",
                        "返佣供应商", 1000, "GPU 时", 10000, amount_cents, f"idem-{order_id}",
                        created, created, created, "gpu", "H100",
                    ),
                )
                order = server.fetch_order(connection, order_id)
                band = "over_50000" if amount_cents > server.SUPPLIER_REBATE_REVIEW_CENTS else "up_to_50000"
                rebate = server.create_supplier_card_hour_rebate(
                    connection, order, "supplier_rebate", "supplier_rebate", band,
                    f"{order_id} 真实算力交易与交付说明", created,
                )
                assert rebate is not None
                assert rebate["rebate_rate_bps"] == expected_bps
                assert rebate["rebate_card_hours_micros"] == int(expected_hours * server.CARD_HOUR_MICROS)
                assert rebate["status"] == expected_status
                assert bool(rebate["review_required"]) == (expected_status == "pending_review")
                replay = server.create_supplier_card_hour_rebate(
                    connection, order, "supplier_rebate", "supplier_rebate", band,
                    f"{order_id} 真实算力交易与交付说明", created,
                )
                assert replay["id"] == rebate["id"]
            connection.execute("COMMIT")

        with server.db_connect() as connection:
            rows = connection.execute("SELECT * FROM supplier_card_hour_rebates ORDER BY amount_cents").fetchall()
            assert len(rows) == 5
            assert connection.execute(
                "SELECT COUNT(*) FROM allocations WHERE owner_user_id='supplier_rebate' AND provider='CloudPay 供应商返佣'"
            ).fetchone()[0] == 4
            pending = connection.execute(
                "SELECT * FROM supplier_card_hour_rebates WHERE status='pending_review'"
            ).fetchone()
            issued = server.issue_supplier_card_hour_rebate(connection, pending, "admin_rebate", server.now_iso())
            assert issued["status"] == "issued"
            assert issued["allocation_id"]

            first = connection.execute(
                "SELECT * FROM supplier_card_hour_rebates WHERE order_id='tier_1'"
            ).fetchone()
            server.pause_supplier_card_hour_rebate(connection, "tier_1", server.now_iso())
            paused = connection.execute("SELECT * FROM supplier_card_hour_rebates WHERE id=?", (first["id"],)).fetchone()
            assert paused["status"] == "paused"
            assert connection.execute("SELECT status FROM allocations WHERE id=?", (first["allocation_id"],)).fetchone()[0] == "frozen"
            server.restore_supplier_card_hour_rebate(connection, "tier_1", server.now_iso())
            assert connection.execute("SELECT status FROM supplier_card_hour_rebates WHERE id=?", (first["id"],)).fetchone()[0] == "issued"
            server.reverse_supplier_card_hour_rebate(connection, "tier_1", "admin_rebate", server.now_iso())
            assert connection.execute("SELECT status FROM supplier_card_hour_rebates WHERE id=?", (first["id"],)).fetchone()[0] == "reversed"
            allocation = connection.execute("SELECT * FROM allocations WHERE id=?", (first["allocation_id"],)).fetchone()
            assert allocation["status"] == "reversed" and allocation["quantity"] == 0

        assert server.supplier_rebate_rate_bps(99) == 0
        assert server.supplier_rebate_rate_bps(100_000) == 100
        assert server.supplier_rebate_rate_bps(100_001) == 80
        assert server.supplier_rebate_rate_bps(1_000_001) == 50
        assert server.supplier_rebate_rate_bps(3_000_001) == 30
        assert server.supplier_rebate_rate_bps(5_000_001) == 20
        print("supplier card-hour rebate regression: PASS")


if __name__ == "__main__":
    main()
