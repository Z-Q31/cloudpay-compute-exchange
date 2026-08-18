from __future__ import annotations

import json
import os
import posixpath
import re
import shlex
import sys
import time

import paramiko


HOST = "18.163.148.84"
USER = "ubuntu"
APP = "/home/ubuntu/kai-transaction-v1"
SECRETS = "/home/ubuntu/kai-secrets/kai-secrets.env"


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


def replace_env_values(source: str, updates: dict[str, str]) -> str:
    pending = dict(updates)
    lines: list[str] = []
    for line in source.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key = line.split("=", 1)[0].strip()
            if key in pending:
                lines.append(f"{key}={pending.pop(key)}")
                continue
        lines.append(line)
    if pending:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append("# KAI Identity / CloudPay OIDC client")
        lines.extend(f"{key}={value}" for key, value in pending.items())
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    payload = json.load(sys.stdin)
    client_id = str(payload.get("client_id", "")).strip()
    client_secret = str(payload.get("client_secret", "")).strip()
    if not re.fullmatch(r"[A-Za-z0-9._~-]{8,256}", client_id):
        raise ValueError("invalid OAuth client id")
    if not (16 <= len(client_secret) <= 2048) or "\n" in client_secret or "\r" in client_secret:
        raise ValueError("invalid OAuth client secret")

    password = os.environ["KAI_SSH_PASSWORD"]
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = f"/home/ubuntu/deploy-backups/cloudpay-kai-client-{stamp}"
    backup_path = posixpath.join(backup_dir, "kai-secrets.env")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=password, timeout=20, banner_timeout=20)
    ssh.get_transport().set_keepalive(10)
    try:
        run(ssh, f"mkdir -p {shlex.quote(backup_dir)}")
        sftp = ssh.open_sftp()
        try:
            with sftp.open(SECRETS, "r") as source:
                current = source.read().decode("utf-8")
            updated = replace_env_values(
                current,
                {
                    "KAI_IDENTITY_CLIENT_ID": client_id,
                    "KAI_IDENTITY_CLIENT_SECRET": client_secret,
                },
            )
            with sftp.open(backup_path, "w") as target:
                target.write(current)
            with sftp.open(SECRETS, "w") as target:
                target.write(updated)
        finally:
            sftp.close()

        run(ssh, f"chmod 0600 {shlex.quote(SECRETS)} {shlex.quote(backup_path)}")
        try:
            run(ssh, "sudo -S -p '' systemctl restart kai-transaction.service", password)
            ready = False
            readiness: dict[str, object] = {}
            for _ in range(30):
                try:
                    raw = run(ssh, "curl -fsS --max-time 5 http://127.0.0.1:8081/api/config/readiness")
                    readiness = json.loads(raw)
                    identity = readiness.get("identity") or {}
                    if isinstance(identity, dict) and identity.get("configured") is True:
                        ready = True
                        break
                except Exception:
                    time.sleep(1)
            if not ready:
                raise RuntimeError("CloudPay did not become KAI Identity ready")
        except Exception:
            sftp = ssh.open_sftp()
            try:
                with sftp.open(backup_path, "r") as source:
                    previous = source.read().decode("utf-8")
                with sftp.open(SECRETS, "w") as target:
                    target.write(previous)
            finally:
                sftp.close()
            run(ssh, f"chmod 0600 {shlex.quote(SECRETS)}")
            run(ssh, "sudo -S -p '' systemctl restart kai-transaction.service", password)
            raise

        print(
            json.dumps(
                {
                    "deployed": True,
                    "client_id_prefix": client_id[:8] + "…",
                    "backup": backup_dir,
                    "identity_configured": True,
                },
                ensure_ascii=False,
            )
        )
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
