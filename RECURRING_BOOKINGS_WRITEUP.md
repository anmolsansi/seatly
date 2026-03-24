# Recurring Bookings Write-Up

Date: 2026-03-22

## What I implemented

- Added weekly recurring booking support to the backend booking flow.
- Extended booking creation requests to accept:
  - `recurrenceType`
  - `occurrences`
- Implemented server-side weekly occurrence generation.
- Reused the existing overlap rule for every generated occurrence.
- Added all-or-nothing conflict handling so a recurring series is rejected if any occurrence overlaps.
- Persisted recurring bookings as normal `booking` rows so the existing availability endpoint continues to work without a special recurring view model.
- Expanded the booking create response to include:
  - the original top-level booking fields
  - `createdCount`
  - `recurrenceType`
  - created occurrence details
- Updated the frontend booking modal to support:
  - single booking
  - weekly recurring booking
  - number of weeks
- Updated the frontend API client to send recurrence fields only when recurrence is selected.
- Added backend tests for:
  - recurring booking success
  - recurring conflict rejection
  - recurring booking visibility in availability
- Added frontend tests for:
  - recurring controls rendering
  - recurring payload submission
  - backend conflict error display
- Fixed backend test verification so the project can be tested locally without a running Postgres container:
  - aligned Java/Kotlin/KSP to JVM 17
  - added an H2 in-memory test datasource for Micronaut tests

## What I verified

Frontend:

- `yarn typecheck` passed
- `yarn test --run` passed
- Result: 3 test files passed, 7 tests passed

Backend:

- `./gradlew test` passed

## Where I stopped

- The recurring booking feature is implemented through the backend and frontend flows.
- The main remaining work is optional cleanup or submission polish, not feature completion.

## Why I focused on this work

- The assignment goal is primarily feature behavior:
  - create weekly recurring bookings
  - enforce conflicts
  - show recurring bookings in availability
- Persisting recurring occurrences as normal booking rows was the lowest-risk way to satisfy those requirements with the existing code structure.
- I prioritized end-to-end feature behavior and test coverage before build-environment cleanup because that directly addresses the assignment scope.
