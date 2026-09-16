# Binding confirm-gate (outside Gmail)

Confirm-before-send / Todoist / pay is a durable object on ostroff.la, not
prompt text and **not** a Gmail message (that would be circular: Cliff
archives the mailbox he would also use to confirm).

Store: private Vercel Blob (`CONFIRMATIONS_BLOB`, default
`bot-confirmations.json`), same `BLOB_READ_WRITE_TOKEN` as mail-notes.
Local: `.data/bot-confirmations.json`.

## Who may call what

| Action | Admin session (Nick on ostroff.la) | Bearer `MAIL_NOTES_FEED_TOKEN` |
| --- | --- | --- |
| Create pending | yes | yes (Cliff) |
| List / GET by id | yes | yes (Cliff or Cap) |
| Approve / deny | yes (Nick) | yes (**Cap only** — Cliff must never auto-approve) |
| Consume | yes | yes (Cliff, after Nick/Cap approved) |

Same token as mail-notes on purpose. The API cannot tell Cliff from Cap;
Cliff’s rule is: create and consume only. Never `status: approved`.

Confirm channel: Cap chat / AgentMail Cap / the admin page at
`/bots/confirm/`. Do **not** put the approval in nick@ostroff.la or
nick@pixelocity.com.

## Flow

1. Cliff `POST`s a pending confirmation (kind + summary + payload).
2. Cap shows Nick the summary (or Nick opens `/bots/confirm/`).
3. Nick/Cap `PATCH` `approved` or `denied`.
4. Cliff `GET`s by id. Act **only** when `status` is `approved`,
   `expires_at` is still in the future, and it is not `consumed`.
5. After acting, Cliff `PATCH`es `consumed: true` so the id cannot replay.

Statuses: `pending` | `approved` | `denied` | `expired` | `consumed`.
Default TTL is 24 hours. Expired pending/approved become `expired` on read.

Kinds: `send_email`, `todoist_create`, `payment` (other snake_case strings
are stored but not special-cased).

## Create

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $MAIL_NOTES_FEED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"send_email","summary":"Reply to Casey","payload":{"to":"casey@example.com"},"requested_by":"cliff"}' \
  https://ostroff.la/api/confirmations
```

## Approve (Cap Bearer or Nick session)

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $MAIL_NOTES_FEED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"c_…","status":"approved"}' \
  https://ostroff.la/api/confirmations
```

Nick on ostroff.la can instead open `/bots/confirm/` and tap Approve / Deny
(admin session cookie). `denied` is the same PATCH with `"status":"denied"`.

## Consume (Cliff)

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $MAIL_NOTES_FEED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"c_…","consumed":true}' \
  https://ostroff.la/api/confirmations
```

Re-consume of an already-consumed id is **200** + the same object. Consume
while `pending` / `denied` / `expired` is **409**. Missing id → 404.
Missing or wrong auth → 401.

GET one: `GET /api/confirmations?id=c_…`
List pending: `GET /api/confirmations?status=pending`

Cap/AgentMail send wiring is not in this repo. Cap should: receive the
created `id` + `summary` from Cliff (or poll pending), ask Nick, PATCH
approve/deny, tell Cliff to consume.
