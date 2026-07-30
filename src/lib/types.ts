export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export type Filter = {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  search?: string;
} & { [tag: `#${string}`]: string[] | undefined };

export interface Channel {
  id: string;
  name: string;
  about?: string;
}

export interface Message {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  channelId: string;
}

export interface UserStatus {
  text: string;
  emoji: string;
}
