// Public routing contract; credentials belong only to the web server.
export const modelPrefix = '/api/model/';
export const enabledProviders = ['opencode'] as const;
export function modelBaseURL(origin: string, providerID: string) {
  return `${origin}${modelPrefix}${encodeURIComponent(providerID)}`;
}
