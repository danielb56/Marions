export const APP_NAME = "REME Painting Group";
export const APP_SHORT_NAME = "REME";

export function brandNotificationBody(body: string) {
  return body.replace(/^Marion:/, `${APP_SHORT_NAME}:`);
}
