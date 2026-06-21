export function irisEmailCronDryRun(searchParams: URLSearchParams): boolean {
  if (searchParams.get("dryRun") === "true") return true;
  if (searchParams.get("dryRun") === "false") return false;
  return process.env.IRIS_EMAIL_LIVE !== "true";
}

export function irisEmailCronSendReplies(searchParams: URLSearchParams, emailAutoSendEnabled: boolean): boolean {
  if (searchParams.get("sendReplies") === "false") return false;
  if (process.env.IRIS_EMAIL_SEND_REPLIES !== "true") return false;
  if (!emailAutoSendEnabled) return false;
  return searchParams.get("sendReplies") === "true" || process.env.IRIS_EMAIL_LIVE === "true";
}
