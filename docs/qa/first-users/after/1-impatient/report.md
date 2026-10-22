# Персона 1: нетерпеливый пользователь (после исправлений)

Результат: SUCCESS за 10 действий (2 из них - тупиковая ветка). Закрыл бы вкладку на шаге 4.

## Путь
1. README.md, первый экран: "Get started" (`cd your-project` / `akramcode`) + подсказка про `/login` и llama.cpp.
2. `akramcode` -> "Warning: No models available. Use /login to connect a subscription, an API key, or a local model."
3. `/login` -> "Sign in with an account" / "Use an API key or local model"
4. Первый пункт -> OpenAI, OpenAI Codex, OpenRouter, локальной модели нет. ЗАКРЫЛ БЫ ЗДЕСЬ. (01-signin-no-local)
5. Escape -> корректный возврат в меню способов входа.
6. "Use an API key or local model" -> DeepSeek, llama.cpp, OpenAI, OpenRouter
7. llama.cpp
8. URL `http://127.0.0.1:18081` (поле предлагает `http://127.0.0.1:8080` по Enter)
9. "API key (optional, Enter to skip)" -> Enter -> "Connected to llama.cpp. Model: mock-coder-7b." (модель выбрана сама)
10. "explain this project" -> ответ без ошибок (02-success)

## Проблемы
1. MAJOR, product. Первый пункт `/login` ("Sign in with an account") ведёт в список без локальной модели; по названию не видно, что она во втором пункте. (01-signin-no-local)
2. MINOR, product. Стартовое предупреждение ссылается на абсолютный путь docs из исходников (`/Users/draiqws/akramcode/packages/coding-agent/docs/models.md`). Примечание координатора: в тесте запуск идёт из исходников; у релизного бинарника путь указывает на его собственную папку docs.

Установка не запутала: одна команда `curl ... | sh`.

## Вернулся бы?
Да: если пропустить неудачный первый пункт, путь короткий - URL, Enter, задача, ответ.
