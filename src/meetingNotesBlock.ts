import type { Client } from "@notionhq/client";

export interface MeetingNotesCalendarEvent {
	start_time: string;
	end_time?: string;
	attendees?: string[];
}

export interface MeetingNotesBlock {
	id: string;
	calendar_event: MeetingNotesCalendarEvent;
}

const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 90_000;

export async function waitForMeetingNotesBlock(
	notion: Client,
	pageId: string,
): Promise<MeetingNotesBlock | null> {
	const deadline = Date.now() + MAX_WAIT_MS;
	while (Date.now() < deadline) {
		const block = await findMeetingNotesBlock(notion, pageId);
		if (block) return block;
		await sleep(POLL_INTERVAL_MS);
	}
	return null;
}

async function findMeetingNotesBlock(
	notion: Client,
	pageId: string,
): Promise<MeetingNotesBlock | null> {
	let cursor: string | undefined;
	do {
		const query = new URLSearchParams({ page_size: "100" });
		if (cursor) query.set("start_cursor", cursor);
		const resp = (await notion.request({
			method: "get",
			path: `blocks/${pageId}/children?${query.toString()}`,
			headers: { "Notion-Version": "2026-03-11" },
		} as any)) as any;
		for (const block of resp.results ?? []) {
			if (block.type === "meeting_notes") {
				console.log(
					`Found meeting_notes block ${block.id}:`,
					JSON.stringify(block.meeting_notes ?? {}),
				);
				const calendarEvent = block.meeting_notes?.calendar_event;
				if (calendarEvent?.start_time) {
					return {
						id: block.id,
						calendar_event: calendarEvent,
					};
				}
			}
		}
		cursor = resp.has_more ? resp.next_cursor : undefined;
	} while (cursor);
	return null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
