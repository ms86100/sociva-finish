import { registerPlugin } from '@capacitor/core';
import type { SocivaVoipPlugin } from './definitions';

const noop: SocivaVoipPlugin = {
  registerVoipToken: async () => ({ ok: false }),
  requestCallPermissions: async () => ({ mic: false }),
  reportIncomingCall: async () => ({ ok: false }),
  endNativeCall: async () => {},
  setMuted: async () => {},
  setSpeaker: async () => {},
  addListener: async () => ({ remove: async () => {} }),
};

export const SocivaVoip = registerPlugin<SocivaVoipPlugin>('SocivaVoip', {
  web: noop as any,
});

export type { SocivaVoipPlugin } from './definitions';
