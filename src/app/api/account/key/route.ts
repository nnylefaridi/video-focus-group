import { connection } from "next/server";
import { getViewer, signInResponse } from "@/server/auth";
import { getPaymentContext } from "@/server/billing";
import { checkAnthropicKey, deleteKey, getKeyInfo, KeyCheckFailed, normalizeKey, saveKey } from "@/server/apikeys";
import { LimitReached, limitResponse, spendKeyCheck } from "@/server/budget";
import { whoIsCalling } from "@/server/client";
import { isHosted } from "@/server/config";
import { KeyVaultUnavailable } from "@/server/keyvault";

/**
 * Hosted mode only: the account's own Anthropic API key. Nothing here ever sends the
 * key back; responses carry only its last 4 characters and when it was saved.
 */
const localOnly = () => Response.json({ error: "Saving your own API key is only for the hosted site. This copy of Panel uses the key in .env.local." }, { status: 404 });

export async function GET() {
  await connection();
  if (!isHosted()) return localOnly();
  const viewer = await getViewer();
  if (!viewer.userId) return signInResponse("Log in to see your API key.");
  return Response.json({ key: await getKeyInfo(viewer.userId) });
}

/** Saves or replaces the key, only once Anthropic has accepted it. */
export async function PUT(req: Request) {
  if (!isHosted()) return localOnly();
  const viewer = await getViewer();
  if (!viewer.userId) return signInResponse("Log in to save your API key.");
  const body = (await req.json().catch(() => null)) as { key?: unknown } | null;
  try {
    const key = normalizeKey(body?.key);
    await spendKeyCheck(whoIsCalling(req.headers, viewer.userId));
    await checkAnthropicKey(key);
    const info = await saveKey(viewer.userId, key);
    return Response.json({ key: info, payment: await getPaymentContext(viewer.userId) });
  } catch (e) {
    if (e instanceof KeyCheckFailed) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof LimitReached) return limitResponse(e);
    // Never pass on or log other errors as they are: they came from handling the key.
    console.error("[keys] saving a key failed:", e instanceof KeyVaultUnavailable ? e.message : e instanceof Error ? e.name : "unknown error");
    return Response.json({ error: "Couldn't save your key. Please try again." }, { status: 500 });
  }
}

/** Removes the key. Reviews running on it stop at their next call to Anthropic. */
export async function DELETE() {
  if (!isHosted()) return localOnly();
  const viewer = await getViewer();
  if (!viewer.userId) return signInResponse("Log in to remove your API key.");
  await deleteKey(viewer.userId);
  return Response.json({ key: null, payment: await getPaymentContext(viewer.userId) });
}
