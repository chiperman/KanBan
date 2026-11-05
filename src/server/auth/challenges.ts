import { randomUUID } from "node:crypto";

type Context = { purpose: "login" | "register"; origin: string; rpID: string; credentialId: string | null };
type Challenge = Context & { challenge: string; expiresAt: number };
type State = { challenges: Map<string, Challenge>; pending: Promise<unknown> };
const scope = globalThis as typeof globalThis & { __kanbanChallenges?: State };
function state(): State {
  return scope.__kanbanChallenges ??= { challenges: new Map(), pending: Promise.resolve() };
}

/** Single-process deployment, just like owner sessions. Restart invalidates all challenges. */
export function issueChallenge(context: Context, challenge: string, previous: string | null, now: Date): string {
  const challenges = state().challenges;
  if (previous) challenges.delete(previous);
  for (const [key, value] of challenges) if (value.expiresAt <= now.getTime()) challenges.delete(key);
  // Keep anonymous options requests from growing memory without limit.
  while (challenges.size >= 1000) challenges.delete(challenges.keys().next().value!);
  const token = randomUUID();
  challenges.set(token, { ...context, challenge, expiresAt: now.getTime() + 300_000 });
  return token;
}

/** Delete synchronously before any asynchronous signature verification or storage. */
export function consumeChallenge(token: string | null, context: Context, now: Date): string | null {
  if (!token) return null;
  const challenges = state().challenges;
  const record = challenges.get(token);
  challenges.delete(token);
  return record && record.expiresAt > now.getTime() && record.purpose === context.purpose &&
    record.origin === context.origin && record.rpID === context.rpID && record.credentialId === context.credentialId
    ? record.challenge : null;
}

/** Serialize owner credential updates, including separate registration challenges. */
export function withOwnerCredentialLock<T>(operation: () => Promise<T>): Promise<T> {
  const slot = state();
  const result = slot.pending.then(operation, operation);
  slot.pending = result.then(() => undefined, () => undefined);
  return result;
}

export function clearChallenges(): void { state().challenges.clear(); }
