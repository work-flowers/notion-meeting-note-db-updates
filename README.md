# notion-meeting-note-db-updates

A [Notion Worker](https://developers.notion.com/workers) that enriches newly created pages in the **Meeting Notes** data source with metadata from Google Calendar and resolved attendees. Replaces a production Zap + sub-Zap that previously did this job (the originals are kept in `exported-zap-*.json` for reference).

## What it does

When a page is added to the Meeting Notes data source, a Notion DB automation calls this Worker's webhook. The Worker then:

1. Polls the page for a populated `meeting_notes` block and reads `calendar_event.start_time`.
2. Strips the trailing ISO timestamp from the page title to recover the original meeting title.
3. Calls the Google Calendar API via the Zapier SDK (reusing the existing Zapier OAuth connection — no separate Google client needed) to find the matching event in a 1-minute window around `start_time`.
4. Resolves attendee emails (via [`@work-flowers/notion-worker-shared`](https://github.com/work-flowers/notion-worker-shared)):
   - External addresses → Notion **Contacts** page IDs, matching on **Primary Email or Secondary Email**. Uses a Zapier-table blocklist, classifies unknown addresses with AI by Zapier (individual vs. service account), and creates new Contact pages for individuals (capped at 10 per run).
   - Internal addresses → Notion workspace user IDs, via `notion.users.list`.
5. Patches the page with `Date`, `Google Calendar Event ID`, `Description`, `Call Link`, `Contacts`, `Internal Attendees`.
6. Find-or-creates a row in the Zapier `[Table] Meeting Note IDs` (`01JZCVG73MBWWB0357CEPS4903`) keyed on `iCalUID`, recording the Notion page ID alongside the event's start, end, and summary.

## Layout

```
src/
├── index.ts             # Worker + webhook registration
├── handler.ts           # handlePageCreated orchestration
├── meetingNotesBlock.ts # Poll for the populated meeting_notes child block
├── calendar.ts          # Zapier-SDK-backed Google Calendar lookup
└── meetingNoteIdsTable.ts # Find-or-create Zapier Table row mapping pageId ↔ iCalUID
```

Contact resolution, internal-user lookup, and raw data-source helpers live in [`@work-flowers/notion-worker-shared`](https://github.com/work-flowers/notion-worker-shared), shared with [notion-worker-email-db-updates](https://github.com/work-flowers/notion-worker-email-db-updates).

```
```

## Setup

Prerequisites: Node 22+, the [`ntn` CLI](https://ntn.dev), and Notion Business/Enterprise with Workers enabled.

```bash
npm install
npm run check                      # type-check
```

Generate Zapier client credentials once (locally, since it needs a browser):

```bash
npx zapier-sdk login
npx zapier-sdk create-client-credentials "notion-worker"
```

Set Worker secrets:

```bash
ntn workers env set \
  ZAPIER_CLIENT_ID=... \
  ZAPIER_CLIENT_SECRET=... \
  NOTION_API_TOKEN=ntn_...
```

`NOTION_API_TOKEN` is an internal integration token (or PAT) that must have access to the Meeting Notes data source, the Contacts data source, and workspace users. The integration also needs to be connected to both data sources from the Notion UI.

## Deploy

```bash
ntn workers deploy
ntn workers webhooks list   # copy the URL for onMeetingNoteCreated
```

Wire it up in Notion: open the Meeting Notes data source → automations → trigger **When page added** → action **Send to webhook** → paste the URL above.

## Local testing

```bash
ntn workers env pull        # write secrets to .env for local runs
ntn workers exec onMeetingNoteCreated --local \
  -d '{"pageId": "<real-meeting-page-id>"}'
```

## Operating notes

- The Worker waits up to ~90s for the `meeting_notes` block to appear (Notion populates it asynchronously after page creation). If the block never appears, the run is a no-op — same behaviour as the Zap's "Only continue if found" filter.
- The Zapier table `01KQY6RB1TJ9X7BAYBRRRKB35S` is still the source of truth for the email blocklist. Moving it into Notion is a follow-up.
- Existing-contact lookup queries the Notion Contacts data source (`21991b07-11ac-81a6-a894-000be4a09a67`) directly via `POST /v1/data_sources/{id}/query` (Notion-Version `2026-03-11`), matching `Primary Email` (email) or `Secondary Email` (multi-select).
- New Contact creation is capped at `NEW_CONTACT_CAP = 10` per run to match the original sub-Zap.

## References

- [`exported-zap-2026-05-14T00_17_10.836Z.json`](exported-zap-2026-05-14T00_17_10.836Z.json) — original parent Zap export.
- [`exported-zap-2026-05-14T00_17_43.957Z.json`](exported-zap-2026-05-14T00_17_43.957Z.json) — original contact-resolution sub-Zap export.
- [Notion Workers docs](https://developers.notion.com/workers)
- [Zapier SDK docs](https://docs.zapier.com/platform/sdk)
