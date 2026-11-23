"""The fpgasim-admin utility (spec section 8.6, accounts spec section 3.8 (docs/tz-accounts.md)).

    fpgasim-admin key add <name>        creates a key and prints it once
    fpgasim-admin key disable <name>    disables a key
    fpgasim-admin key list              owners and key states

    fpgasim-admin user add <login> [--name <name>] [--admin]   creates an account and prints the password once
    fpgasim-admin user passwd <login>                          new password; the account's sessions are deleted
    fpgasim-admin user disable <login>                         disables the account; sessions are deleted
    fpgasim-admin user enable <login>
    fpgasim-admin user list                                    login, role, state, last login

    fpgasim-admin db restore <backup file>   replaces the database with the backup and writes a new generation

    fpgasim-admin assistant key                reads the Anthropic key from standard input into the key file
    fpgasim-admin assistant usage [--days N]  assistant tokens and approximate cost per UTC day and owner
                                              (decision 175); N days including today, 7 by default

The key file: variable FPGASIM_KEYS, by default /etc/fpgasim/keys.toml.
The account database: variable FPGASIM_ACCOUNTS, setting server.accounts_db,
by default /var/lib/fpgasim/accounts/accounts.db. The utility writes to the same database as the service.
The assistant counts: <data folder>/assistant/usage.db (variable FPGASIM_DATA_DIR, setting server.data_dir).
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from .accounts import AccountsError, AccountStore, SchemaTooNew, hash_password, new_password, restore
from .config import accounts_db_path, assistant_key_path, data_dir_path
from .keys import NAME_RE, KeyRecord, hash_key, new_key, read_keys, write_keys
from .usage import Usage, UsageStore, cost


def keys_command(args: argparse.Namespace) -> int:
    keys = read_keys(args.keys)
    if args.cmd == "list":
        for owner in sorted(keys):
            print(f"{owner}\t{'включён' if keys[owner].enabled else 'отключён'}")
        return 0
    if not NAME_RE.fullmatch(args.name):
        print("имя владельца: латиница, цифры, _ и -, не длиннее 64 знаков", file=sys.stderr)
        return 1
    if args.cmd == "add":
        if args.name in keys:
            print(f"ключ для {args.name} уже есть; отключите его и выпустите ключ с другим именем", file=sys.stderr)
            return 1
        value = new_key()
        keys[args.name] = KeyRecord(args.name, hash_key(value), True)
        write_keys(args.keys, keys)
        print(value)
        return 0
    if args.name not in keys:
        print(f"ключа для {args.name} нет", file=sys.stderr)
        return 1
    keys[args.name] = replace(keys[args.name], enabled=False)
    write_keys(args.keys, keys)
    print(f"ключ {args.name} отключён")
    return 0


def when(ms: int | None) -> str:
    return datetime.fromtimestamp(ms / 1000, UTC).strftime("%Y-%m-%d %H:%M UTC") if ms else "—"


def user_command(args: argparse.Namespace) -> int:
    store = AccountStore(args.db)
    if args.cmd == "list":
        for user in store.users():
            state = "включена" if user["enabled"] else "отключена"
            print(f"{user['login']}\t{user['role']}\t{state}\t{when(user['lastLogin'])}")
        return 0
    login = args.login.strip().lower()
    if args.cmd == "add":
        password = new_password()
        store.add_user(login, args.name or login, "admin" if args.admin else "user", hash_password(password))
        print(password)
        return 0
    if args.cmd == "passwd":
        password = new_password()
        store.set_password(login, hash_password(password))
        print(password)
        return 0
    # The utility is the administrator's fallback: the bans of section 3.4 on the last administrator
    # apply here too; there is no ban on "own account" (actor=None).
    user = store.update_user(None, login, {"enabled": args.cmd == "enable"})
    print(f"запись {user['login']} {'включена' if user['enabled'] else 'отключена'}")
    return 0


def db_command(args: argparse.Namespace) -> int:
    kept = restore(args.db, args.file)
    if kept is not None:
        print(f"прежняя база сохранена: {kept}")
    print(f"база {args.db} заменена копией {args.file}; поколение новое")
    return 0


def money(value: float | None) -> str:
    return "—" if value is None else f"${value:.4f}"


def assistant_key() -> int:
    """The key goes through standard input, never through the command line or the screen (decision 175)."""
    key = sys.stdin.read().strip()
    if not key.startswith("sk-ant-") or any(c.isspace() for c in key):
        print("на входе не ключ Anthropic (ожидается одна строка, начинается с sk-ant-)", file=sys.stderr)
        return 1
    path = assistant_key_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(key + "\n")
    os.chmod(temp, 0o600)
    os.replace(temp, path)
    print(f"ключ записан в {path}; перезапустите сервис, чтобы он его прочитал")
    return 0


def assistant_command(args: argparse.Namespace) -> int:
    """Spend report: one line per day, owner and model, then the day's total (decision 175)."""
    if args.cmd == "key":
        return assistant_key()
    path = data_dir_path() / "assistant" / "usage.db"
    if not path.exists():
        print(f"учёта помощника нет: {path}", file=sys.stderr)
        return 1
    store = UsageStore(path, lambda: int(datetime.now(UTC).timestamp() * 1000))
    rows = store.report(args.days)
    for day in sorted({r["day"] for r in rows}):
        total = [0, 0, 0, 0]
        spent = 0.0
        unpriced: set[str] = set()
        for r in (r for r in rows if r["day"] == day):
            usage = Usage(r["input"], r["output"], r["cacheRead"], r["cacheWrite"])
            total = [a + b for a, b in zip(total, usage, strict=True)]
            price = cost(r["model"], usage)
            spent += price or 0.0
            if price is None:
                unpriced.add(r["model"])
            print("\t".join([day, r["owner"], r["model"], *map(str, usage), money(price)]))
        # A model without a price is not in the sum: the total says so instead of looking complete.
        note = f" + без цены: {', '.join(sorted(unpriced))}" if unpriced else ""
        print("\t".join([day, "итого", "", *map(str, total), money(spent) + note]))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="fpgasim-admin")
    ap.add_argument("--keys", type=Path, default=Path(os.environ.get("FPGASIM_KEYS", "/etc/fpgasim/keys.toml")))
    ap.add_argument("--db", type=Path, default=None, help="база учётных записей")
    sub = ap.add_subparsers(dest="group", required=True)
    key = sub.add_parser("key").add_subparsers(dest="cmd", required=True)
    key.add_parser("add").add_argument("name")
    key.add_parser("disable").add_argument("name")
    key.add_parser("list")
    user = sub.add_parser("user").add_subparsers(dest="cmd", required=True)
    add = user.add_parser("add")
    add.add_argument("login")
    add.add_argument("--name")
    add.add_argument("--admin", action="store_true")
    for cmd in ("passwd", "disable", "enable"):
        user.add_parser(cmd).add_argument("login")
    user.add_parser("list")
    db = sub.add_parser("db").add_subparsers(dest="cmd", required=True)
    db.add_parser("restore").add_argument("file", type=Path)
    assistant = sub.add_parser("assistant").add_subparsers(dest="cmd", required=True)
    assistant.add_parser("usage").add_argument("--days", type=int, default=7)
    assistant.add_parser("key")
    args = ap.parse_args(argv)
    if args.db is None:
        args.db = accounts_db_path()

    try:
        if args.group == "key":
            return keys_command(args)
        if args.group == "user":
            return user_command(args)
        if args.group == "assistant":
            return assistant_command(args)
        return db_command(args)
    except AccountsError as e:
        print(e.text, file=sys.stderr)
        return 1
    except SchemaTooNew as e:
        print(e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
