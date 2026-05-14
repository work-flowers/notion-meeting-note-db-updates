const NOTION_VERSION = "2026-03-11";
const API_BASE = "https://api.notion.com/v1";

function token(): string {
	const t = process.env.NOTION_API_TOKEN;
	if (!t) throw new Error("NOTION_API_TOKEN is not configured");
	return t;
}

async function call<T>(
	method: "GET" | "POST" | "PATCH",
	path: string,
	body?: unknown,
): Promise<T> {
	const res = await fetch(`${API_BASE}/${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token()}`,
			"Notion-Version": NOTION_VERSION,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		throw new Error(
			`Notion ${method} /${path} failed: ${res.status} ${await res.text()}`,
		);
	}
	return (await res.json()) as T;
}

export async function queryDataSource(
	_notion: unknown,
	dataSourceId: string,
	body: Record<string, unknown>,
): Promise<{ results: any[]; has_more: boolean; next_cursor: string | null }> {
	return await call("POST", `data_sources/${dataSourceId}/query`, body);
}

export async function createPage(body: Record<string, unknown>): Promise<any> {
	return await call("POST", "pages", body);
}
