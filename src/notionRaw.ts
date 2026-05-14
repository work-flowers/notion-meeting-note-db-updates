import type { Client } from "@notionhq/client";

const NOTION_VERSION = "2026-03-11";

export async function queryDataSource(
	notion: Client,
	dataSourceId: string,
	body: Record<string, unknown>,
): Promise<{ results: any[]; has_more: boolean; next_cursor: string | null }> {
	return (await notion.request({
		method: "post",
		path: `data_sources/${dataSourceId}/query`,
		body,
		headers: { "Notion-Version": NOTION_VERSION },
	} as any)) as any;
}

export async function retrieveDataSource(
	notion: Client,
	dataSourceId: string,
): Promise<any> {
	return await notion.request({
		method: "get",
		path: `data_sources/${dataSourceId}`,
		headers: { "Notion-Version": NOTION_VERSION },
	} as any);
}
