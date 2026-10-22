# Персона 1: нетерпеливый пользователь (до исправлений)

Результат: SUCCESS достигнут за 12 действий, но после точки, где персона закрыла бы вкладку (шаг 4).

## Путь
1. README.md, первый экран: curl-установка и таблица пакетов, нет "как запустить / подключить модель".
2. `akramcode` -> "Warning: No models available. Use /login..."
3. `/login`
4. Первый пункт "Sign in with an account" -> только OpenAI, OpenAI Codex, OpenRouter, локального варианта нет. ЗАКРЫЛ БЫ ЗДЕСЬ. (01-login-no-local)
5. Escape (доп. попытка 1)
6. "Sign in with an API key" -> есть llama.cpp
7. Выбор llama.cpp
8. URL `http://127.0.0.1:18081`
9. Ключ пустой, Enter -> "Error: ... No llama.cpp models are loaded." (02-no-models-loaded)
10. `/model` по подсказке (доп. попытка 2) -> `mock-coder-7b [llama.cpp]`
11. Выбор модели
12. "explain this project" -> ответ агента без ошибки: SUCCESS (03-success)

## Проблемы
1. BLOCKER, product. Локальная модель доступна только через "Sign in with an API key", хотя llama.cpp ключ не нужен. Первый очевидный пункт ведёт только в OpenAI/Codex/OpenRouter. (01-login-no-local.png)
2. MAJOR, product. После ввода URL: "Error: Saved API key for llama.cpp. No llama.cpp models are loaded. Load one on the router, then select it with /model." Сервер отдаёт `mock-coder-7b` со статусом `loaded`, и `/model` сразу её показывает. (02-no-models-loaded.png)
3. MINOR, product. "Saved API key for llama.cpp. Credentials saved to .../auth.json" при пустом ключе; текст дублируется (и внутри Error). (02-no-models-loaded.png)
4. MINOR, product. После выбора модели над чатом остаются старые "Warning: No models available" и "Error ... no models loaded". (03-success.png)
5. MINOR, product. На первом экране README нет быстрого старта.
6. MINOR, product. `/quit` ушёл модели как обычный промпт (ответ `Done. I looked at your request: "/quit".`). Двойной Ctrl+C с интервалом ~0.5 с не вышел, ~0.3 с вышел. (04-quit-sent-as-prompt.png)

Проблем с ценами/условиями/приватностью не зафиксировано (персона туда не доходила).

## Вернулся бы?
Нет: первый очевидный путь не ведёт к локальной модели, а правильный сразу показывает ошибку, хотя всё работает.
