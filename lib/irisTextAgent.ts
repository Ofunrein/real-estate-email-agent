import {
  generateTheoReply,
  smsOptIn,
  type TheoReplyContext,
  type TheoReplyResult,
} from "@/lib/theoAgent";

export type IrisTextReplyContext = TheoReplyContext;
export type IrisTextReplyResult = TheoReplyResult;

// Shared text-channel brain. Keep theoAgent as compatibility implementation
// while all runtime callers use Iris naming and one entry point.
export async function generateIrisTextReply(context: IrisTextReplyContext): Promise<IrisTextReplyResult> {
  return generateTheoReply(context);
}

export { smsOptIn };
