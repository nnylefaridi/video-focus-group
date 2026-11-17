/**
 * Hosted mode: what a review says when the owner's own Anthropic API key can't be used,
 * and where that's fixed. Shared by the server (which fails the review with these) and
 * the review screen (which links to the fix), so it holds no server code.
 */
export const NEEDS_KEY = "Add your Anthropic API key first.";
export const KEY_REJECTED = "Anthropic rejected your saved API key. Replace it with a working one under Your reviews, then try again.";
export const KEY_REMOVED = "Your Anthropic API key isn't saved anymore. Add it again under Your reviews, then try again.";
export const KEY_UNREADABLE = "Panel couldn't read your saved API key. Save it again under Your reviews, then try again.";
export const KEY_FORBIDDEN = "Your Anthropic API key isn't allowed to use the models Panel needs. Check the key's workspace in the Anthropic Console, or replace it under Your reviews, then try again.";

/** The key section on the Your reviews page. */
export const API_KEY_ANCHOR = "api-key";
export const API_KEY_HREF = `/reviews#${API_KEY_ANCHOR}`;

/** Whether this error is fixed by saving or replacing the key in Panel. */
export function isKeyProblem(message: string | null | undefined): boolean {
  return message === NEEDS_KEY || message === KEY_REJECTED || message === KEY_REMOVED || message === KEY_UNREADABLE || message === KEY_FORBIDDEN;
}
