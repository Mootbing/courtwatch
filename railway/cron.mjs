const baseUrl = process.env.MONITOR_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("MONITOR_URL is required for the Railway cron service.");

const response = await fetch(`${baseUrl}/api/refresh`, {
  method: "POST",
  headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
});

if (!response.ok) throw new Error(`Refresh failed with ${response.status}: ${await response.text()}`);
console.log(await response.text());
