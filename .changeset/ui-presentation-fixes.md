---
"@zebric/runtime-core": patch
---

Show field values the way people read them. Detail pages now keep line breaks in `LongText` values and show `JSON`
values pretty-printed in a monospaced block, instead of collapsing both into one paragraph. `DateTime` values now show
the time and name the time zone (the server's, which is UTC on Cloudflare Workers) instead of only the date; `Date`
values are unchanged. Activity feeds now use `kind`, `type` or `name` as the heading, `detail`, `description` or `message`
as the body, and `createdAt` as the time when a record has no `title`, `summary`, `action` or `timestamp`, so
audit-style and event-log entities no longer render as the word "Event". Values remain HTML-escaped throughout. Tables
and lists that show `DateTime` columns now include the time, so those cells are wider.
