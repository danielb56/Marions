// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- OpenNext creates this module during `pnpm build:cloudflare`.
import openNextWorker from "./.open-next/worker.js";

const notificationCronUrl = "https://marion.internal/api/cron/notifications";

export default {
  fetch: openNextWorker.fetch,

  async scheduled(_controller, env, ctx) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      throw new Error("CRON_SECRET is not configured");
    }

    const response = await openNextWorker.fetch(
      new Request(notificationCronUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cronSecret}`,
        },
      }),
      env,
      ctx,
    );

    if (!response.ok) {
      throw new Error(`Notification dispatcher returned HTTP ${response.status}`);
    }
  },
} satisfies ExportedHandler<CloudflareEnv>;
