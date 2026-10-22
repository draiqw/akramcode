# Персона 2: скептик (после исправлений)

Результат: SUCCESS. 28 действий: 17 страниц docs, 4 на `/settings` и `/usage` до входа; сам путь ~10 действий, подключение - 5 действий без ошибок.

## Путь
1-17. README.md, LICENSE, packages/coding-agent/README.md, docs/index.md, security.md, environment-variables.md, settings.md ("Updates and telemetry"), usage.md, slash-commands.md, traces.md, sessions.md, providers.md, models.md, containerization.md, quickstart.md, llama-cpp.md, cli.md.
18. `akramcode` -> "Warning: No models available. Use /login ..."
19-21. `/settings`, поиск "tele"/"update" -> "No matching settings", Esc
22. `/usage` -> $0.00
23-27. `/login` -> "Use an API key or local model" -> llama.cpp -> URL -> Enter -> "Connected to llama.cpp. Model: mock-coder-7b."
28. "Explain this project" -> ответ (02-success)
После: `/usage` (03), выход через `/quit`.

## Проблемы: цены, условия, приватность (только фиксация)
1. MAJOR. Телеметрия по умолчанию (`settings.md:254`): не описаны поля, адрес, "provider attribution headers"; нет страницы о приватности; нет в README/quickstart/security.md.
2. MINOR. `--offline` (`cli.md:241`, `environment-variables.md:84`): не сказано, отключает ли телеметрию и автообновление; нет рецепта "ничего не уходит с машины".
3. MINOR. Удалённый каталог (`models.md:15`): адрес/частота/что отправляется не указаны; оборванное предложение.
4. MINOR. Автообновление по умолчанию ставит бинарник при выходе (`cli.md:284`); нет в README/quickstart.
5. MAJOR. `/share`: "private gist" (`usage.md:84`, `sessions.md:65`) vs "secret gist" (`slash-commands.md:32`); адрес viewer по умолчанию не назван.
6. MAJOR. `providers.md:36` "env-ключи не читаются" vs `containerization.md:60-66` (`docker run -e OPENROUTER_API_KEY`).
7. MAJOR. Нет прямого слова о цене инструмента; цен моделей в docs нет.
8. MAJOR. LICENSE запрещает copy/modify, а README описывают clone/сборку/PR; `"license": "UNLICENSED"` в package.json.
9. MINOR. Нет `THIRD_PARTY_NOTICES.md` (ссылки в README.md, packages/coding-agent/README.md, LICENSE).
10. MINOR. Трейсы с полными запросами по умолчанию (`traces.md:51,93`); security.md и quickstart не упоминают.
11. MINOR. `usage.md:9` vs `usage.md:25` и футер: стоимости в футере нет.
12. MAJOR. В `/settings` нет приватности/обновлений; при первом запуске нет уведомления о телеметрии. (01-settings-no-telemetry)
13. MINOR. `/usage` для локальной модели "$0.00+" ("без известной цены"). (03-usage-local-unknown-price)

## Проблемы: продукт
14. MINOR. В списке провайдеров `/login` не отличить локальный llama.cpp от облачных.

Понравилось: честное описание шифрования auth.json (`providers.md:38-46`), `/bug` ничего не загружает (`sessions.md:73`), подробный traces.md, пояснение цен в `/usage`.

## Вернулся бы?
Скорее нет, пока не исправят docs: подключение быстрое и без ошибок, но телеметрия по умолчанию без описания и без выключателя в приложении, противоречия в лицензии и `/share`.
