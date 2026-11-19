# 2026-11-18 — Headless Node Transformers model acceptance

## Goal
Make the canonical Transformers.js provider executable and measurable on macOS without a browser or an agent control plane.

## Completed
- Added an explicit operator-run Node smoke command accepting a reviewed model execution card.
- Report runtime/device/model identity, generation timing, usage, terminal status and cleanup.
- Bound request output and token limits; always dispose model instance.
- Added deterministic CPU runtime loading/inference/disposal contract test.

## Verification
GitHub CI build/unit tests required. Real Mac model weights, WebGPU/CPU device selection and cache capacity unverified here. The operator must run the smoke command on target hardware.

## Dependencies
Node 22+, installed Transformers.js package, valid model cache/weights and hardware support; no container, server or browser required.

## Next
Capture an actual Mac run result before recording model compatibility or migrating BML.
