# Mail-notes feed + terminal ACK

Durable filing notes for Cliff. Persist on private Vercel Blob
(`MAIL_NOTES_BLOB`, default `filing-corrections.json`). Auth is an admin
session cookie **or** `Authorization: Bearer $MAIL_NOTES_FEED_TOKEN`.
An empty/unset token does not open the endpoint.

Notes have a terminal lifecycle: `open` → `processed` | `failed` | `deduped`.
Legacy notes without `status` are `open`. `GET ?status=open` returns only
open notes so a zombie cannot be replayed after ACK.

Creating a note still requires an admin session (the mail-log UI). The
feed Bearer may list and ACK, not create.

## List open notes

```bash
curl -sS -H "Authorization: Bearer $MAIL_NOTES_FEED_TOKEN" \
  "https://ostroff.la/api/mail-notes?status=open"
```

Omit `?status=` (or pass `all`) to get every note, including terminal ones.

## ACK processed (Cliff, after applying a note)

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $MAIL_NOTES_FEED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"n_5bf65643-ebc6-4f16-992a-097d878f021c","processed":true}' \
  https://ostroff.la/api/mail-notes
```

Equivalent bodies:

```json
{"id":"n_…","status":"processed"}
{"id":"n_…","status":"failed","detail":"could not apply"}
{"id":"n_…","status":"deduped","detail":"already in filing-corrections.csv"}
```

`POST` with the same JSON is also accepted (historical clients). Re-ACK of
an already-terminal note returns **200** and the same note (`idempotent: true`),
not 404. Missing id → 404. Missing or wrong auth → 401.

To re-open a note after a bad ACK:

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $MAIL_NOTES_FEED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"n_…","status":"open"}' \
  https://ostroff.la/api/mail-notes
```

Production ACK of the live Vercel zombie (`n_5bf65643-ebc6-4f16-992a-097d878f021c`)
happens **after merge + deploy**. Proto E2E with the real Bearer then.
