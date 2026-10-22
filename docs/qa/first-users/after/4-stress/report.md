# Персона 4: тестировщик на прочность (после исправлений)

Результат: SUCCESS. (a) 54 действия с учётом некорректного ввода; (b) минимальный чистый путь 9 действий (7 без docs):
README -> quickstart -> `akramcode` -> `/login` -> "Use an API key or local model" -> llama.cpp -> URL -> Enter -> промпт.

## Путь (главное)
- `/foobar` -> "Warning: Unknown command /foobar. Type / to see commands." Текст остаётся в поле.
- Промпт без модели -> "Error: No model selected. Use /login ... Then use /model to select a model." Промпт не теряется.
- `/login` + двойной Enter -> провалился в "Enter DeepSeek API key" (01); Escape вернул к списку.
- Пустой URL -> после шага ключа: "Could not reach a llama.cpp router at http://127.0.0.1:8080 (fetch failed). Check that llama-server is running in router mode." (02)
- `abc` -> "Invalid server URL "abc". Example: http://127.0.0.1:8080" (сразу, до ключа). `ftp://x` -> "Server URL must use http or https. Example: ...".
- `http://127.0.0.1:1` -> после ключа "Could not reach ... (fetch failed)".
- Ctrl+C посреди ввода URL -> назад к списку провайдеров, без ошибки.
- `.../v1` -> "Connected to llama.cpp. Model: mock-coder-7b."; пробелы и слэш -> "Connected to llama.cpp."
- URL 600 символов -> ошибка на полэкрана (03); рабочая конфигурация цела.
- Промпт двойным Enter -> один ответ: SUCCESS (04). Второй промпт во время стриминга -> в очередь ("Steering: ..."), без дублей.

## Проблемы
1. MINOR, product. Двойной Enter в меню способа входа проваливается дальше: выбран первый провайдер (DeepSeek). (01-double-enter-deepseek)
2. MINOR, product. Ключ спрашивается до проверки доступности сервера; неверный синтаксис отсекается сразу. (02-empty-url-8080)
3. MINOR, product. После ошибки вход закрывается целиком: повтор = `/login` + способ + провайдер; курсор не запоминает llama.cpp.
4. MINOR, product. Пустой URL подставляет `:8080` (подсказка есть), выбранный URL после ввода не отображается. (02)
5. MINOR, product. Длинный URL целиком в тексте ошибки - 5 строк. (03-long-url-error)
6. MINOR, product. При повторном входе "Connected to llama.cpp." без имени модели; в списке провайдеров не видно сохранённого URL.
7. MINOR, product. Абсолютный путь к docs в стартовом предупреждении (в тесте - путь исходников).

Блокеров нет: ошибки понятные и с форматом, состояние не теряется, неудачный вход не ломает рабочую конфигурацию.

## Вернулся бы?
Да: не упало, без дублей, рабочая конфигурация не потерялась.
