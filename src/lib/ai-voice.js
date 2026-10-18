/* The owner's writing instructions for AI drafts, bundled at build time from
   src/ai/reply-voice.txt. Kept separate so ai-drafts.js stays testable in Node. */
import voice from '../ai/reply-voice.txt?raw';
import { draftReply } from './ai-drafts.js';

export const replyVoice = voice;

export function draftReplyInVoice(env, ref, options = {}) {
  return draftReply(env, ref, { ...options, instructions: voice });
}
