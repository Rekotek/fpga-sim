# FPGA SIM

[English version](README.md)

Веб-симулятор проектов на Verilog для плат Sipeed Tang Nano 20K и Tang Nano 9K. Сборка идёт на сервере
(Verilator → WebAssembly), счёт — в браузере.

- Техническое задание: `docs/tz-v1.md`. Видение и архитектура: `docs/vision.md`.
- Где работа сейчас: первый раздел `docs/progress.md`. Принятые решения: `docs/decisions.md`.
- Правила для агентов: `CLAUDE.md`.

## Папки

| Папка | Что в ней |
|---|---|
| `spec/` | Схемы форматов (проект, плата, деталь, протокол), образцы в `spec/tests/` |
| `boards/`, `parts/` | Файлы плат и описания деталей |
| `core/` | Среда исполнения и детали, C++20 |
| `server/` | Сервер сборки, Python 3.12, и образ сборки |
| `web/` | Интерфейс: TypeScript, React, Tailwind, компоненты shadcn |
| `examples/` | Примеры проектов с ожиданиями `expect.json` |
| `tools/` | Замер (`bench/`), проверка форматов (`spec/`), примеры в обычной сборке (`native/`) и в Node (`headless/`), локальный сервер (`dev/`) |
| `deploy/` | Выкладка сервера сборки на VPS; порядок — `docs/deploy-server.md` |

## Проверка

`make check` — стиль, форматы и все тесты. По частям: `make test-core` (ядро), `make test-server`
(сервер сборки), `make test-examples` (примеры через локальный сервер, ядро в Node), `make test-web`
(интерфейс), `make e2e` (сквозные тесты в Chromium на локальном стенде). `make dev` — сервер сборки
на `localhost:8080` и интерфейс на `localhost:5173`; ключ разработки лежит в `.fpgasim/dev/key`.
Нужны Node, `uv` и Docker; Verilator и Emscripten на машину
не ставятся, они есть в образах (`make image`).

Приложение открыто по адресу `https://fpga-sim.scriptorium.cc` (статика, выкладка — `make deploy-web`,
порядок — `docs/deploy-web.md`). Сервер сборки работает на `https://fpga-build.scriptorium.cc`
(выкладка — `make deploy-server`, порядок — `docs/deploy-server.md`). Приёмочные тесты против
рабочих адресов — `make e2e-prod`. Итог версии 1 — `docs/v1-report.md`.

## Лицензия

MIT, см. `LICENSE`. Уроки курса в `examples/lessons/` — того же автора, под той же лицензией.
