import type { createZapierSdk } from "@zapier/zapier-sdk";

type Zapier = ReturnType<typeof createZapierSdk>;

export interface CalendarEvent {
	id: string;
	summary?: string;
	description?: string;
	hangoutLink?: string;
	iCalUID?: string;
	start: { dateTime?: string; date?: string };
	end: { dateTime?: string; date?: string };
	organizer?: { email?: string };
	attendees?: Array<{ email?: string }>;
}

let cachedConnectionId: string | number | null = null;

async function getGoogleCalendarConnectionId(
	zapier: Zapier,
): Promise<string | number> {
	if (cachedConnectionId !== null) return cachedConnectionId;
	const { data } = await zapier.findFirstConnection({
		app: "google-calendar",
		owner: "me",
	});
	if (!data?.id) {
		throw new Error("No Google Calendar connection found in Zapier");
	}
	cachedConnectionId = data.id;
	return data.id;
}

export async function findCalendarEvent(
	zapier: Zapier,
	{
		query,
		startTime,
	}: {
		query: string;
		startTime: string;
	},
): Promise<CalendarEvent | null> {
	const connectionId = await getGoogleCalendarConnectionId(zapier);
	const timeMin = startTime;
	const timeMax = new Date(new Date(startTime).getTime() + 60_000).toISOString();

	const params = new URLSearchParams({
		timeMin,
		timeMax,
		q: query,
		singleEvents: "true",
	});
	const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`;

	const res = await zapier.fetch(url, {
		method: "GET",
		connection: connectionId,
		headers: { Accept: "application/json" },
	});
	if (!res.ok) {
		throw new Error(
			`Google Calendar request failed: ${res.status} ${await res.text()}`,
		);
	}
	const body = (await res.json()) as { items?: CalendarEvent[] };
	return body.items?.[0] ?? null;
}

export function extractMeetingTitle(pageTitle: string): string {
	const match = pageTitle.match(/^.+?(?=\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
	return (match ? match[0] : pageTitle).trim();
}
