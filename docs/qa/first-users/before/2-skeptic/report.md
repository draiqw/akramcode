# Персона 2: скептик (до исправлений)

Результат: SUCCESS. 31 действие: 16 страниц документации + 15 действий в приложении (4 из них на проверку `/settings` и `/usage`).

## Путь
1-16. README.md, LICENSE, packages/coding-agent/README.md, docs/index.md, security.md, quickstart.md, llama-cpp.md, usage.md, environment-variables.md, providers.md, models.md, traces.md, sessions.md, configuration.md, settings.md, cli.md (обновления).
17. `akramcode` в ~/my-app -> "Warning: No models available. Use /login..."; уведомления о телеметрии или трейсах нет (01)
18. `/settings` -> 2 пункта, поиск "tele"/"trace"/"update" пуст (02)
19. `/usage` -> $0.00, "Costs use pay-as-you-go API prices" (03)
20. `/login` -> API key -> llama.cpp -> URL -> пустой ключ -> ошибка "No llama.cpp models are loaded" (04)
21. `/model` -> mock-coder-7b
22. "Explain this project" -> ответ (05-success)
23. После: `/usage` "$0.00+" (06); `/quit` ушёл модели (07); выход через Ctrl+D.

## Проблемы: цены, условия, приватность (только фиксация)
1. MAJOR. Телеметрия включена по умолчанию, не описано, что именно отправляется, куда и каким провайдерам идут "attribution headers" (`docs/settings.md:254`, `docs/environment-variables.md:87`). В README, quickstart и security.md не упоминается. В `/settings` её нет (02).
2. MINOR. `enableAnalytics` (`docs/settings.md:255`): какие данные и кому, что такое "experimental first-run setup" - не объяснено.
3. MAJOR. Трейсы включены по умолчанию и пишутся полностью (`docs/traces.md:51`): полные запросы к модели, тела HTTP, вывод инструментов, до 2048 МБ / 30 дней (`settings.md:243-245`); `traces.md:92`: секреты в нераспознанном формате могут сохраниться. Первый запуск и quickstart об этом молчат.
4. MINOR. Автообновление standalone-бинарника при выходе по умолчанию (`settings.md:252`, `cli.md:284`); в `/settings` не отключается, в README/quickstart не упомянуто. Проверка версии при каждом старте (запрос к api.github.com).
5. MINOR. Нигде не сказано, сколько стоит сам инструмент; бесплатность выводится только из `LICENSE:3-5`.
6. MAJOR. LICENSE (`:7-10`) запрещает copy/modify/merge/publish/distribute, а README (`:46-55`, `:57-68`) и packages/coding-agent/README.md (`:37-57`) предлагают клонировать, собирать из исходников, присылать PR. LICENSE разрешает "official releases from GitHub releases", а README предлагает npm.
7. MINOR. Нет `THIRD_PARTY_NOTICES.md` (ссылки в `README.md:86`, `LICENSE:14`); `packages/coding-agent/README.md` ссылается на корневой `CONTRIBUTING.md`, он лежит в `docs/`.
8. MAJOR. Противоречие про env-ключи: `docs/providers.md:33-35` "Environment variables are ignored", а `docs/models.md:10,21,23`, `llama-cpp.md:58-63`, `models.md:143-147` предлагают переменные окружения.
9. MINOR. `secrets.key` по умолчанию лежит рядом с `auth.json`, хотя `providers.md:42` советует хранить отдельно.
10. MINOR. `/share`: "private gist" (`usage.md:84`, `sessions.md:65`) vs "secret gist" (`slash-commands.md:31`); адрес viewer по умолчанию не указан.
11. MINOR. `docs/models.md:15` - оборванное предложение; адрес удалённого каталога (откуда цены) не указан.
12. MINOR. `/usage` для бесплатной локальной модели: "Total cost: $0.00+" ("+" = цена неизвестна) (06).
13. MINOR. `docs/usage.md:9` обещает стоимость в футере, фактически только "7.0% context ... mock-coder-7b" (05).

## Проблемы: продукт
14. MAJOR. Ложная ошибка после `/login` llama.cpp: "Saved API key for llama.cpp. ... Error: ... No llama.cpp models are loaded" при загруженной модели; "Saved API key" при пустом ключе; дубль строки (04).
15. MINOR. `/quit` уходит модели как промпт, без "unknown command"; опечатка в команде уходит провайдеру (07).
16. MINOR. Три разные инструкции установки: README (curl install.sh), packages/coding-agent/README ("installer" = gh release download), quickstart ("macOS arm64" only); удаление не упоминает `~/.akramcode/bin-release`, `~/.local/bin`.
17. MINOR. `README.md:37` обещает "three patterns" изоляции, перечислены два.
18. MINOR. llama.cpp нет в таблице провайдеров (`providers.md:22-27`, `README.md:7`), хотя он есть в `/login`.
19. MINOR. `/settings` почти пуст (Accent color, Auto-compact), хотя `usage.md:56` обещает "common preferences".
20. MINOR. `/usage`: "Prompt cache: warming streaming: Inactive" - непонятно (03); первое предупреждение ссылается на локальные пути docs (01).

## Проверено по трейсам
Наружу ушёл только запрос версии к api.github.com, остальное - локальный сервер. Телеметрии в этом запуске не видно.

## Вернулся бы?
Скорее да, с оговорками: всё заработало локально, но телеметрия и трейсы по умолчанию без описания, тихое автообновление и противоречия в лицензии/env - без правки settings.json и `AKRAMCODE_OFFLINE=1` на рабочем коде не запустил бы.
