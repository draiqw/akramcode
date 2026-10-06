# SQLite Storage - Transaction and Read Semantics

Source: packages/durable/src/storage/sqlite/storage.ts

## Transactional consistency for document queries

The record and revision queries must observe one committed state. A commit between them can replace the base document, so both queries must run within a transaction to ensure they read consistent data.

## Read admission gate design

Run a read that issues several queries. Close waits for admitted reads, so their later queries never reach a closed database. Single-query reads and transactions are already ordered before close by the database itself.
