import type { Client } from "@notionhq/client";
import type { createZapierSdk } from "@zapier/zapier-sdk";
import { extractMeetingTitle, findCalendarEvent } from "./calendar";
import { resolveContactPageIds, extractAddresses } from "./contacts";
import {
	buildInternalUserMap,
	resolveInternalAttendees,
} from "./internalAttendees";
import { upsertMeetingNoteIdRow } from "./meetingNoteIdsTable";
import { waitForMeetingNotesBlock } from "./meetingNotesBlock";

type Zapier = ReturnType<typeof createZapierSdk>;

interface AutomationPayload {
	pageId?: string;
	page_id?: string;
	data?: { id?: string };
	source?: { id?: string };
	[k: string]: unknown;
}

function extractPageId(body: unknown): string | null {
	if (!body || typeof body !== "object") return null;
	const b = body as AutomationPayload;
	return (
		b.pageId ??
		b.page_id ??
		b.data?.id ??
		b.source?.id ??
		null
	);
}

async function getPageTitle(notion: Client, pageId: string): Promise<string> {
	const page = (await notion.pages.retrieve({ page_id: pageId })) as any;
	const props = page.properties ?? {};
	for (const value of Object.values(props) as any[]) {
		if (value?.type === "title") {
			return (value.title ?? [])
				.map((t: any) => t.plain_text)
				.join("")
				.trim();
		}
	}
	return "";
}

export async function handlePageCreated(
	body: unknown,
	{ notion, zapier }: { notion: Client; zapier: Zapier },
): Promise<void> {
	const pageId = extractPageId(body);
	if (!pageId) {
		console.log("No pageId in webhook payload; skipping.", body);
		return;
	}

	console.log(`Processing Meeting Note page ${pageId}`);

	const meetingNotesBlock = await waitForMeetingNotesBlock(notion, pageId);
	if (!meetingNotesBlock) {
		console.log(`No meeting_notes block with start_time found on ${pageId}`);
		return;
	}

	const startTime = meetingNotesBlock.calendar_event.start_time;
	const title = await getPageTitle(notion, pageId);
	const query = extractMeetingTitle(title);
	console.log(`Searching Google Calendar: q="${query}" start=${startTime}`);

	const event = await findCalendarEvent(zapier, { query, startTime });
	if (!event) {
		console.log(`No matching Google Calendar event for ${pageId}`);
		return;
	}

	const organizerEmail = event.organizer?.email ?? "";
	const attendeeEmails = (event.attendees ?? [])
		.map((a) => a.email)
		.filter((e): e is string => Boolean(e));
	const allEmails = extractAddresses([organizerEmail, ...attendeeEmails].join(","));

	const [internalMap, contactPageIds] = await Promise.all([
		buildInternalUserMap(notion),
		resolveContactPageIds(notion, zapier, allEmails),
	]);
	const internalAttendeeIds = resolveInternalAttendees(allEmails, internalMap);

	const properties: Record<string, any> = {
		"Google Calendar Event ID": {
			rich_text: [{ type: "text", text: { content: event.id } }],
		},
	};

	const startDateTime = event.start.dateTime ?? event.start.date;
	const endDateTime = event.end.dateTime ?? event.end.date;
	if (startDateTime) {
		properties["Date"] = {
			date: { start: startDateTime, end: endDateTime ?? null },
		};
	}
	if (event.description) {
		properties["Description"] = {
			rich_text: [{ type: "text", text: { content: event.description.slice(0, 2000) } }],
		};
	}
	if (event.hangoutLink) {
		properties["Call Link"] = { url: event.hangoutLink };
	}
	if (contactPageIds.length > 0) {
		properties["Contacts"] = {
			relation: contactPageIds.map((id) => ({ id })),
		};
	}
	if (internalAttendeeIds.length > 0) {
		properties["Internal Attendees"] = {
			people: internalAttendeeIds.map((id) => ({ id })),
		};
	}

	await notion.pages.update({ page_id: pageId, properties } as any);
	console.log(
		`Updated ${pageId}: event=${event.id}, contacts=${contactPageIds.length}, internal=${internalAttendeeIds.length}`,
	);

	if (event.iCalUID) {
		try {
			await upsertMeetingNoteIdRow(zapier, {
				iCalUID: event.iCalUID,
				pageId,
				startDateTime: event.start.dateTime ?? event.start.date,
				endDateTime: event.end.dateTime ?? event.end.date,
				summary: event.summary,
			});
		} catch (err) {
			console.log(
				`Meeting Note IDs table write failed: ${(err as Error)?.message ?? err}`,
			);
		}
	}
}
