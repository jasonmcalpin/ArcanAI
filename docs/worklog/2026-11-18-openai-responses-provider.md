# 2026-11-18 — Direct OpenAI Responses provider

## Goal
Access the official OpenAI Responses API through an independently owned provider plugin without introducing OpenAI protocol logic into ArcanAI core.

## Completed
- Added explicit host-keyed HTTPS Responses streaming provider with text input/output and native function-call output.
- Mapped canonical message roles, tool history, common generation options, provider-specific options, structured usage and failure statuses.
- Defaults to no retained server-side response; does not execute tools or retry requests.
- Added HTTP SSE fixture, tool fragment, error and cancellation conformance tests.

## Dependencies
A separately provisioned OpenAI Platform API credential (not ChatGPT plan), reachable endpoint, API billing, and model permissions. CI does not verify the deployed API capability set.

## Deferred
Full vision/audio, built-in hosted tools, reasoning metadata and live authenticated endpoint acceptance require separately reviewed capability contracts.
