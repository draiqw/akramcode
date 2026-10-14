# Model catalog publication script

Source: scripts/publish-model-catalog.mjs

## Hashing the full model catalog

Revisions are keyed to the full catalog (models.all.json), not the legacy chat-only variant. This ensures that any content change—chat models, image models, or classifiers—triggers a new revision, avoiding stale cache issues when only image or classifier models update.
