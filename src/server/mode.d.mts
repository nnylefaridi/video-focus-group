export type Mode = "local" | "hosted";
export type Env = Record<string, string | undefined>;

export class StartupError extends Error {}
export function parseMode(value: string | undefined): Mode;
export function parseEnvFile(text: string): Record<string, string>;
export function readEnvFiles(dir?: string, nodeEnv?: string): Record<string, string>;
export function startupEnv(dir?: string, nodeEnv?: string): Env;
export function publicOriginOf(value: string | undefined): string | null;
export function canonicalLocation(method: string | undefined, url: string | undefined, host: string | undefined, publicOrigin: string | null): string | null;
export function encryptionSecretOf(value: string | undefined): Buffer | null;
export function mediaSecretOf(value: string | undefined): Buffer | null;
export function hostedProblems(env: Env): { missing: string[]; invalid: string[] };
export function checkStartup(env: Env): { mode: Mode };
export function exitUnlessReady(env: Env): Mode;
export function listenAddress(mode: Mode, env: Env): { hostname: string; port: number };
export function trustedProxyCount(env: Env): number;
export function forwardedClient(forwardedFor: string | null | undefined, trustedProxies: number): string;
