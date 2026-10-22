# Персона 3: смартфон, 46x26, медленный 3G (после исправлений)

Ограничение среды: медленным был только модельный сервер (~2 с латентность, потоковый ответ); остальной трафик без ограничений.

Результат: SUCCESS за 7 действий.

## Путь
1. README: раздел "Get started" (`/login` + ссылка на llama.cpp)
2. docs/llama-cpp.md -> `/login llama.cpp`
3. `akramcode` в ~/my-app
4. `/login llama.cpp`
5. URL `http://127.0.0.1:18082`
6. Enter (пропуск ключа) -> "Connected to llama.cpp. Model: mock-coder-7b."
7. "explain this project" -> ответ без ошибок (03-success)

## Проблемы
1. MINOR, product. Стартовое предупреждение: абсолютный локальный путь к docs рвётся посреди слова. (01-startup-path-wrap)
2. MINOR, product. После Enter в поле API key ~2 с нет индикатора "Connecting…" - непонятно, принят ли ввод.
3. MINOR, product. URL надо набирать целиком (22 символа); по Enter подставляется только порт 8080.
4. MINOR, product. Меню `/` на 46 колонках: описания обрезаны ("Select mod…"), но с многоточием; меню помещается, есть счётчик (1/21). (04-slash-menu-truncated)
5. MINOR, product. Подсказка при выходе `akramcode --session <UUID>` рвётся и не набирается с телефона.
6. MINOR, product. Docs: длинные строки (curl ~85 символов, curl в llama-cpp.md >110), широкая таблица в README, плотный раздел "Classification".

Хорошо: "Working · 1s · ↓ 24 tokens" во время ответа; аккуратный перенос; предупреждение "No models available" исчезает после подключения; `/model` помещается.

Цены/условия/приватность: не найдено.

## Вернулся бы?
Да: 7 действий, на узком экране ничего не ломается.
