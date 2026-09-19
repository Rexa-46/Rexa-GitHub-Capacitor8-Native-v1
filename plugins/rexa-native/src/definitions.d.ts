export interface SpeechResult { text: string; }
export interface SpeechAvailableResult { available: boolean; }
export interface SmsMessage { id: string; address: string; body: string; date: number; }
export interface SmsPermissionResult { sms: "prompt" | "prompt-with-rationale" | "granted" | "denied"; }
export interface RexaNativePlugin {
  isSpeechAvailable(): Promise<SpeechAvailableResult>;
  startSpeech(options?: { language?: string }): Promise<SpeechResult>;
  stopSpeech(): Promise<void>;
  checkSmsPermissions(): Promise<SmsPermissionResult>;
  requestSmsPermissions(): Promise<SmsPermissionResult>;
  getRecentSms(options?: { limit?: number; since?: number }): Promise<{ messages: SmsMessage[] }>;
  getPendingSms(): Promise<{ messages: SmsMessage[] }>;
  addListener(eventName: "smsReceived", listenerFunc: (message: SmsMessage) => void): Promise<{ remove: () => Promise<void> }>;
}
