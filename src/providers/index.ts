import type { Provider } from './types.js';
import { agentSdkProvider } from './agentSdk.js';
import { messagesApiProvider } from './messagesApi.js';

export function selectProvider(): Provider {
  const name = (process.env.COLLABORATE_PROVIDER ?? 'sdk').toLowerCase();
  if (name === 'api') return messagesApiProvider;
  if (name === 'sdk') return agentSdkProvider;
  throw new Error(`Unknown COLLABORATE_PROVIDER "${name}". Use sdk or api.`);
}
