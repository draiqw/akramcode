# Персона 4: тестировщик на прочность (до исправлений)

Результат: SUCCESS. (a) ~77 действий с учётом некорректного ввода (6 страниц docs); (b) минимальный чистый путь 11 действий:
README -> coding-agent README -> docs/llama-cpp.md -> `akramcode` -> `/login` -> "Sign in with an API key" -> llama.cpp -> URL -> пустой ключ -> `/model` + выбор -> промпт.

## Путь
1. README, coding-agent README, docs/index.md, llama-cpp.md (позже models.md, providers.md).
2. `akramcode`; пустой Enter - ничего (ок).
3. Промпт + `Enter Enter` без модели - одна ошибка, без дублей.
4. `/foobar`.
5. `/login` + `Enter Enter` -> список OpenAI / Codex / OpenRouter без llama.cpp; фильтр "llama" -> "No matching providers".
6. `/login llama.cpp`, `/model` - тот же список (персона не уверена, возможно мешал Escape).
7. OpenAI -> OAuth, вставка `abc`, Ctrl+C, Escape.
8. "Sign in with an API key" -> llama.cpp появился.
9. Плохие URL: пустой, `abc`, `ftp://x`, `http://127.0.0.1:1`, `.../v1`, слэш в конце, пробелы, ~1000 символов.
10. Отмена: Escape на поле URL, Ctrl+C после URL.
11. `/model` + `Enter Enter` - без дублей.
12. Промпт `Enter Enter` + второй промпт -> SUCCESS (13-success).

## Проблемы
1. MAJOR, product. Двойной Enter после `/login` молча выбирает "Sign in with an account"; в этой ветке нет llama.cpp, фильтр "No matching providers" - выглядит так, будто провайдер не установлен. Docs не упоминают шаг выбора способа. (03-no-llama-provider, 06-login-skips-provider-list)
2. MAJOR, product. Меню "Select authentication method" не объясняет, что выбор фильтрует провайдеров и что llama.cpp в ветке "API key"; Escape закрывает весь вход. (06)
3. MINOR, product. `/login llama.cpp` возможно игнорирует аргумент (не подтверждено). (04-login-llamacpp-ignored)
4. MINOR, product. `/foobar` уходит как промпт, нет "unknown command"; показывается "No API key found for the selected model". (02-unknown-slash)
5. MINOR, product. Без модели: "No API key found for the selected model" (модель не выбрана); введённый текст теряется. (01-prompt-no-model)
6. MAJOR, product. Ошибки URL без подсказок: пустой -> "Failed to save API key for llama.cpp: fetch failed" (молча подставлен дефолт), `abc` -> "Invalid URL", `127.0.0.1:1` и длинный -> "fetch failed"; нет URL в тексте и совета. `ftp://x` -> понятно. (07-empty-url-fetch-failed, 08-bad-urls, 11-long-url)
7. MAJOR, product. URL с `/v1`: "Saved API key ... Error: ... No llama.cpp models are loaded" при загруженной модели. (09-v1-saved-no-models)
8. MINOR, product. Успех показан как ошибка: "Error: Saved API key for llama.cpp. Use /model to select a loaded llama.cpp model."; модель надо выбирать вручную. (10-success-shown-as-error)
9. MINOR, product. Отмена входа показана как ошибка: "Error: Failed to save API key for llama.cpp: This operation was aborted"; при повторном `/login` URL не подставляется. (12-cancel-shown-as-error)
10. MINOR, product. Ctrl+C не закрывает меню способа входа (Escape закрывает).
11. MINOR, product. OpenAI OAuth + мусор: "Paste the full callback URL from the browser" - понятно. (05-openai-oauth-garbage)

Хорошо: пустой промпт игнорируется; `Enter Enter` в промпте и `/model` без дублей; пробелы и слэш в URL обрабатываются; неудачные входы не ломают рабочее подключение. Отправку во время стриминга проверить не удалось (мок отвечает быстро).

## Вернулся бы?
Да: подключение работает и переживает плохой ввод, но первые минуты ушли на ловушку с двойным Enter и ошибки без подсказок.
