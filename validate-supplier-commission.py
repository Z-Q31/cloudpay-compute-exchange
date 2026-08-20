#!/usr/bin/env python3
"""Isolated regression checks for the supplier referral commission ledger."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


def main() -> None:
    with tempfile.TemporaryDirectory(
        prefix="cloudpay-supplier-commission-", ignore_cleanup_errors=True
    ) as directory:
        os.environ["KAI_DB_PATH"] = str(Path(directory) / "commission.db")
        os.environ["KAI_SEED_CATALOG"] = "false"

        import server

        server.initialize_database()
        created = server.now_iso()
        password_hash = server.hash_password("commission-test-password")
        with server.db_connect() as connection:
            users = [
                ("usr_supplier_test", "验收供应商", "supplier-commission@example.test", "supplier", "certified"),
                ("usr_partner_test", "推广伙伴", "partner-commission@example.test", "buyer", "unverified"),
                ("usr_buyer_test", "采购客户", "buyer-commission@example.test", "buyer", "unverified"),
            ]
            connection.executemany(
                """INSERT INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                [(user_id, name, account, password_hash, role, status, created, created)
                 for user_id, name, account, role, status in users],
            )
            connection.execute(
                """INSERT INTO listings(id,supplier_user_id,kind,product_code,gpu,provider,region,unit,
                   unit_price_cents,verified_quantity,status,valid_from,valid_until,created_at,updated_at)
                   VALUES('listing_commission','usr_supplier_test','gpu','H100','H100','验收供应商','成都','GPU 时',
                   1000,1000,'active',?,?,?,?)""",
                (created, (datetime.now(timezone.utc) + timedelta(days=30)).replace(microsecond=0).isoformat(), created, created),
            )
            program = server.ensure_supplier_referral_program(connection, "usr_supplier_test")
            assert program["commission_rate_bps"] == 800
            connection.execute(
                """INSERT INTO supplier_referral_partners(
                   id,supplier_user_id,partner_user_id,commission_rate_bps,referral_code,status,invited_at,accepted_at,updated_at
                   ) VALUES('partner_relation','usr_supplier_test','usr_partner_test',800,'KAI-SUP-TEST0001','active',?,?,?)""",
                (created, created, created),
            )
            connection.execute(
                """INSERT INTO supplier_referral_attributions(
                   id,buyer_user_id,supplier_user_id,partner_relation_id,status,attributed_at,expires_at,updated_at
                   ) VALUES('attribution_test','usr_buyer_test','usr_supplier_test','partner_relation','active',?,?,?)""",
                (created, (datetime.now(timezone.utc) + timedelta(days=30)).replace(microsecond=0).isoformat(), created),
            )
            connection.execute(
                """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,
                   unit_price_cents,amount_cents,currency,status,idempotency_key,quote_snapshot_json,accepted_at,created_at,updated_at)
                   VALUES('order_commission','KAI-COMMISSION-TEST','usr_buyer_test','listing_commission','H100','成都',
                   '验收供应商',1000,'GPU 时',1000,1000000,'CNY','accepted','commission-test','{}',?,?,?)""",
                (created, created, created),
            )
            order = server.fetch_order(connection, "order_commission")
            commission = server.create_supplier_referral_commission(
                connection, order, "usr_supplier_test", created
            )
            assert commission is not None
            assert commission["amount_cents"] == 50000, "8% commission must respect the ¥500 cap"
            duplicate = server.create_supplier_referral_commission(
                connection, order, "usr_supplier_test", created
            )
            assert duplicate["id"] == commission["id"], "order commission must be idempotent"
            connection.execute(
                """INSERT INTO settlements(id,order_id,supplier_user_id,gross_cents,platform_fee_cents,
                   supplier_net_cents,referral_commission_cents,currency,status,hold_until,created_at,updated_at)
                   VALUES('settlement_commission','order_commission','usr_supplier_test',1000000,50000,900000,50000,
                   'CNY','payable',?,?,?)""",
                (created, created, created),
            )
            connection.execute(
                "UPDATE supplier_referral_commissions SET hold_until=? WHERE id=?",
                ((datetime.now(timezone.utc) - timedelta(seconds=1)).replace(microsecond=0).isoformat(), commission["id"]),
            )
            connection.execute(
                """INSERT INTO payments(id,order_id,provider,amount_cents,currency,status,created_at,updated_at)
                   VALUES('payment_commission','order_commission','alipay',1000000,'CNY','success',?,?)""",
                (created, created),
            )
        result = server.run_maintenance_cycle()
        assert result["available_supplier_commissions"] == 1
        with server.db_connect() as connection:
            available = connection.execute(
                "SELECT * FROM supplier_referral_commissions WHERE order_id='order_commission'"
            ).fetchone()
            assert available["status"] == "available"
            connection.execute(
                """INSERT INTO refunds(id,order_id,payment_id,requester_user_id,amount_cents,reason,
                   original_order_status,status,idempotency_key,created_at,updated_at)
                   VALUES('refund_commission','order_commission','payment_commission','usr_buyer_test',1000000,
                   '回归测试退款','accepted','processing','refund-test',?,?)""",
                (created, created),
            )
            refund = connection.execute("SELECT * FROM refunds WHERE id='refund_commission'").fetchone()
            server.apply_refund_success(connection, refund, "refund-provider-test")
            reversed_commission = connection.execute(
                "SELECT * FROM supplier_referral_commissions WHERE order_id='order_commission'"
            ).fetchone()
            assert reversed_commission["status"] == "reversed"
            settlement = connection.execute(
                "SELECT * FROM settlements WHERE order_id='order_commission'"
            ).fetchone()
            assert settlement["referral_commission_cents"] == 50000
            assert settlement["supplier_net_cents"] == 900000

    print("supplier commission regression: PASS")


if __name__ == "__main__":
    main()
