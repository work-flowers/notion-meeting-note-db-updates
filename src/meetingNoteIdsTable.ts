import type { createZapierSdk } from "@zapier/zapier-sdk";

type Zapier = ReturnType<typeof createZapierSdk>;

const TABLE_ID = "01JZCVG73MBWWB0357CEPS4903";
const FIELD_EVENT_ID = "data__f3";
const NEW_FIELD_PAGE_ID = "new__data__f2";
const NEW_FIELD_EVENT_ID = "new__data__f3";
const NEW_FIELD_START = "new__data__f5";
const NEW_FIELD_END = "new__data__f6";
const NEW_FIELD_FLAG = "new__data__f7";
const NEW_FIELD_SUMMARY = "new__data__f8";

interface LogRow {
	iCalUID: string;
	pageId: string;
	startDateTime?: string;
	endDateTime?: string;
	summary?: string;
}

export async function upsertMeetingNoteIdRow(
	zapier: Zapier,
	row: LogRow,
): Promise<void> {
	const newFields: Record<string, unknown> = {
		[NEW_FIELD_EVENT_ID]: row.iCalUID,
		[NEW_FIELD_PAGE_ID]: row.pageId,
	};
	if (row.startDateTime) newFields[NEW_FIELD_START] = row.startDateTime;
	if (row.endDateTime) newFields[NEW_FIELD_END] = row.endDateTime;
	if (row.summary) newFields[NEW_FIELD_SUMMARY] = row.summary;

	const { data } = (await zapier.runAction({
		appKey: "TableCLIAPI",
		actionType: "search_or_write",
		actionKey: "find_record",
		inputs: {
			table_id: TABLE_ID,
			filter_count: "1",
			use_stored_order: false,
			field_data_key: FIELD_EVENT_ID,
			operator: "exact",
			lookup_value: row.iCalUID,
			...newFields,
			[NEW_FIELD_FLAG]: false,
		},
	} as any)) as any;

	const existingRecordId =
		data?.record_id ?? data?.id ?? (Array.isArray(data) ? data[0]?.record_id : null);
	if (!existingRecordId) {
		return;
	}

	await zapier.runAction({
		appKey: "TableCLIAPI",
		actionType: "write",
		actionKey: "update_record",
		inputs: {
			table_id: TABLE_ID,
			record_id: existingRecordId,
			...newFields,
		},
	} as any);
}
