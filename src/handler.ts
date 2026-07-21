import type { Client } from "@notionhq/client";
import type { createZapierSdk } from "@zapier/zapier-sdk";
import {
	DEFAULT_INTERNAL_DOMAIN,
	extractAddresses,
	resolveContactPageIds,
} from "@work-flowers/notion-worker-shared";
import { findCalendarEvent, type CalendarEvent } from "./googleCalendar";
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

function stripHtml(html: string): string {
	return html
		.replace(/<\s*br\s*\/?\s*>/gi, "\n")
		.replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

interface ResolvedAttendees {
	/** Notion user IDs of internal-domain attendees (for the people property). */
	internalUserIds: string[];
	/** Emails of internal-domain attendees (candidates for calendar impersonation). */
	internalEmails: string[];
	/** Emails of external attendees resolvable through Notion (members/guests). */
	externalEmails: string[];
	/** Attendee user IDs the integration could not resolve (non-guests). */
	unresolvedCount: number;
}

/**
 * Resolve meeting_notes attendee Notion user IDs to workspace people.
 * Only workspace members and guests are visible to the integration;
 * anyone else counts as unresolved and must come from the calendar event.
 */
async function resolveAttendees(
	notion: Client,
	attendeeUserIds: string[],
): Promise<ResolvedAttendees> {
	const internalUserIds = new Set<string>();
	const internalEmails = new Set<string>();
	const externalEmails = new Set<string>();
	let unresolvedCount = 0;

	for (const userId of attendeeUserIds) {
		let user: any;
		try {
			user = await notion.users.retrieve({ user_id: userId });
		} catch (err) {
			unresolvedCount++;
			console.log(
				`Could not resolve attendee ${userId}: ${(err as Error)?.message ?? err}`,
			);
			continue;
		}
		if (user?.type !== "person") continue;
		const email = String(user.person?.email ?? "").toLowerCase();
		if (!email) continue;
		if (email.endsWith(DEFAULT_INTERNAL_DOMAIN)) {
			internalUserIds.add(user.id);
			internalEmails.add(email);
		} else {
			externalEmails.add(email);
		}
	}

	return {
		internalUserIds: [...internalUserIds],
		internalEmails: [...internalEmails],
		externalEmails: [...externalEmails],
		unresolvedCount,
	};
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

	const { start_time, end_time, attendees = [] } =
		meetingNotesBlock.calendar_event;
	console.log(
		`meeting_notes block found: start=${start_time}, attendees=${attendees.length}`,
	);

	const { internalUserIds, internalEmails, externalEmails, unresolvedCount } =
		await resolveAttendees(notion, attendees);

	// The Notion users API only resolves workspace members and guests. The
	// calendar event — read from an internal attendee's calendar via the
	// domain-wide-delegated service account — supplies everyone else's email,
	// plus event metadata (call link, description, iCalUID).
	let event: CalendarEvent | null = null;
	const subject = internalEmails[0];
	if (subject) {
		try {
			event = await findCalendarEvent(subject, start_time);
			if (!event) {
				console.log(
					`No calendar event at ${start_time} on ${subject}'s calendar`,
				);
			}
		} catch (err) {
			console.log(
				`Calendar lookup failed (${subject}): ${(err as Error)?.message ?? err}`,
			);
		}
	} else {
		console.log("No internal attendee resolved; skipping calendar lookup.");
	}
	if (unresolvedCount > 0 && !event) {
		console.log(
			`${unresolvedCount} attendee(s) unresolved and no calendar event found; Contacts may be incomplete.`,
		);
	}

	const eventEmails = event
		? extractAddresses(
				[
					event.organizer?.email ?? "",
					...(event.attendees ?? [])
						.filter((a) => !a.resource)
						.map((a) => a.email ?? ""),
				].join(","),
			)
		: [];

	// resolveContactPageIds drops internal-domain and blocklisted addresses
	// itself, so the merged list can safely include internal attendees.
	const contactPageIds = await resolveContactPageIds(notion, zapier, [
		...externalEmails,
		...eventEmails,
	]);

	const properties: Record<string, any> = {
		Date: { date: { start: start_time, end: end_time ?? null } },
	};
	if (event) {
		properties["Google Calendar Event ID"] = {
			rich_text: [{ type: "text", text: { content: event.id } }],
		};
		if (event.description) {
			const cleaned = stripHtml(event.description);
			if (cleaned) {
				properties["Description"] = {
					rich_text: [
						{ type: "text", text: { content: cleaned.slice(0, 2000) } },
					],
				};
			}
		}
		if (event.hangoutLink) {
			properties["Call Link"] = { url: event.hangoutLink };
		}
	}
	if (contactPageIds.length > 0) {
		properties["Contacts"] = {
			relation: contactPageIds.map((id) => ({ id })),
		};
	}
	if (internalUserIds.length > 0) {
		properties["Internal Attendees"] = {
			people: internalUserIds.map((id) => ({ id })),
		};
	}

	await notion.pages.update({ page_id: pageId, properties } as any);
	console.log(
		`Updated ${pageId}: event=${event?.id ?? "none"}, contacts=${contactPageIds.length}, internal=${internalUserIds.length}`,
	);

	// Notion DB automations don't reliably fire on API-driven property updates,
	// and the native "set Companies from Contacts" automation can't cascade-trigger
	// other automations. Explicitly POST to the icon-sync worker so it can copy
	// the related Company's icon onto this Meeting Note.
	const iconSyncUrl = process.env.ICON_SYNC_WEBHOOK_URL;
	if (iconSyncUrl) {
		try {
			const res = await fetch(iconSyncUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ page_id: pageId }),
			});
			if (!res.ok) {
				console.log(
					`Icon sync webhook returned ${res.status} for ${pageId}`,
				);
			}
		} catch (err) {
			console.log(
				`Icon sync webhook failed for ${pageId}: ${(err as Error)?.message ?? err}`,
			);
		}
	}

	if (event?.iCalUID) {
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
