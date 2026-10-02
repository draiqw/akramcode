# Provider registry notes

Комментарии реестра провайдеров вынесены сюда. Основная документация:

- [Provider registry](providers/README.md)
- [Provider plugin contract](../plugins/model-providers/README.md)

## `providers/__init__.py`

- Реестр разделяет bundled-, пользовательские и runtime-регистрации.
- Пользовательские плагины привязаны к профилю через `ContextVar`.
- Каталог `plugins/model-providers/` заполняется при discovery.

## `providers/base.py`

- `OMIT_TEMPERATURE` означает, что temperature нужно исключить из запроса.
