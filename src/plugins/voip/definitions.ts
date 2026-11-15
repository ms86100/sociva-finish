export type VoipPlatform = 'ios_pushkit' | 'android_fcm';

export interface SocivaVoipPlugin {
  /** Start / refresh PushKit registration; Android may pass FCM token. */
  registerVoipToken(opts?: { token?: string; platform?: VoipPlatform }): Promise<{
    ok: boolean;
    token?: string;
    platform?: string;
    reason?: string;
  }>;
  /** Request mic (and Android phone-account where needed). */
  requestCallPermissions(): Promise<{ mic: boolean; phoneAccount?: boolean }>;
  /** Report an incoming call to CallKit / in-app ring. */
  reportIncomingCall(opts: {
    callId: string;
    callerName: string;
    payload?: Record<string, unknown>;
  }): Promise<{ ok: boolean; reason?: string; mode?: string }>;
  endNativeCall(opts: { callId: string }): Promise<void>;
  setMuted(opts: { muted: boolean }): Promise<void>;
  setSpeaker(opts: { speaker: boolean }): Promise<void>;
  addListener(
    eventName: 'voipToken' | 'incoming' | 'accepted' | 'ended' | 'audioRoute',
    callback: (data: any) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}
