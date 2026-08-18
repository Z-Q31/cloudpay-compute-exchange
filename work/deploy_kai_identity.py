from __future__ import annotations

import hashlib
import json
import os
import posixpath
import shlex
import time
from pathlib import Path

import paramiko


HOST = "18.163.148.84"
USER = "ubuntu"
APP = "/home/ubuntu/kai-transaction-v1"
ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "server.py": ROOT / "server.py",
    "outputs/index.html": ROOT / "outputs" / "index.html",
    "outputs/production.js": ROOT / "outputs" / "production.js",
    "outputs/identity-auth.css": ROOT / "outputs" / "identity-auth.css",
    "outputs/native-bridge.js": ROOT / "outputs" / "native-bridge.js",
}
ENV_UPDATES = {
    "KAI_AUTH_PROVIDER": "kai_identity",
    "KAI_PUBLIC_BASE_URL": "https://cloudpay.kai.com",
    "KAI_COOKIE_SECURE": "true",
    "KAI_IDENTITY_ISSUER": "https://auth.kai.com/api/auth",
    "KAI_IDENTITY_REDIRECT_URI": "https://cloudpay.kai.com/api/auth/kai/callback",
    "KAI_IDENTITY_MOBILE_REDIRECT_URI": "https://cloudpay.kai.com/api/auth/kai/mobile/callback",
    "KAI_MOBILE_APP_CALLBACK_URI": "cloudpay://auth/callback",
    "KAI_IDENTITY_AUTHORIZATION_ENDPOINT": "https://auth.kai.com/api/auth/oauth2/authorize",
    "KAI_IDENTITY_TOKEN_ENDPOINT": "https://auth.kai.com/api/auth/oauth2/token",
    "KAI_IDENTITY_USERINFO_ENDPOINT": "https://auth.kai.com/api/auth/oauth2/userinfo",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(client: paramiko.SSHClient, command: str, password: str | None = None) -> str:
    stdin, stdout, stderr = client.exec_command(command)
    if password is not None:
        stdin.write(password + "\n")
        stdin.flush()
    status = stdout.channel.recv_exit_status()
    output = stdout.read().decode("utf-8", "replace")
    error = stderr.read().decode("utf-8", "replace")
    if status:
        raise RuntimeError(error.strip() or output.strip() or f"remote command failed ({status})")
    return output.strip()


def updated_env(current: str) -> str:
    remaining = dict(ENV_UPDATES)
    lines: list[str] = []
    for line in current.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key = line.split("=", 1)[0].strip()
            if key in remaining:
                lines.append(f"{key}={remaining.pop(key)}")
                continue
        lines.append(line)
    if remaining:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append("# KAI Identity / CloudPay OIDC")
        lines.extend(f"{key}={value}" for key, value in remaining.items())
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    password = os.environ["KAI_SSH_PASSWORD"]
    stamp = time.strftime("%Y%m%d-%H%M%S")
    incoming = posixpath.join(APP, f".incoming-kai-identity-{stamp}")
    backup = f"/home/ubuntu/deploy-backups/cloudpay-kai-identity-{stamp}"
    env_path = posixpath.join(APP, ".env")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20, banner_timeout=20)
    client.get_transport().set_keepalive(10)
    existed: dict[str, bool] = {}
    deployed = False
    try:
        run(client, f"mkdir -p {shlex.quote(incoming + '/outputs')} {shlex.quote(backup + '/outputs')}")
        sftp = client.open_sftp()
        try:
            for relative, local in FILES.items():
                remote = posixpath.join(incoming, relative)
                sftp.put(str(local), remote)
                if run(client, f"sha256sum {shlex.quote(remote)}").split()[0] != digest(local):
                    raise RuntimeError(f"upload checksum mismatch: {relative}")
            with sftp.open(env_path, "r") as source:
                current_env = source.read().decode("utf-8")
            with sftp.open(posixpath.join(incoming, ".env"), "w") as target:
                target.write(updated_env(current_env))
        finally:
            sftp.close()

        run(client, f"/home/ubuntu/kai-transaction-v1/.venv/bin/python -m py_compile {shlex.quote(posixpath.join(incoming, 'server.py'))}")
        for relative in FILES:
            live = posixpath.join(APP, relative)
            saved = posixpath.join(backup, relative)
            existed[relative] = run(client, f"test -f {shlex.quote(live)} && echo yes || echo no") == "yes"
            if existed[relative]:
                run(client, f"cp -p {shlex.quote(live)} {shlex.quote(saved)}")
        run(client, f"cp -p {shlex.quote(env_path)} {shlex.quote(posixpath.join(backup, '.env'))}")

        db_path = "/home/ubuntu/kai-transaction-v1/data/kai.db"
        for line in current_env.splitlines():
            if line.startswith("KAI_DB_PATH=") and line.split("=", 1)[1].strip():
                db_path = line.split("=", 1)[1].strip()
                break
        db_backup = posixpath.join(backup, "kai.db")
        backup_code = "import sqlite3,sys;src=sqlite3.connect(sys.argv[1]);dst=sqlite3.connect(sys.argv[2]);src.backup(dst);dst.close();src.close()"
        run(client, f"/home/ubuntu/kai-transaction-v1/.venv/bin/python -c {shlex.quote(backup_code)} {shlex.quote(db_path)} {shlex.quote(db_backup)}")

        for relative in FILES:
            source = posixpath.join(incoming, relative)
            live = posixpath.join(APP, relative)
            run(client, f"mv {shlex.quote(source)} {shlex.quote(live)} && chmod 0644 {shlex.quote(live)}")
        run(client, f"mv {shlex.quote(posixpath.join(incoming, '.env'))} {shlex.quote(env_path)} && chmod 0600 {shlex.quote(env_path)}")
        deployed = True
        run(client, "sudo -S -p '' systemctl restart kai-transaction.service", password)
        run(client, "sudo -S -p '' docker exec kai-transaction-edge nginx -t", password)

        ready = False
        for _ in range(30):
            try:
                health = json.loads(run(client, "curl -fsS --max-time 5 http://127.0.0.1:18081/api/health"))
                readiness = json.loads(run(client, "curl -fsS --max-time 5 http://127.0.0.1:8081/api/config/readiness"))
                if health.get("auth_provider") == "kai_identity" and readiness.get("auth_provider") == "kai_identity":
                    ready = True
                    break
            except Exception:
                time.sleep(1)
        if not ready:
            raise RuntimeError("production KAI Identity readiness check failed")
        html = run(client, "curl -fsS --max-time 10 http://127.0.0.1:8081/")
        css = run(client, "curl -fsS --max-time 10 http://127.0.0.1:8081/identity-auth.css")
        javascript = run(client, "curl -fsS --max-time 10 http://127.0.0.1:8081/production.js")
        native_bridge = run(client, "curl -fsS --max-time 10 http://127.0.0.1:8081/native-bridge.js")
        if (
            "identity-auth.css" not in html
            or "identity-auth-block" not in css
            or "kaiIdentityLogin" not in javascript
            or "/api/auth/kai/mobile/start" not in native_bridge
            or readiness.get("identity", {}).get("mobile_start_url") != "/api/auth/kai/mobile/start?return_to=/"
        ):
            raise RuntimeError("production KAI Identity static verification failed")
        print(json.dumps({
            "deployed": True,
            "backup": backup,
            "database_backup": db_backup,
            "identity_configured": readiness["identity"]["configured"],
            "identity_missing": readiness["identity"]["missing"],
        }, ensure_ascii=False))
    except Exception:
        if deployed:
            for relative in FILES:
                live = posixpath.join(APP, relative)
                saved = posixpath.join(backup, relative)
                try:
                    if existed.get(relative):
                        run(client, f"cp -p {shlex.quote(saved)} {shlex.quote(live)}")
                    else:
                        run(client, f"rm -f -- {shlex.quote(live)}")
                except Exception:
                    pass
            try:
                run(client, f"cp -p {shlex.quote(posixpath.join(backup, '.env'))} {shlex.quote(env_path)}")
                run(client, "sudo -S -p '' systemctl restart kai-transaction.service", password)
            except Exception:
                pass
        raise
    finally:
        try:
            run(client, f"rmdir {shlex.quote(incoming + '/outputs')} {shlex.quote(incoming)} 2>/dev/null || true")
        except Exception:
            pass
        client.close()


if __name__ == "__main__":
    main()
