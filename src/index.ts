import { Worker } from "@notionhq/workers";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { handlePageCreated } from "./handler";

const worker = new Worker();
export default worker;

worker.webhook("onMeetingNoteCreated", {
	title: "Meeting Note created",
	description:
		"Enrich a new Meeting Notes page with attendees resolved from its meeting_notes block.",
	execute: async (events, { notion }) => {
		const clientId = process.env.ZAPIER_CLIENT_ID;
		const clientSecret = process.env.ZAPIER_CLIENT_SECRET;
		if (!clientId || !clientSecret) {
			throw new Error(
				"ZAPIER_CLIENT_ID / ZAPIER_CLIENT_SECRET are not configured.",
			);
		}
		const zapier = createZapierSdk({
			credentials: { clientId, clientSecret },
		});

		for (const event of events) {
			try {
				await handlePageCreated(event.body, { notion, zapier });
			} catch (err) {
				console.error(
					`Failed to process delivery ${event.deliveryId}:`,
					(err as Error)?.stack ?? err,
				);
				throw err;
			}
		}
	},
});
