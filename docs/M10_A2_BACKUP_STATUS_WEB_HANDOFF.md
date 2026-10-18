# M10 A2 — the stale-backup warning: what the Web tier needs (for Agent B)

Agent A built the API half and did **not** build any screen. This is the exact
contract for the web half.

## Why it exists

The server takes an encrypted backup every night; a Windows computer at the clinic
collects it. Either can stop silently. The manager must see it within three days
(owner decision), without any staff permission being widened.

## The API (done, Agent A)

`GET /operations/backup-status`

- Guard chain as every internal read: internal key + session. Requires **`user.read`**,
  which only `MANAGER` holds. A receptionist gets `403`; no session gets `401`. **No new
  permission exists and none should be added.**
- Response: `backupStatusResponseSchema` from `@clinic/contracts`
  (`packages/contracts/src/operations/backup-status.ts`):

  | Field                   | Type                                                                  | Meaning                                                                               |
  | ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
  | `state`                 | `OK` \| `STALE` \| `NEVER_COLLECTED` \| `UNKNOWN` \| `NOT_CONFIGURED` | see below                                                                             |
  | `warning`               | boolean                                                               | `true` for every state except `OK` — **the only field that decides showing a banner** |
  | `warningAfterHours`     | number (72)                                                           | the threshold; `OFFSITE_BACKUP_WARNING_HOURS` is exported too                         |
  | `offsiteCopy`           | `{ takenAt, collectedAt, ageHours }` or `null`                        | newest backup the clinic computer holds: when it was taken, when last confirmed       |
  | `newestOnServerTakenAt` | ISO instant or `null`                                                 | newest backup the server had at the last collection                                   |
  | `checkedAt`             | ISO instant                                                           | the API's clock when it answered                                                      |

- States:
  - `OK` — the newest off-site copy is at most 72 hours old. No banner.
  - `STALE` — older than 72 hours. Either the server stopped backing up or the clinic
    computer stopped collecting; `newestOnServerTakenAt` distinguishes them (if it is
    newer than `offsiteCopy.takenAt`, the computer is behind; if it is just as old, the
    server has stopped).
  - `NEVER_COLLECTED` — collection is configured but nothing has been collected yet.
  - `UNKNOWN` — the status could not be read. Treat as a warning.
  - `NOT_CONFIGURED` — this deployment has no collector. On a development machine this
    is normal; in production it is a warning like the others.

## What the Web tier needs to do

1. **Where:** a banner at the top of the manager's dashboard (`/dashboard`), rendered only
   when the signed-in user holds `user.read`. Nothing for the receptionist — do not even
   call the endpoint for them.
2. **How it reads:** a Server Component read through the existing server-only NestJS client
   (the same pattern as the other dashboard reads), `cache: 'no-store'`. Parse with
   `backupStatusResponseSchema`. No client component, no Server Action, no route handler,
   no BFF endpoint — it is a read of two timestamps.
3. **What it shows:** when `warning` is true, one prominent Persian warning. The words are
   the coordinator's to translate; the meaning per state is:
   - `STALE`: "The newest backup outside the server is _N_ days old (taken _date_). Check
     that the clinic computer is switched on and connected; if it is, tell the developer."
     Use `offsiteCopy.takenAt` in the Jalali calendar and `ageHours` as whole days.
   - `NEVER_COLLECTED`: "No backup has been collected off the server yet."
   - `UNKNOWN`: "The backup status could not be read. Tell the developer."
   - `NOT_CONFIGURED`: "Backups are not being collected off the server."
     When `state` is `OK`, optionally a quiet line with the last off-site copy's date; not
     required.
4. **If the API call itself fails**, do not hide the problem: show the `UNKNOWN` wording,
   never nothing.
5. **Tests:** one fixture per state, the receptionist sees no banner and makes no call,
   and a failed call renders the `UNKNOWN` wording.

## What must not change

- No new permission, no new role grant.
- No write, no "dismiss" that is stored anywhere; the warning goes away only when a newer
  backup is collected.
- No backup file name, path or server address shown anywhere.
