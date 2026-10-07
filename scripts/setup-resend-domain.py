#!/usr/bin/env python3
"""Полная настройка отправки почты с uchlist.ru через Resend.

Что делает:
  1. Регистрирует домен uchlist.ru в Resend (или берёт существующий).
  2. Заливает DNS-записи Resend в зону Cloudflare.
  3. Запускает верификацию домена.

Ключ Resend читается из backend/.resend.key (в gitignore), токен
Cloudflare — из .env. Ничего не выводится в лог кроме имён записей.

Запуск:  python3 scripts/setup-resend-domain.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOMAIN = "uchlist.ru"
ZONE_ID = "aa62863d81292d97326088d831434f9d"
CF_API = "https://api.cloudflare.com/client/v4"
RESEND_API = "https://api.resend.com"

# Резолвер Cloudflare: записи почты НЕ должны быть проксированы.
# Orange cloud ломает верификацию DKIM/SPF — это частая причина, по которой
# домен «не верифицируется» после ручного добавления записей.
CF_RESOLVER = "1.1.1.1"

# Cloudflare (и воркеры за ним) отвечают 403/1010 на запросы без
# браузерного User-Agent. Скрипту нужны реальные HTTP-вызовы к API, поэтому
# подставляем User-Agent браузера, а не urllib по умолчанию.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def read_secret(path, label):
    if not os.path.exists(path):
        sys.exit(f"{label} не найден: {path}")
    with open(path, encoding="utf-8") as fh:
        value = fh.read().strip()
    if not value or value.startswith("re_ЗАМЕНИ"):
        sys.exit(f"{label} выглядит как заглушка — впиши настоящее значение в {path}")
    return value


def read_env_token(path):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("CLOUDFLARE_API_TOKEN="):
                return line.split("=", 1)[1].strip()
    sys.exit("CLOUDFLARE_API_TOKEN не найден в .env")


def request(url, token, method="GET", body=None, extra_headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "application/json")
    for key, value in (extra_headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise SystemExit(f"{exc.code} {exc.reason} на {url}:\n{detail[:900]}") from None


def ensure_resend_domain(resend_token):
    existing = request(
        f"{RESEND_API}/domains", resend_token
    )
    for item in existing.get("data") or []:
        if item.get("name") == DOMAIN:
            print(f"домен {DOMAIN} уже есть в Resend, статус: {item.get('status')}")
            return item

    print(f"создаю домен {DOMAIN} в Resend…")
    created = request(
        f"{RESEND_API}/domains",
        resend_token,
        method="POST",
        body={"name": DOMAIN},
    )
    if created.get("error"):
        sys.exit(f"Resend отклонил: {created['error']}")
    print("домен создан")
    return created


def push_records(resend_token, cf_token, records):
    for rec in records or []:
        name = rec.get("record") or rec.get("name", "?")
        rtype = rec.get("type")
        rvalue = rec.get("value")
        rname = rec.get("name", "").rstrip(".")
        priority = rec.get("priority")

        # Уже есть в Cloudflare? Тогда сверяем значение и пропускаем.
        query = (f"{CF_API}/zones/{ZONE_ID}/dns_records"
                 f"?type={rtype}&name={rname}")
        found = request(query, cf_token).get("result") or []
        if found:
            same = any(x.get("content", "").rstrip(".") == rvalue.rstrip(".") for x in found)
            print(f"  = {rtype} {rname}: уже есть"
                  f"{'' if same else ' (значение отличается — обновлю)'}")
            if same:
                continue
            for old in found:
                request(f"{CF_API}/zones/{ZONE_ID}/dns_records/{old['id']}",
                        cf_token, method="PUT",
                        body={"type": rtype, "name": rname, "content": rvalue,
                              "ttl": 1, "proxied": False,
                              **({"priority": priority} if priority else {})})
            print(f"    обновлено → {rtype} {rname}")
            continue

        body = {"type": rtype, "name": rname, "content": rvalue,
                "ttl": 1, "proxied": False}
        if priority:
            body["priority"] = priority
        request(f"{CF_API}/zones/{ZONE_ID}/dns_records", cf_token,
                method="POST", body=body)
        print(f"  + {rtype} {rname} добавлен в Cloudflare (proxied=false)")


def verify(resend_token, domain_id):
    request(f"{RESEND_API}/domains/{domain_id}/verify", resend_token, method="POST")
    print("верификация запущена")


def main():
    resend_token = read_secret(os.path.join(ROOT, "backend", ".resend.key"),
                              "ключ Resend")
    cf_token = read_env_token(os.path.join(ROOT, ".env"))

    domain = ensure_resend_domain(resend_token)
    domain_id = domain.get("id")
    records = domain.get("records") or domain.get("dns_records") or []
    if not records and domain_id:
        fresh = request(f"{RESEND_API}/domains/{domain_id}", resend_token)
        records = fresh.get("records") or []

    if records:
        print(f"DNS-записей от Resend: {len(records)}")
        push_records(resend_token, cf_token, records)
    else:
        print("Resend не вернул DNS-записей — загляни в дашборд вручную")

    if domain_id:
        verify(resend_token, domain_id)

    print("\nГотово. Дай записям распространиться (обычно 15 мин, максимум 72 ч),")
    print("потом проверь: python3 scripts/check-resend-domain.py")


if __name__ == "__main__":
    main()