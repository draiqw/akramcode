# Персона 3: смартфон, 46x26, медленный 3G (до исправлений)

Ограничение среды: медленным был только модельный сервер (~2 с латентность, медленный стриминг). Остальной трафик (проверка версии, каталог) не замедлялся: без sudo это невозможно.

Результат: SUCCESS. 11 действий: 6 страниц docs + 5 в терминале. Ответ пришёл примерно за 10 с.

## Путь
1. README.md: про локальную модель ничего, curl-строка ~85 символов.
2. packages/coding-agent/README.md: другой способ установки, `gh release download` назван "installer".
3. docs/index.md
4. docs/quickstart.md: третий вариант установки, широкая таблица.
5. docs/models.md -> ссылка на llama.cpp
6. docs/llama-cpp.md -> `/login llama.cpp`
7. `akramcode` -> "No models available"
8. `/login llama.cpp`, URL `http://127.0.0.1:18082`
9. Пустой API key -> ошибка "No llama.cpp models are loaded" (02)
10. `/model` -> mock-coder-7b
11. "explain this project" -> ответ (04-success)

## Проблемы
1. MAJOR, product. Ложная ошибка после login: "Saved API key for llama.cpp. ... Error: ... No llama.cpp models are loaded" при пустом ключе и загруженной модели. (02-login-no-models-loaded)
2. MINOR, product. На старте длинные локальные пути к docs разорваны посреди слова; путь к auth.json тоже; 10+ строк висят над чатом всю сессию. (01-start-no-models, 02)
3. MINOR, product. Меню `/`: описания обрезаны без многоточия ("Share session as a se"); видно 5 пунктов из 20. (05-slash-menu-truncated)
4. MAJOR, product. `/quit` ушёл модели как промпт (лишний запрос на медленной сети); выход только Ctrl+D / двойной Ctrl+C, в slash-commands.md и usage.md про выход ничего. (07-quit-sent-as-prompt)
5. MINOR, product. Подсказка при выходе: "akramcode --session <UUID>" - на телефоне не набрать; quickstart говорит `akramcode --resume`.
6. MINOR, product. Три разных способа установки (README / coding-agent README / quickstart).
7. MINOR, product. Локальная модель спрятана: 4 перехода в docs; в `/login` llama.cpp под "Sign in with an API key", хотя ключ не нужен. (06-login-provider-list)
8. MINOR, product. Широкие таблицы и длинные абзацы в docs.
9. MINOR, product. Поле URL: placeholder `http://127.0.0.1:8080`, но значение надо набирать целиком.

Хорошо: во время медленного ответа видно "Working · 3s · ↓ 9 tokens", стриминг постепенный; ответ и футер вписываются в 46 колонок.

Цены/условия/приватность: не проверялись этой персоной.

## Вернулся бы?
Да: после подключения работает и читается на узком экране, но ложная ошибка и `/quit` в модель раздражают.
