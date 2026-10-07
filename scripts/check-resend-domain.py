#!/usr/bin/env python3
"""Проверка готовности отправки почты с uchlist.ru.

Показывает: статус домена в Resend, какие DNS-записи есть в Cloudflare и
совпадают ли они с ожидаемыми, и — главное — проходит ли живой запрос на
magic-link (то есть реально ли уходит письмо).

Запуск:  python3 scripts/check-resend-domain.py
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOMAIN = "uchlist.ru"
ZONE_ID = "aa62863d81292d97326088d831434f9d"
CF_API = "https://api.cloudflare.com/client/v4"
RESEND_API = "https://api.resend.com"
API = "https://rabochielisty-api.ivanlusnikov159.workers.dev"


def read_secret(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read().strip()


def request(url, token, method="GET", body=None, extra=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    for key, value in (extra or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        return {"_error": f"{exc.code} {exc.reason}: {detail[:300]}"}


def dig(name, rtype):
    try:
        out = subprocess.run(
            ["dig", "@1.1.1.1", "+short", rtype, name],
            capture_output=True, text=True, timeout=20,
        ).stdout.strip()
        return [line for line in out.splitlines() if line]
    except Exception as exc:  # noqa: BLE001 - диагностический скрипт
        return [f"<{exc}>"]


def main():
    try:
        resend_token = read_secret(os.path.join(ROOT, "backend", ".resend.key"))
    except OSError:
        resend_token = ""
    cf_token = ""
    with open(os.path.join(ROOT, ".env"), encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("CLOUDFLARE_API_TOKEN="):
                cf_token = line.split("=", 1)[1].strip()

    print("=" * 58)
    print("ПОЧТА uchlist.ru — состояние")
    print("=" * 58)

    if resend_token and not resend_token.startswith("re_ЗАМЕНИ"):
        domains = request(f"{RESEND_API}/domains", resend_token)
        found = None
        for item in domains.get("data") or []:
            if item.get("name") == DOMAIN:
                found = item
        if found:
            print(f"\nResend: домен {DOMAIN} — статус {found.get('status')}")
            for rec in found.get("records") or []:
                state = rec.get("status", "?")
                mark = "OK " if state == "verified" else ".. "
                print(f"  {mark}{rec.get('record', rec.get('name')):<10} "
                      f"{rec.get('type'):<6} {state}")
        else:
            print(f"\nResend: домена {DOMAIN} нет — запусти scripts/setup-resend-domain.py")
    else:
        print("\nResend: ключ не задан (backend/.resend.key)")

    print("\nDNS (публичный резолвер 1.1.1.1):")
    for rtype, label in (("MX", "MX (возврат писем)"), ("TXT", "TXT (SPF/DKIM)")):
        values = dig(DOMAIN, rtype)
        if values:
            print(f"  {label}:")
            for value in values:
                print(f"    - {value[:80]}")
        else:
            print(f"  {label}: ПУСТО")

    for sub in ("dkim.resend", "send"):
        cname = dig(f"{sub}.{DOMAIN}", "CNAME")
        if cname:
            print(f"  CNAME {sub}: {cname[0][:70]}")

    print("\nЖивая проверка отправки (POST /api/auth/magic-link):")
    req = urllib.request.Request(
        f"{API}/api/auth/magic-link",
        data=json.dumps({"email": "ivanlusnikov@yandex.ru"}).encode(),
        method="POST",
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Origin", f"https://{DOMAIN}")
    # Cloudflare отдаёт 403/1010 на запросы без браузерного User-Agent —
    # это защита воркера, а не ответ почтового сервиса. Без заголовка
    # проверка врёт: отказ выглядит как «письмо не уходит».
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                                 "AppleWebKit/537.36 (KHTML, like Gecko) "
                                 "Chrome/131.0.0.0 Safari/537.36")
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            body = json.loads(resp.read())
            print(f"  {resp.status} {body}")
            print("  => письмо уходит, вход в кабинет работает.")
    except urllib.error.HTTPError as exc:
        print(f"  {exc.code} {exc.read().decode('utf-8', 'replace')[:160]}")
        print("  => письмо НЕ уходит. Проверь верификацию домена в Resend.")
    except Exception as exc:  # noqa: BLE001
        print(f"  <{exc}>")


if __name__ == "__main__":
    main()