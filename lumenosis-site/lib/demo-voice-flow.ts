/**
 * Conversation flow control: silence, pauses, and ending the call.
 *
 * The failure this exists to prevent: a voice agent with no idle policy and no hangup policy
 * runs forever. The caller stops talking, the agent waits, nothing happens, and the call sits
 * open burning minutes until a hard timeout kills it mid-sentence. Or worse, the agent keeps
 * asking "is there anything else?" in a loop because nothing tells it a conversation is over.
 *
 * Three separate mechanisms, because they solve different problems:
 *
 *   1. `messagePlan` — provider-level idle nudges. Deterministic, fires on real silence, and
 *      does not need the model to notice anything.
 *   2. `stopSpeakingPlan` / `startSpeakingPlan` — barge-in and endpointing, so pauses in
 *      normal speech are not mistaken for turn ends.
 *   3. Prompt rules — judgement calls the provider cannot make: *when* a conversation is
 *      actually finished, versus a caller who is simply thinking.
 *
 * Escalating idle messages matter: a caller who paused to grab a pen should get a soft "take
 * your time", not an immediate goodbye. Only sustained silence ends the call.
 */

export const IDLE_MESSAGES = [
  // Deliberately varied and low-pressure. Repeating one identical prompt sounds robotic and
  // makes the caller feel rushed.
  "Take your time.",
  "Still here whenever you're ready.",
  "I'll hang on a moment in case you're still there.",
] as const;

/**
 * Idle handling. `timeoutSeconds` is generous on purpose: 8 seconds of true silence is a long
 * time on a phone call, but cutting in at 3 or 4 seconds interrupts anyone who is reading a
 * listing or thinking about a number.
 */
export const messagePlan = {
  idleMessages: [...IDLE_MESSAGES],
  idleTimeoutSeconds: 8,
  // After three unanswered nudges the caller is gone — dropped signal, walked away, or
  // pocket dial. Ending is the correct behaviour; waiting for the hard cap is not.
  idleMessageMaxSpokenCount: 3,
  silenceTimeoutMessage:
    "Seems like we lost each other. I'll let the team know you called, and you can reach us again anytime. Take care.",
} as const;

/**
 * Endpointing. `waitSeconds` is how long the agent waits after the caller stops before it
 * assumes the turn is over.
 *
 * The tension: too short and the agent talks over anyone who pauses mid-sentence ("I'm
 * looking at the... three bedroom?"); too long and it feels laggy and dead. Just over half a
 * second is the usual sweet spot, and we extend it when the caller's last utterance sounds
 * unfinished, which is what `smartEndpointingPlan` is for.
 */
export const startSpeakingPlan = {
  waitSeconds: 0.6,
  smartEndpointingPlan: { provider: "livekit" as const },
  // A caller trailing off with "um", "so", "and", "I think" is still mid-thought. Wait longer
  // rather than jumping in and forcing them to restart.
  transcriptionEndpointingPlan: {
    onPunctuationSeconds: 0.35,
    onNoPunctuationSeconds: 1.4,
    onNumberSeconds: 0.6,
  },
} as const;

/**
 * Barge-in. Two words is enough to know the caller wants the floor; one word triggers on
 * "yeah"/"mhm" backchannels and makes the agent stutter to a halt constantly.
 */
export const stopSpeakingPlan = {
  numWords: 2,
  voiceSeconds: 0.2,
  backoffSeconds: 1,
} as const;

/**
 * Hard ceiling. Not a conversation-management tool — a cost and runaway guard. Real end-of-
 * call decisions come from the prompt rules and the idle plan above; if we ever hit this, the
 * agent failed to end a finished conversation.
 */
export const maxDurationSeconds = 600;

/**
 * Prompt rules for turn-taking, pauses, and hanging up. These cover the judgement the
 * provider plan cannot: distinguishing "thinking" from "finished", and closing once rather
 * than fishing for more conversation.
 */
export const CONVERSATION_FLOW_PROMPT = `PAUSES AND SILENCE
- A pause is not your turn to fill. If the caller goes quiet mid-thought, wait. Do not restate, rephrase, or pile on another question.
- If the caller trails off ("so...", "I mean...", "let me see"), stay silent and let them finish. Interrupting a thinking caller forces them to start over.
- If you are genuinely unsure whether they finished, a short "Go ahead" is better than launching into an answer.
- If the caller says they need a second, or you hear them looking something up, acknowledge once and wait quietly. Do not narrate the wait.
- If the line has been silent for a while, check in once, briefly and without pressure. Do not stack check-ins or escalate urgency each time.
- If there is still no response after a few attempts, assume the call dropped or the caller left. Close politely and end the call rather than waiting indefinitely.
- If you hear background conversation clearly not directed at you, stay quiet. Do not answer it or ask who they are talking to.

ENDING THE CALL
- End the call once the caller's need is handled and there is a clear next step or no outstanding question. Do not keep the call alive looking for more to do.
- Ask "anything else?" at most once per call. If they say no, close. Never ask it repeatedly or reopen a settled topic.
- Explicit exits ("that's all", "thanks, bye", "I'm good", "gotta run") mean the call is over. Confirm the next step in one short sentence if there is one, say a brief goodbye, and end. Do not add new information, offers, or questions after the caller has signalled they are done.
- Never end mid-answer, mid-question, or immediately after your own statement without giving the caller a chance to respond.
- Close once and cleanly. One goodbye, no repeated sign-offs, no summarizing the whole call back to them.
- If the caller is hostile, repeatedly abusive, or the call is clearly a wrong number or robocall, close politely and end. Do not argue, lecture, or keep engaging.
- If the caller asks for something you cannot do, say who will follow up and when, then close rather than looping through the same limitation.` as const;
