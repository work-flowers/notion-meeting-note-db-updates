// End-to-end test for handlePageCreated against a real Meeting Notes page.
// Writes Date / Contacts / Internal Attendees on the target page.
//
// Usage:
//   NOTION_API_TOKEN=$(op read "op://Employee/notion-worker-automations/credential") \
//     npx tsx --env-file=.env ./test-handler.ts <meeting-note-page-id>
import { Client } from "@notionhq/client";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { handlePageCreated } from "./src/handler";

const pageId = process.argv[2];
if (!pageId) {
	console.error("Usage: npx tsx --env-file=.env ./test-handler.ts <page-id>");
	process.exit(1);
}

const notion = new Client({ auth: process.env.NOTION_API_TOKEN });
const zapier = createZapierSdk({
	credentials: {
		clientId: process.env.ZAPIER_CLIENT_ID!,
		clientSecret: process.env.ZAPIER_CLIENT_SECRET!,
	},
});

handlePageCreated({ pageId }, { notion, zapier }).then(
	() => console.log("done"),
	(err) => {
		console.error(err);
		process.exit(1);
	},
);
