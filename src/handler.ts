import type { Client } from "@notionhq/client";
import type { createZapierSdk } from "@zapier/zapier-sdk";
import {
	DEFAULT_INTERNAL_DOMAIN,
	resolveContactPageIds,
} from "@work-flowers/notion-worker-shared";
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

interface ResolvedAttendees {
	internalUserIds: string[];
	externalEmails: string[];
}

/**
 * Resolve meeting_notes attendee Notion user IDs to workspace people.
 * Internal-domain people keep their user ID (for the people property);
 * everyone else contributes an email for Contacts resolution.
 */
async function resolveAttendees(
	notion: Client,
	attendeeUserIds: string[],
): Promise<ResolvedAttendees> {
	const internalUserIds = new Set<string>();
	const externalEmails = new Set<string>();

	for (const userId of attendeeUserIds) {
		let user: any;
		try {
			user = await notion.users.retrieve({ user_id: userId });
		} catch (err) {
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
		} else {
			externalEmails.add(email);
		}
	}

	return {
		internalUserIds: [...internalUserIds],
		externalEmails: [...externalEmails],
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

	const { internalUserIds, externalEmails } = await resolveAttendees(
		notion,
		attendees,
	);
	const contactPageIds = await resolveContactPageIds(
		notion,
		zapier,
		externalEmails,
	);

	const properties: Record<string, any> = {
		Date: { date: { start: start_time, end: end_time ?? null } },
	};
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
		`Updated ${pageId}: contacts=${contactPageIds.length}, internal=${internalUserIds.length}`,
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
}
