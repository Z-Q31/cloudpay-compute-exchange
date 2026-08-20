#!/usr/bin/env python3
"""KAI Cloud phase-1 transaction service.

Standard-library-only HTTP service with SQLite persistence. It deliberately keeps
the first production slice narrow: enterprise accounts, verified GPU listings,
atomic reservations, server-side payment callbacks, delivery, acceptance and an
append-only audit trail. Real payment credentials are injected through the
environment; the mock provider is for end-to-end acceptance only.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import importlib.util
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
STATIC_ROOT = (ROOT / "outputs").resolve()
DB_PATH = Path(os.environ.get("KAI_DB_PATH", str(ROOT / "data" / "kai.db"))).resolve()
HOST = os.environ.get("KAI_HOST", "127.0.0.1")
PORT = int(os.environ.get("KAI_PORT", "8081"))
ALLOW_DEMO = os.environ.get("KAI_ALLOW_DEMO", "true").lower() == "true"
SEED_CATALOG = os.environ.get("KAI_SEED_CATALOG", "true").lower() == "true"
COOKIE_SECURE = os.environ.get("KAI_COOKIE_SECURE", "false").lower() == "true"
SESSION_HOURS = int(os.environ.get("KAI_SESSION_HOURS", "12"))
MAX_BODY = 1_048_576
PBKDF2_ROUNDS = 310_000
MOCK_SECRET = os.environ.get("KAI_PAYMENT_MOCK_SECRET", "kai-local-mock-provider-change-me")
REQUIRE_SMS = os.environ.get("KAI_REQUIRE_SMS", "false").lower() == "true"
SMS_PROVIDER = os.environ.get("KAI_SMS_PROVIDER", "disabled").strip().lower()
OTP_TTL_SECONDS = int(os.environ.get("KAI_OTP_TTL_SECONDS", "300"))
OTP_MAX_ATTEMPTS = int(os.environ.get("KAI_OTP_MAX_ATTEMPTS", "5"))
OTP_HASH_SECRET = os.environ.get("KAI_OTP_HASH_SECRET", "")
PUBLIC_BASE_URL = os.environ.get("KAI_PUBLIC_BASE_URL", "").rstrip("/")
PLATFORM_MODE = os.environ.get("KAI_PLATFORM_MODE", "marketplace").strip().lower()
ORDER_RESERVATION_MINUTES = max(5, int(os.environ.get("KAI_ORDER_RESERVATION_MINUTES", "30")))
SETTLEMENT_HOLD_HOURS = max(0, int(os.environ.get("KAI_SETTLEMENT_HOLD_HOURS", "72")))
PLATFORM_FEE_BPS = min(5000, max(0, int(os.environ.get("KAI_PLATFORM_FEE_BPS", "500"))))
SUPPLIER_REBATE_REVIEW_CENTS = 5_000_000
CARD_HOUR_MICROS = 1_000_000
SUPPLIER_REBATE_TIERS = (
    (100_000, 100),
    (1_000_000, 80),
    (3_000_000, 50),
    (5_000_000, 30),
    (None, 20),
)
METERING_TOLERANCE_RATIO = min(.25, max(0, float(os.environ.get("KAI_METERING_TOLERANCE_RATIO", ".02"))))
WORKER_INTERVAL_SECONDS = max(5, int(os.environ.get("KAI_WORKER_INTERVAL_SECONDS", "30")))
ADMIN_ACCOUNT = os.environ.get("KAI_ADMIN_ACCOUNT", "").strip().lower()
ADMIN_PASSWORD = os.environ.get("KAI_ADMIN_PASSWORD", "")
OPERATOR_LEGAL_NAME = os.environ.get("KAI_OPERATOR_LEGAL_NAME", "").strip()
OPERATOR_CREDIT_CODE = os.environ.get("KAI_OPERATOR_CREDIT_CODE", "").strip()
SUPPORT_EMAIL = os.environ.get("KAI_SUPPORT_EMAIL", "").strip()
SUPPORT_PHONE = os.environ.get("KAI_SUPPORT_PHONE", "").strip()
ICP_FILING = os.environ.get("KAI_ICP_FILING", "").strip()
APP_FILING = os.environ.get("KAI_APP_FILING", "").strip()
APP_NAME = os.environ.get("KAI_APP_NAME", "KAI Cloud").strip() or "KAI Cloud"
IOS_BUNDLE_ID = os.environ.get("KAI_IOS_BUNDLE_ID", "com.kaicloud.marketplace").strip()
ANDROID_PACKAGE_ID = os.environ.get("KAI_ANDROID_PACKAGE_ID", "com.kaicloud.marketplace").strip()
AUTH_PROVIDER = os.environ.get("KAI_AUTH_PROVIDER", "kai_identity").strip().lower()
IDENTITY_ISSUER = os.environ.get("KAI_IDENTITY_ISSUER", "https://auth.kai.com/api/auth").rstrip("/")
IDENTITY_CLIENT_ID = os.environ.get("KAI_IDENTITY_CLIENT_ID", "").strip()
IDENTITY_CLIENT_SECRET = os.environ.get("KAI_IDENTITY_CLIENT_SECRET", "").strip()
IDENTITY_REDIRECT_URI = os.environ.get(
    "KAI_IDENTITY_REDIRECT_URI",
    f"{PUBLIC_BASE_URL}/api/auth/kai/callback" if PUBLIC_BASE_URL else "",
).strip()
IDENTITY_MOBILE_REDIRECT_URI = os.environ.get(
    "KAI_IDENTITY_MOBILE_REDIRECT_URI",
    f"{PUBLIC_BASE_URL}/api/auth/kai/mobile/callback" if PUBLIC_BASE_URL else "",
).strip()
MOBILE_APP_CALLBACK_URI = os.environ.get(
    "KAI_MOBILE_APP_CALLBACK_URI", "cloudpay://auth/callback"
).strip()
IDENTITY_AUTHORIZATION_ENDPOINT = os.environ.get(
    "KAI_IDENTITY_AUTHORIZATION_ENDPOINT", f"{IDENTITY_ISSUER}/oauth2/authorize"
).strip()
IDENTITY_TOKEN_ENDPOINT = os.environ.get(
    "KAI_IDENTITY_TOKEN_ENDPOINT", f"{IDENTITY_ISSUER}/oauth2/token"
).strip()
IDENTITY_USERINFO_ENDPOINT = os.environ.get(
    "KAI_IDENTITY_USERINFO_ENDPOINT", f"{IDENTITY_ISSUER}/oauth2/userinfo"
).strip()
IDENTITY_TRANSACTION_MINUTES = 10
MOBILE_LOGIN_TICKET_MINUTES = 2

RATE_LOCK = threading.Lock()
RATE_BUCKETS: dict[str, list[float]] = {}

MARKET_PRODUCTS = {
    "gpu": [
        {"id": "H100", "name": "NVIDIA H100 80GB", "base": 14.90, "unit": "元 / GPU 时"},
        {"id": "H200", "name": "NVIDIA H200 141GB", "base": 18.80, "unit": "元 / GPU 时"},
        {"id": "A100", "name": "NVIDIA A100 80GB", "base": 9.82, "unit": "元 / GPU 时"},
        {"id": "MI300X", "name": "AMD MI300X 192GB", "base": 11.70, "unit": "元 / GPU 时"},
        {"id": "910B", "name": "华为昇腾 910B", "base": 8.70, "unit": "元 / GPU 时"},
    ],
    "token": [
        {"id": "gpt5-mini-mixed", "name": "GPT-5 mini · KAI 网关 · 32K · 组合用量", "base": 18.70, "unit": "元 / 百万 Token"},
        {"id": "deepseek-v3-mixed", "name": "DeepSeek-V3 · KAI 网关 · 32K · 组合用量", "base": 12.10, "unit": "元 / 百万 Token"},
        {"id": "qwen3-32b-mixed", "name": "Qwen3-32B · KAI 网关 · 32K · 组合用量", "base": 9.40, "unit": "元 / 百万 Token"},
        {"id": "kimi-k2-mixed", "name": "Kimi K2 · KAI 网关 · 32K · 组合用量", "base": 11.00, "unit": "元 / 百万 Token"},
    ],
    "rack": [
        {"id": "rack20", "name": "20kW 标准风冷机柜", "base": 28000, "unit": "元 / 柜月"},
        {"id": "rack40", "name": "40kW 液冷机柜", "base": 65100, "unit": "元 / 柜月"},
        {"id": "rack80", "name": "80kW 高密液冷机柜", "base": 154560, "unit": "元 / 柜月"},
    ],
    "server": [
        {"id": "h100x8", "name": "NVIDIA H100 80GB × 8 整机", "base": 119.20, "unit": "元 / 整机时"},
        {"id": "h200x8", "name": "NVIDIA H200 141GB × 8 整机", "base": 150.40, "unit": "元 / 整机时"},
        {"id": "a100x8", "name": "NVIDIA A100 80GB × 8 整机", "base": 78.56, "unit": "元 / 整机时"},
        {"id": "l40sx4", "name": "NVIDIA L40S 48GB × 4 整机", "base": 32.80, "unit": "元 / 整机时"},
        {"id": "cpu512", "name": "双路 CPU · 512GB 内存服务器", "base": 6.80, "unit": "元 / 整机时"},
    ],
}
MARKET_REGIONS = {
    "beijing": ("北京", 1.18), "shanghai": ("上海", 1.16),
    "chengdu": ("成都", .92), "guizhou": ("贵州", .82),
    "ningxia": ("宁夏", .80), "hongkong": ("中国香港", 1.32),
    "singapore": ("新加坡", 1.48),
}
MARKET_INTERVALS = {
    "5m": 300, "15m": 900, "1h": 3600, "4h": 14400,
    "1d": 86400, "1w": 604800, "1mo": 2592000,
}
H100_SERVICE_MODES = {
    "exclusive": {"label": "H100 80GB 独占", "billing_factor": 1.0, "gpu_memory_gb": 80},
    "slice_20gb": {"label": "H100 20GB 切片", "billing_factor": 0.25, "gpu_memory_gb": 20},
}
H100_CPU_OPTIONS = {16, 32, 64}
H100_MEMORY_OPTIONS = {64, 128, 256}
H100_STORAGE_OPTIONS = {
    "ssd_500": "500GB SSD", "nvme_1tb": "1TB NVMe", "nvme_2tb": "2TB NVMe",
}
H100_ENVIRONMENT_OPTIONS = {
    "ubuntu_cuda": "Ubuntu + CUDA", "pytorch": "Ubuntu + CUDA + PyTorch",
    "tensorflow": "Ubuntu + CUDA + TensorFlow",
}
RESOURCE_UNITS = {
    "gpu": {"GPU 时"},
    "tokencap": {"Token 容量时"},
    "tokenusage": {"百万 Token"},
    "rack": {"柜月", "kW 月"},
}
RESOURCE_KIND_LABELS = {
    "gpu": "GPU 算力", "tokencap": "Token 容量时",
    "tokenusage": "百万 Token 实际用量", "rack": "柜月",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def future_iso(hours: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).replace(microsecond=0).isoformat()


def future_minutes_iso(minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).replace(microsecond=0).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def db_connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=15000")
    return connection


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt_b64, expected_b64 = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_b64.encode())
        expected = base64.urlsafe_b64decode(expected_b64.encode())
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def safe_return_to(value: object) -> str:
    target = str(value or "/").strip()
    if len(target) > 600 or not target.startswith("/") or target.startswith("//"):
        return "/"
    if "\\" in target or any(ord(character) < 32 for character in target):
        return "/"
    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc:
        return "/"
    return parsed.path + (f"?{parsed.query}" if parsed.query else "")


def normalize_phone(value: object) -> str:
    phone = re.sub(r"[\s()-]", "", str(value or "").strip())
    if phone.startswith("+86"):
        phone = phone[3:]
    elif phone.startswith("0086"):
        phone = phone[4:]
    if not re.fullmatch(r"1[3-9]\d{9}", phone):
        raise ApiError(422, "请输入有效的中国大陆手机号", "invalid_phone")
    return phone


def otp_digest(record_id: str, phone: str, code: str) -> str:
    secret = OTP_HASH_SECRET or (MOCK_SECRET if ALLOW_DEMO else "")
    if not secret:
        raise ApiError(503, "验证码安全密钥尚未配置", "otp_secret_not_configured")
    message = f"{record_id}|{phone}|register|{code}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def environment_file_ready(name: str) -> bool:
    value = os.environ.get(name, "").strip()
    if not value:
        return False
    try:
        candidate = Path(value).expanduser().resolve()
        return candidate.is_file() and candidate.stat().st_size > 0
    except (OSError, RuntimeError):
        return False


def sms_readiness() -> dict:
    if SMS_PROVIDER == "mock" and ALLOW_DEMO:
        return {"provider": "mock", "configured": True, "required": REQUIRE_SMS, "missing": []}
    if SMS_PROVIDER != "aliyun":
        return {"provider": SMS_PROVIDER, "configured": False, "required": REQUIRE_SMS,
                "missing": ["阿里云短信通道"]}
    checks = {
        "RAM AccessKey ID": bool(os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_ID", "").strip()),
        "RAM AccessKey Secret": bool(os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET", "").strip()),
        "短信签名": bool(os.environ.get("KAI_SMS_SIGN_NAME", "").strip()),
        "验证码模板": bool(os.environ.get("KAI_SMS_TEMPLATE_CODE", "").strip()),
        "验证码安全密钥": bool(OTP_HASH_SECRET),
        "阿里云短信官方 SDK": importlib.util.find_spec("alibabacloud_dysmsapi20170525") is not None,
    }
    missing = [label for label, ready in checks.items() if not ready]
    return {"provider": "aliyun", "configured": not missing, "required": REQUIRE_SMS, "missing": missing}


def identity_readiness() -> dict:
    checks = {
        "KAI Identity Client ID": bool(IDENTITY_CLIENT_ID),
        "KAI Identity Client Secret": bool(IDENTITY_CLIENT_SECRET),
        "CloudPay HTTPS 回调地址": IDENTITY_REDIRECT_URI.startswith("https://"),
        "CloudPay App HTTPS 回调地址": IDENTITY_MOBILE_REDIRECT_URI.startswith("https://"),
        "CloudPay App 原生回跳地址": bool(re.fullmatch(r"[a-z][a-z0-9+.-]*://[^\s]+", MOBILE_APP_CALLBACK_URI)),
        "KAI Identity HTTPS 授权端点": IDENTITY_AUTHORIZATION_ENDPOINT.startswith("https://"),
        "KAI Identity HTTPS令牌端点": IDENTITY_TOKEN_ENDPOINT.startswith("https://"),
        "KAI Identity HTTPS 用户信息端点": IDENTITY_USERINFO_ENDPOINT.startswith("https://"),
    }
    missing = [label for label, ready in checks.items() if not ready]
    return {
        "provider": "kai_identity",
        "configured": not missing,
        "missing": missing,
        "issuer": IDENTITY_ISSUER,
        "start_url": "/api/auth/kai/start?return_to=/",
        "mobile_start_url": "/api/auth/kai/mobile/start?return_to=/",
        "registration_url": "https://auth.kai.com/sign-up",
        "cloud_login_url": "https://cloud.kai.com/login",
    }


def payment_readiness(provider: str) -> dict:
    prefix = f"KAI_{provider.upper()}"
    labels = {
        f"{prefix}_MERCHANT_ID": "商户号",
        f"{prefix}_ADAPTER_URL": "官方 SDK 支付适配服务",
        f"{prefix}_CALLBACK_SECRET": "适配服务回调密钥",
        f"{prefix}_MARKETPLACE_MODE": "子商户或持牌分账配置",
    }
    missing = [label for key, label in labels.items() if not os.environ.get(key, "").strip()]
    if PLATFORM_MODE == "marketplace" and os.environ.get(f"{prefix}_MARKETPLACE_MODE", "").strip().lower() != "enabled":
        if "子商户或持牌分账配置" not in missing:
            missing.append("子商户或持牌分账配置")
    adapter_url = os.environ.get(f"{prefix}_ADAPTER_URL", "").strip()
    if adapter_url and not adapter_url.startswith("https://"):
        missing.append("HTTPS 支付适配服务地址")
    if not PUBLIC_BASE_URL.startswith("https://"):
        missing.append("HTTPS 公网域名")
    configured = not missing
    return {
        "provider": provider,
        "configured": configured,
        "missing": missing,
        "channels": ["电脑网站支付", "手机网站支付"] if provider == "alipay" else ["Native 二维码", "H5 支付"],
    }


def integration_readiness() -> dict:
    marketplace_ready = PLATFORM_MODE == "marketplace"
    release_checks = {
        "HTTPS 公网域名": PUBLIC_BASE_URL.startswith("https://"),
        "运营主体法定名称": bool(OPERATOR_LEGAL_NAME),
        "运营主体统一社会信用代码": bool(OPERATOR_CREDIT_CODE),
        "用户支持邮箱": bool(SUPPORT_EMAIL),
        "用户支持电话": bool(SUPPORT_PHONE),
        "ICP 备案号": bool(ICP_FILING),
        "APP 备案号": bool(APP_FILING),
        "KAI Identity 统一登录": identity_readiness()["configured"],
        "支付宝真实支付通道": payment_readiness("alipay")["configured"],
        "微信支付真实支付通道": payment_readiness("wechat")["configured"],
    }
    return {
        "ok": True,
        "platform_mode": PLATFORM_MODE,
        "auth_provider": AUTH_PROVIDER,
        "marketplace_ready": marketplace_ready,
        "public_https": PUBLIC_BASE_URL.startswith("https://"),
        "identity": identity_readiness(),
        "sms": sms_readiness(),
        "payment": {
            "alipay": payment_readiness("alipay"),
            "wechat": payment_readiness("wechat"),
        },
        "transaction_capabilities": {
            "supplier_review": True, "resource_verification": True, "server_listings": True,
            "reservation_expiry": True, "supplier_delivery": True, "dual_source_metering": True,
            "disputes_and_refunds": True, "settlement_ledger": True, "invoice_workflow": True,
            "supplier_card_hour_rebate": True,
            "gpu_token_rack": True, "swap_rfq": True, "account_deletion_request": True,
        },
        "app_release": {
            "app_name": APP_NAME,
            "ios_bundle_id": IOS_BUNDLE_ID,
            "android_package_id": ANDROID_PACKAGE_ID,
            "ready": all(release_checks.values()),
            "checks": release_checks,
            "blockers": [label for label, ready in release_checks.items() if not ready],
        },
    }


def add_column_if_missing(connection: sqlite3.Connection, table: str, name: str, definition: str) -> None:
    columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}
    if name not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


def require_idempotency_key(headers) -> str:
    value = headers.get("Idempotency-Key", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{12,120}", value):
        raise ApiError(422, "缺少有效幂等键", "invalid_idempotency_key")
    return value


def market_product(kind: str, product_id: str) -> dict:
    product = next((item for item in MARKET_PRODUCTS.get(kind, []) if item["id"] == product_id), None)
    if not product:
        raise ApiError(422, "行情产品不存在", "market_product_not_found")
    return product


def deterministic_ratio(seed: str) -> float:
    value = int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12], 16)
    return (value / float(0xFFFFFFFFFFFF)) * 2 - 1


def build_market_candles(kind: str, product_id: str, region_id: str,
                         interval: str, limit: int = 72) -> dict:
    if kind not in MARKET_PRODUCTS:
        raise ApiError(422, "行情类型无效", "invalid_market_kind")
    if region_id not in MARKET_REGIONS:
        raise ApiError(422, "行情地区无效", "invalid_market_region")
    if interval not in MARKET_INTERVALS:
        raise ApiError(422, "K 线周期无效", "invalid_market_interval")
    product = market_product(kind, product_id)
    region_name, region_factor = MARKET_REGIONS[region_id]
    seconds = MARKET_INTERVALS[interval]
    limit = max(24, min(limit, 120))
    current_bucket = int(time.time()) // seconds * seconds
    base = float(product["base"]) * region_factor
    source = "platform_reference"
    if kind == "gpu":
        with db_connect() as connection:
            rows = connection.execute(
                "SELECT unit_price_cents FROM listings WHERE status='active' AND gpu=? AND region=? AND valid_from<=? AND valid_until>?",
                (product_id, region_name, now_iso(), now_iso()),
            ).fetchall()
        if rows:
            base = sum(row["unit_price_cents"] for row in rows) / len(rows) / 100
            source = "verified_listing"

    volatility = {"gpu": .010, "token": .016, "rack": .005, "server": .008}[kind]
    volume_base = {"gpu": 480, "token": 1800, "rack": 12, "server": 96}[kind]
    candles = []
    previous_close = base * (1 + deterministic_ratio(f"{kind}|{product_id}|{region_id}|start") * volatility)
    for offset in range(limit - 1, -1, -1):
        stamp = current_bucket - offset * seconds
        cycle = deterministic_ratio(f"cycle|{product_id}|{region_id}|{stamp // (seconds * 12)}") * volatility * .7
        move = deterministic_ratio(f"close|{kind}|{product_id}|{region_id}|{stamp}") * volatility
        open_price = previous_close
        close_price = max(base * .6, open_price * (1 + move + cycle * .12))
        wick_up = abs(deterministic_ratio(f"high|{kind}|{product_id}|{stamp}")) * volatility * .8
        wick_down = abs(deterministic_ratio(f"low|{kind}|{product_id}|{stamp}")) * volatility * .8
        high_price = max(open_price, close_price) * (1 + wick_up)
        low_price = min(open_price, close_price) * (1 - wick_down)
        volume = volume_base * (1 + abs(move) / volatility * 1.8) * (1 + abs(cycle) / volatility)
        candles.append({
            "time": stamp,
            "open": round(open_price, 4), "high": round(high_price, 4),
            "low": round(low_price, 4), "close": round(close_price, 4),
            "volume": round(volume, 2),
        })
        previous_close = close_price

    if candles:
        live = candles[-1]
        progress = (time.time() - current_bucket) / seconds
        direction = deterministic_ratio(f"live|{kind}|{product_id}|{region_id}|{current_bucket}") * volatility
        live_close = live["open"] * (1 + direction * progress)
        live["close"] = round(live_close, 4)
        live["high"] = round(max(live["open"], live_close) * (1 + abs(direction) * .18), 4)
        live["low"] = round(min(live["open"], live_close) * (1 - abs(direction) * .14), 4)
        live["volume"] = round(live["volume"] * max(.08, progress), 2)

    return {
        "ok": True, "kind": kind, "product": {key: product[key] for key in ("id", "name", "unit")},
        "region": {"id": region_id, "name": region_name}, "interval": interval,
        "source": source, "reference_only": True, "candles": candles,
        "updated_at": now_iso(),
        "notice": "平台报价参考盘，展示同口径报价变化，不代表外部交易所成交价；订单执行价以服务端库存、有效期和双方确认为准。",
        "options": {
            "products": {key: [{"id": item["id"], "name": item["name"], "unit": item["unit"]} for item in value]
                         for key, value in MARKET_PRODUCTS.items()},
            "regions": [{"id": key, "name": value[0]} for key, value in MARKET_REGIONS.items()],
            "intervals": list(MARKET_INTERVALS.keys()),
        },
    }


APP_MARKET_KIND_MAP = {"gpu": "gpu", "cabinet": "rack", "token": "token", "server": "server"}
APP_MARKET_RANGES = {
    ("1d", "15m"): 96,
    ("7d", "4h"): 42,
    ("30d", "1d"): 30,
}


def app_market_instrument_id(kind: str, product_id: str, region_id: str) -> str:
    return f"{kind}:{product_id}:{region_id}"


def parse_app_market_instrument(value: str) -> tuple[str, str, str]:
    parts = str(value or "").split(":")
    if len(parts) != 3:
        raise ApiError(422, "行情产品标识无效", "invalid_market_instrument")
    kind, product_id, region_id = parts
    market_product(kind, product_id)
    if region_id not in MARKET_REGIONS:
        raise ApiError(422, "行情地区无效", "invalid_market_region")
    return kind, product_id, region_id


def app_market_dimensions(kind: str, product: dict, region_id: str) -> dict:
    dimensions = {
        "product": product["id"],
        "region": MARKET_REGIONS[region_id][0],
        "priceType": "平台参考价",
        "currency": "CNY",
    }
    if kind == "token":
        dimensions.update({
            "provider": "KAI 网关",
            "model": product["name"].split(" · ")[0],
            "contextTier": "32K",
            "usageType": "输入/缓存/输出组合用量",
        })
    elif kind == "rack":
        dimensions.update({"contractTerm": "月", "powerIncluded": "以具体报价为准"})
    elif kind == "server":
        dimensions.update({"billingUnit": "整机时", "networkAndStorage": "以具体报价为准"})
    else:
        dimensions.update({"billingUnit": "单卡时", "offerType": "按需参考"})
    return dimensions


def app_market_instruments(category: str) -> dict:
    kind = APP_MARKET_KIND_MAP.get(category)
    if not kind:
        raise ApiError(422, "行情类型无效", "invalid_market_category")
    items = []
    for product in MARKET_PRODUCTS[kind]:
        for region_id, (region_name, _) in MARKET_REGIONS.items():
            payload = build_market_candles(kind, product["id"], region_id, "1h", 24)
            candles = payload["candles"]
            first = candles[0]
            last = candles[-1]
            source = payload["source"]
            items.append({
                "instrumentId": app_market_instrument_id(kind, product["id"], region_id),
                "category": category,
                "displayName": product["name"],
                "subtitle": product["unit"],
                "region": region_name,
                "unit": product["unit"].replace(" / ", "/"),
                "currency": "CNY",
                "priceFen": max(1, round(last["close"] * 100)),
                "lowFen": max(1, round(min(item["low"] for item in candles) * 100)),
                "highFen": max(1, round(max(item["high"] for item in candles) * 100)),
                "changeBps": round((last["close"] / first["open"] - 1) * 10000) if first["open"] else 0,
                "quoteCount": len(candles),
                "pointCount": len(candles),
                "observedAt": payload["updated_at"],
                "sourceLabel": "已验真挂牌" if source == "verified_listing" else "平台参考盘",
                "sourceUrl": None,
                "dataMode": "live" if source == "verified_listing" else "demo",
                "dimensions": app_market_dimensions(kind, product, region_id),
            })
    return {"ok": True, "items": items}


def app_market_candles(instrument_id: str, range_id: str, interval: str) -> dict:
    kind, product_id, region_id = parse_app_market_instrument(instrument_id)
    limit = APP_MARKET_RANGES.get((range_id, interval))
    if not limit:
        raise ApiError(422, "行情时间范围与周期不匹配", "invalid_market_period")
    payload = build_market_candles(kind, product_id, region_id, interval, limit)
    seconds = MARKET_INTERVALS[interval]
    return {
        "ok": True,
        "items": [{
            "startAt": datetime.fromtimestamp(item["time"], timezone.utc).isoformat(),
            "endAt": datetime.fromtimestamp(item["time"] + seconds, timezone.utc).isoformat(),
            "openFen": max(1, round(item["open"] * 100)),
            "highFen": max(1, round(item["high"] * 100)),
            "lowFen": max(1, round(item["low"] * 100)),
            "closeFen": max(1, round(item["close"] * 100)),
            "quoteCount": max(1, round(item["volume"])),
        } for item in payload["candles"]],
        "source": payload["source"],
        "referenceOnly": payload["reference_only"],
        "notice": payload["notice"],
    }


def app_market_status() -> dict:
    with db_connect() as connection:
        verified_count = connection.execute(
            "SELECT COUNT(*) AS total FROM listings WHERE status='active'"
        ).fetchone()["total"]
    instrument_count = sum(len(products) * len(MARKET_REGIONS) for products in MARKET_PRODUCTS.values())
    return {
        "ok": True,
        "configured": True,
        "pointCount": instrument_count * 24,
        "instrumentCount": instrument_count,
        "dataMode": "live" if verified_count else "demo",
        "lastSync": {"finishedAt": now_iso(), "records": verified_count},
    }


def send_verification_message(phone: str, code: str) -> str:
    readiness = sms_readiness()
    if not readiness["configured"]:
        raise ApiError(503, "短信验证码通道尚未配置完成", "sms_provider_not_configured")
    if SMS_PROVIDER == "mock" and ALLOW_DEMO:
        return uid("smsmock")
    try:
        from alibabacloud_dysmsapi20170525.client import Client as DysmsClient
        from alibabacloud_dysmsapi20170525 import models as sms_models
        from alibabacloud_tea_openapi import models as open_api_models
        from alibabacloud_tea_util import models as util_models

        config = open_api_models.Config(
            access_key_id=os.environ["ALIBABA_CLOUD_ACCESS_KEY_ID"],
            access_key_secret=os.environ["ALIBABA_CLOUD_ACCESS_KEY_SECRET"],
        )
        config.endpoint = "dysmsapi.aliyuncs.com"
        client = DysmsClient(config)
        request = sms_models.SendSmsRequest(
            phone_numbers=phone,
            sign_name=os.environ["KAI_SMS_SIGN_NAME"],
            template_code=os.environ["KAI_SMS_TEMPLATE_CODE"],
            template_param=json.dumps({"code": code}, separators=(",", ":")),
        )
        response = client.send_sms_with_options(request, util_models.RuntimeOptions())
        body = response.body
        if str(getattr(body, "code", "")) != "OK":
            raise ApiError(502, "短信服务未接受本次发送请求", "sms_provider_rejected")
        return str(getattr(body, "biz_id", "") or getattr(body, "request_id", "") or uid("sms"))
    except ApiError:
        raise
    except Exception as error:
        print(f"SMS provider error: {type(error).__name__}")
        raise ApiError(502, "短信验证码发送失败，请稍后重试", "sms_delivery_failed")


def verify_adapter_response(body: bytes, signature: str, secret: str) -> None:
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature or ""):
        raise ApiError(502, "支付适配服务响应签名无效", "invalid_adapter_response_signature")


def request_provider_checkout(provider: str, payment_id: str, order: sqlite3.Row,
                              channel: str) -> str:
    readiness = payment_readiness(provider)
    if not readiness["configured"]:
        raise ApiError(503, f"{provider} 支付通道尚未配置完成", "payment_provider_not_configured")
    prefix = f"KAI_{provider.upper()}"
    payload = {
        "event_id": uid("checkout"),
        "payment_id": payment_id,
        "order_id": order["id"],
        "order_no": order["order_no"],
        "subject": f"KAI Cloud 算力订单 {order['order_no']}",
        "amount_cents": order["amount_cents"],
        "currency": "CNY",
        "merchant_id": os.environ[f"{prefix}_MERCHANT_ID"],
        "channel": channel,
        "notify_url": f"{PUBLIC_BASE_URL}/api/payments/callback/{provider}",
        "return_url": f"{PUBLIC_BASE_URL}/?payment_return={order['order_no']}",
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    secret = os.environ[f"{prefix}_CALLBACK_SECRET"]
    signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    request = Request(
        os.environ[f"{prefix}_ADAPTER_URL"], data=body, method="POST",
        headers={
            "Content-Type": "application/json", "X-KAI-Gateway-Signature": signature,
            "Idempotency-Key": payload["event_id"],
        },
    )
    try:
        with urlopen(request, timeout=12) as response:
            response_body = response.read(MAX_BODY)
            verify_adapter_response(
                response_body, response.headers.get("X-KAI-Adapter-Signature", ""), secret,
            )
            result = json.loads(response_body.decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"Payment adapter error ({provider}): {type(error).__name__}")
        raise ApiError(502, "支付机构收银台暂时不可用，请稍后重试", "payment_checkout_unavailable")
    checkout_url = str(result.get("checkout_url") or "").strip()
    parsed = urlparse(checkout_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ApiError(502, "支付机构返回了无效的收银台地址", "invalid_checkout_url")
    return checkout_url


def request_provider_refund(provider: str, refund: sqlite3.Row, order: sqlite3.Row) -> dict:
    readiness = payment_readiness(provider)
    if not readiness["configured"]:
        raise ApiError(503, f"{provider} 退款通道尚未配置完成", "payment_provider_not_configured")
    prefix = f"KAI_{provider.upper()}"
    payload = {
        "event_id": uid("refund_request"), "refund_id": refund["id"], "order_id": order["id"],
        "order_no": order["order_no"], "amount_cents": refund["amount_cents"], "currency": "CNY",
        "merchant_id": os.environ[f"{prefix}_MERCHANT_ID"],
        "notify_url": f"{PUBLIC_BASE_URL}/api/payments/refund-callback/{provider}",
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    secret = os.environ[f"{prefix}_CALLBACK_SECRET"]
    signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    request = Request(
        os.environ[f"{prefix}_ADAPTER_URL"].rstrip("/") + "/refund", data=body, method="POST",
        headers={
            "Content-Type": "application/json", "X-KAI-Gateway-Signature": signature,
            "Idempotency-Key": payload["event_id"],
        },
    )
    try:
        with urlopen(request, timeout=12) as response:
            response_body = response.read(MAX_BODY)
            verify_adapter_response(
                response_body, response.headers.get("X-KAI-Adapter-Signature", ""), secret,
            )
            result = json.loads(response_body.decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"Refund adapter error ({provider}): {type(error).__name__}")
        raise ApiError(502, "退款请求暂时无法提交，请稍后重试", "refund_adapter_unavailable")
    if str(result.get("status")) not in ("ACCEPTED", "PROCESSING", "SUCCESS"):
        raise ApiError(502, "支付机构未接受退款请求", "refund_provider_rejected")
    return result


def clean_text(value: object, field: str, minimum: int = 1, maximum: int = 160) -> str:
    text = str(value or "").strip()
    if len(text) < minimum or len(text) > maximum:
        raise ApiError(422, f"{field}长度不符合要求")
    return text


def normalize_iso_time(value: object, field: str) -> str:
    text = clean_text(value, field, 10, 40)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(422, f"{field}格式无效", "invalid_datetime")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone(timedelta(hours=8)))
    return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def public_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "account": row["account"],
        "role": row["role"],
        "enterprise_status": row["enterprise_status"],
        "lifecycle_status": row["lifecycle_status"] if "lifecycle_status" in row.keys() else "active",
        "must_change_password": bool(row["must_change_password"]) if "must_change_password" in row.keys() else False,
    }


def order_dict(row: sqlite3.Row) -> dict:
    try:
        raw_snapshot = json.loads(row["quote_snapshot_json"] or "{}")
    except (TypeError, json.JSONDecodeError):
        raw_snapshot = {}
    quote_snapshot = {
        "source": raw_snapshot.get("source"),
        "gpu": raw_snapshot.get("gpu"),
        "listing_version": raw_snapshot.get("listing_version"),
    }
    if isinstance(raw_snapshot.get("h100_configuration"), dict):
        allowed = {
            "service_mode", "service_mode_label", "gpu_memory_gb", "billing_factor",
            "service_hours", "billable_gpu_hours", "cpu_cores", "memory_gb", "storage",
            "storage_label", "environment", "environment_label", "operating_system",
            "start_at", "delivery_mode",
        }
        quote_snapshot["h100_configuration"] = {
            key: value for key, value in raw_snapshot["h100_configuration"].items() if key in allowed
        }
    delivery = None
    if "delivery_task_status" in row.keys() and row["delivery_task_status"]:
        delivery = {
            "status": row["delivery_task_status"],
            "credential_reference": row["delivery_credential_reference"],
            "endpoint_summary": row["delivery_endpoint_summary"],
            "evidence_digest": row["delivery_evidence_digest"],
            "started_at": row["delivery_started_at"],
            "delivered_at": row["delivery_task_delivered_at"],
            "acceptance_due_at": row["delivery_task_acceptance_due_at"],
        }
    return {
        "id": row["id"],
        "order_no": row["order_no"],
        "listing_id": row["listing_id"],
        "gpu": row["gpu"],
        "kind": row["kind"] if "kind" in row.keys() else "gpu",
        "product_code": row["product_code"] if "product_code" in row.keys() else row["gpu"],
        "region": row["region"],
        "provider": row["provider"],
        "quantity": row["quantity"],
        "unit": row["unit"],
        "unit_price_cny": row["unit_price_cents"] / 100,
        "amount_cny": row["amount_cents"] / 100,
        "currency": row["currency"],
        "status": row["status"],
        "payment_provider": row["payment_provider"],
        "settlement_mode": row["settlement_mode"] if "settlement_mode" in row.keys() else "cash",
        "swap_id": row["swap_id"] if "swap_id" in row.keys() else None,
        "delivery_ref": row["delivery_ref"],
        "reservation_expires_at": row["reservation_expires_at"] if "reservation_expires_at" in row.keys() else None,
        "supplier_confirmed_at": row["supplier_confirmed_at"] if "supplier_confirmed_at" in row.keys() else None,
        "delivered_at": row["delivered_at"] if "delivered_at" in row.keys() else None,
        "accepted_at": row["accepted_at"] if "accepted_at" in row.keys() else None,
        "acceptance_due_at": row["acceptance_due_at"] if "acceptance_due_at" in row.keys() else None,
        "quote_snapshot": quote_snapshot,
        "service_configuration": quote_snapshot.get("h100_configuration"),
        "delivery": delivery,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str = "request_error"):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code


def normalized_order_snapshot(raw_snapshot: object, listing: sqlite3.Row, quantity: float) -> dict:
    raw = raw_snapshot if isinstance(raw_snapshot, dict) else {}
    try:
        listing_version = int(raw.get("listing_version") or listing["version"])
    except (TypeError, ValueError):
        raise ApiError(422, "挂牌版本无效", "invalid_listing_version")
    if listing_version != listing["version"]:
        raise ApiError(409, "报价已更新，请按最新价格重新确认", "listing_version_changed")
    snapshot = {
        "source": clean_text(raw.get("source") or "api_order", "报价来源", 3, 40),
        "gpu": listing["gpu"],
        "listing_version": listing_version,
    }
    if listing["kind"] != "gpu" or listing["gpu"] != "H100":
        return snapshot

    config = raw.get("h100_configuration") if isinstance(raw.get("h100_configuration"), dict) else {}
    mode = clean_text(config.get("service_mode") or "exclusive", "H100 使用模式", 3, 24)
    if mode not in H100_SERVICE_MODES:
        raise ApiError(422, "H100 使用模式无效", "invalid_h100_service_mode")
    try:
        cpu_cores = int(config.get("cpu_cores") or 32)
        memory_gb = int(config.get("memory_gb") or 128)
        service_hours = round(float(config.get("service_hours") or quantity), 3)
    except (TypeError, ValueError):
        raise ApiError(422, "H100 计算配置无效", "invalid_h100_configuration")
    if cpu_cores not in H100_CPU_OPTIONS or memory_gb not in H100_MEMORY_OPTIONS:
        raise ApiError(422, "H100 CPU 或内存配置无效", "invalid_h100_configuration")
    storage = clean_text(config.get("storage") or "nvme_1tb", "存储配置", 3, 24)
    environment = clean_text(config.get("environment") or "pytorch", "运行环境", 3, 32)
    if storage not in H100_STORAGE_OPTIONS or environment not in H100_ENVIRONMENT_OPTIONS:
        raise ApiError(422, "H100 存储或运行环境无效", "invalid_h100_configuration")
    if service_hours < 1 or service_hours > 8760:
        raise ApiError(422, "H100 服务时长应为 1 至 8760 小时", "invalid_h100_service_hours")
    billing_factor = H100_SERVICE_MODES[mode]["billing_factor"]
    expected_quantity = round(service_hours * billing_factor, 6)
    if abs(expected_quantity - quantity) > 0.001:
        raise ApiError(422, "H100 服务时长与计费容量不一致，请重新确认配置", "h100_quantity_mismatch")
    start_at = clean_text(config.get("start_at") or now_iso(), "计划开始时间", 10, 40)
    try:
        datetime.fromisoformat(start_at.replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(422, "计划开始时间格式无效", "invalid_h100_start_at")
    snapshot["h100_configuration"] = {
        "service_mode": mode,
        "service_mode_label": H100_SERVICE_MODES[mode]["label"],
        "gpu_memory_gb": H100_SERVICE_MODES[mode]["gpu_memory_gb"],
        "billing_factor": billing_factor,
        "service_hours": service_hours,
        "billable_gpu_hours": expected_quantity,
        "cpu_cores": cpu_cores,
        "memory_gb": memory_gb,
        "storage": storage,
        "storage_label": H100_STORAGE_OPTIONS[storage],
        "environment": environment,
        "environment_label": H100_ENVIRONMENT_OPTIONS[environment],
        "operating_system": "Ubuntu",
        "start_at": start_at,
        "delivery_mode": "隔离实例 + 脱敏端点 + 一次性交付凭证",
    }
    return snapshot


def audit(connection: sqlite3.Connection, actor_user_id: str | None, aggregate: str,
          aggregate_id: str, event_type: str, payload: dict, idempotency_key: str | None = None,
          event_id: str | None = None) -> str:
    event_id = event_id or uid("evt")
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    connection.execute(
        "INSERT INTO audit_events(event_id,actor_user_id,aggregate_type,aggregate_id,event_type,payload_json,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (event_id, actor_user_id, aggregate, aggregate_id, event_type, serialized, idempotency_key, now_iso()),
    )
    connection.execute(
        "INSERT INTO outbox(event_id,event_type,payload_json,status,attempts,created_at) VALUES(?,?,?,'pending',0,?)",
        (event_id, event_type, serialized, now_iso()),
    )
    return event_id


def initialize_database() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db_connect() as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users(
              id TEXT PRIMARY KEY, name TEXT NOT NULL, account TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'buyer',
              enterprise_status TEXT NOT NULL DEFAULT 'unverified',
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions(
              token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS external_identities(
              provider TEXT NOT NULL, subject TEXT NOT NULL,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              email TEXT, claims_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              PRIMARY KEY(provider,subject)
            );
            CREATE INDEX IF NOT EXISTS external_identities_user_idx
              ON external_identities(user_id);
            CREATE TABLE IF NOT EXISTS oidc_transactions(
              id TEXT PRIMARY KEY, state_hash TEXT NOT NULL UNIQUE, nonce TEXT NOT NULL,
              code_verifier TEXT NOT NULL, return_to TEXT NOT NULL,
              expires_at TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS mobile_login_tickets(
              ticket_hash TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              app_nonce_hash TEXT NOT NULL,
              return_to TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              consumed_at TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS mobile_login_tickets_expiry_idx
              ON mobile_login_tickets(expires_at);
            CREATE TABLE IF NOT EXISTS mobile_login_preparations(
              handle_hash TEXT PRIMARY KEY,
              app_nonce_hash TEXT NOT NULL,
              login_hint TEXT,
              return_to TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              consumed_at TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS mobile_login_preparations_expiry_idx
              ON mobile_login_preparations(expires_at);
            CREATE TABLE IF NOT EXISTS phone_verifications(
              id TEXT PRIMARY KEY, phone TEXT NOT NULL, purpose TEXT NOT NULL,
              code_hash TEXT NOT NULL, provider TEXT NOT NULL, provider_request_id TEXT,
              status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
              max_attempts INTEGER NOT NULL, request_ip_hash TEXT NOT NULL,
              expires_at TEXT NOT NULL, sent_at TEXT NOT NULL, consumed_at TEXT,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS supplier_applications(
              id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), enterprise_name TEXT NOT NULL,
              credit_code TEXT NOT NULL, agent_name TEXT NOT NULL, status TEXT NOT NULL,
              review_due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS listings(
              id TEXT PRIMARY KEY, supplier_user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
              product_code TEXT NOT NULL, gpu TEXT NOT NULL, provider TEXT NOT NULL, region TEXT NOT NULL,
              unit TEXT NOT NULL, unit_price_cents INTEGER NOT NULL,
              verified_quantity REAL NOT NULL, quote_reserved REAL NOT NULL DEFAULT 0,
              order_locked REAL NOT NULL DEFAULT 0, delivering REAL NOT NULL DEFAULT 0,
              consumed REAL NOT NULL DEFAULT 0, frozen REAL NOT NULL DEFAULT 0,
              status TEXT NOT NULL DEFAULT 'active', version INTEGER NOT NULL DEFAULT 1,
              valid_from TEXT NOT NULL, valid_until TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orders(
              id TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, buyer_user_id TEXT NOT NULL REFERENCES users(id),
              listing_id TEXT NOT NULL REFERENCES listings(id), gpu TEXT NOT NULL, region TEXT NOT NULL,
              provider TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL,
              unit_price_cents INTEGER NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
              status TEXT NOT NULL, payment_provider TEXT, delivery_ref TEXT,
              idempotency_key TEXT NOT NULL, quote_snapshot_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(buyer_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS payments(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), provider TEXT NOT NULL,
              amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, merchant_id TEXT,
              provider_txn_id TEXT UNIQUE, status TEXT NOT NULL, callback_event_id TEXT UNIQUE,
              callback_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS allocations(
              id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
              listing_id TEXT NOT NULL REFERENCES listings(id), gpu TEXT NOT NULL, region TEXT NOT NULL,
              quantity REAL NOT NULL, unit TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS withdrawal_requests(
              id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id),
              allocation_id TEXT NOT NULL REFERENCES allocations(id), quantity REAL NOT NULL,
              unit TEXT NOT NULL, status TEXT NOT NULL, decision TEXT NOT NULL,
              idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(owner_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS purchase_requests(
              id TEXT PRIMARY KEY, buyer_user_id TEXT NOT NULL REFERENCES users(id),
              product_code TEXT NOT NULL, region TEXT NOT NULL, service_mode TEXT NOT NULL,
              service_hours REAL NOT NULL, requested_gpu_hours REAL NOT NULL,
              cpu_cores INTEGER NOT NULL, memory_gb INTEGER NOT NULL,
              storage TEXT NOT NULL, environment TEXT NOT NULL, start_at TEXT NOT NULL,
              status TEXT NOT NULL, idempotency_key TEXT NOT NULL,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(buyer_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS resource_intakes(
              id TEXT PRIMARY KEY, supplier_user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
              product_code TEXT NOT NULL, region TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL,
              status TEXT NOT NULL, evidence_summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_events(
              sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
              actor_user_id TEXT, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL,
              event_type TEXT NOT NULL, payload_json TEXT NOT NULL, idempotency_key TEXT,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS outbox(
              sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
              event_type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL,
              attempts INTEGER NOT NULL, created_at TEXT NOT NULL, processed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS delivery_tasks(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
              supplier_user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL,
              credential_reference TEXT, endpoint_summary TEXT, evidence_digest TEXT,
              started_at TEXT, delivered_at TEXT, acceptance_due_at TEXT,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS metering_records(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
              source TEXT NOT NULL, resource_kind TEXT NOT NULL,
              started_at TEXT NOT NULL, ended_at TEXT NOT NULL, quantity REAL NOT NULL,
              performance_json TEXT NOT NULL DEFAULT '{}', evidence_digest TEXT NOT NULL,
              signature TEXT NOT NULL, status TEXT NOT NULL,
              created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
              UNIQUE(order_id,source,evidence_digest)
            );
            CREATE TABLE IF NOT EXISTS disputes(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
              opened_by TEXT NOT NULL REFERENCES users(id), category TEXT NOT NULL,
              reason TEXT NOT NULL, original_order_status TEXT NOT NULL, status TEXT NOT NULL,
              resolution TEXT, assigned_to TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS refunds(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
              payment_id TEXT NOT NULL REFERENCES payments(id), requester_user_id TEXT NOT NULL REFERENCES users(id),
              amount_cents INTEGER NOT NULL, reason TEXT NOT NULL, original_order_status TEXT NOT NULL,
              status TEXT NOT NULL, provider_ref TEXT, reviewer_user_id TEXT,
              idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(requester_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS settlements(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
              supplier_user_id TEXT NOT NULL REFERENCES users(id), gross_cents INTEGER NOT NULL,
              platform_fee_cents INTEGER NOT NULL, supplier_net_cents INTEGER NOT NULL,
              currency TEXT NOT NULL, status TEXT NOT NULL, hold_until TEXT NOT NULL,
              payout_ref TEXT, paid_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS supplier_card_hour_rebates(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
              supplier_user_id TEXT NOT NULL REFERENCES users(id),
              listing_id TEXT NOT NULL REFERENCES listings(id), amount_cents INTEGER NOT NULL,
              source_card_hours_micros INTEGER NOT NULL, rebate_rate_bps INTEGER NOT NULL,
              rebate_card_hours_micros INTEGER NOT NULL, unit TEXT NOT NULL,
              status TEXT NOT NULL, pre_hold_status TEXT, review_required INTEGER NOT NULL DEFAULT 0,
              conversion_basis TEXT NOT NULL, synthetic_order_id TEXT REFERENCES orders(id),
              allocation_id TEXT REFERENCES allocations(id), reviewer_user_id TEXT REFERENCES users(id),
              submitted_by TEXT REFERENCES users(id), submission_band TEXT,
              transaction_summary TEXT, submitted_at TEXT,
              review_reason TEXT, reviewed_at TEXT, issued_at TEXT, reversed_at TEXT,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS invoice_requests(
              id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
              requester_user_id TEXT NOT NULL REFERENCES users(id), invoice_title TEXT NOT NULL,
              tax_id TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL,
              invoice_ref TEXT, issued_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS event_deliveries(
              id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE REFERENCES outbox(event_id),
              consumer TEXT NOT NULL, status TEXT NOT NULL, delivered_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS swap_requests(
              id TEXT PRIMARY KEY, requester_user_id TEXT NOT NULL REFERENCES users(id),
              source_allocation_id TEXT NOT NULL REFERENCES allocations(id),
              source_kind TEXT NOT NULL, source_product_code TEXT NOT NULL,
              source_quantity REAL NOT NULL, source_unit TEXT NOT NULL,
              target_kind TEXT NOT NULL, target_product_code TEXT NOT NULL, target_region TEXT NOT NULL,
              target_listing_id TEXT REFERENCES listings(id), target_quantity REAL,
              source_reference_cents INTEGER NOT NULL, target_reference_cents INTEGER,
              quote_snapshot_json TEXT NOT NULL DEFAULT '{}', quote_expires_at TEXT,
              target_order_id TEXT REFERENCES orders(id), status TEXT NOT NULL,
              idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(requester_user_id,idempotency_key)
            );
            CREATE TABLE IF NOT EXISTS account_deletion_requests(
              id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
              status TEXT NOT NULL, reason TEXT NOT NULL, retention_summary TEXT NOT NULL,
              requested_at TEXT NOT NULL, scheduled_for TEXT, completed_at TEXT, updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_user_id,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_phone_verification ON phone_verifications(phone,purpose,status,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_withdrawals_owner ON withdrawal_requests(owner_user_id,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_purchase_requests_buyer ON purchase_requests(buyer_user_id,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_listings_active ON listings(status,kind,gpu,region);
            CREATE INDEX IF NOT EXISTS idx_events_aggregate ON audit_events(aggregate_type,aggregate_id,sequence);
            CREATE INDEX IF NOT EXISTS idx_metering_order ON metering_records(order_id,source);
            CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(order_id,status);
            CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id,status);
            CREATE INDEX IF NOT EXISTS idx_settlements_supplier ON settlements(supplier_user_id,status);
            CREATE INDEX IF NOT EXISTS idx_supplier_card_hour_rebates_supplier ON supplier_card_hour_rebates(supplier_user_id,status,created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_supplier_card_hour_rebates_review ON supplier_card_hour_rebates(review_required,status,created_at);
            CREATE INDEX IF NOT EXISTS idx_swaps_requester ON swap_requests(requester_user_id,created_at DESC);
            """
        )
        add_column_if_missing(connection, "supplier_applications", "reviewer_user_id", "TEXT")
        add_column_if_missing(connection, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "oidc_transactions", "flow", "TEXT NOT NULL DEFAULT 'web'")
        add_column_if_missing(connection, "oidc_transactions", "app_nonce_hash", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "review_reason", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "reviewed_at", "TEXT")
        add_column_if_missing(connection, "supplier_applications", "bank_account_verified", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "supplier_applications", "invoice_verified", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "supplier_applications", "resource_proof_verified", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "supplier_applications", "license_verified", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "supplier_applications", "next_review_at", "TEXT")
        add_column_if_missing(connection, "resource_intakes", "provider", "TEXT")
        add_column_if_missing(connection, "resource_intakes", "verification_summary", "TEXT")
        add_column_if_missing(connection, "resource_intakes", "reviewer_user_id", "TEXT")
        add_column_if_missing(connection, "resource_intakes", "verified_at", "TEXT")
        add_column_if_missing(connection, "resource_intakes", "frozen_reason", "TEXT")
        add_column_if_missing(connection, "listings", "intake_id", "TEXT")
        add_column_if_missing(connection, "listings", "floor_price_cents", "INTEGER")
        add_column_if_missing(connection, "listings", "trade_mode", "TEXT NOT NULL DEFAULT 'fixed'")
        add_column_if_missing(connection, "listings", "sla", "TEXT NOT NULL DEFAULT '99.5% 标准保障'")
        add_column_if_missing(connection, "listings", "minimum_quantity", "REAL NOT NULL DEFAULT 1")
        add_column_if_missing(connection, "listings", "reviewer_user_id", "TEXT")
        add_column_if_missing(connection, "listings", "reviewed_at", "TEXT")
        add_column_if_missing(connection, "listings", "price_source_json", "TEXT NOT NULL DEFAULT '{}'")
        add_column_if_missing(connection, "orders", "reservation_expires_at", "TEXT")
        add_column_if_missing(connection, "orders", "supplier_confirmed_at", "TEXT")
        add_column_if_missing(connection, "orders", "delivered_at", "TEXT")
        add_column_if_missing(connection, "orders", "accepted_at", "TEXT")
        add_column_if_missing(connection, "orders", "acceptance_due_at", "TEXT")
        add_column_if_missing(connection, "orders", "kind", "TEXT NOT NULL DEFAULT 'gpu'")
        add_column_if_missing(connection, "orders", "product_code", "TEXT")
        add_column_if_missing(connection, "orders", "settlement_mode", "TEXT NOT NULL DEFAULT 'cash'")
        add_column_if_missing(connection, "orders", "swap_id", "TEXT")
        add_column_if_missing(connection, "settlements", "referral_commission_cents", "INTEGER NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "pre_hold_status", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "submitted_by", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "submission_band", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "transaction_summary", "TEXT")
        add_column_if_missing(connection, "supplier_card_hour_rebates", "submitted_at", "TEXT")
        add_column_if_missing(connection, "allocations", "kind", "TEXT NOT NULL DEFAULT 'gpu'")
        add_column_if_missing(connection, "allocations", "product_code", "TEXT")
        add_column_if_missing(connection, "allocations", "provider", "TEXT")
        add_column_if_missing(connection, "allocations", "swap_reserved", "REAL NOT NULL DEFAULT 0")
        add_column_if_missing(connection, "users", "lifecycle_status", "TEXT NOT NULL DEFAULT 'active'")
        add_column_if_missing(connection, "users", "deletion_requested_at", "TEXT")
        add_column_if_missing(connection, "users", "anonymized_at", "TEXT")
        add_column_if_missing(connection, "mobile_login_preparations", "login_hint", "TEXT")
        connection.execute("UPDATE orders SET product_code=COALESCE(product_code,gpu) WHERE product_code IS NULL")
        connection.execute("UPDATE allocations SET product_code=COALESCE(product_code,gpu),provider=COALESCE(provider,'KAI 已验资源池') WHERE product_code IS NULL OR provider IS NULL")
        connection.execute(
            "UPDATE orders SET reservation_expires_at=? WHERE status='pending_payment' AND reservation_expires_at IS NULL",
            (future_minutes_iso(ORDER_RESERVATION_MINUTES),),
        )
        if ADMIN_ACCOUNT and ADMIN_PASSWORD:
            if len(ADMIN_PASSWORD) < 12:
                raise RuntimeError("KAI_ADMIN_PASSWORD must contain at least 12 characters")
            admin = connection.execute("SELECT * FROM users WHERE account=?", (ADMIN_ACCOUNT,)).fetchone()
            if admin:
                connection.execute(
                    "UPDATE users SET role='admin',enterprise_status='verified',updated_at=? WHERE id=?",
                    (now_iso(), admin["id"]),
                )
            else:
                created = now_iso()
                connection.execute(
                    "INSERT INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at,must_change_password) VALUES(?,?,?,?, 'admin','verified',?,?,1)",
                    (uid("usr"), "KAI 平台运营管理员", ADMIN_ACCOUNT, hash_password(ADMIN_PASSWORD), created, created),
                )
        if SEED_CATALOG:
            seed_demo(connection)
        else:
            archived_at = now_iso()
            connection.execute("UPDATE listings SET status='retired_demo',updated_at=? WHERE supplier_user_id='usr_demo_supplier'", (archived_at,))
            connection.execute(
                "UPDATE supplier_applications SET status='archived_test',review_reason='上线前历史验收数据归档',updated_at=? WHERE user_id IN (SELECT id FROM users WHERE account LIKE 'online-%@example.com')",
                (archived_at,),
            )
            connection.execute(
                "UPDATE users SET role='buyer',enterprise_status='unverified',updated_at=? WHERE account LIKE 'online-%@example.com'",
                (archived_at,),
            )


def seed_demo(connection: sqlite3.Connection) -> None:
    created = now_iso()
    supplier_id = "usr_demo_supplier"
    buyer_id = "usr_demo_buyer"
    connection.execute(
        "INSERT OR IGNORE INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        (supplier_id, "KAI 首阶段供应商", "supplier@kai.internal", hash_password(secrets.token_urlsafe(32)), "supplier", "certified", created, created),
    )
    if ALLOW_DEMO:
        connection.execute(
            "INSERT OR IGNORE INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            (buyer_id, "KAI 企业采购方", "buyer@kai.demo", hash_password("KaiBuyer#2026"), "buyer", "verified", created, created),
        )
    connection.execute(
        "INSERT OR IGNORE INTO supplier_applications(id,user_id,enterprise_name,credit_code,agent_name,status,review_due_at,created_at,updated_at) VALUES(?,?,?,?,?,'certified',?,?,?)",
        ("sup_demo", supplier_id, "KAI 首阶段供应商", "91310000KAI0000001", "系统联调经办人", future_iso(24 * 180), created, created),
    )
    catalogue = [
        ("lst_h100_bj", "H100", "NVIDIA H100 80GB", "KAI 已验资源池", "北京", 1490, 12000),
        ("lst_h200_sh", "H200", "NVIDIA H200 141GB", "认证云厂商", "上海", 1880, 6000),
        ("lst_a100_cd", "A100", "NVIDIA A100 80GB", "企业闲置池", "成都", 982, 16000),
        ("lst_h800_sz", "H800", "NVIDIA H800 80GB", "认证云厂商", "深圳", 1260, 10000),
        ("lst_mi300x_hk", "MI300X", "AMD MI300X 192GB", "KAI 已验资源池", "中国香港", 1170, 8000),
        ("lst_910b_cd", "910B", "华为昇腾 910B", "国产算力资源池", "成都", 870, 12000),
    ]
    for listing_id, gpu, product_code, provider, region, price, quantity in catalogue:
        connection.execute(
            """INSERT OR IGNORE INTO listings(
              id,supplier_user_id,kind,product_code,gpu,provider,region,unit,unit_price_cents,
              verified_quantity,status,valid_from,valid_until,created_at,updated_at
            ) VALUES(?,?,'gpu',?,?,?,?, 'GPU 时',?,?,'active',?,?,?,?)""",
            (listing_id, supplier_id, product_code, gpu, provider, region, price, quantity, created, future_iso(24 * 365), created, created),
        )


def payment_canonical(payload: dict) -> str:
    fields = ("event_id", "payment_id", "order_id", "provider_txn_id", "merchant_id", "amount_cents", "currency", "status", "timestamp")
    return "|".join(str(payload.get(field, "")) for field in fields)


def payment_secret(provider: str, mock: bool = False) -> str | None:
    if mock:
        return MOCK_SECRET
    return os.environ.get(f"KAI_{provider.upper()}_CALLBACK_SECRET")


def sign_payment(payload: dict, secret: str) -> str:
    return hmac.new(secret.encode(), payment_canonical(payload).encode(), hashlib.sha256).hexdigest()


def refund_canonical(payload: dict) -> str:
    fields = ("event_id", "refund_id", "order_id", "provider_ref", "amount_cents", "currency", "status", "timestamp")
    return "|".join(str(payload.get(field, "")) for field in fields)


def sign_refund(payload: dict, secret: str) -> str:
    return hmac.new(secret.encode(), refund_canonical(payload).encode(), hashlib.sha256).hexdigest()


def fetch_order(connection: sqlite3.Connection, order_id: str) -> sqlite3.Row:
    row = connection.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
    if not row:
        raise ApiError(404, "订单不存在", "order_not_found")
    return row


def require_role(session: sqlite3.Row, *roles: str) -> None:
    if session["role"] not in roles:
        raise ApiError(403, "当前账户没有执行此操作的权限", "permission_denied")


def supplier_for_order(connection: sqlite3.Connection, order: sqlite3.Row) -> sqlite3.Row:
    supplier = connection.execute(
        "SELECT u.* FROM listings l JOIN users u ON u.id=l.supplier_user_id WHERE l.id=?",
        (order["listing_id"],),
    ).fetchone()
    if not supplier:
        raise ApiError(409, "订单供应商信息异常", "supplier_missing")
    return supplier


def supplier_rebate_rate_bps(amount_cents: int) -> int:
    if amount_cents < 100:
        return 0
    for maximum_cents, rate_bps in SUPPLIER_REBATE_TIERS:
        if maximum_cents is None or amount_cents <= maximum_cents:
            return rate_bps
    return 0


def supplier_rebate_policy() -> dict:
    return {
        "review_threshold_cents": SUPPLIER_REBATE_REVIEW_CENTS,
        "unit": "GPU 时",
        "tiers": [
            {"minimum_cents": 100, "maximum_cents": 100_000, "rate_bps": 100, "review_required": False},
            {"minimum_cents": 100_001, "maximum_cents": 1_000_000, "rate_bps": 80, "review_required": False},
            {"minimum_cents": 1_000_001, "maximum_cents": 3_000_000, "rate_bps": 50, "review_required": False},
            {"minimum_cents": 3_000_001, "maximum_cents": 5_000_000, "rate_bps": 30, "review_required": False},
            {"minimum_cents": 5_000_001, "maximum_cents": None, "rate_bps": 20, "review_required": True},
        ],
    }


def supplier_rebate_dict(row: sqlite3.Row) -> dict:
    item = dict(row)
    item["amount_cny"] = item["amount_cents"] / 100
    item["source_card_hours"] = item["source_card_hours_micros"] / CARD_HOUR_MICROS
    item["rebate_card_hours"] = item["rebate_card_hours_micros"] / CARD_HOUR_MICROS
    item["rebate_rate_percent"] = item["rebate_rate_bps"] / 100
    return item


def issue_supplier_card_hour_rebate(
    connection: sqlite3.Connection,
    rebate: sqlite3.Row,
    actor_user_id: str | None,
    issued_at: str,
) -> sqlite3.Row:
    if rebate["allocation_id"]:
        return rebate
    order = fetch_order(connection, rebate["order_id"])
    listing = connection.execute("SELECT * FROM listings WHERE id=?", (rebate["listing_id"],)).fetchone()
    if not listing or order["kind"] != "gpu" or order["unit"] != "GPU 时":
        raise ApiError(409, "订单无法换算为标准卡时", "card_hour_conversion_unavailable")
    rebate_hours = rebate["rebate_card_hours_micros"] / CARD_HOUR_MICROS
    if rebate_hours <= 0:
        raise ApiError(409, "返佣卡时计算结果无效", "invalid_rebate_card_hours")
    synthetic_order_id = uid("rebate_order")
    allocation_id = uid("rebate_asset")
    order_no = f"KAI-REBATE-{secrets.token_hex(6).upper()}"
    snapshot = json.dumps({
        "source": "supplier_card_hour_rebate",
        "source_order_id": order["id"],
        "source_order_no": order["order_no"],
        "source_amount_cents": rebate["amount_cents"],
        "source_card_hours": rebate["source_card_hours_micros"] / CARD_HOUR_MICROS,
        "rebate_rate_bps": rebate["rebate_rate_bps"],
        "rebate_id": rebate["id"],
    }, ensure_ascii=False)
    connection.execute(
        """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,
           unit_price_cents,amount_cents,currency,status,payment_provider,idempotency_key,quote_snapshot_json,
           accepted_at,created_at,updated_at,kind,product_code,settlement_mode)
           VALUES(?,?,?,?,?,?,?,?,?,?,0,'CNY','accepted','supplier_rebate',?,?,?,?,?,?,?,'rebate')""",
        (
            synthetic_order_id, order_no, rebate["supplier_user_id"], listing["id"], order["gpu"], order["region"],
            "CloudPay 供应商返佣", rebate_hours, "GPU 时", order["unit_price_cents"],
            f"supplier-rebate:{rebate['id']}", snapshot, issued_at, issued_at, issued_at,
            "gpu", order["product_code"] or order["gpu"],
        ),
    )
    connection.execute(
        """INSERT INTO allocations(id,owner_user_id,order_id,listing_id,gpu,region,quantity,unit,expires_at,status,
           created_at,kind,product_code,provider) VALUES(?,?,?,?,?,?,?,?,?,'available',?,'gpu',?,?)""",
        (
            allocation_id, rebate["supplier_user_id"], synthetic_order_id, listing["id"], order["gpu"], order["region"],
            rebate_hours, "GPU 时", listing["valid_until"], issued_at,
            order["product_code"] or order["gpu"], "CloudPay 供应商返佣",
        ),
    )
    connection.execute(
        """UPDATE supplier_card_hour_rebates SET status='issued',synthetic_order_id=?,allocation_id=?,
           issued_at=?,updated_at=? WHERE id=?""",
        (synthetic_order_id, allocation_id, issued_at, issued_at, rebate["id"]),
    )
    audit(connection, actor_user_id, "supplier_card_hour_rebate", rebate["id"], "supplier_rebate.card_hours_issued", {
        "source_order_id": order["id"], "supplier_user_id": rebate["supplier_user_id"],
        "allocation_id": allocation_id, "rebate_card_hours": rebate_hours,
        "rebate_rate_bps": rebate["rebate_rate_bps"],
    })
    return connection.execute("SELECT * FROM supplier_card_hour_rebates WHERE id=?", (rebate["id"],)).fetchone()


def create_supplier_card_hour_rebate(
    connection: sqlite3.Connection,
    order: sqlite3.Row,
    supplier_user_id: str,
    submitted_by: str,
    submission_band: str,
    transaction_summary: str,
    submitted_at: str,
) -> sqlite3.Row | None:
    existing = connection.execute(
        "SELECT * FROM supplier_card_hour_rebates WHERE order_id=?", (order["id"],)
    ).fetchone()
    if existing:
        return existing
    if order["kind"] != "gpu" or order["unit"] != "GPU 时" or order["settlement_mode"] != "cash":
        return None
    amount_cents = int(order["amount_cents"])
    rate_bps = supplier_rebate_rate_bps(amount_cents)
    source_micros = int(round(float(order["quantity"]) * CARD_HOUR_MICROS))
    rebate_micros = (source_micros * rate_bps + 5000) // 10000
    if rate_bps <= 0 or source_micros <= 0 or rebate_micros <= 0:
        return None
    review_required = amount_cents > SUPPLIER_REBATE_REVIEW_CENTS
    expected_band = "over_50000" if review_required else "up_to_50000"
    if submission_band != expected_band:
        raise ApiError(422, "所选金额区间与订单实际金额不一致", "rebate_band_mismatch")
    rebate_id = uid("supplier_rebate")
    status = "pending_review" if review_required else "calculated"
    connection.execute(
        """INSERT INTO supplier_card_hour_rebates(
           id,order_id,supplier_user_id,listing_id,amount_cents,source_card_hours_micros,
           rebate_rate_bps,rebate_card_hours_micros,unit,status,review_required,conversion_basis,
           submitted_by,submission_band,transaction_summary,submitted_at,created_at,updated_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'order_quantity_gpu_hour',?,?,?,?,?,?)""",
        (
            rebate_id, order["id"], supplier_user_id, order["listing_id"], amount_cents, source_micros,
            rate_bps, rebate_micros, "GPU 时", status, int(review_required), submitted_by,
            submission_band, transaction_summary, submitted_at, submitted_at, submitted_at,
        ),
    )
    audit(connection, submitted_by, "supplier_card_hour_rebate", rebate_id,
          "supplier_rebate.pending_review" if review_required else "supplier_rebate.calculated", {
              "order_id": order["id"], "supplier_user_id": supplier_user_id,
              "amount_cents": amount_cents, "source_card_hours": source_micros / CARD_HOUR_MICROS,
              "rebate_rate_bps": rate_bps, "rebate_card_hours": rebate_micros / CARD_HOUR_MICROS,
              "review_required": review_required,
              "submission_band": submission_band,
          })
    rebate = connection.execute("SELECT * FROM supplier_card_hour_rebates WHERE id=?", (rebate_id,)).fetchone()
    if not review_required:
        rebate = issue_supplier_card_hour_rebate(connection, rebate, submitted_by, submitted_at)
    return rebate


def pause_supplier_card_hour_rebate(connection: sqlite3.Connection, order_id: str, updated_at: str) -> None:
    rebate = connection.execute(
        "SELECT * FROM supplier_card_hour_rebates WHERE order_id=?", (order_id,)
    ).fetchone()
    if not rebate or rebate["status"] not in ("issued", "pending_review"):
        return
    connection.execute(
        """UPDATE supplier_card_hour_rebates SET pre_hold_status=status,status='paused',updated_at=?
           WHERE id=?""",
        (updated_at, rebate["id"]),
    )
    if rebate["allocation_id"]:
        connection.execute(
            "UPDATE allocations SET status='frozen' WHERE id=? AND status='available'",
            (rebate["allocation_id"],),
        )


def restore_supplier_card_hour_rebate(connection: sqlite3.Connection, order_id: str, updated_at: str) -> None:
    rebate = connection.execute(
        "SELECT * FROM supplier_card_hour_rebates WHERE order_id=?", (order_id,)
    ).fetchone()
    if not rebate or rebate["status"] != "paused":
        return
    restored = rebate["pre_hold_status"] or ("pending_review" if rebate["review_required"] else "issued")
    connection.execute(
        "UPDATE supplier_card_hour_rebates SET status=?,pre_hold_status=NULL,updated_at=? WHERE id=?",
        (restored, updated_at, rebate["id"]),
    )
    if restored == "issued" and rebate["allocation_id"]:
        connection.execute(
            "UPDATE allocations SET status='available' WHERE id=? AND status='frozen'",
            (rebate["allocation_id"],),
        )


def reverse_supplier_card_hour_rebate(
    connection: sqlite3.Connection,
    order_id: str,
    actor_user_id: str | None,
    reversed_at: str,
) -> None:
    rebate = connection.execute(
        "SELECT * FROM supplier_card_hour_rebates WHERE order_id=?", (order_id,)
    ).fetchone()
    if not rebate or rebate["status"] in ("rejected", "reversed", "clawback_required"):
        return
    next_status = "reversed"
    if rebate["allocation_id"]:
        allocation = connection.execute(
            "SELECT * FROM allocations WHERE id=?", (rebate["allocation_id"],)
        ).fetchone()
        if allocation:
            expected = rebate["rebate_card_hours_micros"] / CARD_HOUR_MICROS
            withdrawal_reserved = connection.execute(
                """SELECT COALESCE(SUM(quantity),0) FROM withdrawal_requests
                   WHERE allocation_id=? AND status IN ('scheduled','processing')""",
                (allocation["id"],),
            ).fetchone()[0]
            used_or_reserved = (
                float(allocation["quantity"]) + 1e-9 < expected
                or float(allocation["swap_reserved"] or 0) > 1e-9
                or float(withdrawal_reserved or 0) > 1e-9
            )
            if used_or_reserved:
                next_status = "clawback_required"
                connection.execute("UPDATE allocations SET status='frozen' WHERE id=?", (allocation["id"],))
            else:
                connection.execute(
                    "UPDATE allocations SET quantity=0,swap_reserved=0,status='reversed' WHERE id=?",
                    (allocation["id"],),
                )
    connection.execute(
        """UPDATE supplier_card_hour_rebates SET status=?,pre_hold_status=NULL,reversed_at=?,updated_at=?
           WHERE id=?""",
        (next_status, reversed_at, reversed_at, rebate["id"]),
    )
    audit(connection, actor_user_id, "supplier_card_hour_rebate", rebate["id"],
          f"supplier_rebate.{next_status}", {
              "order_id": order_id,
              "rebate_card_hours": rebate["rebate_card_hours_micros"] / CARD_HOUR_MICROS,
          })


def release_order_capacity(connection: sqlite3.Connection, order: sqlite3.Row, source_status: str) -> None:
    counter = {
        "pending_payment": "quote_reserved",
        "paid": "order_locked",
        "supplier_confirmed": "order_locked",
        "delivered": "delivering",
    }.get(source_status)
    if counter:
        connection.execute(
            f"UPDATE listings SET {counter}=MAX(0,{counter}-?),version=version+1,updated_at=? WHERE id=?",
            (order["quantity"], now_iso(), order["listing_id"]),
        )
    elif source_status == "accepted":
        connection.execute(
            "UPDATE listings SET consumed=MAX(0,consumed-?),version=version+1,updated_at=? WHERE id=?",
            (order["quantity"], now_iso(), order["listing_id"]),
        )
        connection.execute("UPDATE allocations SET status='refunded' WHERE order_id=?", (order["id"],))


def apply_refund_success(connection: sqlite3.Connection, refund: sqlite3.Row, provider_ref: str,
                         actor_user_id: str | None = None) -> None:
    order = fetch_order(connection, refund["order_id"])
    if refund["status"] == "success" or order["status"] == "refunded":
        return
    release_order_capacity(connection, order, refund["original_order_status"])
    updated = now_iso()
    connection.execute(
        "UPDATE refunds SET status='success',provider_ref=?,reviewer_user_id=COALESCE(reviewer_user_id,?),updated_at=? WHERE id=?",
        (provider_ref, actor_user_id, updated, refund["id"]),
    )
    connection.execute("UPDATE orders SET status='refunded',updated_at=? WHERE id=?", (updated, order["id"]))
    connection.execute("UPDATE payments SET status='refunded',updated_at=? WHERE id=?", (updated, refund["payment_id"]))
    connection.execute("UPDATE settlements SET status='reversed',updated_at=? WHERE order_id=? AND status!='paid'", (updated, order["id"]))
    reverse_supplier_card_hour_rebate(connection, order["id"], actor_user_id, updated)
    audit(connection, actor_user_id, "refund", refund["id"], "refund.succeeded", {
        "order_id": order["id"], "amount_cents": refund["amount_cents"], "provider_ref": provider_ref,
    })


def metering_reconciliation(connection: sqlite3.Connection, order_id: str) -> dict:
    rows = connection.execute(
        "SELECT source,quantity,status FROM metering_records WHERE order_id=? ORDER BY created_at DESC",
        (order_id,),
    ).fetchall()
    latest = {}
    for row in rows:
        latest.setdefault(row["source"], row)
    supplier = latest.get("supplier")
    gateway = latest.get("kai_gateway")
    if not supplier or not gateway:
        return {"ready": False, "status": "awaiting_dual_source", "difference_ratio": None}
    denominator = max(abs(float(supplier["quantity"])), abs(float(gateway["quantity"])), 1e-9)
    difference = abs(float(supplier["quantity"]) - float(gateway["quantity"])) / denominator
    status = "matched" if difference <= METERING_TOLERANCE_RATIO else "manual_review"
    connection.execute("UPDATE metering_records SET status=? WHERE order_id=?", (status, order_id))
    return {"ready": status == "matched", "status": status, "difference_ratio": round(difference, 6)}


def run_maintenance_cycle() -> dict:
    expired = payable = delivered = swap_quotes_expired = 0
    moment = now_iso()
    with db_connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            rows = connection.execute(
                "SELECT * FROM orders WHERE status='pending_payment' AND reservation_expires_at IS NOT NULL AND reservation_expires_at<=?",
                (moment,),
            ).fetchall()
            for order in rows:
                release_order_capacity(connection, order, "pending_payment")
                connection.execute("UPDATE orders SET status='expired',updated_at=? WHERE id=?", (moment, order["id"]))
                connection.execute("UPDATE payments SET status='closed',updated_at=? WHERE order_id=? AND status='pending'", (moment, order["id"]))
                audit(connection, None, "order", order["id"], "capacity.reservation_expired", {
                    "quantity": order["quantity"], "unit": order["unit"], "expired_at": moment,
                })
                expired += 1
            swap_rows = connection.execute(
                "SELECT * FROM swap_requests WHERE status='quoted' AND quote_expires_at IS NOT NULL AND quote_expires_at<=?",
                (moment,),
            ).fetchall()
            for swap in swap_rows:
                connection.execute("UPDATE allocations SET swap_reserved=MAX(0,swap_reserved-?) WHERE id=?", (swap["source_quantity"], swap["source_allocation_id"]))
                connection.execute("UPDATE listings SET quote_reserved=MAX(0,quote_reserved-?),version=version+1,updated_at=? WHERE id=?", (swap["target_quantity"], moment, swap["target_listing_id"]))
                connection.execute("UPDATE swap_requests SET status='quote_expired',updated_at=? WHERE id=?", (moment, swap["id"]))
                audit(connection, None, "swap", swap["id"], "swap.quote_expired", {"reservations_released": True})
                swap_quotes_expired += 1
            settlement_rows = connection.execute(
                """SELECT s.* FROM settlements s
                   WHERE s.status='holding' AND s.hold_until<=?
                   AND NOT EXISTS(SELECT 1 FROM disputes d WHERE d.order_id=s.order_id AND d.status IN ('open','reviewing'))
                   AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.order_id=s.order_id AND r.status IN ('pending_review','approved','processing'))""",
                (moment,),
            ).fetchall()
            for settlement in settlement_rows:
                connection.execute("UPDATE settlements SET status='payable',updated_at=? WHERE id=?", (moment, settlement["id"]))
                audit(connection, None, "settlement", settlement["id"], "settlement.payable", {
                    "order_id": settlement["order_id"], "supplier_net_cents": settlement["supplier_net_cents"],
                })
                payable += 1
            events = connection.execute("SELECT * FROM outbox WHERE status='pending' ORDER BY sequence LIMIT 200").fetchall()
            for event in events:
                connection.execute(
                    "INSERT OR IGNORE INTO event_deliveries(id,event_id,consumer,status,delivered_at) VALUES(?,?,?,'delivered',?)",
                    (uid("delivery"), event["event_id"], "kai-local-projection", moment),
                )
                connection.execute(
                    "UPDATE outbox SET status='processed',attempts=attempts+1,processed_at=? WHERE event_id=?",
                    (moment, event["event_id"]),
                )
                delivered += 1
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
    return {
        "expired_orders": expired, "expired_swap_quotes": swap_quotes_expired,
        "payable_settlements": payable,
        "processed_events": delivered,
    }


def maintenance_worker(stop_event: threading.Event) -> None:
    while not stop_event.wait(WORKER_INTERVAL_SECONDS):
        try:
            run_maintenance_cycle()
        except Exception as error:
            print(f"Maintenance cycle failed: {error!r}")


def apply_payment_callback(connection: sqlite3.Connection, provider: str, payload: dict,
                           signature: str, secret: str) -> sqlite3.Row:
    if not hmac.compare_digest(sign_payment(payload, secret), signature or ""):
        raise ApiError(401, "支付通知签名无效", "invalid_payment_signature")
    try:
        callback_time = int(payload["timestamp"])
    except (KeyError, ValueError, TypeError):
        raise ApiError(422, "支付通知时间戳无效", "invalid_payment_timestamp")
    if abs(int(time.time()) - callback_time) > 300:
        raise ApiError(409, "支付通知超出防重放时间窗", "payment_replay_window")
    if payload.get("status") != "SUCCESS" or payload.get("currency") != "CNY":
        raise ApiError(422, "支付状态或币种不符合入账条件", "payment_not_successful")

    connection.execute("BEGIN IMMEDIATE")
    try:
        payment = connection.execute("SELECT * FROM payments WHERE id=? AND provider=?", (payload.get("payment_id"), provider)).fetchone()
        if not payment:
            raise ApiError(404, "支付单不存在", "payment_not_found")
        order = fetch_order(connection, payment["order_id"])
        if str(payload.get("order_id")) != order["id"]:
            raise ApiError(409, "平台订单号不匹配", "order_mismatch")
        if str(payload.get("merchant_id")) not in ("KAI-MOCK", os.environ.get(f"KAI_{provider.upper()}_MERCHANT_ID", "")):
            raise ApiError(409, "商户号不匹配", "merchant_mismatch")
        if int(payload.get("amount_cents", -1)) != order["amount_cents"] or payment["amount_cents"] != order["amount_cents"]:
            raise ApiError(409, "支付金额不匹配", "amount_mismatch")
        existing = connection.execute("SELECT id FROM payments WHERE callback_event_id=?", (payload.get("event_id"),)).fetchone()
        if payment["status"] == "success" or existing:
            connection.execute("COMMIT")
            return fetch_order(connection, order["id"])
        if order["status"] != "pending_payment":
            raise ApiError(409, "订单当前状态不能支付", "invalid_order_state")
        if order["reservation_expires_at"] and order["reservation_expires_at"] <= now_iso():
            raise ApiError(409, "订单支付预留已过期，请重新下单", "reservation_expired")
        listing = connection.execute("SELECT * FROM listings WHERE id=?", (order["listing_id"],)).fetchone()
        if not listing or listing["quote_reserved"] + 1e-9 < order["quantity"]:
            raise ApiError(409, "订单预留容量异常", "reservation_mismatch")
        callback_hash = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        connection.execute(
            "UPDATE payments SET status='success',merchant_id=?,provider_txn_id=?,callback_event_id=?,callback_hash=?,updated_at=? WHERE id=?",
            (payload["merchant_id"], payload["provider_txn_id"], payload["event_id"], callback_hash, now_iso(), payment["id"]),
        )
        connection.execute(
            "UPDATE listings SET quote_reserved=quote_reserved-?,order_locked=order_locked+?,version=version+1,updated_at=? WHERE id=? AND version=?",
            (order["quantity"], order["quantity"], now_iso(), listing["id"], listing["version"]),
        )
        if connection.execute("SELECT changes()").fetchone()[0] != 1:
            raise ApiError(409, "容量版本冲突，请重试", "capacity_version_conflict")
        connection.execute(
            "UPDATE orders SET status='paid',payment_provider=?,updated_at=? WHERE id=?",
            (provider, now_iso(), order["id"]),
        )
        audit(connection, None, "order", order["id"], "payment.confirmed", {
            "payment_id": payment["id"], "provider": provider, "provider_txn_id": payload["provider_txn_id"],
            "amount_cents": order["amount_cents"], "currency": "CNY"
        }, event_id=payload["event_id"])
        connection.execute("COMMIT")
        return fetch_order(connection, order["id"])
    except Exception:
        connection.execute("ROLLBACK")
        raise


class KaiHandler(BaseHTTPRequestHandler):
    server_version = "KAICloud/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        try:
            parsed_request = urlparse(self.path)
            path = parsed_request.path
            if path == "/api/health":
                readiness = integration_readiness()
                return self.json_response(200, {
                    "ok": True, "service": "kai-transaction", "phase": 1,
                    "payment_mode": "mock" if ALLOW_DEMO else "provider",
                    "auth_provider": "kai_identity",
                    "auth_ready": readiness["identity"]["configured"],
                    "sms_ready": readiness["sms"]["configured"],
                    "payment_ready": any(item["configured"] for item in readiness["payment"].values()),
                })
            if path == "/api/config/readiness":
                return self.json_response(200, integration_readiness())
            if path == "/api/market/status":
                return self.json_response(200, app_market_status())
            if path == "/api/market/instruments":
                query = parse_qs(parsed_request.query)
                category = query.get("category", ["gpu"])[0]
                return self.json_response(200, app_market_instruments(category))
            if path == "/api/market/candles":
                query = parse_qs(parsed_request.query)
                instrument_id = query.get("instrumentId", [""])[0]
                if instrument_id:
                    range_id = query.get("range", ["30d"])[0]
                    app_interval = query.get("interval", ["1d"])[0]
                    return self.json_response(200, app_market_candles(instrument_id, range_id, app_interval))
                kind = query.get("kind", ["gpu"])[0]
                default_product = MARKET_PRODUCTS.get(kind, MARKET_PRODUCTS["gpu"])[0]["id"]
                product_id = query.get("product", [default_product])[0]
                region_id = query.get("region", ["chengdu"])[0]
                interval = query.get("interval", ["15m"])[0]
                try:
                    limit = int(query.get("limit", ["72"])[0])
                except ValueError:
                    raise ApiError(422, "K 线数量无效", "invalid_market_limit")
                return self.json_response(200, build_market_candles(kind, product_id, region_id, interval, limit))
            if path == "/api/auth/kai/start":
                return self.kai_identity_start(parse_qs(parsed_request.query))
            if path == "/api/auth/kai/callback":
                return self.kai_identity_callback(parse_qs(parsed_request.query))
            if path == "/api/auth/kai/mobile/start":
                return self.kai_identity_start(parse_qs(parsed_request.query), mobile=True)
            if path == "/api/auth/kai/mobile/callback":
                return self.kai_identity_callback(parse_qs(parsed_request.query), mobile=True)
            if path == "/api/auth/me":
                return self.get_me()
            if path == "/api/catalog":
                return self.get_catalog()
            if path == "/api/purchase-requests":
                return self.get_purchase_requests()
            if path == "/api/orders":
                return self.get_orders()
            if path == "/api/assets":
                return self.get_assets()
            if path == "/api/withdrawals":
                return self.get_withdrawals()
            if path == "/api/audit/recent":
                return self.get_recent_audit()
            if path == "/api/supplier/workbench":
                return self.get_supplier_workbench()
            if path in ("/api/supplier-rebate/overview", "/api/supplier-referral/overview"):
                return self.get_supplier_rebate_overview()
            if path == "/api/admin/overview":
                return self.get_admin_overview()
            if path == "/api/cases":
                return self.get_cases()
            if path == "/api/swaps":
                return self.get_swap_requests()
            if path == "/api/account/deletion-status":
                return self.get_account_deletion_status()
            if path == "/api/app/release-readiness":
                return self.get_app_release_readiness()
            if path == "/api/public/operator":
                return self.get_public_operator()
            return self.serve_static(path)
        except ApiError as error:
            self.api_error(error)
        except Exception as error:
            print(f"Unhandled GET error: {error!r}")
            self.api_error(ApiError(500, "服务暂时不可用", "internal_error"))

    def do_POST(self) -> None:
        try:
            path = urlparse(self.path).path
            if not self.origin_is_same_site():
                raise ApiError(403, "请求来源校验失败", "origin_rejected")
            if path == "/api/auth/register":
                return self.register()
            if path == "/api/auth/send-code":
                return self.send_registration_code()
            if path == "/api/auth/login":
                return self.login()
            if path == "/api/auth/kai/mobile/prepare":
                return self.prepare_mobile_identity_login()
            if path == "/api/auth/kai/mobile/session":
                return self.create_mobile_identity_session()
            if path == "/api/auth/demo-login":
                return self.demo_login()
            if path == "/api/auth/logout":
                return self.logout()
            if path == "/api/auth/change-password":
                return self.change_password()
            if path == "/api/suppliers/applications":
                return self.create_supplier_application()
            if path == "/api/assets/intake":
                return self.create_resource_intake()
            if path == "/api/supplier/listings":
                return self.create_supplier_listing()
            if path == "/api/withdrawals":
                return self.create_withdrawal()
            if path == "/api/orders":
                return self.create_order()
            if path == "/api/purchase-requests":
                return self.create_purchase_request()
            if path == "/api/supplier-rebate/submissions":
                return self.create_supplier_rebate_submission()
            if path == "/api/payments/create":
                return self.create_payment()
            if path == "/api/payments/mock-complete":
                return self.mock_complete_payment()
            if path == "/api/metering":
                return self.create_metering_record()
            if path == "/api/disputes":
                return self.create_dispute()
            if path == "/api/refunds":
                return self.create_refund()
            if path == "/api/invoices":
                return self.create_invoice_request()
            if path == "/api/swaps":
                return self.create_swap_request()
            if path == "/api/account/deletion-request":
                return self.create_account_deletion_request()
            if path == "/api/account/deletion-cancel":
                return self.cancel_account_deletion_request()
            if path == "/api/admin/maintenance/run":
                return self.admin_run_maintenance()
            callback_match = re.fullmatch(r"/api/payments/callback/(alipay|wechat)", path)
            if callback_match:
                return self.real_payment_callback(callback_match.group(1))
            refund_callback_match = re.fullmatch(r"/api/payments/refund-callback/(alipay|wechat)", path)
            if refund_callback_match:
                return self.real_refund_callback(refund_callback_match.group(1))
            deliver_match = re.fullmatch(r"/api/orders/([^/]+)/demo-deliver", path)
            if deliver_match:
                return self.demo_deliver(deliver_match.group(1))
            supplier_confirm_match = re.fullmatch(r"/api/supplier/orders/([^/]+)/confirm", path)
            if supplier_confirm_match:
                return self.supplier_confirm_order(supplier_confirm_match.group(1))
            supplier_deliver_match = re.fullmatch(r"/api/supplier/orders/([^/]+)/deliver", path)
            if supplier_deliver_match:
                return self.supplier_deliver_order(supplier_deliver_match.group(1))
            accept_match = re.fullmatch(r"/api/orders/([^/]+)/accept", path)
            if accept_match:
                return self.accept_order(accept_match.group(1))
            cancel_match = re.fullmatch(r"/api/orders/([^/]+)/cancel", path)
            if cancel_match:
                return self.cancel_order(cancel_match.group(1))
            supplier_review_match = re.fullmatch(r"/api/admin/suppliers/([^/]+)/review", path)
            if supplier_review_match:
                return self.admin_review_supplier(supplier_review_match.group(1))
            intake_review_match = re.fullmatch(r"/api/admin/intakes/([^/]+)/review", path)
            if intake_review_match:
                return self.admin_review_intake(intake_review_match.group(1))
            listing_review_match = re.fullmatch(r"/api/admin/listings/([^/]+)/review", path)
            if listing_review_match:
                return self.admin_review_listing(listing_review_match.group(1))
            dispute_review_match = re.fullmatch(r"/api/admin/disputes/([^/]+)/resolve", path)
            if dispute_review_match:
                return self.admin_resolve_dispute(dispute_review_match.group(1))
            refund_review_match = re.fullmatch(r"/api/admin/refunds/([^/]+)/review", path)
            if refund_review_match:
                return self.admin_review_refund(refund_review_match.group(1))
            settlement_paid_match = re.fullmatch(r"/api/admin/settlements/([^/]+)/mark-paid", path)
            if settlement_paid_match:
                return self.admin_mark_settlement_paid(settlement_paid_match.group(1))
            supplier_rebate_review_match = re.fullmatch(r"/api/admin/supplier-rebates/([^/]+)/review", path)
            if supplier_rebate_review_match:
                return self.admin_review_supplier_rebate(supplier_rebate_review_match.group(1))
            invoice_issue_match = re.fullmatch(r"/api/admin/invoices/([^/]+)/issue", path)
            if invoice_issue_match:
                return self.admin_issue_invoice(invoice_issue_match.group(1))
            swap_quote_match = re.fullmatch(r"/api/admin/swaps/([^/]+)/quote", path)
            if swap_quote_match:
                return self.admin_quote_swap(swap_quote_match.group(1))
            swap_accept_match = re.fullmatch(r"/api/swaps/([^/]+)/accept", path)
            if swap_accept_match:
                return self.accept_swap_quote(swap_accept_match.group(1))
            swap_cancel_match = re.fullmatch(r"/api/swaps/([^/]+)/cancel", path)
            if swap_cancel_match:
                return self.cancel_swap_request(swap_cancel_match.group(1))
            deletion_complete_match = re.fullmatch(r"/api/admin/account-deletions/([^/]+)/complete", path)
            if deletion_complete_match:
                return self.admin_complete_account_deletion(deletion_complete_match.group(1))
            raise ApiError(404, "接口不存在", "not_found")
        except ApiError as error:
            self.api_error(error)
        except sqlite3.IntegrityError as error:
            print(f"Integrity error: {error!r}")
            self.api_error(ApiError(409, "请求与现有记录冲突", "conflict"))
        except Exception as error:
            print(f"Unhandled POST error: {error!r}")
            self.api_error(ApiError(500, "服务暂时不可用", "internal_error"))

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(400, "请求长度无效")
        if length <= 0 or length > MAX_BODY:
            raise ApiError(413 if length > MAX_BODY else 400, "请求内容为空或过大")
        try:
            value = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "JSON 请求格式无效")
        if not isinstance(value, dict):
            raise ApiError(400, "JSON 请求必须是对象")
        return value

    def json_response(self, status: int, payload: dict, cookies: list[str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for cookie in cookies or []:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def api_error(self, error: ApiError) -> None:
        self.json_response(error.status, {"ok": False, "error": {"code": error.code, "message": error.message}})

    def cookie_value(self, name: str) -> str | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        return cookie[name].value if name in cookie else None

    def session(self, csrf: bool = False) -> sqlite3.Row:
        raw = self.cookie_value("kai_session")
        if not raw:
            raise ApiError(401, "请先登录", "authentication_required")
        with db_connect() as connection:
            row = connection.execute(
                "SELECT s.*,u.name,u.account,u.role,u.enterprise_status,u.must_change_password,u.lifecycle_status FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
                (token_hash(raw), now_iso()),
            ).fetchone()
        if not row:
            raise ApiError(401, "登录状态已失效，请重新登录", "session_expired")
        if csrf and not hmac.compare_digest(row["csrf_token"], self.headers.get("X-KAI-CSRF", "")):
            raise ApiError(403, "请求令牌校验失败", "csrf_rejected")
        return row

    def create_session(self, connection: sqlite3.Connection, user_id: str) -> tuple[str, str]:
        raw = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        connection.execute(
            "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)",
            (token_hash(raw), user_id, csrf, future_iso(SESSION_HOURS), now_iso()),
        )
        return raw, csrf

    def session_cookie(self, raw: str, clear: bool = False) -> str:
        parts = [f"kai_session={'' if clear else raw}", "Path=/", "HttpOnly", "SameSite=Lax"]
        if clear:
            parts.append("Max-Age=0")
        else:
            parts.append(f"Max-Age={SESSION_HOURS * 3600}")
        if COOKIE_SECURE:
            parts.append("Secure")
        return "; ".join(parts)

    def oidc_transaction_cookie(self, transaction_id: str, clear: bool = False) -> str:
        parts = [
            f"kai_oidc_transaction={'' if clear else transaction_id}",
            "Path=/api/auth/kai",
            "HttpOnly",
            "SameSite=Lax",
        ]
        parts.append("Max-Age=0" if clear else f"Max-Age={IDENTITY_TRANSACTION_MINUTES * 60}")
        if COOKIE_SECURE or IDENTITY_REDIRECT_URI.startswith("https://"):
            parts.append("Secure")
        return "; ".join(parts)

    def redirect_response(self, location: str, cookies: list[str] | None = None) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        for cookie in cookies or []:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    def kai_identity_start(self, query: dict[str, list[str]], mobile: bool = False) -> None:
        flow = "mobile" if mobile else "web"
        self.rate_limit(f"kai-identity-start:{flow}:{self.client_address[0]}", 20, 300)
        readiness = identity_readiness()
        if not readiness["configured"]:
            raise ApiError(503, "KAI Identity 统一登录客户端尚未配置完成", "kai_identity_not_configured")
        return_to = safe_return_to(query.get("return_to", ["/"])[0])
        app_nonce_hash = None
        login_hint = ""
        if mobile:
            login_handle = str(query.get("login_handle", [""])[0]).strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]{43,180}", login_handle):
                raise ApiError(422, "App 登录准备信息无效，请重新发起登录", "mobile_identity_handle_invalid")
            moment = now_iso()
            with db_connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                try:
                    preparation = connection.execute(
                        "SELECT * FROM mobile_login_preparations WHERE handle_hash=?",
                        (token_hash(login_handle),),
                    ).fetchone()
                    if not preparation or preparation["expires_at"] <= moment or preparation["consumed_at"]:
                        raise ApiError(401, "App 登录准备信息已失效，请重新登录", "mobile_identity_handle_expired")
                    return_to = safe_return_to(preparation["return_to"])
                    app_nonce_hash = preparation["app_nonce_hash"]
                    login_hint = str(preparation["login_hint"] or "")
                    connection.execute(
                        "DELETE FROM mobile_login_preparations WHERE handle_hash=?",
                        (token_hash(login_handle),),
                    )
                    connection.execute("COMMIT")
                except Exception:
                    if connection.in_transaction:
                        connection.execute("ROLLBACK")
                    raise
        transaction_id = uid("oidc")
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = base64url(hashlib.sha256(code_verifier.encode("ascii")).digest())
        created = now_iso()
        expires = (
            datetime.now(timezone.utc) + timedelta(minutes=IDENTITY_TRANSACTION_MINUTES)
        ).replace(microsecond=0).isoformat()
        with db_connect() as connection:
            connection.execute("DELETE FROM oidc_transactions WHERE expires_at<=?", (created,))
            connection.execute(
                "INSERT INTO oidc_transactions(id,state_hash,nonce,code_verifier,return_to,expires_at,created_at,flow,app_nonce_hash) VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    transaction_id, token_hash(state), nonce, code_verifier, return_to, expires, created,
                    flow, app_nonce_hash,
                ),
            )
        redirect_uri = IDENTITY_MOBILE_REDIRECT_URI if mobile else IDENTITY_REDIRECT_URI
        authorization_params = {
            'response_type': 'code',
            'client_id': IDENTITY_CLIENT_ID,
            'redirect_uri': redirect_uri,
            'scope': 'openid profile email',
            'state': state,
            'nonce': nonce,
            'code_challenge': code_challenge,
            'code_challenge_method': 'S256',
            'response_mode': 'query',
        }
        if login_hint:
            authorization_params["login_hint"] = login_hint
        authorization_url = f"{IDENTITY_AUTHORIZATION_ENDPOINT}?{urlencode(authorization_params)}"
        self.redirect_response(authorization_url, [self.oidc_transaction_cookie(transaction_id)])

    def kai_identity_request(self, request: Request, error_message: str) -> dict:
        try:
            with urlopen(request, timeout=15) as response:
                body = response.read(MAX_BODY + 1)
            if len(body) > MAX_BODY:
                raise ApiError(502, error_message, "kai_identity_response_too_large")
            payload = json.loads(body.decode("utf-8"))
        except ApiError:
            raise
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
            print(f"KAI Identity request failed: {type(error).__name__}")
            raise ApiError(502, error_message, "kai_identity_unavailable")
        if not isinstance(payload, dict):
            raise ApiError(502, error_message, "kai_identity_invalid_response")
        return payload

    def exchange_kai_identity_code(self, code: str, code_verifier: str, redirect_uri: str) -> dict:
        form = urlencode({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }).encode("utf-8")
        basic = base64.b64encode(f"{IDENTITY_CLIENT_ID}:{IDENTITY_CLIENT_SECRET}".encode("utf-8")).decode("ascii")
        request = Request(IDENTITY_TOKEN_ENDPOINT, data=form, method="POST", headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {basic}",
            "User-Agent": "CloudPay-OIDC/1.0",
        })
        payload = self.kai_identity_request(request, "KAI Identity 暂时无法完成登录")
        access_token = str(payload.get("access_token") or "")
        if not access_token or str(payload.get("token_type") or "Bearer").lower() != "bearer":
            raise ApiError(502, "KAI Identity 返回的登录凭据无效", "kai_identity_invalid_token")
        return payload

    def fetch_kai_identity_user(self, access_token: str) -> dict:
        request = Request(IDENTITY_USERINFO_ENDPOINT, method="GET", headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
            "User-Agent": "CloudPay-OIDC/1.0",
        })
        return self.kai_identity_request(request, "KAI Identity 暂时无法读取账户资料")

    def complete_kai_identity_callback(self, query: dict[str, list[str]], mobile: bool = False) -> None:
        flow = "mobile" if mobile else "web"
        self.rate_limit(f"kai-identity-callback:{flow}:{self.client_address[0]}", 30, 300)
        if query.get("error"):
            raise ApiError(401, "KAI Identity 登录已取消或未获授权", "kai_identity_denied")
        code = str(query.get("code", [""])[0]).strip()
        state = str(query.get("state", [""])[0]).strip()
        transaction_id = self.cookie_value("kai_oidc_transaction") or ""
        if not code or not state or not transaction_id:
            raise ApiError(400, "统一登录回调参数不完整", "kai_identity_callback_invalid")
        moment = now_iso()
        with db_connect() as connection:
            transaction = connection.execute(
                "SELECT * FROM oidc_transactions WHERE id=?", (transaction_id,)
            ).fetchone()
            if transaction:
                connection.execute("DELETE FROM oidc_transactions WHERE id=?", (transaction_id,))
        if not transaction or transaction["expires_at"] <= moment:
            raise ApiError(400, "统一登录请求已过期，请重新登录", "kai_identity_transaction_expired")
        if transaction["flow"] != flow:
            raise ApiError(400, "统一登录回调通道不匹配", "kai_identity_flow_rejected")
        if not hmac.compare_digest(transaction["state_hash"], token_hash(state)):
            raise ApiError(400, "统一登录状态校验失败", "kai_identity_state_rejected")

        redirect_uri = IDENTITY_MOBILE_REDIRECT_URI if mobile else IDENTITY_REDIRECT_URI
        token_payload = self.exchange_kai_identity_code(code, transaction["code_verifier"], redirect_uri)
        claims = self.fetch_kai_identity_user(str(token_payload["access_token"]))
        subject = str(claims.get("sub") or "").strip()
        email = str(claims.get("email") or "").strip().lower()
        email_verified = claims.get("email_verified") in (True, 1, "true", "True")
        if not subject or len(subject) > 255:
            raise ApiError(502, "KAI Identity 账户标识无效", "kai_identity_subject_invalid")
        if not email_verified or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ApiError(403, "请先在 KAI Identity 完成邮箱验证", "kai_identity_email_unverified")
        name = str(claims.get("name") or email.split("@", 1)[0] or "KAI 用户").strip()[:120]
        if len(name) < 2:
            name = f"KAI 用户 {name}".strip()
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                identity = connection.execute(
                    "SELECT * FROM external_identities WHERE provider='kai_identity' AND subject=?", (subject,)
                ).fetchone()
                user = connection.execute("SELECT * FROM users WHERE id=?", (identity["user_id"],)).fetchone() if identity else None
                if not user:
                    user = connection.execute("SELECT * FROM users WHERE account=?", (email,)).fetchone()
                    if user and user["role"] in ("admin", "staff"):
                        raise ApiError(403, "运营账号首次绑定需由管理员在后台确认", "staff_identity_link_required")
                    if not user:
                        user_id = uid("usr")
                        connection.execute(
                            "INSERT INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at) VALUES(?,?,?,?, 'buyer','unverified',?,?)",
                            (user_id, name, email, hash_password(secrets.token_urlsafe(48)), created, created),
                        )
                        user = connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                    connection.execute(
                        "INSERT INTO external_identities(provider,subject,user_id,email,claims_json,created_at,updated_at) VALUES('kai_identity',?,?,?,?,?,?)",
                        (subject, user["id"], email, json.dumps({"email_verified": True}, ensure_ascii=False), created, created),
                    )
                    audit(connection, user["id"], "user", user["id"], "identity.kai_linked", {
                        "subject_hash": token_hash(subject), "email_hash": token_hash(email),
                    })
                else:
                    connection.execute(
                        "UPDATE external_identities SET email=?,claims_json=?,updated_at=? WHERE provider='kai_identity' AND subject=?",
                        (email, json.dumps({"email_verified": True}, ensure_ascii=False), created, subject),
                    )
                if user["lifecycle_status"] == "anonymized":
                    raise ApiError(403, "账户已注销", "account_deleted")
                if mobile:
                    ticket = secrets.token_urlsafe(48)
                    ticket_expires = (
                        datetime.now(timezone.utc) + timedelta(minutes=MOBILE_LOGIN_TICKET_MINUTES)
                    ).replace(microsecond=0).isoformat()
                    connection.execute("DELETE FROM mobile_login_tickets WHERE expires_at<=?", (created,))
                    connection.execute(
                        "INSERT INTO mobile_login_tickets(ticket_hash,user_id,app_nonce_hash,return_to,expires_at,created_at) VALUES(?,?,?,?,?,?)",
                        (
                            token_hash(ticket), user["id"], transaction["app_nonce_hash"],
                            safe_return_to(transaction["return_to"]), ticket_expires, created,
                        ),
                    )
                    audit(connection, user["id"], "mobile_login", token_hash(ticket)[:16], "identity.mobile_ticket_created", {
                        "expires_at": ticket_expires,
                    })
                else:
                    raw, csrf = self.create_session(connection, user["id"])
                    audit(connection, user["id"], "session", token_hash(raw)[:16], "session.kai_identity_created", {
                        "channel": "web",
                    })
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
        return_to = safe_return_to(transaction["return_to"])
        if mobile:
            separator = "&" if "?" in MOBILE_APP_CALLBACK_URI else "?"
            return self.redirect_response(
                f"{MOBILE_APP_CALLBACK_URI}{separator}{urlencode({'ticket': ticket, 'return_to': return_to})}",
                [self.oidc_transaction_cookie("", clear=True)],
            )
        separator = "&" if "?" in return_to else "?"
        self.redirect_response(
            f"{return_to}{separator}kai_auth=success",
            [self.session_cookie(raw), self.oidc_transaction_cookie("", clear=True)],
        )

    def kai_identity_callback(self, query: dict[str, list[str]], mobile: bool = False) -> None:
        try:
            self.complete_kai_identity_callback(query, mobile=mobile)
        except ApiError as error:
            if mobile:
                separator = "&" if "?" in MOBILE_APP_CALLBACK_URI else "?"
                return self.redirect_response(
                    f"{MOBILE_APP_CALLBACK_URI}{separator}{urlencode({'error': error.code})}",
                    [self.oidc_transaction_cookie("", clear=True)],
                )
            self.redirect_response(
                f"/?kai_auth=error&reason={urlencode({'reason': error.code}).split('=', 1)[1]}",
                [self.oidc_transaction_cookie("", clear=True)],
            )
        except Exception as error:
            print(f"Unhandled KAI Identity callback error: {type(error).__name__}")
            if mobile:
                separator = "&" if "?" in MOBILE_APP_CALLBACK_URI else "?"
                return self.redirect_response(
                    f"{MOBILE_APP_CALLBACK_URI}{separator}error=internal_error",
                    [self.oidc_transaction_cookie("", clear=True)],
                )
            self.redirect_response(
                "/?kai_auth=error&reason=internal_error",
                [self.oidc_transaction_cookie("", clear=True)],
            )

    def prepare_mobile_identity_login(self) -> None:
        self.rate_limit(f"mobile-identity-prepare:{self.client_address[0]}", 20, 300)
        readiness = identity_readiness()
        if not readiness["configured"]:
            raise ApiError(503, "KAI Identity 统一登录客户端尚未配置完成", "kai_identity_not_configured")
        data = self.read_json()
        app_nonce = str(data.get("app_nonce") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{43,180}", app_nonce):
            raise ApiError(422, "App 登录绑定码无效，请重新发起登录", "mobile_identity_nonce_invalid")
        login_hint = str(data.get("login_hint") or "").strip().lower()
        if not re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,189}", login_hint):
            raise ApiError(422, "请输入有效的 KAI 账户邮箱", "mobile_identity_login_hint_invalid")
        return_to = safe_return_to(data.get("return_to") or "/")
        login_handle = secrets.token_urlsafe(48)
        created = now_iso()
        expires = (
            datetime.now(timezone.utc) + timedelta(minutes=IDENTITY_TRANSACTION_MINUTES)
        ).replace(microsecond=0).isoformat()
        with db_connect() as connection:
            connection.execute("DELETE FROM mobile_login_preparations WHERE expires_at<=?", (created,))
            connection.execute(
                "INSERT INTO mobile_login_preparations(handle_hash,app_nonce_hash,login_hint,return_to,expires_at,created_at) VALUES(?,?,?,?,?,?)",
                (token_hash(login_handle), token_hash(app_nonce), login_hint, return_to, expires, created),
            )
        self.json_response(201, {
            "ok": True,
            "login_handle": login_handle,
            "start_url": f"/api/auth/kai/mobile/start?{urlencode({'login_handle': login_handle})}",
            "expires_at": expires,
        })

    def create_mobile_identity_session(self) -> None:
        self.rate_limit(f"mobile-identity-session:{self.client_address[0]}", 12, 300)
        data = self.read_json()
        ticket = str(data.get("ticket") or "").strip()
        app_nonce = str(data.get("app_nonce") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{48,180}", ticket):
            raise ApiError(422, "App 登录票据无效，请重新登录", "mobile_identity_ticket_invalid")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43,180}", app_nonce):
            raise ApiError(422, "App 登录绑定码无效，请重新登录", "mobile_identity_nonce_invalid")
        moment = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                login_ticket = connection.execute(
                    "SELECT * FROM mobile_login_tickets WHERE ticket_hash=?", (token_hash(ticket),)
                ).fetchone()
                if not login_ticket or login_ticket["expires_at"] <= moment or login_ticket["consumed_at"]:
                    raise ApiError(401, "App 登录票据已失效，请重新登录", "mobile_identity_ticket_expired")
                if not hmac.compare_digest(login_ticket["app_nonce_hash"], token_hash(app_nonce)):
                    raise ApiError(403, "App 登录绑定校验失败", "mobile_identity_nonce_rejected")
                user = connection.execute(
                    "SELECT * FROM users WHERE id=?", (login_ticket["user_id"],)
                ).fetchone()
                if not user or user["lifecycle_status"] == "anonymized":
                    raise ApiError(403, "账户不可用", "account_unavailable")
                connection.execute(
                    "UPDATE mobile_login_tickets SET consumed_at=? WHERE ticket_hash=? AND consumed_at IS NULL",
                    (moment, token_hash(ticket)),
                )
                raw, csrf = self.create_session(connection, user["id"])
                audit(connection, user["id"], "session", token_hash(raw)[:16], "session.kai_identity_created", {
                    "channel": "mobile",
                })
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
        self.json_response(200, {
            "ok": True,
            "user": public_user(user),
            "csrf_token": csrf,
            "return_to": safe_return_to(login_ticket["return_to"]),
        }, [self.session_cookie(raw)])

    def origin_is_same_site(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urlparse(origin)
        return parsed.netloc == self.headers.get("Host") and parsed.scheme in ("http", "https")

    def rate_limit(self, key: str, limit: int = 12, window: int = 60) -> None:
        moment = time.time()
        with RATE_LOCK:
            bucket = [stamp for stamp in RATE_BUCKETS.get(key, []) if stamp > moment - window]
            if len(bucket) >= limit:
                raise ApiError(429, "请求过于频繁，请稍后再试", "rate_limited")
            bucket.append(moment)
            RATE_BUCKETS[key] = bucket

    def send_registration_code(self) -> None:
        if AUTH_PROVIDER == "kai_identity":
            raise ApiError(410, "请使用 KAI Identity 统一账户注册", "kai_identity_registration_required")
        data = self.read_json()
        phone = normalize_phone(data.get("phone") or data.get("account"))
        phone_key = hashlib.sha256(phone.encode("utf-8")).hexdigest()
        ip_key = hashlib.sha256(self.client_address[0].encode("utf-8")).hexdigest()
        self.rate_limit(f"sms-ip:{ip_key}", 5, 600)
        self.rate_limit(f"sms-phone:{phone_key}", 3, 600)
        readiness = sms_readiness()
        if not readiness["configured"]:
            raise ApiError(503, "短信验证码通道尚未配置完成", "sms_provider_not_configured")

        verification_id = uid("verify")
        code = f"{secrets.randbelow(1_000_000):06d}"
        created = now_iso()
        expires = (datetime.now(timezone.utc) + timedelta(seconds=OTP_TTL_SECONDS)).replace(microsecond=0).isoformat()
        with db_connect() as connection:
            recent = connection.execute(
                "SELECT sent_at FROM phone_verifications WHERE phone=? AND purpose='register' AND status='sent' ORDER BY created_at DESC LIMIT 1",
                (phone,),
            ).fetchone()
            if recent:
                sent_at = datetime.fromisoformat(recent["sent_at"])
                remaining = 60 - int((datetime.now(timezone.utc) - sent_at).total_seconds())
                if remaining > 0:
                    raise ApiError(429, f"请在 {remaining} 秒后重新获取验证码", "sms_resend_too_soon")
            connection.execute(
                """INSERT INTO phone_verifications(
                   id,phone,purpose,code_hash,provider,status,attempts,max_attempts,request_ip_hash,
                   expires_at,sent_at,created_at,updated_at
                   ) VALUES(?,?,'register',?,?,'sending',0,?,?,?,?,?,?)""",
                (verification_id, phone, otp_digest(verification_id, phone, code), SMS_PROVIDER,
                 OTP_MAX_ATTEMPTS, ip_key, expires, created, created, created),
            )
        try:
            provider_request_id = send_verification_message(phone, code)
        except Exception:
            with db_connect() as connection:
                connection.execute(
                    "UPDATE phone_verifications SET status='failed',updated_at=? WHERE id=?",
                    (now_iso(), verification_id),
                )
            raise
        with db_connect() as connection:
            connection.execute(
                "UPDATE phone_verifications SET status='sent',provider_request_id=?,updated_at=? WHERE id=?",
                (provider_request_id, now_iso(), verification_id),
            )
            audit(connection, None, "phone_verification", verification_id, "verification.sent", {
                "phone_hash": phone_key, "purpose": "register", "provider": SMS_PROVIDER,
                "expires_in": OTP_TTL_SECONDS,
            })
        payload = {"ok": True, "sent": True, "expires_in": OTP_TTL_SECONDS, "resend_after": 60}
        if ALLOW_DEMO and SMS_PROVIDER == "mock":
            payload["debug_code"] = code
        self.json_response(200, payload)

    def register(self) -> None:
        if AUTH_PROVIDER == "kai_identity":
            raise ApiError(410, "请使用 KAI Identity 统一账户注册", "kai_identity_registration_required")
        self.rate_limit(f"register:{self.client_address[0]}", 6, 300)
        data = self.read_json()
        name = clean_text(data.get("name"), "企业名称", 2, 120)
        account_input = clean_text(data.get("account"), "手机号或邮箱", 5, 160)
        account = normalize_phone(account_input) if REQUIRE_SMS else account_input.lower()
        password = str(data.get("password") or "")
        if not REQUIRE_SMS and not (re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", account) or re.fullmatch(r"\+?\d{8,15}", account)):
            raise ApiError(422, "请输入有效的手机号或邮箱", "invalid_account")
        if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
            raise ApiError(422, "密码至少 8 位，并同时包含字母和数字", "weak_password")
        verification_code = str(data.get("verification_code") or "").strip()
        if REQUIRE_SMS and not re.fullmatch(r"\d{6}", verification_code):
            raise ApiError(422, "请输入 6 位短信验证码", "verification_code_required")
        created = now_iso()
        user_id = uid("usr")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                verification = None
                if REQUIRE_SMS:
                    verification = connection.execute(
                        """SELECT * FROM phone_verifications
                           WHERE phone=? AND purpose='register' AND status='sent' AND expires_at>?
                           ORDER BY created_at DESC LIMIT 1""",
                        (account, created),
                    ).fetchone()
                    if not verification:
                        raise ApiError(422, "验证码已失效，请重新获取", "verification_expired")
                    if verification["attempts"] >= verification["max_attempts"]:
                        raise ApiError(429, "验证码尝试次数过多，请重新获取", "verification_attempts_exhausted")
                    if not hmac.compare_digest(verification["code_hash"], otp_digest(verification["id"], account, verification_code)):
                        next_attempt = verification["attempts"] + 1
                        status = "exhausted" if next_attempt >= verification["max_attempts"] else "sent"
                        connection.execute(
                            "UPDATE phone_verifications SET attempts=?,status=?,updated_at=? WHERE id=?",
                            (next_attempt, status, created, verification["id"]),
                        )
                        connection.execute("COMMIT")
                        raise ApiError(422, "短信验证码错误", "invalid_verification_code")
                connection.execute(
                    "INSERT INTO users(id,name,account,password_hash,role,enterprise_status,created_at,updated_at) VALUES(?,?,?,?,'buyer','unverified',?,?)",
                    (user_id, name, account, hash_password(password), created, created),
                )
                if verification:
                    connection.execute(
                        "UPDATE phone_verifications SET status='consumed',consumed_at=?,updated_at=? WHERE id=? AND status='sent'",
                        (created, created, verification["id"]),
                    )
                raw, csrf = self.create_session(connection, user_id)
                audit(connection, user_id, "user", user_id, "user.registered", {
                    "account_hash": hashlib.sha256(account.encode()).hexdigest(),
                    "phone_verified": bool(verification),
                })
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
            user = connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        self.json_response(201, {"ok": True, "user": public_user(user), "csrf_token": csrf}, [self.session_cookie(raw)])

    def login(self) -> None:
        self.rate_limit(f"login:{self.client_address[0]}", 12, 300)
        data = self.read_json()
        account = clean_text(data.get("account"), "账号", 5, 160).lower()
        password = str(data.get("password") or "")
        with db_connect() as connection:
            user = connection.execute("SELECT * FROM users WHERE account=?", (account,)).fetchone()
            if not user or not verify_password(password, user["password_hash"]):
                raise ApiError(401, "账号或密码错误", "invalid_credentials")
            if user["lifecycle_status"] == "anonymized":
                raise ApiError(403, "账户已注销", "account_deleted")
            raw, csrf = self.create_session(connection, user["id"])
            audit(connection, user["id"], "session", token_hash(raw)[:16], "session.created", {})
        self.json_response(200, {"ok": True, "user": public_user(user), "csrf_token": csrf}, [self.session_cookie(raw)])

    def demo_login(self) -> None:
        if not ALLOW_DEMO:
            raise ApiError(404, "联调账户未启用", "demo_disabled")
        self.rate_limit(f"demo-login:{self.client_address[0]}", 20, 300)
        with db_connect() as connection:
            user = connection.execute("SELECT * FROM users WHERE id='usr_demo_buyer'").fetchone()
            raw, csrf = self.create_session(connection, user["id"])
            audit(connection, user["id"], "session", token_hash(raw)[:16], "session.demo_created", {})
        self.json_response(200, {"ok": True, "user": public_user(user), "csrf_token": csrf}, [self.session_cookie(raw)])

    def logout(self) -> None:
        row = self.session(csrf=True)
        raw = self.cookie_value("kai_session")
        with db_connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(raw or ""),))
            audit(connection, row["user_id"], "session", token_hash(raw or "")[:16], "session.revoked", {})
        self.json_response(200, {"ok": True}, [self.session_cookie("", clear=True)])

    def change_password(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        current_password = str(data.get("current_password") or "")
        new_password = str(data.get("new_password") or "")
        if len(new_password) < 12 or not re.search(r"[A-Za-z]", new_password) or not re.search(r"\d", new_password) or not re.search(r"[^A-Za-z0-9]", new_password):
            raise ApiError(422, "新密码至少 12 位，并包含字母、数字和特殊字符", "weak_password")
        raw = self.cookie_value("kai_session") or ""
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                user = connection.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
                if not user or not verify_password(current_password, user["password_hash"]):
                    raise ApiError(401, "当前密码不正确", "invalid_current_password")
                if verify_password(new_password, user["password_hash"]):
                    raise ApiError(422, "新密码不能与当前密码相同")
                updated = now_iso()
                connection.execute("UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?", (hash_password(new_password), updated, user["id"]))
                connection.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (user["id"], token_hash(raw)))
                audit(connection, user["id"], "user", user["id"], "user.password_changed", {"other_sessions_revoked": True})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "must_change_password": False})

    def get_me(self) -> None:
        try:
            row = self.session()
        except ApiError:
            return self.json_response(200, {"ok": True, "authenticated": False})
        self.json_response(200, {"ok": True, "authenticated": True, "user": {
            "id": row["user_id"], "name": row["name"], "account": row["account"],
            "role": row["role"], "enterprise_status": row["enterprise_status"],
            "lifecycle_status": row["lifecycle_status"],
            "must_change_password": bool(row["must_change_password"])
        }, "csrf_token": row["csrf_token"]})

    def get_catalog(self) -> None:
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT *, verified_quantity-quote_reserved-order_locked-delivering-consumed-frozen AS available
                   FROM listings WHERE status='active' AND trade_mode='fixed' AND valid_from<=? AND valid_until>? ORDER BY kind,unit_price_cents""",
                (now_iso(), now_iso()),
            ).fetchall()
        listings = [{
            "id": row["id"], "kind": row["kind"], "product_code": row["product_code"], "gpu": row["gpu"],
            "provider": row["provider"], "region": row["region"], "unit": row["unit"],
            "unit_price_cny": row["unit_price_cents"] / 100, "available_quantity": max(0, row["available"]),
            "valid_from": row["valid_from"], "valid_until": row["valid_until"], "version": row["version"],
            "trade_mode": row["trade_mode"], "sla": row["sla"], "minimum_quantity": row["minimum_quantity"],
        } for row in rows if row["available"] > 0]
        self.json_response(200, {"ok": True, "listings": listings, "price_notice": "订单执行价以创建订单时的服务端库存快照为准"})

    def get_purchase_requests(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT id,product_code,region,service_mode,service_hours,requested_gpu_hours,
                          cpu_cores,memory_gb,storage,environment,start_at,status,created_at,updated_at
                   FROM purchase_requests WHERE buyer_user_id=? ORDER BY created_at DESC LIMIT 20""",
                (session["user_id"],),
            ).fetchall()
        self.json_response(200, {"ok": True, "requests": [dict(row) for row in rows]})

    def create_purchase_request(self) -> None:
        session = self.session(csrf=True)
        self.rate_limit(f"purchase-request:{session['user_id']}", 10, 3600)
        data = self.read_json()
        product_code = clean_text(data.get("product_code") or "NVIDIA H100 SXM 80GB", "H100 产品", 4, 80)
        if product_code != "NVIDIA H100 SXM 80GB":
            raise ApiError(422, "当前采购需求入口仅支持 NVIDIA H100 SXM 80GB", "unsupported_purchase_product")
        region = clean_text(data.get("region") or "不限地区", "期望地区", 2, 40)
        if region not in {"不限地区", "北京", "上海", "深圳", "成都", "中国香港"}:
            raise ApiError(422, "期望地区不在可选范围内", "invalid_purchase_region")
        service_mode = clean_text(data.get("service_mode") or "exclusive", "H100 使用模式", 3, 24)
        if service_mode not in H100_SERVICE_MODES:
            raise ApiError(422, "H100 使用模式无效", "invalid_h100_service_mode")
        try:
            service_hours = round(float(data.get("service_hours")), 3)
            cpu_cores = int(data.get("cpu_cores"))
            memory_gb = int(data.get("memory_gb"))
        except (TypeError, ValueError):
            raise ApiError(422, "H100 采购配置格式无效", "invalid_h100_configuration")
        if service_hours < 1 or service_hours > 8760:
            raise ApiError(422, "H100 服务时长应为 1 至 8760 小时", "invalid_h100_service_hours")
        if cpu_cores not in H100_CPU_OPTIONS or memory_gb not in H100_MEMORY_OPTIONS:
            raise ApiError(422, "H100 CPU 或内存配置无效", "invalid_h100_configuration")
        storage = clean_text(data.get("storage") or "nvme_1tb", "存储配置", 3, 24)
        environment = clean_text(data.get("environment") or "pytorch", "运行环境", 3, 32)
        if storage not in H100_STORAGE_OPTIONS or environment not in H100_ENVIRONMENT_OPTIONS:
            raise ApiError(422, "H100 存储或运行环境无效", "invalid_h100_configuration")
        start_at = normalize_iso_time(data.get("start_at"), "计划开始时间")
        requested_gpu_hours = round(service_hours * H100_SERVICE_MODES[service_mode]["billing_factor"], 6)
        idem = require_idempotency_key(self.headers)
        request_id = uid("prq")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM purchase_requests WHERE buyer_user_id=? AND idempotency_key=?",
                    (session["user_id"], idem),
                ).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "request": dict(existing), "idempotent_replay": True})
                connection.execute(
                    """INSERT INTO purchase_requests(
                         id,buyer_user_id,product_code,region,service_mode,service_hours,requested_gpu_hours,
                         cpu_cores,memory_gb,storage,environment,start_at,status,idempotency_key,created_at,updated_at
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'submitted',?,?,?)""",
                    (request_id, session["user_id"], product_code, region, service_mode, service_hours,
                     requested_gpu_hours, cpu_cores, memory_gb, storage, environment, start_at, idem, created, created),
                )
                audit(connection, session["user_id"], "purchase_request", request_id, "purchase_request.submitted", {
                    "product_code": product_code, "region": region, "service_mode": service_mode,
                    "service_hours": service_hours, "requested_gpu_hours": requested_gpu_hours,
                }, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            purchase_request = connection.execute("SELECT * FROM purchase_requests WHERE id=?", (request_id,)).fetchone()
        self.json_response(201, {"ok": True, "request": dict(purchase_request)})

    def get_supplier_workbench(self) -> None:
        session = self.session()
        require_role(session, "supplier", "supplier_pending", "admin")
        supplier_id = session["user_id"]
        with db_connect() as connection:
            applications = connection.execute(
                "SELECT id,enterprise_name,credit_code,agent_name,status,review_reason,reviewed_at,next_review_at,created_at,updated_at FROM supplier_applications WHERE user_id=? ORDER BY created_at DESC",
                (supplier_id,),
            ).fetchall()
            intakes = connection.execute(
                "SELECT id,kind,product_code,region,quantity,unit,status,evidence_summary,verification_summary,verified_at,created_at,updated_at FROM resource_intakes WHERE supplier_user_id=? ORDER BY created_at DESC",
                (supplier_id,),
            ).fetchall()
            listings = connection.execute(
                """SELECT id,intake_id,kind,product_code,gpu,provider,region,unit,unit_price_cents,
                          verified_quantity,quote_reserved,order_locked,delivering,consumed,frozen,status,
                          trade_mode,sla,minimum_quantity,valid_from,valid_until,created_at,updated_at
                   FROM listings WHERE supplier_user_id=? ORDER BY created_at DESC""",
                (supplier_id,),
            ).fetchall()
            orders = connection.execute(
                """SELECT o.* FROM orders o JOIN listings l ON l.id=o.listing_id
                   WHERE l.supplier_user_id=? ORDER BY o.created_at DESC LIMIT 100""",
                (supplier_id,),
            ).fetchall()
            settlements = connection.execute(
                "SELECT * FROM settlements WHERE supplier_user_id=? ORDER BY created_at DESC LIMIT 100",
                (supplier_id,),
            ).fetchall()
        listing_rows = []
        for row in listings:
            item = dict(row)
            item["unit_price_cny"] = item.pop("unit_price_cents") / 100
            item["available_quantity"] = max(0, item["verified_quantity"] - item["quote_reserved"] - item["order_locked"] - item["delivering"] - item["consumed"] - item["frozen"])
            listing_rows.append(item)
        self.json_response(200, {
            "ok": True,
            "supplier": {"id": supplier_id, "role": session["role"], "enterprise_status": session["enterprise_status"]},
            "applications": [dict(row) for row in applications],
            "intakes": [dict(row) for row in intakes],
            "listings": listing_rows,
            "orders": [order_dict(row) for row in orders],
            "settlements": [dict(row) for row in settlements],
        })

    def get_supplier_rebate_overview(self) -> None:
        session = self.session()
        rebates = []
        eligible_orders = []
        if session["role"] == "supplier" and session["enterprise_status"] == "certified":
            with db_connect() as connection:
                rebates = connection.execute(
                    """SELECT r.*,o.order_no,o.product_code,o.gpu,o.region
                       FROM supplier_card_hour_rebates r JOIN orders o ON o.id=r.order_id
                       WHERE r.supplier_user_id=? ORDER BY r.created_at DESC LIMIT 300""",
                    (session["user_id"],),
                ).fetchall()
                order_rows = connection.execute(
                    """SELECT o.* FROM orders o JOIN listings l ON l.id=o.listing_id
                       WHERE l.supplier_user_id=? AND o.status='accepted' AND o.kind='gpu'
                       AND o.unit='GPU 时' AND o.settlement_mode='cash'
                       AND NOT EXISTS(
                         SELECT 1 FROM supplier_card_hour_rebates r WHERE r.order_id=o.id
                       )
                       AND NOT EXISTS(
                         SELECT 1 FROM disputes d WHERE d.order_id=o.id
                         AND d.status IN ('open','reviewing')
                       )
                       AND NOT EXISTS(
                         SELECT 1 FROM refunds f WHERE f.order_id=o.id
                         AND f.status IN ('pending_review','approved','processing','success')
                       )
                       ORDER BY o.accepted_at DESC LIMIT 200""",
                    (session["user_id"],),
                ).fetchall()
                for row in order_rows:
                    amount_cents = int(row["amount_cents"])
                    eligible_orders.append({
                        "id": row["id"], "order_no": row["order_no"],
                        "product_code": row["product_code"], "gpu": row["gpu"],
                        "region": row["region"], "amount_cents": amount_cents,
                        "amount_cny": amount_cents / 100,
                        "card_hours": float(row["quantity"]), "unit": row["unit"],
                        "accepted_at": row["accepted_at"],
                        "submission_band": (
                            "over_50000" if amount_cents > SUPPLIER_REBATE_REVIEW_CENTS
                            else "up_to_50000"
                        ),
                    })
        summary = {
            "source_card_hours": sum(row["source_card_hours_micros"] for row in rebates) / CARD_HOUR_MICROS,
            "issued_card_hours": sum(
                row["rebate_card_hours_micros"] for row in rebates if row["status"] == "issued"
            ) / CARD_HOUR_MICROS,
            "pending_review_card_hours": sum(
                row["rebate_card_hours_micros"] for row in rebates if row["status"] in ("pending_review", "paused")
            ) / CARD_HOUR_MICROS,
            "order_count": len(rebates),
        }
        self.json_response(200, {
            "ok": True,
            "viewer": {
                "user_id": session["user_id"], "role": session["role"],
                "enterprise_status": session["enterprise_status"],
            },
            "eligible": session["role"] == "supplier" and session["enterprise_status"] == "certified",
            "eligible_orders": eligible_orders,
            "rebates": [supplier_rebate_dict(row) for row in rebates],
            "summary": summary,
            "policy": supplier_rebate_policy(),
        })

    def create_supplier_rebate_submission(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        if session["enterprise_status"] != "certified":
            raise ApiError(403, "仅已认证供应商可以提交返佣申请", "supplier_not_certified")
        self.rate_limit(f"supplier-rebate-submit:{session['user_id']}", 30, 3600)
        data = self.read_json()
        order_id = clean_text(data.get("order_id"), "成交订单", 3, 100)
        submission_band = clean_text(data.get("submission_band"), "金额区间", 5, 30)
        if submission_band not in ("up_to_50000", "over_50000"):
            raise ApiError(422, "请选择正确的成交金额区间", "invalid_rebate_band")
        transaction_summary = clean_text(data.get("transaction_summary"), "交易内容", 10, 1000)
        submitted_at = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = connection.execute(
                    """SELECT o.*,l.supplier_user_id FROM orders o
                       JOIN listings l ON l.id=o.listing_id WHERE o.id=?""",
                    (order_id,),
                ).fetchone()
                if not order or order["supplier_user_id"] != session["user_id"]:
                    raise ApiError(404, "未找到可申报的供应商成交订单", "rebate_order_not_found")
                existing = connection.execute(
                    "SELECT * FROM supplier_card_hour_rebates WHERE order_id=?", (order_id,)
                ).fetchone()
                if existing:
                    if existing["submission_band"] and existing["submission_band"] != submission_band:
                        raise ApiError(409, "该订单已经按另一金额区间提交", "rebate_submission_conflict")
                    connection.execute("COMMIT")
                    return self.json_response(200, {
                        "ok": True, "rebate": supplier_rebate_dict(existing),
                        "idempotent_replay": True,
                    })
                if (
                    order["status"] != "accepted" or order["kind"] != "gpu"
                    or order["unit"] != "GPU 时" or order["settlement_mode"] != "cash"
                ):
                    raise ApiError(409, "该订单尚不符合返佣申报条件", "rebate_order_not_eligible")
                blocking_case = connection.execute(
                    """SELECT 1 FROM disputes WHERE order_id=? AND status IN ('open','reviewing')
                       UNION ALL SELECT 1 FROM refunds WHERE order_id=?
                       AND status IN ('pending_review','approved','processing','success') LIMIT 1""",
                    (order_id, order_id),
                ).fetchone()
                if blocking_case:
                    raise ApiError(409, "订单存在争议或退款，暂不能提交返佣", "rebate_submission_blocked")
                rebate = create_supplier_card_hour_rebate(
                    connection, order, session["user_id"], session["user_id"],
                    submission_band, transaction_summary, submitted_at,
                )
                if not rebate:
                    raise ApiError(409, "该订单无法换算返佣卡时", "rebate_conversion_unavailable")
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "rebate": supplier_rebate_dict(rebate)})

    def update_supplier_referral_program(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        if session["enterprise_status"] != "certified":
            raise ApiError(403, "仅已认证供应商可以开启返佣计划", "supplier_not_certified")
        data = self.read_json()
        try:
            rate_percent = float(data.get("commission_rate_percent"))
        except (TypeError, ValueError):
            raise ApiError(422, "返佣比例无效", "invalid_commission_rate")
        rate_bps = int(round(rate_percent * 100))
        if rate_bps < 100 or rate_bps > 2000:
            raise ApiError(422, "返佣比例必须在 1% 至 20% 之间", "invalid_commission_rate")
        status = clean_text(data.get("status") or "active", "计划状态", 4, 20)
        if status not in ("active", "paused"):
            raise ApiError(422, "返佣计划状态无效")
        updated = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                ensure_supplier_referral_program(connection, session["user_id"])
                connection.execute(
                    """UPDATE supplier_referral_programs SET commission_rate_bps=?,status=?,updated_at=?
                       WHERE supplier_user_id=?""",
                    (rate_bps, status, updated, session["user_id"]),
                )
                audit(connection, session["user_id"], "supplier_referral_program", session["user_id"],
                      "supplier_referral.program_updated", {"commission_rate_bps": rate_bps, "status": status})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            program = connection.execute(
                "SELECT * FROM supplier_referral_programs WHERE supplier_user_id=?", (session["user_id"],)
            ).fetchone()
        self.json_response(200, {"ok": True, "program": dict(program)})

    def create_supplier_referral_invitation(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        if session["enterprise_status"] != "certified":
            raise ApiError(403, "仅已认证供应商可以邀请推广伙伴", "supplier_not_certified")
        self.rate_limit(f"supplier-referral-invite:{session['user_id']}", 20, 3600)
        data = self.read_json()
        partner_account = clean_text(data.get("partner_account"), "推广伙伴账户", 3, 160).lower()
        invited_at = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                program = ensure_supplier_referral_program(connection, session["user_id"])
                if program["status"] != "active":
                    raise ApiError(409, "返佣计划已暂停，请先恢复计划")
                partner = connection.execute(
                    "SELECT * FROM users WHERE lower(account)=? AND lifecycle_status='active'",
                    (partner_account,),
                ).fetchone()
                if not partner:
                    raise ApiError(404, "推广伙伴账户不存在", "partner_not_found")
                if partner["id"] == session["user_id"]:
                    raise ApiError(422, "不能邀请自己的账户")
                existing = connection.execute(
                    "SELECT * FROM supplier_referral_partners WHERE supplier_user_id=? AND partner_user_id=?",
                    (session["user_id"], partner["id"]),
                ).fetchone()
                if existing and existing["status"] in ("pending_confirmation", "active"):
                    raise ApiError(409, "该账户已有待确认邀请或已是推广伙伴", "partner_relation_exists")
                code = next_supplier_referral_code(connection)
                if existing:
                    relation_id = existing["id"]
                    connection.execute(
                        """UPDATE supplier_referral_partners SET commission_rate_bps=?,referral_code=?,
                           status='pending_confirmation',invited_at=?,accepted_at=NULL,rejected_at=NULL,updated_at=? WHERE id=?""",
                        (program["commission_rate_bps"], code, invited_at, invited_at, relation_id),
                    )
                else:
                    relation_id = uid("suppartner")
                    connection.execute(
                        """INSERT INTO supplier_referral_partners(
                           id,supplier_user_id,partner_user_id,commission_rate_bps,referral_code,status,invited_at,updated_at
                           ) VALUES(?,?,?,?,?,'pending_confirmation',?,?)""",
                        (relation_id, session["user_id"], partner["id"], program["commission_rate_bps"], code, invited_at, invited_at),
                    )
                audit(connection, session["user_id"], "supplier_referral_partner", relation_id,
                      "supplier_referral.invited", {"partner_user_id": partner["id"], "commission_rate_bps": program["commission_rate_bps"]})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            invitation = connection.execute(
                "SELECT * FROM supplier_referral_partners WHERE id=?", (relation_id,)
            ).fetchone()
        self.json_response(201, {"ok": True, "invitation": dict(invitation)})

    def resolve_supplier_referral_invitation(self, relation_id: str, action: str) -> None:
        session = self.session(csrf=True)
        resolved_at = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                relation = connection.execute(
                    "SELECT * FROM supplier_referral_partners WHERE id=?", (relation_id,)
                ).fetchone()
                if not relation or relation["partner_user_id"] != session["user_id"]:
                    raise ApiError(404, "返佣邀请不存在", "invitation_not_found")
                if relation["status"] != "pending_confirmation":
                    raise ApiError(409, "返佣邀请已经处理", "invitation_already_resolved")
                status = "active" if action == "accept" else "rejected"
                connection.execute(
                    """UPDATE supplier_referral_partners SET status=?,accepted_at=?,rejected_at=?,updated_at=? WHERE id=?""",
                    (status, resolved_at if action == "accept" else None,
                     resolved_at if action == "reject" else None, resolved_at, relation_id),
                )
                audit(connection, session["user_id"], "supplier_referral_partner", relation_id,
                      f"supplier_referral.invitation_{action}ed", {"supplier_user_id": relation["supplier_user_id"]})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            updated = connection.execute(
                "SELECT * FROM supplier_referral_partners WHERE id=?", (relation_id,)
            ).fetchone()
        self.json_response(200, {"ok": True, "partnership": dict(updated)})

    def claim_supplier_referral(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        referral_code = clean_text(data.get("referral_code"), "供应商推荐码", 8, 80).upper()
        attributed_at = now_iso()
        expires_at = (
            datetime.now(timezone.utc) + timedelta(days=SUPPLIER_REFERRAL_WINDOW_DAYS)
        ).replace(microsecond=0).isoformat()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                relation = connection.execute(
                    """SELECT p.*,u.name AS supplier_name,u.enterprise_status
                       FROM supplier_referral_partners p JOIN users u ON u.id=p.supplier_user_id
                       JOIN supplier_referral_programs g ON g.supplier_user_id=p.supplier_user_id
                       WHERE p.referral_code=? AND p.status='active' AND g.status='active'""",
                    (referral_code,),
                ).fetchone()
                if not relation or relation["enterprise_status"] != "certified":
                    raise ApiError(404, "供应商推荐码无效或已暂停", "referral_code_invalid")
                if session["user_id"] in (relation["supplier_user_id"], relation["partner_user_id"]):
                    raise ApiError(422, "不能对自己的推荐关系进行归因", "self_referral_blocked")
                existing = connection.execute(
                    """SELECT * FROM supplier_referral_attributions
                       WHERE buyer_user_id=? AND supplier_user_id=?""",
                    (session["user_id"], relation["supplier_user_id"]),
                ).fetchone()
                if existing and existing["locked_at"]:
                    if existing["partner_relation_id"] != relation["id"]:
                        raise ApiError(409, "该供应商的推荐关系已随首笔合格订单锁定", "attribution_locked")
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "attribution": dict(existing), "idempotent_replay": True})
                if existing:
                    attribution_id = existing["id"]
                    connection.execute(
                        """UPDATE supplier_referral_attributions SET partner_relation_id=?,status='active',
                           attributed_at=?,expires_at=?,updated_at=? WHERE id=?""",
                        (relation["id"], attributed_at, expires_at, attributed_at, attribution_id),
                    )
                else:
                    attribution_id = uid("supattrib")
                    connection.execute(
                        """INSERT INTO supplier_referral_attributions(
                           id,buyer_user_id,supplier_user_id,partner_relation_id,status,attributed_at,expires_at,updated_at
                           ) VALUES(?,?,?,?,'active',?,?,?)""",
                        (attribution_id, session["user_id"], relation["supplier_user_id"], relation["id"], attributed_at, expires_at, attributed_at),
                    )
                audit(connection, session["user_id"], "supplier_referral_attribution", attribution_id,
                      "supplier_referral.attributed", {"supplier_user_id": relation["supplier_user_id"], "partner_relation_id": relation["id"], "expires_at": expires_at})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            attribution = connection.execute(
                "SELECT * FROM supplier_referral_attributions WHERE id=?", (attribution_id,)
            ).fetchone()
        self.json_response(200, {"ok": True, "attribution": dict(attribution), "supplier_name": relation["supplier_name"]})

    def get_admin_overview(self) -> None:
        session = self.session()
        require_role(session, "admin")
        with db_connect() as connection:
            applications = connection.execute(
                """SELECT a.*,u.name,u.account FROM supplier_applications a JOIN users u ON u.id=a.user_id
                   WHERE a.status IN ('reviewing','restricted') ORDER BY a.created_at"""
            ).fetchall()
            intakes = connection.execute(
                """SELECT i.*,u.name AS supplier_name FROM resource_intakes i JOIN users u ON u.id=i.supplier_user_id
                   WHERE i.status IN ('pending_verification','frozen') ORDER BY i.created_at"""
            ).fetchall()
            listings = connection.execute(
                """SELECT l.*,u.name AS supplier_name FROM listings l JOIN users u ON u.id=l.supplier_user_id
                   WHERE l.status IN ('pending_review','suspended') ORDER BY l.created_at"""
            ).fetchall()
            disputes = connection.execute(
                "SELECT * FROM disputes WHERE status IN ('open','reviewing') ORDER BY created_at"
            ).fetchall()
            refunds = connection.execute(
                "SELECT * FROM refunds WHERE status IN ('pending_review','approved','processing') ORDER BY created_at"
            ).fetchall()
            settlements = connection.execute(
                "SELECT * FROM settlements WHERE status IN ('holding','payable') ORDER BY created_at"
            ).fetchall()
            supplier_rebates = connection.execute(
                """SELECT r.*,s.name AS supplier_name,s.account AS supplier_account,
                          o.order_no,o.product_code,o.gpu,o.region
                   FROM supplier_card_hour_rebates r
                   JOIN users s ON s.id=r.supplier_user_id JOIN orders o ON o.id=r.order_id
                   WHERE r.status IN ('pending_review','paused','clawback_required')
                   ORDER BY r.created_at"""
            ).fetchall()
            invoices = connection.execute(
                "SELECT * FROM invoice_requests WHERE status='requested' ORDER BY created_at"
            ).fetchall()
            metering_orders = connection.execute(
                """SELECT o.*,u.name AS supplier_name FROM orders o
                   JOIN listings l ON l.id=o.listing_id JOIN users u ON u.id=l.supplier_user_id
                   WHERE o.status='delivered'
                   AND NOT EXISTS(SELECT 1 FROM metering_records m WHERE m.order_id=o.id AND m.source='kai_gateway')
                   ORDER BY o.delivered_at"""
            ).fetchall()
            swaps = connection.execute(
                "SELECT * FROM swap_requests WHERE status IN ('matching','quoted','confirmed') ORDER BY created_at"
            ).fetchall()
            account_deletions = connection.execute(
                "SELECT d.*,u.name,u.account FROM account_deletion_requests d JOIN users u ON u.id=d.user_id WHERE d.status IN ('pending_obligations','scheduled') ORDER BY d.requested_at"
            ).fetchall()
            counts = {
                "pending_supplier_reviews": len(applications), "pending_intakes": len(intakes),
                "pending_listings": len(listings), "open_disputes": len(disputes),
                "pending_refunds": len(refunds), "pending_settlements": len(settlements),
                "pending_supplier_rebates": len(supplier_rebates),
                "pending_invoices": len(invoices),
                "pending_gateway_metering": len(metering_orders),
                "pending_swaps": len(swaps), "pending_account_deletions": len(account_deletions),
                "pending_outbox": connection.execute("SELECT COUNT(*) FROM outbox WHERE status='pending'").fetchone()[0],
            }
        self.json_response(200, {
            "ok": True, "counts": counts, "readiness": integration_readiness(),
            "applications": [dict(row) for row in applications], "intakes": [dict(row) for row in intakes],
            "listings": [dict(row) for row in listings], "disputes": [dict(row) for row in disputes],
            "refunds": [dict(row) for row in refunds], "settlements": [dict(row) for row in settlements],
            "supplier_rebates": [supplier_rebate_dict(row) for row in supplier_rebates],
            "invoices": [dict(row) for row in invoices], "metering_orders": [order_dict(row) | {"supplier_name": row["supplier_name"]} for row in metering_orders],
            "swaps": [dict(row) for row in swaps], "account_deletions": [dict(row) for row in account_deletions],
        })

    def admin_review_supplier(self, application_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "审核决定", 3, 20)
        if decision not in ("certified", "restricted", "needs_changes"):
            raise ApiError(422, "供应商审核决定无效")
        reason = clean_text(data.get("reason") or "审核资料符合平台规则", "审核理由", 4, 500)
        checks = {
            "bank_account_verified": bool(data.get("bank_account_verified")),
            "invoice_verified": bool(data.get("invoice_verified")),
            "resource_proof_verified": bool(data.get("resource_proof_verified")),
            "license_verified": bool(data.get("license_verified")),
        }
        if decision == "certified" and not all(checks.values()):
            raise ApiError(422, "认证通过前必须完成对公账户、开票、资源证明和许可核验", "supplier_checks_incomplete")
        reviewed = now_iso()
        next_review = (datetime.now(timezone.utc) + timedelta(days=180)).replace(microsecond=0).isoformat() if decision == "certified" else None
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                application = connection.execute("SELECT * FROM supplier_applications WHERE id=?", (application_id,)).fetchone()
                if not application:
                    raise ApiError(404, "供应商申请不存在")
                connection.execute(
                    """UPDATE supplier_applications SET status=?,reviewer_user_id=?,review_reason=?,reviewed_at=?,
                       bank_account_verified=?,invoice_verified=?,resource_proof_verified=?,license_verified=?,next_review_at=?,review_due_at=?,updated_at=? WHERE id=?""",
                    (decision, session["user_id"], reason, reviewed, int(checks["bank_account_verified"]),
                     int(checks["invoice_verified"]), int(checks["resource_proof_verified"]), int(checks["license_verified"]),
                     next_review, next_review, reviewed, application_id),
                )
                user_role = "supplier" if decision in ("certified", "restricted") else "supplier_pending"
                enterprise_status = decision if decision != "needs_changes" else "unverified"
                connection.execute(
                    "UPDATE users SET role=?,enterprise_status=?,updated_at=? WHERE id=?",
                    (user_role, enterprise_status, reviewed, application["user_id"]),
                )
                audit(connection, session["user_id"], "supplier_application", application_id, f"supplier.{decision}", {
                    "reason": reason, "checks": checks, "next_review_at": next_review,
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "application_id": application_id, "status": decision, "next_review_at": next_review})

    def admin_review_intake(self, intake_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "验真决定", 3, 20)
        if decision not in ("verified", "rejected", "frozen"):
            raise ApiError(422, "资源验真决定无效")
        summary = clean_text(data.get("verification_summary") or data.get("reason"), "验真结论", 8, 1000)
        updated = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                intake = connection.execute("SELECT * FROM resource_intakes WHERE id=?", (intake_id,)).fetchone()
                if not intake:
                    raise ApiError(404, "资源存入单不存在")
                supplier = connection.execute("SELECT * FROM users WHERE id=?", (intake["supplier_user_id"],)).fetchone()
                if decision == "verified" and (not supplier or supplier["enterprise_status"] != "certified"):
                    raise ApiError(409, "供应商尚未认证，不能确认资源验真", "supplier_not_certified")
                connection.execute(
                    "UPDATE resource_intakes SET status=?,verification_summary=?,reviewer_user_id=?,verified_at=?,frozen_reason=?,updated_at=? WHERE id=?",
                    (decision, summary, session["user_id"], updated if decision == "verified" else None,
                     summary if decision == "frozen" else None, updated, intake_id),
                )
                audit(connection, session["user_id"], "resource_intake", intake_id, f"resource.{decision}", {
                    "verification_summary": summary,
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "intake_id": intake_id, "status": decision})

    def create_supplier_listing(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        if session["enterprise_status"] != "certified":
            raise ApiError(403, "仅已认证企业供应商可以提交上架", "supplier_not_certified")
        data = self.read_json()
        intake_id = clean_text(data.get("intake_id"), "验真容量批次", 4, 80)
        kind = clean_text(data.get("kind") or "gpu", "资源类型", 3, 20)
        if kind not in RESOURCE_UNITS:
            raise ApiError(422, "资源类型无效", "invalid_resource_kind")
        product_code = clean_text(data.get("product_code"), "标准产品规格", 2, 120)
        asset_code = clean_text(data.get("asset_code") or data.get("gpu") or product_code, "产品代码", 2, 120)
        provider = clean_text(data.get("provider") or session["name"], "供应商公开名称", 2, 120)
        region = clean_text(data.get("region"), "服务地区", 2, 80)
        sla = clean_text(data.get("sla") or "99.5% 标准保障", "SLA", 3, 80)
        trade_mode = clean_text(data.get("trade_mode") or "fixed", "交易方式", 3, 20)
        if trade_mode not in ("fixed", "rfq", "reserved"):
            raise ApiError(422, "交易方式无效", "invalid_trade_mode")
        try:
            quantity = round(float(data.get("quantity")), 6)
            minimum_quantity = round(float(data.get("minimum_quantity") or 1), 6)
            target_price_cents = int(round(float(data.get("target_price_cny")) * 100))
            floor_value = data.get("floor_price_cny")
            floor_price_cents = int(round(float(floor_value) * 100)) if floor_value not in (None, "") else None
        except (TypeError, ValueError):
            raise ApiError(422, "容量或报价格式无效")
        if quantity <= 0 or minimum_quantity <= 0 or minimum_quantity > quantity or target_price_cents <= 0:
            raise ApiError(422, "容量、最低购买量或报价不符合规则")
        if floor_price_cents is not None and (floor_price_cents <= 0 or floor_price_cents > target_price_cents):
            raise ApiError(422, "供应商底价必须大于零且不能高于目标价")
        valid_from = normalize_iso_time(data.get("valid_from"), "可售开始时间")
        valid_until = normalize_iso_time(data.get("valid_until"), "可售结束时间")
        if valid_until <= valid_from or valid_until <= now_iso():
            raise ApiError(422, "可售结束时间必须晚于开始时间且尚未过期")
        listing_id = uid("lst")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                intake = connection.execute(
                    "SELECT * FROM resource_intakes WHERE id=? AND supplier_user_id=? AND status='verified'",
                    (intake_id, session["user_id"]),
                ).fetchone()
                if not intake or intake["kind"] != kind:
                    raise ApiError(409, "所选容量批次未验真或不属于当前供应商", "verified_intake_required")
                unit = str(intake["unit"]).strip()
                if unit not in RESOURCE_UNITS[kind]:
                    raise ApiError(409, f"{RESOURCE_KIND_LABELS[kind]}批次单位不符合标准产品口径", "invalid_intake_unit")
                allocated = connection.execute(
                    "SELECT COALESCE(SUM(verified_quantity),0) FROM listings WHERE intake_id=? AND status IN ('pending_review','active','suspended')",
                    (intake_id,),
                ).fetchone()[0]
                if float(intake["quantity"]) - float(allocated) + 1e-9 < quantity:
                    raise ApiError(409, "验真容量批次剩余数量不足", "intake_capacity_insufficient")
                connection.execute(
                    """INSERT INTO listings(id,supplier_user_id,kind,product_code,gpu,provider,region,unit,
                       unit_price_cents,verified_quantity,status,valid_from,valid_until,created_at,updated_at,
                       intake_id,floor_price_cents,trade_mode,sla,minimum_quantity,price_source_json)
                       VALUES(?,?,?,?,?,?,?,?,?,?,'pending_review',?,?,?,?,?,?,?,?,?,?)""",
                    (listing_id, session["user_id"], kind, product_code, asset_code, provider, region, unit,
                     target_price_cents, quantity, valid_from, valid_until, created, created, intake_id,
                     floor_price_cents, trade_mode, sla, minimum_quantity,
                     json.dumps(data.get("price_source") if isinstance(data.get("price_source"), dict) else {}, ensure_ascii=False)),
                )
                audit(connection, session["user_id"], "listing", listing_id, "listing.submitted", {
                    "intake_id": intake_id, "kind": kind, "quantity": quantity, "unit": unit, "target_price_cents": target_price_cents,
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "listing": {"id": listing_id, "status": "pending_review"}})

    def admin_review_listing(self, listing_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "挂牌审核决定", 3, 20)
        if decision not in ("approve", "reject", "suspend"):
            raise ApiError(422, "挂牌审核决定无效")
        reason = clean_text(data.get("reason") or "符合标准产品和价格披露规则", "审核理由", 4, 500)
        status = {"approve": "active", "reject": "rejected", "suspend": "suspended"}[decision]
        updated = now_iso()
        with db_connect() as connection:
            listing = connection.execute("SELECT * FROM listings WHERE id=?", (listing_id,)).fetchone()
            if not listing:
                raise ApiError(404, "挂牌不存在")
            if decision == "approve" and (listing["valid_until"] <= updated or not listing["intake_id"]):
                raise ApiError(409, "挂牌已过期或未绑定验真容量批次", "listing_not_approvable")
            connection.execute(
                "UPDATE listings SET status=?,reviewer_user_id=?,reviewed_at=?,updated_at=?,version=version+1 WHERE id=?",
                (status, session["user_id"], updated, updated, listing_id),
            )
            audit(connection, session["user_id"], "listing", listing_id, f"listing.{status}", {"reason": reason})
        self.json_response(200, {"ok": True, "listing_id": listing_id, "status": status})

    def create_supplier_application(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        enterprise = clean_text(data.get("enterprise_name"), "企业名称", 2, 120)
        code = clean_text(data.get("credit_code"), "统一社会信用代码", 15, 24).upper()
        agent = clean_text(data.get("agent_name"), "授权经办人", 2, 60)
        created = now_iso()
        application_id = uid("sup")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute("SELECT * FROM supplier_applications WHERE user_id=? ORDER BY created_at DESC LIMIT 1", (session["user_id"],)).fetchone()
                if existing and existing["status"] in ("reviewing", "certified"):
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "application": dict(existing)})
                connection.execute(
                    "INSERT INTO supplier_applications(id,user_id,enterprise_name,credit_code,agent_name,status,created_at,updated_at) VALUES(?,?,?,?,?,'reviewing',?,?)",
                    (application_id, session["user_id"], enterprise, code, agent, created, created),
                )
                connection.execute("UPDATE users SET role='supplier_pending',enterprise_status='reviewing',updated_at=? WHERE id=?", (created, session["user_id"]))
                audit(connection, session["user_id"], "supplier_application", application_id, "supplier.submitted", {"enterprise_name": enterprise})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "application": {"id": application_id, "status": "reviewing", "enterprise_name": enterprise}})

    def create_resource_intake(self) -> None:
        session = self.session(csrf=True)
        if session["role"] != "supplier" or session["enterprise_status"] != "certified":
            raise ApiError(403, "仅已认证企业供应商可以提交资源存入", "supplier_not_certified")
        data = self.read_json()
        kind = clean_text(data.get("kind"), "资源类型", 2, 20)
        if kind not in ("gpu", "tokencap", "tokenusage", "rack"):
            raise ApiError(422, "资源类型无效")
        quantity = float(data.get("quantity") or 0)
        if quantity <= 0:
            raise ApiError(422, "资源数量必须大于 0")
        intake_id = uid("intake")
        created = now_iso()
        product = clean_text(data.get("product_code"), "产品规格", 1, 120)
        region = clean_text(data.get("region"), "资源地区", 1, 80)
        unit = clean_text(data.get("unit"), "计量单位", 1, 40)
        if unit not in RESOURCE_UNITS[kind]:
            expected = " / ".join(sorted(RESOURCE_UNITS[kind]))
            raise ApiError(422, f"{RESOURCE_KIND_LABELS[kind]}的标准单位应为：{expected}", "invalid_resource_unit")
        evidence = clean_text(data.get("evidence_summary"), "证据摘要", 4, 500)
        with db_connect() as connection:
            connection.execute(
                "INSERT INTO resource_intakes(id,supplier_user_id,kind,product_code,region,quantity,unit,status,evidence_summary,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending_verification',?,?,?)",
                (intake_id, session["user_id"], kind, product, region, quantity, unit, evidence, created, created),
            )
            audit(connection, session["user_id"], "resource_intake", intake_id, "resource.intake_submitted", {"kind": kind, "quantity": quantity, "unit": unit})
        self.json_response(201, {"ok": True, "intake": {"id": intake_id, "status": "pending_verification"}})

    def create_order(self) -> None:
        session = self.session(csrf=True)
        self.rate_limit(f"order:{session['user_id']}", 30, 60)
        data = self.read_json()
        listing_id = clean_text(data.get("listing_id"), "挂牌", 3, 80)
        try:
            quantity = round(float(data.get("quantity")), 6)
        except (TypeError, ValueError):
            raise ApiError(422, "购买数量无效")
        if quantity <= 0 or quantity > 1_000_000:
            raise ApiError(422, "购买数量超出允许范围")
        idem = require_idempotency_key(self.headers)
        created = now_iso()
        reservation_expires_at = future_minutes_iso(ORDER_RESERVATION_MINUTES)
        order_id = uid("ord")
        order_no = f"KAI{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}{secrets.randbelow(9000)+1000}"
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute("SELECT * FROM orders WHERE buyer_user_id=? AND idempotency_key=?", (session["user_id"], idem)).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(existing), "idempotent_replay": True})
                listing = connection.execute("SELECT * FROM listings WHERE id=? AND status='active'", (listing_id,)).fetchone()
                if not listing or listing["valid_from"] > created or listing["valid_until"] <= created:
                    raise ApiError(409, "挂牌不可用或已过期", "listing_unavailable")
                snapshot = normalized_order_snapshot(data.get("quote_snapshot"), listing, quantity)
                available = listing["verified_quantity"] - listing["quote_reserved"] - listing["order_locked"] - listing["delivering"] - listing["consumed"] - listing["frozen"]
                if available + 1e-9 < quantity:
                    raise ApiError(409, f"可售容量不足，当前可售 {max(0, available):g} {listing['unit']}", "insufficient_capacity")
                amount = int(round(listing["unit_price_cents"] * quantity))
                connection.execute(
                    "UPDATE listings SET quote_reserved=quote_reserved+?,version=version+1,updated_at=? WHERE id=? AND version=?",
                    (quantity, created, listing_id, listing["version"]),
                )
                if connection.execute("SELECT changes()").fetchone()[0] != 1:
                    raise ApiError(409, "容量版本冲突，请重试", "capacity_version_conflict")
                connection.execute(
                    """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,unit_price_cents,amount_cents,currency,status,idempotency_key,quote_snapshot_json,reservation_expires_at,created_at,updated_at,kind,product_code)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,'CNY','pending_payment',?,?,?,?,?,?,?)""",
                    (order_id, order_no, session["user_id"], listing_id, listing["gpu"], listing["region"], listing["provider"], quantity, listing["unit"], listing["unit_price_cents"], amount, idem, json.dumps(snapshot, ensure_ascii=False), reservation_expires_at, created, created, listing["kind"], listing["product_code"]),
                )
                audit(connection, session["user_id"], "order", order_id, "capacity.reserved", {"listing_id": listing_id, "quantity": quantity, "unit": listing["unit"], "listing_version": listing["version"] + 1, "expires_at": reservation_expires_at}, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(201, {"ok": True, "order": order_dict(order)})

    def create_payment(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        order_id = clean_text(data.get("order_id"), "订单", 4, 80)
        provider = clean_text(data.get("provider"), "支付方式", 2, 20)
        if provider not in ("alipay", "wechat"):
            raise ApiError(422, "仅支持支付宝或微信支付")
        default_channel = "web" if provider == "alipay" else "native"
        channel = clean_text(data.get("channel") or default_channel, "支付场景", 2, 20)
        allowed_channels = {"alipay": {"web", "wap"}, "wechat": {"native", "h5"}}
        if channel not in allowed_channels[provider]:
            raise ApiError(422, "所选支付场景与支付方式不匹配", "invalid_payment_channel")
        if not ALLOW_DEMO and not payment_readiness(provider)["configured"]:
            raise ApiError(503, "所选支付通道尚未配置完成", "payment_provider_not_configured")
        with db_connect() as connection:
            order = fetch_order(connection, order_id)
            if order["buyer_user_id"] != session["user_id"]:
                raise ApiError(403, "无权操作该订单")
            if order["status"] != "pending_payment":
                raise ApiError(409, "订单当前状态不能创建支付单", "invalid_order_state")
            existing = connection.execute("SELECT * FROM payments WHERE order_id=? AND provider=? AND status='pending' ORDER BY created_at DESC LIMIT 1", (order_id, provider)).fetchone()
            if existing:
                payment_id = existing["id"]
            else:
                payment_id = uid("pay")
                connection.execute(
                    "INSERT INTO payments(id,order_id,provider,amount_cents,currency,status,created_at,updated_at) VALUES(?,?,?,?, 'CNY','pending',?,?)",
                    (payment_id, order_id, provider, order["amount_cents"], now_iso(), now_iso()),
                )
                audit(connection, session["user_id"], "payment", payment_id, "payment.created", {"order_id": order_id, "provider": provider, "amount_cents": order["amount_cents"]})
        checkout_url = None if ALLOW_DEMO else request_provider_checkout(provider, payment_id, order, channel)
        self.json_response(201, {
            "ok": True,
            "payment": {
                "id": payment_id, "provider": provider, "channel": channel, "status": "pending",
                "amount_cny": order["amount_cents"] / 100, "checkout_url": checkout_url,
            },
            "mock_allowed": ALLOW_DEMO,
        })

    def mock_complete_payment(self) -> None:
        session = self.session(csrf=True)
        if not ALLOW_DEMO:
            raise ApiError(404, "联调支付未启用", "demo_disabled")
        data = self.read_json()
        payment_id = clean_text(data.get("payment_id"), "支付单", 4, 80)
        with db_connect() as connection:
            payment = connection.execute("SELECT * FROM payments WHERE id=?", (payment_id,)).fetchone()
            if not payment:
                raise ApiError(404, "支付单不存在")
            order = fetch_order(connection, payment["order_id"])
            if order["buyer_user_id"] != session["user_id"]:
                raise ApiError(403, "无权操作该支付单")
            payload = {
                "event_id": uid("payevt"), "payment_id": payment["id"], "order_id": order["id"],
                "provider_txn_id": uid(f"{payment['provider']}_txn"), "merchant_id": "KAI-MOCK",
                "amount_cents": order["amount_cents"], "currency": "CNY", "status": "SUCCESS",
                "timestamp": int(time.time()),
            }
            signature = sign_payment(payload, MOCK_SECRET)
            updated = apply_payment_callback(connection, payment["provider"], payload, signature, MOCK_SECRET)
        self.json_response(200, {"ok": True, "order": order_dict(updated), "callback_verified": True})

    def real_payment_callback(self, provider: str) -> None:
        data = self.read_json()
        secret = payment_secret(provider)
        if not secret:
            raise ApiError(503, "支付机构回调密钥尚未配置", "payment_provider_not_configured")
        signature = self.headers.get("X-KAI-Payment-Signature", "")
        with db_connect() as connection:
            order = apply_payment_callback(connection, provider, data, signature, secret)
        self.json_response(200, {"ok": True, "order_id": order["id"], "status": order["status"]})

    def real_refund_callback(self, provider: str) -> None:
        data = self.read_json()
        secret = payment_secret(provider)
        if not secret:
            raise ApiError(503, "支付机构回调密钥尚未配置", "payment_provider_not_configured")
        signature = self.headers.get("X-KAI-Payment-Signature", "")
        if not hmac.compare_digest(sign_refund(data, secret), signature):
            raise ApiError(401, "退款通知签名无效", "invalid_refund_signature")
        try:
            callback_time = int(data["timestamp"])
            amount_cents = int(data["amount_cents"])
        except (KeyError, ValueError, TypeError):
            raise ApiError(422, "退款通知字段无效", "invalid_refund_callback")
        if abs(int(time.time()) - callback_time) > 300:
            raise ApiError(409, "退款通知超出防重放时间窗", "refund_replay_window")
        if data.get("status") != "SUCCESS" or data.get("currency") != "CNY":
            raise ApiError(422, "退款状态或币种不符合入账条件", "refund_not_successful")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                refund = connection.execute("SELECT * FROM refunds WHERE id=?", (data.get("refund_id"),)).fetchone()
                if not refund:
                    raise ApiError(404, "退款单不存在")
                order = fetch_order(connection, refund["order_id"])
                payment = connection.execute("SELECT * FROM payments WHERE id=?", (refund["payment_id"],)).fetchone()
                if payment["provider"] != provider or data.get("order_id") != order["id"]:
                    raise ApiError(409, "退款通知与原订单不匹配", "refund_order_mismatch")
                if amount_cents != refund["amount_cents"]:
                    raise ApiError(409, "退款金额不匹配", "refund_amount_mismatch")
                apply_refund_success(connection, refund, clean_text(data.get("provider_ref"), "支付机构退款流水", 3, 160))
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "refund_id": refund["id"], "status": "success"})

    def supplier_confirm_order(self, order_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                supplier = supplier_for_order(connection, order)
                if supplier["id"] != session["user_id"]:
                    raise ApiError(403, "无权确认该订单")
                if order["status"] == "supplier_confirmed":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(order), "idempotent_replay": True})
                if order["status"] != "paid":
                    raise ApiError(409, "仅已支付订单可以确认交付", "invalid_order_state")
                updated = now_iso()
                connection.execute(
                    "UPDATE orders SET status='supplier_confirmed',supplier_confirmed_at=?,updated_at=? WHERE id=?",
                    (updated, updated, order_id),
                )
                connection.execute(
                    "INSERT OR IGNORE INTO delivery_tasks(id,order_id,supplier_user_id,status,created_at,updated_at) VALUES(?,?,?,'confirmed',?,?)",
                    (uid("delivery"), order_id, session["user_id"], updated, updated),
                )
                audit(connection, session["user_id"], "order", order_id, "delivery.supplier_confirmed", {})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "order": order_dict(order)})

    def supplier_deliver_order(self, order_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier")
        data = self.read_json()
        endpoint_summary = clean_text(data.get("endpoint_summary"), "交付端点摘要", 4, 300)
        evidence_digest = clean_text(data.get("evidence_digest"), "交付证据摘要", 16, 160)
        acceptance_hours = max(1, min(168, int(data.get("acceptance_hours") or 48)))
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                supplier = supplier_for_order(connection, order)
                if supplier["id"] != session["user_id"]:
                    raise ApiError(403, "无权交付该订单")
                if order["status"] == "delivered":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(order), "idempotent_replay": True})
                if order["status"] not in ("paid", "supplier_confirmed"):
                    raise ApiError(409, "订单当前状态不能交付", "invalid_order_state")
                listing = connection.execute("SELECT * FROM listings WHERE id=?", (order["listing_id"],)).fetchone()
                if not listing or listing["order_locked"] + 1e-9 < order["quantity"]:
                    raise ApiError(409, "订单锁定容量异常", "locked_capacity_mismatch")
                updated = now_iso()
                acceptance_due = (datetime.now(timezone.utc) + timedelta(hours=acceptance_hours)).replace(microsecond=0).isoformat()
                delivery_ref = uid("delivery_ref")
                connection.execute(
                    "UPDATE listings SET order_locked=order_locked-?,delivering=delivering+?,version=version+1,updated_at=? WHERE id=?",
                    (order["quantity"], order["quantity"], updated, listing["id"]),
                )
                connection.execute(
                    "UPDATE orders SET status='delivered',delivery_ref=?,delivered_at=?,acceptance_due_at=?,updated_at=? WHERE id=?",
                    (delivery_ref, updated, acceptance_due, updated, order_id),
                )
                connection.execute(
                    """INSERT INTO delivery_tasks(id,order_id,supplier_user_id,status,credential_reference,endpoint_summary,evidence_digest,
                       started_at,delivered_at,acceptance_due_at,created_at,updated_at)
                       VALUES(?,?,?,'delivered',?,?,?,?,?,?,?,?)
                       ON CONFLICT(order_id) DO UPDATE SET status='delivered',credential_reference=excluded.credential_reference,
                       endpoint_summary=excluded.endpoint_summary,evidence_digest=excluded.evidence_digest,delivered_at=excluded.delivered_at,
                       acceptance_due_at=excluded.acceptance_due_at,updated_at=excluded.updated_at""",
                    (uid("delivery"), order_id, session["user_id"], delivery_ref, endpoint_summary, evidence_digest,
                     order["supplier_confirmed_at"] or updated, updated, acceptance_due, updated, updated),
                )
                audit(connection, session["user_id"], "order", order_id, "delivery.credentials_issued", {
                    "delivery_ref": delivery_ref, "credential_mode": "one_time_reference",
                    "endpoint_summary": endpoint_summary, "evidence_digest": evidence_digest,
                    "acceptance_due_at": acceptance_due,
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "order": order_dict(order), "credential_reference": order["delivery_ref"]})

    def create_metering_record(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "supplier", "admin")
        data = self.read_json()
        order_id = clean_text(data.get("order_id"), "订单", 4, 80)
        requested_source = clean_text(data.get("source"), "计量来源", 3, 30)
        source = "kai_gateway" if session["role"] == "admin" else "supplier"
        if requested_source != source:
            raise ApiError(403, "当前账户不能代表该计量来源上报", "metering_source_forbidden")
        started_at = normalize_iso_time(data.get("started_at"), "计量开始时间")
        ended_at = normalize_iso_time(data.get("ended_at"), "计量结束时间")
        if ended_at <= started_at:
            raise ApiError(422, "计量结束时间必须晚于开始时间")
        try:
            quantity = round(float(data.get("quantity")), 6)
        except (TypeError, ValueError):
            raise ApiError(422, "计量数量无效")
        if quantity <= 0:
            raise ApiError(422, "计量数量必须大于零")
        evidence_digest = clean_text(data.get("evidence_digest"), "原始证据摘要", 16, 160)
        signature = clean_text(data.get("signature"), "计量签名", 16, 500)
        performance = data.get("performance") if isinstance(data.get("performance"), dict) else {}
        record_id = uid("meter")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                if order["status"] not in ("delivered", "disputed"):
                    raise ApiError(409, "订单尚未进入可计量交付状态", "invalid_order_state")
                supplier = supplier_for_order(connection, order)
                if source == "supplier" and supplier["id"] != session["user_id"]:
                    raise ApiError(403, "无权上报该订单的供应商计量")
                listing = connection.execute("SELECT kind FROM listings WHERE id=?", (order["listing_id"],)).fetchone()
                resource_kind = listing["kind"] if listing else (order["kind"] if "kind" in order.keys() else "gpu")
                connection.execute(
                    """INSERT INTO metering_records(id,order_id,source,resource_kind,started_at,ended_at,quantity,
                       performance_json,evidence_digest,signature,status,created_by,created_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,'received',?,?)""",
                    (record_id, order_id, source, resource_kind, started_at, ended_at, quantity,
                     json.dumps(performance, ensure_ascii=False), evidence_digest, signature, session["user_id"], now_iso()),
                )
                reconciliation = metering_reconciliation(connection, order_id)
                audit(connection, session["user_id"], "order", order_id, "metering.recorded", {
                    "record_id": record_id, "source": source, "quantity": quantity,
                    "reconciliation": reconciliation,
                })
                if reconciliation["status"] == "manual_review":
                    audit(connection, None, "order", order_id, "metering.manual_review_required", reconciliation)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "record_id": record_id, "reconciliation": reconciliation})

    def demo_deliver(self, order_id: str) -> None:
        session = self.session(csrf=True)
        if not ALLOW_DEMO:
            raise ApiError(404, "联调交付未启用")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                if order["buyer_user_id"] != session["user_id"]:
                    raise ApiError(403, "无权操作该订单")
                if order["status"] == "delivered":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(order), "idempotent_replay": True})
                if order["status"] != "paid":
                    raise ApiError(409, "仅已支付订单可以进入交付", "invalid_order_state")
                listing = connection.execute("SELECT * FROM listings WHERE id=?", (order["listing_id"],)).fetchone()
                if listing["order_locked"] + 1e-9 < order["quantity"]:
                    raise ApiError(409, "订单锁定容量异常")
                delivery_ref = uid("delivery")
                updated = now_iso()
                acceptance_due = future_iso(48)
                connection.execute("UPDATE listings SET order_locked=order_locked-?,delivering=delivering+?,version=version+1,updated_at=? WHERE id=?", (order["quantity"], order["quantity"], updated, listing["id"]))
                connection.execute("UPDATE orders SET status='delivered',delivery_ref=?,delivered_at=?,acceptance_due_at=?,updated_at=? WHERE id=?", (delivery_ref, updated, acceptance_due, updated, order_id))
                connection.execute(
                    "INSERT OR REPLACE INTO delivery_tasks(id,order_id,supplier_user_id,status,credential_reference,endpoint_summary,evidence_digest,started_at,delivered_at,acceptance_due_at,created_at,updated_at) VALUES(?,?,?,'delivered',?,?,?,?,?,?,?,?)",
                    (uid("delivery"), order_id, listing["supplier_user_id"], delivery_ref, "联调交付端点", hashlib.sha256(delivery_ref.encode()).hexdigest(), updated, updated, acceptance_due, updated, updated),
                )
                for source in ("supplier", "kai_gateway"):
                    evidence = hashlib.sha256(f"{order_id}|{source}|demo".encode()).hexdigest()
                    connection.execute(
                        "INSERT OR IGNORE INTO metering_records(id,order_id,source,resource_kind,started_at,ended_at,quantity,performance_json,evidence_digest,signature,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'received',?,?)",
                        (uid("meter"), order_id, source, listing["kind"], updated, future_iso(1), order["quantity"], '{"mode":"demo"}', evidence, evidence, session["user_id"], updated),
                    )
                metering_reconciliation(connection, order_id)
                audit(connection, "usr_demo_supplier", "order", order_id, "delivery.credentials_issued", {"delivery_ref": delivery_ref, "credential_mode": "one_time_reference"})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "order": order_dict(order)})

    def accept_order(self, order_id: str) -> None:
        session = self.session(csrf=True)
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                if order["buyer_user_id"] != session["user_id"]:
                    raise ApiError(403, "无权验收该订单")
                if order["status"] == "accepted":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(order), "idempotent_replay": True})
                if order["status"] != "delivered":
                    raise ApiError(409, "订单尚未完成交付", "invalid_order_state")
                reconciliation = metering_reconciliation(connection, order_id)
                if not reconciliation["ready"]:
                    message = "供应商与 KAI 双源计量尚未齐备" if reconciliation["status"] == "awaiting_dual_source" else "双源计量差异超过阈值，已暂停自动验收"
                    raise ApiError(409, message, "metering_not_reconciled")
                listing = connection.execute("SELECT * FROM listings WHERE id=?", (order["listing_id"],)).fetchone()
                if listing["delivering"] + 1e-9 < order["quantity"]:
                    raise ApiError(409, "交付中容量异常")
                allocation_id = uid("asset")
                connection.execute("UPDATE listings SET delivering=delivering-?,consumed=consumed+?,version=version+1,updated_at=? WHERE id=?", (order["quantity"], order["quantity"], now_iso(), listing["id"]))
                accepted_at = now_iso()
                connection.execute("UPDATE orders SET status='accepted',accepted_at=?,updated_at=? WHERE id=?", (accepted_at, accepted_at, order_id))
                connection.execute(
                    "INSERT INTO allocations(id,owner_user_id,order_id,listing_id,gpu,region,quantity,unit,expires_at,status,created_at,kind,product_code,provider) VALUES(?,?,?,?,?,?,?,?,?,'available',?,?,?,?)",
                    (allocation_id, session["user_id"], order_id, listing["id"], order["gpu"], order["region"], order["quantity"], order["unit"], listing["valid_until"], now_iso(), listing["kind"], listing["product_code"], listing["provider"]),
                )
                audit(connection, session["user_id"], "order", order_id, "order.accepted", {"allocation_id": allocation_id, "quantity": order["quantity"], "unit": order["unit"]})
                supplier = supplier_for_order(connection, order)
                settlement_mode = order["settlement_mode"] if "settlement_mode" in order.keys() else "cash"
                if settlement_mode == "swap":
                    swap = connection.execute("SELECT * FROM swap_requests WHERE id=?", (order["swap_id"],)).fetchone()
                    source = connection.execute("SELECT * FROM allocations WHERE id=?", (swap["source_allocation_id"],)).fetchone() if swap else None
                    if not swap or swap["status"] != "confirmed" or not source or source["swap_reserved"] + 1e-9 < swap["source_quantity"]:
                        raise ApiError(409, "置换源资产锁定状态异常", "swap_source_reservation_invalid")
                    remaining = max(0, source["quantity"] - swap["source_quantity"])
                    connection.execute(
                        "UPDATE allocations SET quantity=?,swap_reserved=MAX(0,swap_reserved-?),status=? WHERE id=?",
                        (remaining, swap["source_quantity"], "transferred" if remaining <= 1e-9 else "available", source["id"]),
                    )
                    source_listing = connection.execute("SELECT * FROM listings WHERE id=?", (source["listing_id"],)).fetchone()
                    transfer_order_id = uid("ord")
                    transfer_order_no = f"KAI-SWAP-{secrets.token_hex(6).upper()}"
                    transfer_amount = int(round(swap["source_quantity"] * swap["source_reference_cents"]))
                    transfer_snapshot = json.dumps({"source": "bilateral_swap_transfer", "swap_id": swap["id"], "counter_order_id": order_id}, ensure_ascii=False)
                    connection.execute(
                        """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,
                           unit_price_cents,amount_cents,currency,status,payment_provider,idempotency_key,quote_snapshot_json,
                           reservation_expires_at,accepted_at,created_at,updated_at,kind,product_code,settlement_mode,swap_id)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,'CNY','accepted','swap',?,?,?,?,?,?,?,?,'swap_transfer',?)""",
                        (transfer_order_id, transfer_order_no, supplier["id"], source["listing_id"], source["gpu"], source["region"],
                         source["provider"] or "置换转入", swap["source_quantity"], source["unit"], swap["source_reference_cents"], transfer_amount,
                         f"swap-transfer:{swap['id']}", transfer_snapshot, accepted_at, accepted_at, accepted_at, accepted_at,
                         source["kind"], source["product_code"] or source["gpu"], swap["id"]),
                    )
                    received_asset_id = uid("asset")
                    connection.execute(
                        """INSERT INTO allocations(id,owner_user_id,order_id,listing_id,gpu,region,quantity,unit,expires_at,status,
                           created_at,kind,product_code,provider) VALUES(?,?,?,?,?,?,?,?,?,'available',?,?,?,?)""",
                        (received_asset_id, supplier["id"], transfer_order_id, source["listing_id"], source["gpu"], source["region"],
                         swap["source_quantity"], source["unit"], source["expires_at"], accepted_at, source["kind"],
                         source["product_code"] or source["gpu"], source["provider"] or "置换转入"),
                    )
                    connection.execute("UPDATE swap_requests SET status='completed',updated_at=? WHERE id=?", (accepted_at, swap["id"]))
                    audit(connection, session["user_id"], "swap", swap["id"], "swap.completed", {
                        "target_order_id": order_id, "source_transfer_order_id": transfer_order_id,
                        "source_received_asset_id": received_asset_id, "cash_difference_cents": 0,
                    })
                if settlement_mode == "cash":
                    platform_fee = int(round(order["amount_cents"] * PLATFORM_FEE_BPS / 10000))
                    supplier_net = order["amount_cents"] - platform_fee
                    hold_until = (datetime.now(timezone.utc) + timedelta(hours=SETTLEMENT_HOLD_HOURS)).replace(microsecond=0).isoformat()
                    settlement_id = uid("settlement")
                    connection.execute(
                        """INSERT INTO settlements(id,order_id,supplier_user_id,gross_cents,platform_fee_cents,supplier_net_cents,
                           referral_commission_cents,currency,status,hold_until,created_at,updated_at)
                           VALUES(?,?,?,?,?,?,?,'CNY','holding',?,?,?)""",
                        (settlement_id, order_id, supplier["id"], order["amount_cents"], platform_fee,
                         supplier_net, 0, hold_until, accepted_at, accepted_at),
                    )
                    audit(connection, session["user_id"], "settlement", settlement_id, "settlement.eligible", {
                        "order_id": order_id, "reason": "buyer_accepted", "gross_cents": order["amount_cents"],
                        "platform_fee_cents": platform_fee, "supplier_net_cents": supplier_net,
                        "hold_until": hold_until,
                    })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "order": order_dict(order)})

    def cancel_order(self, order_id: str) -> None:
        session = self.session(csrf=True)
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                if order["buyer_user_id"] != session["user_id"]:
                    raise ApiError(403, "无权取消该订单")
                if order["status"] == "cancelled":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "order": order_dict(order), "idempotent_replay": True})
                if order["status"] != "pending_payment":
                    raise ApiError(409, "当前订单状态不能直接取消，请进入退款或争议流程")
                connection.execute("UPDATE listings SET quote_reserved=quote_reserved-?,version=version+1,updated_at=? WHERE id=?", (order["quantity"], now_iso(), order["listing_id"]))
                connection.execute("UPDATE orders SET status='cancelled',updated_at=? WHERE id=?", (now_iso(), order_id))
                audit(connection, session["user_id"], "order", order_id, "capacity.reservation_released", {"quantity": order["quantity"], "unit": order["unit"]})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "order": order_dict(order)})

    def create_dispute(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        order_id = clean_text(data.get("order_id"), "订单", 4, 80)
        category = clean_text(data.get("category") or "delivery", "争议类型", 3, 40)
        reason = clean_text(data.get("reason"), "争议说明", 8, 1000)
        dispute_id = uid("dispute")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                order = fetch_order(connection, order_id)
                if order["buyer_user_id"] != session["user_id"]:
                    raise ApiError(403, "无权对该订单发起争议")
                if order["status"] not in ("paid", "supplier_confirmed", "delivered", "accepted"):
                    raise ApiError(409, "订单当前状态不能发起争议", "invalid_order_state")
                existing = connection.execute(
                    "SELECT * FROM disputes WHERE order_id=? AND status IN ('open','reviewing')",
                    (order_id,),
                ).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "dispute": dict(existing), "idempotent_replay": True})
                connection.execute(
                    "INSERT INTO disputes(id,order_id,opened_by,category,reason,original_order_status,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'open',?,?)",
                    (dispute_id, order_id, session["user_id"], category, reason, order["status"], created, created),
                )
                connection.execute("UPDATE orders SET status='disputed',updated_at=? WHERE id=?", (created, order_id))
                connection.execute("UPDATE settlements SET status='paused',updated_at=? WHERE order_id=? AND status IN ('holding','payable')", (created, order_id))
                pause_supplier_card_hour_rebate(connection, order_id, created)
                audit(connection, session["user_id"], "dispute", dispute_id, "dispute.opened", {
                    "order_id": order_id, "category": category, "reason": reason,
                })
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "dispute": {"id": dispute_id, "status": "open"}})

    def create_refund(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        order_id = clean_text(data.get("order_id"), "订单", 4, 80)
        reason = clean_text(data.get("reason"), "退款原因", 8, 1000)
        idem = require_idempotency_key(self.headers)
        refund_id = uid("refund")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM refunds WHERE requester_user_id=? AND idempotency_key=?",
                    (session["user_id"], idem),
                ).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "refund": dict(existing), "idempotent_replay": True})
                order = fetch_order(connection, order_id)
                if order["buyer_user_id"] != session["user_id"]:
                    raise ApiError(403, "无权申请该订单退款")
                payment = connection.execute("SELECT * FROM payments WHERE order_id=? AND status='success'", (order_id,)).fetchone()
                if not payment or order["status"] not in ("paid", "supplier_confirmed", "delivered", "accepted", "disputed"):
                    raise ApiError(409, "订单当前不满足退款申请条件", "refund_not_allowed")
                original_status = order["status"]
                if original_status == "disputed":
                    dispute = connection.execute("SELECT * FROM disputes WHERE order_id=? ORDER BY created_at DESC LIMIT 1", (order_id,)).fetchone()
                    original_status = dispute["original_order_status"] if dispute else "delivered"
                connection.execute(
                    """INSERT INTO refunds(id,order_id,payment_id,requester_user_id,amount_cents,reason,original_order_status,
                       status,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending_review',?,?,?)""",
                    (refund_id, order_id, payment["id"], session["user_id"], order["amount_cents"], reason, original_status, idem, created, created),
                )
                connection.execute("UPDATE orders SET status='refund_pending',updated_at=? WHERE id=?", (created, order_id))
                connection.execute("UPDATE settlements SET status='paused',updated_at=? WHERE order_id=? AND status IN ('holding','payable')", (created, order_id))
                pause_supplier_card_hour_rebate(connection, order_id, created)
                audit(connection, session["user_id"], "refund", refund_id, "refund.requested", {
                    "order_id": order_id, "amount_cents": order["amount_cents"], "reason": reason,
                }, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "refund": {"id": refund_id, "status": "pending_review", "amount_cents": order["amount_cents"]}})

    def create_invoice_request(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        order_id = clean_text(data.get("order_id"), "订单", 4, 80)
        title = clean_text(data.get("invoice_title"), "发票抬头", 2, 160)
        tax_id = clean_text(data.get("tax_id"), "纳税人识别号", 15, 30).upper()
        email = clean_text(data.get("email"), "接收邮箱", 5, 160).lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ApiError(422, "接收邮箱格式无效")
        request_id = uid("invoice")
        created = now_iso()
        with db_connect() as connection:
            order = fetch_order(connection, order_id)
            if order["buyer_user_id"] != session["user_id"]:
                raise ApiError(403, "无权申请该订单发票")
            if order["status"] != "accepted":
                raise ApiError(409, "订单验收后才能申请发票", "invoice_not_allowed")
            existing = connection.execute("SELECT * FROM invoice_requests WHERE order_id=?", (order_id,)).fetchone()
            if existing:
                return self.json_response(200, {"ok": True, "invoice": dict(existing), "idempotent_replay": True})
            connection.execute(
                "INSERT INTO invoice_requests(id,order_id,requester_user_id,invoice_title,tax_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'requested',?,?)",
                (request_id, order_id, session["user_id"], title, tax_id, email, created, created),
            )
            audit(connection, session["user_id"], "invoice", request_id, "invoice.requested", {"order_id": order_id})
        self.json_response(201, {"ok": True, "invoice": {"id": request_id, "status": "requested"}})

    def get_swap_requests(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT s.*,l.provider AS target_provider,l.unit AS target_unit,l.product_code AS quoted_product
                   FROM swap_requests s LEFT JOIN listings l ON l.id=s.target_listing_id
                   WHERE s.requester_user_id=? ORDER BY s.created_at DESC LIMIT 50""",
                (session["user_id"],),
            ).fetchall()
        swaps = []
        for row in rows:
            item = dict(row)
            try:
                item["quote_snapshot"] = json.loads(item.pop("quote_snapshot_json") or "{}")
            except json.JSONDecodeError:
                item["quote_snapshot"] = {}
            item["source_reference_cny"] = item.pop("source_reference_cents") / 100
            target_cents = item.pop("target_reference_cents")
            item["target_reference_cny"] = target_cents / 100 if target_cents else None
            swaps.append(item)
        self.json_response(200, {"ok": True, "swaps": swaps})

    def create_swap_request(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        source_id = clean_text(data.get("source_allocation_id"), "源资产批次", 4, 80)
        target_kind = clean_text(data.get("target_kind"), "目标资源类型", 3, 20)
        if target_kind not in RESOURCE_UNITS:
            raise ApiError(422, "目标资源类型无效", "invalid_resource_kind")
        target_product = clean_text(data.get("target_product_code"), "目标标准产品", 2, 120)
        target_region = clean_text(data.get("target_region") or "不限地区", "目标地区", 2, 80)
        try:
            quantity = round(float(data.get("source_quantity")), 6)
        except (TypeError, ValueError):
            raise ApiError(422, "源资产数量无效")
        if quantity <= 0:
            raise ApiError(422, "源资产数量必须大于零")
        idem = require_idempotency_key(self.headers)
        swap_id = uid("swap")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute(
                    "SELECT * FROM swap_requests WHERE requester_user_id=? AND idempotency_key=?",
                    (session["user_id"], idem),
                ).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "swap": dict(existing), "idempotent_replay": True})
                allocation = connection.execute("SELECT * FROM allocations WHERE id=?", (source_id,)).fetchone()
                if not allocation or allocation["owner_user_id"] != session["user_id"]:
                    raise ApiError(404, "源资产批次不存在", "allocation_not_found")
                if allocation["status"] != "available":
                    raise ApiError(409, "源资产当前已冻结或不可用", "allocation_not_available")
                withdrawal_reserved = connection.execute(
                    "SELECT COALESCE(SUM(quantity),0) FROM withdrawal_requests WHERE allocation_id=? AND status IN ('scheduled','processing')",
                    (source_id,),
                ).fetchone()[0]
                available = allocation["quantity"] - withdrawal_reserved - float(allocation["swap_reserved"] or 0)
                if available + 1e-9 < quantity:
                    raise ApiError(409, f"源资产可置换余额不足，当前可用 {max(0, available):g} {allocation['unit']}", "insufficient_swap_balance")
                source_order = fetch_order(connection, allocation["order_id"])
                source_reference_cents = int(source_order["unit_price_cents"])
                preferred_listing = clean_text(data.get("target_listing_id"), "目标挂牌", 4, 80) if data.get("target_listing_id") else None
                if preferred_listing:
                    target_listing = connection.execute(
                        "SELECT * FROM listings WHERE id=? AND status='active' AND trade_mode='fixed'",
                        (preferred_listing,),
                    ).fetchone()
                else:
                    region_clause = "" if target_region == "不限地区" else " AND region=?"
                    params = [target_kind, target_product, target_product]
                    if target_region != "不限地区":
                        params.append(target_region)
                    target_listing = connection.execute(
                        f"""SELECT * FROM listings WHERE status='active' AND trade_mode='fixed' AND kind=?
                            AND (product_code=? OR gpu=?) {region_clause}
                            AND valid_from<=? AND valid_until>? ORDER BY unit_price_cents LIMIT 1""",
                        (*params, created, created),
                    ).fetchone()
                target_reference_cents = int(target_listing["unit_price_cents"]) if target_listing else None
                estimate = round(quantity * source_reference_cents / target_reference_cents, 6) if target_reference_cents else None
                snapshot = {
                    "valuation_currency": "CNY", "valuation_time": created,
                    "source_price_layer": "source_order_execution_price",
                    "source_unit_price_cny": source_reference_cents / 100,
                    "target_price_layer": "active_verified_listing" if target_listing else "awaiting_market_match",
                    "target_unit_price_cny": target_reference_cents / 100 if target_reference_cents else None,
                    "standardization_adjustment_bps": 0,
                }
                connection.execute(
                    """INSERT INTO swap_requests(id,requester_user_id,source_allocation_id,source_kind,source_product_code,
                       source_quantity,source_unit,target_kind,target_product_code,target_region,target_listing_id,target_quantity,
                       source_reference_cents,target_reference_cents,quote_snapshot_json,status,idempotency_key,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'matching',?,?,?)""",
                    (swap_id, session["user_id"], source_id, allocation["kind"], allocation["product_code"] or allocation["gpu"],
                     quantity, allocation["unit"], target_kind, target_product, target_region,
                     target_listing["id"] if target_listing else None, estimate, source_reference_cents,
                     target_reference_cents, json.dumps(snapshot, ensure_ascii=False), idem, created, created),
                )
                audit(connection, session["user_id"], "swap", swap_id, "swap.requested", {
                    "source_allocation_id": source_id, "source_quantity": quantity,
                    "target_kind": target_kind, "target_product_code": target_product,
                    "reference_value_cents": int(round(quantity * source_reference_cents)),
                }, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "swap": {"id": swap_id, "status": "matching", "estimated_target_quantity": estimate}})

    def admin_quote_swap(self, swap_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        listing_id = clean_text(data.get("target_listing_id"), "目标挂牌", 4, 80)
        quoted_at = now_iso()
        quote_expires = future_minutes_iso(15)
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                swap = connection.execute("SELECT * FROM swap_requests WHERE id=?", (swap_id,)).fetchone()
                if not swap or swap["status"] != "matching":
                    raise ApiError(409, "置换需求不存在或已进入其他状态")
                allocation = connection.execute("SELECT * FROM allocations WHERE id=?", (swap["source_allocation_id"],)).fetchone()
                listing = connection.execute("SELECT * FROM listings WHERE id=? AND status='active' AND trade_mode='fixed'", (listing_id,)).fetchone()
                if not allocation or not listing or listing["kind"] != swap["target_kind"]:
                    raise ApiError(409, "目标挂牌不可用或产品类型不匹配", "swap_target_unavailable")
                if swap["target_product_code"] not in (listing["product_code"], listing["gpu"]):
                    raise ApiError(409, "目标挂牌与需求中的标准产品不一致", "swap_target_product_mismatch")
                target_quantity = round(swap["source_quantity"] * swap["source_reference_cents"] / listing["unit_price_cents"], 6)
                available = listing["verified_quantity"] - listing["quote_reserved"] - listing["order_locked"] - listing["delivering"] - listing["consumed"] - listing["frozen"]
                if target_quantity < listing["minimum_quantity"] or available + 1e-9 < target_quantity:
                    raise ApiError(409, "目标挂牌容量不足或低于最低交易量", "insufficient_swap_target_capacity")
                if allocation["quantity"] - allocation["swap_reserved"] + 1e-9 < swap["source_quantity"]:
                    raise ApiError(409, "源资产可置换余额已变化", "insufficient_swap_balance")
                connection.execute("UPDATE allocations SET swap_reserved=swap_reserved+? WHERE id=?", (swap["source_quantity"], allocation["id"]))
                connection.execute("UPDATE listings SET quote_reserved=quote_reserved+?,version=version+1,updated_at=? WHERE id=?", (target_quantity, quoted_at, listing_id))
                snapshot = {
                    "valuation_currency": "CNY", "valuation_time": quoted_at,
                    "source_unit_price_cny": swap["source_reference_cents"] / 100,
                    "target_unit_price_cny": listing["unit_price_cents"] / 100,
                    "source_value_cny": round(swap["source_quantity"] * swap["source_reference_cents"] / 100, 2),
                    "target_value_cny": round(target_quantity * listing["unit_price_cents"] / 100, 2),
                    "price_source": "source execution price + active verified target listing",
                    "cash_difference_cny": 0,
                }
                connection.execute(
                    """UPDATE swap_requests SET target_listing_id=?,target_quantity=?,target_reference_cents=?,
                       quote_snapshot_json=?,quote_expires_at=?,status='quoted',updated_at=? WHERE id=?""",
                    (listing_id, target_quantity, listing["unit_price_cents"], json.dumps(snapshot, ensure_ascii=False), quote_expires, quoted_at, swap_id),
                )
                audit(connection, session["user_id"], "swap", swap_id, "swap.quoted", {"target_listing_id": listing_id, "target_quantity": target_quantity, "quote_expires_at": quote_expires})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "swap_id": swap_id, "status": "quoted", "quote_expires_at": quote_expires, "target_quantity": target_quantity})

    def accept_swap_quote(self, swap_id: str) -> None:
        session = self.session(csrf=True)
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                swap = connection.execute("SELECT * FROM swap_requests WHERE id=?", (swap_id,)).fetchone()
                if not swap or swap["requester_user_id"] != session["user_id"]:
                    raise ApiError(404, "置换报价不存在")
                if swap["status"] == "confirmed":
                    order = fetch_order(connection, swap["target_order_id"])
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "swap_id": swap_id, "status": "confirmed", "order": order_dict(order), "idempotent_replay": True})
                if swap["status"] != "quoted" or not swap["quote_expires_at"] or swap["quote_expires_at"] <= created:
                    raise ApiError(409, "置换报价已失效，请重新撮合", "swap_quote_expired")
                listing = connection.execute("SELECT * FROM listings WHERE id=?", (swap["target_listing_id"],)).fetchone()
                allocation = connection.execute("SELECT * FROM allocations WHERE id=?", (swap["source_allocation_id"],)).fetchone()
                if not listing or not allocation or allocation["swap_reserved"] + 1e-9 < swap["source_quantity"] or listing["quote_reserved"] + 1e-9 < swap["target_quantity"]:
                    raise ApiError(409, "置换两侧锁定容量异常", "swap_reservation_invalid")
                order_id = uid("ord")
                order_no = f"KAI{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}{secrets.randbelow(9000)+1000}"
                amount = int(round(swap["target_quantity"] * listing["unit_price_cents"]))
                snapshot = json.loads(swap["quote_snapshot_json"] or "{}") | {"source": "bilateral_swap", "swap_id": swap_id, "listing_version": listing["version"]}
                connection.execute("UPDATE listings SET quote_reserved=quote_reserved-?,order_locked=order_locked+?,version=version+1,updated_at=? WHERE id=?", (swap["target_quantity"], swap["target_quantity"], created, listing["id"]))
                connection.execute(
                    """INSERT INTO orders(id,order_no,buyer_user_id,listing_id,gpu,region,provider,quantity,unit,
                       unit_price_cents,amount_cents,currency,status,payment_provider,idempotency_key,quote_snapshot_json,
                       reservation_expires_at,created_at,updated_at,kind,product_code,settlement_mode,swap_id)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,'CNY','paid','swap',?,?,?,?,?,?,?,'swap',?)""",
                    (order_id, order_no, session["user_id"], listing["id"], listing["gpu"], listing["region"], listing["provider"],
                     swap["target_quantity"], listing["unit"], listing["unit_price_cents"], amount, f"swap:{swap_id}",
                     json.dumps(snapshot, ensure_ascii=False), created, created, created, listing["kind"], listing["product_code"], swap_id),
                )
                connection.execute("UPDATE swap_requests SET target_order_id=?,status='confirmed',updated_at=? WHERE id=?", (order_id, created, swap_id))
                audit(connection, session["user_id"], "swap", swap_id, "swap.confirmed", {"target_order_id": order_id, "cash_difference_cents": 0})
                audit(connection, session["user_id"], "order", order_id, "capacity.locked_by_swap", {"swap_id": swap_id, "quantity": swap["target_quantity"], "unit": listing["unit"]})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            order = fetch_order(connection, order_id)
        self.json_response(200, {"ok": True, "swap_id": swap_id, "status": "confirmed", "order": order_dict(order)})

    def cancel_swap_request(self, swap_id: str) -> None:
        session = self.session(csrf=True)
        updated = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                swap = connection.execute("SELECT * FROM swap_requests WHERE id=?", (swap_id,)).fetchone()
                if not swap or swap["requester_user_id"] != session["user_id"]:
                    raise ApiError(404, "置换需求不存在")
                if swap["status"] == "cancelled":
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "swap_id": swap_id, "status": "cancelled", "idempotent_replay": True})
                if swap["status"] not in ("matching", "quoted"):
                    raise ApiError(409, "置换已确认交付，需通过争议流程处理", "swap_not_cancellable")
                if swap["status"] == "quoted":
                    connection.execute("UPDATE allocations SET swap_reserved=MAX(0,swap_reserved-?) WHERE id=?", (swap["source_quantity"], swap["source_allocation_id"]))
                    connection.execute("UPDATE listings SET quote_reserved=MAX(0,quote_reserved-?),version=version+1,updated_at=? WHERE id=?", (swap["target_quantity"], updated, swap["target_listing_id"]))
                connection.execute("UPDATE swap_requests SET status='cancelled',updated_at=? WHERE id=?", (updated, swap_id))
                audit(connection, session["user_id"], "swap", swap_id, "swap.cancelled", {"reservations_released": swap["status"] == "quoted"})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "swap_id": swap_id, "status": "cancelled"})

    def get_account_deletion_status(self) -> None:
        session = self.session()
        with db_connect() as connection:
            row = connection.execute("SELECT * FROM account_deletion_requests WHERE user_id=? ORDER BY requested_at DESC LIMIT 1", (session["user_id"],)).fetchone()
        self.json_response(200, {"ok": True, "request": dict(row) if row else None})

    def create_account_deletion_request(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        password = str(data.get("password") or "")
        reason = clean_text(data.get("reason") or "用户主动申请注销账户", "注销原因", 4, 500)
        requested = now_iso()
        request_id = uid("deletion")
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                user = connection.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
                if not user or not verify_password(password, user["password_hash"]):
                    raise ApiError(401, "账户密码不正确", "invalid_current_password")
                existing = connection.execute("SELECT * FROM account_deletion_requests WHERE user_id=? AND status IN ('pending_obligations','scheduled') ORDER BY requested_at DESC LIMIT 1", (user["id"],)).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "request": dict(existing), "idempotent_replay": True})
                open_orders = connection.execute("SELECT COUNT(*) FROM orders WHERE buyer_user_id=? AND status NOT IN ('accepted','cancelled','refunded','expired')", (user["id"],)).fetchone()[0]
                supplier_obligations = connection.execute("SELECT COUNT(*) FROM listings WHERE supplier_user_id=? AND status IN ('pending_review','active','suspended')", (user["id"],)).fetchone()[0]
                open_cases = connection.execute("SELECT COUNT(*) FROM disputes WHERE opened_by=? AND status IN ('open','reviewing')", (user["id"],)).fetchone()[0]
                has_obligations = (open_orders + supplier_obligations + open_cases) > 0
                status = "pending_obligations" if has_obligations else "scheduled"
                scheduled_for = None if has_obligations else (datetime.now(timezone.utc) + timedelta(days=7)).replace(microsecond=0).isoformat()
                retention = "订单、支付、计量、发票、结算、风控与审计记录按法定或合同期限保留；到期前限制使用并与公开身份分离。"
                connection.execute("INSERT INTO account_deletion_requests(id,user_id,status,reason,retention_summary,requested_at,scheduled_for,updated_at) VALUES(?,?,?,?,?,?,?,?)", (request_id, user["id"], status, reason, retention, requested, scheduled_for, requested))
                connection.execute("UPDATE users SET lifecycle_status='deletion_requested',deletion_requested_at=?,updated_at=? WHERE id=?", (requested, requested, user["id"]))
                audit(connection, user["id"], "account_deletion", request_id, "account.deletion_requested", {"status": status, "open_orders": open_orders, "supplier_obligations": supplier_obligations, "open_cases": open_cases})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(201, {"ok": True, "request": {"id": request_id, "status": status, "scheduled_for": scheduled_for, "retention_summary": retention}})

    def cancel_account_deletion_request(self) -> None:
        session = self.session(csrf=True)
        updated = now_iso()
        with db_connect() as connection:
            row = connection.execute("SELECT * FROM account_deletion_requests WHERE user_id=? AND status IN ('pending_obligations','scheduled') ORDER BY requested_at DESC LIMIT 1", (session["user_id"],)).fetchone()
            if not row:
                raise ApiError(409, "当前没有可撤销的注销申请")
            connection.execute("UPDATE account_deletion_requests SET status='cancelled',updated_at=? WHERE id=?", (updated, row["id"]))
            connection.execute("UPDATE users SET lifecycle_status='active',deletion_requested_at=NULL,updated_at=? WHERE id=?", (updated, session["user_id"]))
            audit(connection, session["user_id"], "account_deletion", row["id"], "account.deletion_cancelled", {})
        self.json_response(200, {"ok": True, "request_id": row["id"], "status": "cancelled"})

    def admin_complete_account_deletion(self, request_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        completed = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                request_row = connection.execute("SELECT * FROM account_deletion_requests WHERE id=?", (request_id,)).fetchone()
                if not request_row or request_row["status"] not in ("pending_obligations", "scheduled"):
                    raise ApiError(409, "注销申请不存在或已处理")
                user_id = request_row["user_id"]
                open_orders = connection.execute("SELECT COUNT(*) FROM orders WHERE buyer_user_id=? AND status NOT IN ('accepted','cancelled','refunded','expired')", (user_id,)).fetchone()[0]
                open_supplier_orders = connection.execute("SELECT COUNT(*) FROM orders o JOIN listings l ON l.id=o.listing_id WHERE l.supplier_user_id=? AND o.status NOT IN ('accepted','cancelled','refunded','expired')", (user_id,)).fetchone()[0]
                open_cases = connection.execute("SELECT COUNT(*) FROM disputes WHERE opened_by=? AND status IN ('open','reviewing')", (user_id,)).fetchone()[0]
                if open_orders or open_supplier_orders or open_cases:
                    raise ApiError(409, "仍有订单、交付或争议义务，暂不能完成注销", "account_deletion_obligations")
                pseudonym = hashlib.sha256(f"{user_id}|{completed}".encode()).hexdigest()[:16]
                connection.execute("UPDATE listings SET status='supplier_exited',updated_at=? WHERE supplier_user_id=? AND status IN ('pending_review','active','suspended')", (completed, user_id))
                connection.execute(
                    """UPDATE users SET name='已注销企业用户',account=?,password_hash=?,role='exited',enterprise_status='exited',
                       lifecycle_status='anonymized',anonymized_at=?,updated_at=? WHERE id=?""",
                    (f"deleted-{pseudonym}@invalid.kai", hash_password(secrets.token_urlsafe(32)), completed, completed, user_id),
                )
                connection.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
                connection.execute("UPDATE account_deletion_requests SET status='completed',completed_at=?,updated_at=? WHERE id=?", (completed, completed, request_id))
                audit(connection, session["user_id"], "account_deletion", request_id, "account.deletion_completed", {"identity_anonymized": True, "transaction_history_preserved": True})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "request_id": request_id, "status": "completed"})

    def get_public_operator(self) -> None:
        self.json_response(200, {"ok": True, "operator": {
            "app_name": APP_NAME, "legal_name": OPERATOR_LEGAL_NAME, "support_email": SUPPORT_EMAIL,
            "support_phone": SUPPORT_PHONE, "icp_filing": ICP_FILING, "app_filing": APP_FILING,
            "privacy_url": f"{PUBLIC_BASE_URL}/privacy.html" if PUBLIC_BASE_URL else "/privacy.html",
            "terms_url": f"{PUBLIC_BASE_URL}/terms.html" if PUBLIC_BASE_URL else "/terms.html",
            "deletion_url": f"{PUBLIC_BASE_URL}/account-deletion.html" if PUBLIC_BASE_URL else "/account-deletion.html",
        }})

    def get_app_release_readiness(self) -> None:
        session = self.session()
        require_role(session, "admin")
        self.json_response(200, {"ok": True, "release": integration_readiness()["app_release"]})

    def get_cases(self) -> None:
        session = self.session()
        with db_connect() as connection:
            disputes = connection.execute(
                "SELECT d.* FROM disputes d JOIN orders o ON o.id=d.order_id WHERE o.buyer_user_id=? ORDER BY d.created_at DESC",
                (session["user_id"],),
            ).fetchall()
            refunds = connection.execute(
                "SELECT * FROM refunds WHERE requester_user_id=? ORDER BY created_at DESC", (session["user_id"],)
            ).fetchall()
            invoices = connection.execute(
                "SELECT * FROM invoice_requests WHERE requester_user_id=? ORDER BY created_at DESC", (session["user_id"],)
            ).fetchall()
            settlements = []
            if session["role"] == "supplier":
                settlements = connection.execute(
                    "SELECT * FROM settlements WHERE supplier_user_id=? ORDER BY created_at DESC", (session["user_id"],)
                ).fetchall()
        self.json_response(200, {"ok": True, "disputes": [dict(row) for row in disputes], "refunds": [dict(row) for row in refunds], "invoices": [dict(row) for row in invoices], "settlements": [dict(row) for row in settlements]})

    def admin_resolve_dispute(self, dispute_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "争议处理决定", 3, 20)
        if decision not in ("reject", "refund"):
            raise ApiError(422, "争议处理决定无效")
        resolution = clean_text(data.get("resolution"), "处理结论", 8, 1000)
        updated = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                dispute = connection.execute("SELECT * FROM disputes WHERE id=?", (dispute_id,)).fetchone()
                if not dispute or dispute["status"] not in ("open", "reviewing"):
                    raise ApiError(409, "争议不存在或已处理")
                order = fetch_order(connection, dispute["order_id"])
                if decision == "reject":
                    connection.execute("UPDATE orders SET status=?,updated_at=? WHERE id=?", (dispute["original_order_status"], updated, order["id"]))
                    connection.execute("UPDATE settlements SET status='holding',updated_at=? WHERE order_id=? AND status='paused'", (updated, order["id"]))
                    restore_supplier_card_hour_rebate(connection, order["id"], updated)
                    dispute_status = "resolved_rejected"
                else:
                    payment = connection.execute("SELECT * FROM payments WHERE order_id=? AND status='success'", (order["id"],)).fetchone()
                    if not payment:
                        raise ApiError(409, "订单不存在可退款支付记录")
                    refund_id = uid("refund")
                    connection.execute(
                        """INSERT INTO refunds(id,order_id,payment_id,requester_user_id,amount_cents,reason,original_order_status,status,idempotency_key,created_at,updated_at)
                           VALUES(?,?,?,?,?,?,?,'pending_review',?,?,?)""",
                        (refund_id, order["id"], payment["id"], dispute["opened_by"], order["amount_cents"], resolution,
                         dispute["original_order_status"], f"dispute:{dispute_id}", updated, updated),
                    )
                    connection.execute("UPDATE orders SET status='refund_pending',updated_at=? WHERE id=?", (updated, order["id"]))
                    dispute_status = "resolved_refund"
                connection.execute(
                    "UPDATE disputes SET status=?,resolution=?,assigned_to=?,updated_at=? WHERE id=?",
                    (dispute_status, resolution, session["user_id"], updated, dispute_id),
                )
                audit(connection, session["user_id"], "dispute", dispute_id, f"dispute.{dispute_status}", {"resolution": resolution})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "dispute_id": dispute_id, "status": dispute_status})

    def admin_review_refund(self, refund_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "退款审核决定", 3, 20)
        if decision not in ("approve", "reject"):
            raise ApiError(422, "退款审核决定无效")
        reason = clean_text(data.get("reason") or "依据订单、计量和争议记录审核", "审核理由", 4, 500)
        with db_connect() as connection:
            refund = connection.execute("SELECT * FROM refunds WHERE id=?", (refund_id,)).fetchone()
            if not refund or refund["status"] != "pending_review":
                raise ApiError(409, "退款申请不存在或已审核")
            order = fetch_order(connection, refund["order_id"])
            payment = connection.execute("SELECT * FROM payments WHERE id=?", (refund["payment_id"],)).fetchone()
        if decision == "approve" and not ALLOW_DEMO:
            provider_result = request_provider_refund(payment["provider"], refund, order)
        else:
            provider_result = {}
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                refund = connection.execute("SELECT * FROM refunds WHERE id=?", (refund_id,)).fetchone()
                if decision == "reject":
                    updated = now_iso()
                    connection.execute("UPDATE refunds SET status='rejected',reviewer_user_id=?,updated_at=? WHERE id=?", (session["user_id"], updated, refund_id))
                    connection.execute("UPDATE orders SET status=?,updated_at=? WHERE id=?", (refund["original_order_status"], updated, refund["order_id"]))
                    connection.execute("UPDATE settlements SET status='holding',updated_at=? WHERE order_id=? AND status='paused'", (updated, refund["order_id"]))
                    restore_supplier_card_hour_rebate(connection, refund["order_id"], updated)
                    status = "rejected"
                elif ALLOW_DEMO:
                    apply_refund_success(connection, refund, uid("mock_refund"), session["user_id"])
                    status = "success"
                else:
                    status = "success" if provider_result.get("status") == "SUCCESS" else "processing"
                    if status == "success":
                        apply_refund_success(connection, refund, str(provider_result.get("provider_ref") or uid("refund_ref")), session["user_id"])
                    else:
                        connection.execute("UPDATE refunds SET status='processing',reviewer_user_id=?,provider_ref=?,updated_at=? WHERE id=?", (session["user_id"], provider_result.get("provider_ref"), now_iso(), refund_id))
                audit(connection, session["user_id"], "refund", refund_id, f"refund.{status}", {"reason": reason})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        self.json_response(200, {"ok": True, "refund_id": refund_id, "status": status})

    def admin_mark_settlement_paid(self, settlement_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        payout_ref = clean_text(data.get("payout_ref"), "持牌机构分账流水", 6, 160)
        with db_connect() as connection:
            settlement = connection.execute("SELECT * FROM settlements WHERE id=?", (settlement_id,)).fetchone()
            if not settlement or settlement["status"] != "payable":
                raise ApiError(409, "结算单尚未达到可结算状态")
            updated = now_iso()
            connection.execute("UPDATE settlements SET status='paid',payout_ref=?,paid_at=?,updated_at=? WHERE id=?", (payout_ref, updated, updated, settlement_id))
            audit(connection, session["user_id"], "settlement", settlement_id, "settlement.paid", {"payout_ref": payout_ref, "supplier_net_cents": settlement["supplier_net_cents"]})
        self.json_response(200, {"ok": True, "settlement_id": settlement_id, "status": "paid"})

    def admin_review_supplier_rebate(self, rebate_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        decision = clean_text(data.get("decision"), "审核决定", 6, 20)
        if decision not in ("approve", "reject"):
            raise ApiError(422, "审核决定无效", "invalid_rebate_review_decision")
        reason = clean_text(data.get("reason"), "审核理由", 4, 500)
        reviewed_at = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                rebate = connection.execute(
                    "SELECT * FROM supplier_card_hour_rebates WHERE id=?", (rebate_id,)
                ).fetchone()
                if not rebate or rebate["status"] != "pending_review" or not rebate["review_required"]:
                    raise ApiError(409, "返佣记录不在待审核状态", "rebate_not_pending_review")
                blocking_case = connection.execute(
                    """SELECT 1 FROM disputes WHERE order_id=? AND status IN ('open','reviewing')
                       UNION ALL SELECT 1 FROM refunds WHERE order_id=?
                       AND status IN ('pending_review','approved','processing','success') LIMIT 1""",
                    (rebate["order_id"], rebate["order_id"]),
                ).fetchone()
                if blocking_case:
                    raise ApiError(409, "订单存在争议或退款，暂不能审核返佣", "rebate_review_blocked")
                if decision == "approve":
                    connection.execute(
                        """UPDATE supplier_card_hour_rebates SET reviewer_user_id=?,review_reason=?,reviewed_at=?,
                           updated_at=? WHERE id=?""",
                        (session["user_id"], reason, reviewed_at, reviewed_at, rebate_id),
                    )
                    rebate = connection.execute(
                        "SELECT * FROM supplier_card_hour_rebates WHERE id=?", (rebate_id,)
                    ).fetchone()
                    rebate = issue_supplier_card_hour_rebate(connection, rebate, session["user_id"], reviewed_at)
                    status = rebate["status"]
                else:
                    status = "rejected"
                    connection.execute(
                        """UPDATE supplier_card_hour_rebates SET status='rejected',reviewer_user_id=?,review_reason=?,
                           reviewed_at=?,updated_at=? WHERE id=?""",
                        (session["user_id"], reason, reviewed_at, reviewed_at, rebate_id),
                    )
                    audit(connection, session["user_id"], "supplier_card_hour_rebate", rebate_id,
                          "supplier_rebate.rejected", {"order_id": rebate["order_id"], "reason": reason})
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            updated = connection.execute(
                "SELECT * FROM supplier_card_hour_rebates WHERE id=?", (rebate_id,)
            ).fetchone()
        self.json_response(200, {"ok": True, "rebate": supplier_rebate_dict(updated), "status": status})

    def admin_issue_invoice(self, invoice_id: str) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        data = self.read_json()
        invoice_ref = clean_text(data.get("invoice_ref"), "发票号码", 6, 160)
        with db_connect() as connection:
            invoice = connection.execute("SELECT * FROM invoice_requests WHERE id=?", (invoice_id,)).fetchone()
            if not invoice or invoice["status"] != "requested":
                raise ApiError(409, "开票申请不存在或已处理")
            updated = now_iso()
            connection.execute("UPDATE invoice_requests SET status='issued',invoice_ref=?,issued_at=?,updated_at=? WHERE id=?", (invoice_ref, updated, updated, invoice_id))
            audit(connection, session["user_id"], "invoice", invoice_id, "invoice.issued", {"invoice_ref": invoice_ref})
        self.json_response(200, {"ok": True, "invoice_id": invoice_id, "status": "issued"})

    def admin_run_maintenance(self) -> None:
        session = self.session(csrf=True)
        require_role(session, "admin")
        result = run_maintenance_cycle()
        self.json_response(200, {"ok": True, "result": result})

    def get_orders(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT o.*,
                          d.status AS delivery_task_status,
                          d.credential_reference AS delivery_credential_reference,
                          d.endpoint_summary AS delivery_endpoint_summary,
                          d.evidence_digest AS delivery_evidence_digest,
                          d.started_at AS delivery_started_at,
                          d.delivered_at AS delivery_task_delivered_at,
                          d.acceptance_due_at AS delivery_task_acceptance_due_at
                   FROM orders o
                   LEFT JOIN delivery_tasks d ON d.order_id=o.id
                   WHERE o.buyer_user_id=? ORDER BY o.created_at DESC LIMIT 50""",
                (session["user_id"],),
            ).fetchall()
        self.json_response(200, {"ok": True, "orders": [order_dict(row) for row in rows]})

    def create_withdrawal(self) -> None:
        session = self.session(csrf=True)
        data = self.read_json()
        allocation_id = clean_text(data.get("allocation_id"), "资产批次", 4, 80)
        try:
            quantity = round(float(data.get("quantity")), 6)
        except (TypeError, ValueError):
            raise ApiError(422, "取出数量无效")
        if quantity <= 0:
            raise ApiError(422, "取出数量必须大于 0")
        idem = self.headers.get("Idempotency-Key", "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{12,120}", idem):
            raise ApiError(422, "缺少有效幂等键", "invalid_idempotency_key")
        request_id = uid("withdraw")
        created = now_iso()
        with db_connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                existing = connection.execute("SELECT * FROM withdrawal_requests WHERE owner_user_id=? AND idempotency_key=?", (session["user_id"], idem)).fetchone()
                if existing:
                    connection.execute("COMMIT")
                    return self.json_response(200, {"ok": True, "withdrawal": dict(existing), "idempotent_replay": True})
                allocation = connection.execute("SELECT * FROM allocations WHERE id=?", (allocation_id,)).fetchone()
                if not allocation or allocation["owner_user_id"] != session["user_id"]:
                    raise ApiError(404, "资产批次不存在", "allocation_not_found")
                if allocation["status"] != "available":
                    raise ApiError(409, "资产批次当前已冻结或不可用", "allocation_not_available")
                reserved = connection.execute(
                    "SELECT COALESCE(SUM(quantity),0) FROM withdrawal_requests WHERE allocation_id=? AND status IN ('scheduled','processing')",
                    (allocation_id,),
                ).fetchone()[0]
                available = allocation["quantity"] - reserved - float(allocation["swap_reserved"] or 0)
                if available + 1e-9 < quantity:
                    raise ApiError(409, f"可取出余额不足，当前可取出 {max(0, available):g} {allocation['unit']}", "insufficient_withdrawable_balance")
                connection.execute(
                    "INSERT INTO withdrawal_requests(id,owner_user_id,allocation_id,quantity,unit,status,decision,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,'scheduled','scheduled_withdrawal',?,?,?)",
                    (request_id, session["user_id"], allocation_id, quantity, allocation["unit"], idem, created, created),
                )
                audit(connection, session["user_id"], "withdrawal", request_id, "withdrawal.scheduled", {
                    "allocation_id": allocation_id, "quantity": quantity, "unit": allocation["unit"],
                    "history_preserved": True
                }, idem)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            withdrawal = connection.execute("SELECT * FROM withdrawal_requests WHERE id=?", (request_id,)).fetchone()
        self.json_response(201, {"ok": True, "withdrawal": dict(withdrawal)})

    def get_withdrawals(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                "SELECT * FROM withdrawal_requests WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 50",
                (session["user_id"],),
            ).fetchall()
        self.json_response(200, {"ok": True, "withdrawals": [dict(row) for row in rows]})

    def get_assets(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                """SELECT a.*,o.unit_price_cents, COALESCE((SELECT SUM(w.quantity) FROM withdrawal_requests w
                   WHERE w.allocation_id=a.id AND w.status IN ('scheduled','processing')),0) AS withdrawal_reserved
                   FROM allocations a JOIN orders o ON o.id=a.order_id WHERE a.owner_user_id=? ORDER BY a.created_at DESC""",
                (session["user_id"],),
            ).fetchall()
        assets = [{
            "id": row["id"], "order_id": row["order_id"], "gpu": row["gpu"],
            "kind": row["kind"], "product_code": row["product_code"] or row["gpu"], "provider": row["provider"],
            "region": row["region"], "quantity": row["quantity"], "withdrawal_reserved": row["withdrawal_reserved"],
            "swap_reserved": row["swap_reserved"],
            "available_quantity": max(0, row["quantity"] - row["withdrawal_reserved"] - row["swap_reserved"]),
            "unit": row["unit"], "unit_price_cny": row["unit_price_cents"] / 100,
            "estimated_value_cny": round(max(0, row["quantity"] - row["withdrawal_reserved"] - row["swap_reserved"]) * row["unit_price_cents"] / 100, 2),
            "expiry": row["expires_at"][:10], "status": row["status"]
        } for row in rows]
        self.json_response(200, {"ok": True, "assets": assets})

    def get_recent_audit(self) -> None:
        session = self.session()
        with db_connect() as connection:
            rows = connection.execute(
                "SELECT event_id,aggregate_type,aggregate_id,event_type,created_at FROM audit_events WHERE actor_user_id=? OR aggregate_id IN (SELECT id FROM orders WHERE buyer_user_id=?) ORDER BY sequence DESC LIMIT 30",
                (session["user_id"], session["user_id"]),
            ).fetchall()
        self.json_response(200, {"ok": True, "events": [dict(row) for row in rows]})

    def serve_static(self, path: str) -> None:
        relative = "index.html" if path in ("", "/") else unquote(path).lstrip("/")
        candidate = (STATIC_ROOT / relative).resolve()
        if STATIC_ROOT not in candidate.parents and candidate != STATIC_ROOT:
            raise ApiError(403, "路径无效")
        if not candidate.is_file():
            raise ApiError(404, "页面不存在", "not_found")
        body = candidate.read_bytes()
        mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if mime.startswith("text/") or mime in ("application/javascript", "application/json"):
            mime += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if candidate.suffix in (".html", ".js") else "public, max-age=300")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    initialize_database()
    run_maintenance_cycle()
    stop_event = threading.Event()
    worker = threading.Thread(target=maintenance_worker, args=(stop_event,), name="kai-maintenance", daemon=True)
    worker.start()
    server = ThreadingHTTPServer((HOST, PORT), KaiHandler)
    print(f"KAI transaction service listening on http://{HOST}:{PORT} using {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        server.server_close()


if __name__ == "__main__":
    main()
