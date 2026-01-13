export type ElymentsSession = {
  userId: string;
  accessToken: string;
  chatAccessToken: string;
  refreshToken?: string;
  savedAt?: string;
};

export type ElymentsDevice = {
  deviceId: string;
  deviceToken: string;
  platform: "WEB" | "MOBILE";
  resource: string;
  createdAt: string;
};

export type ElymentsProfile = {
  senderName?: string;
  userId?: string;
  updatedAt?: string;
};

export type OtpRequest = {
  countryCode: string;
  phoneNumber: string;
};

export type OtpVerifyRequest = OtpRequest & {
  otp: string;
  deviceToken?: string;
  platformType?: string;
};

export type ChatSummary = {
  id: string;
  jid: string;
  isGroup: boolean;
  title: string;
  lastMessage?: string;
  raw: unknown;
};

export type RecipientEntry = {
  jid: string;
  title: string;
  isGroup: boolean;
  numbers: string[];
  updatedAt: string;
};

export type ElymentsMessage = {
  id: string;
  jid: string;
  from: string;
  to: string;
  type: "chat" | "groupchat";
  text?: string;
  senderName?: string;
  messageId?: string;
  timestamp?: string;
  raw: unknown;
};

export type SendTextRequest = {
  jid: string;
  text: string;
  senderName: string;
  isGroup?: boolean;
  origin?: string;
  lang?: string;
};

export type ResolvedRecipient = {
  jid: string;
  isGroup: boolean;
  title: string;
};
