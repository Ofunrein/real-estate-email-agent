export type ProviderErrorCode =
  | "PROVIDER_NOT_CONNECTED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_BAD_REQUEST"
  | "PROVIDER_CONFLICT";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly provider: string;
  readonly cause?: unknown;

  constructor(code: ProviderErrorCode, provider: string, message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.provider = provider;
    this.cause = options.cause;
  }
}

export function providerUnavailable(provider: string, message: string, cause?: unknown): ProviderError {
  return new ProviderError("PROVIDER_UNAVAILABLE", provider, message, { cause });
}

export function providerNotConnected(provider: string, message: string, cause?: unknown): ProviderError {
  return new ProviderError("PROVIDER_NOT_CONNECTED", provider, message, { cause });
}

export function providerBadRequest(provider: string, message: string, cause?: unknown): ProviderError {
  return new ProviderError("PROVIDER_BAD_REQUEST", provider, message, { cause });
}
