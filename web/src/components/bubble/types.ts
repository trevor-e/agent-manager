export type AssistantBubble = { kind: 'assistant'; id: string; messageId: string; text: string };
export type UserImage = { dataUrl: string };
export type UserBubble = { kind: 'user'; id: string; text: string; images?: UserImage[] };
export type ToolUseBubble = {
  kind: 'tool_use';
  id: string;
  toolUseId: string;
  toolName: string;
  input: any;
  status: 'pending' | 'allowed' | 'denied' | 'completed';
  result?: string;
  resultIsError?: boolean;
  startedAt?: number;
  endedAt?: number;
};
export type SystemBubble = { kind: 'system'; id: string; text: string };

export type QueuedBubble = { kind: 'queued'; id: string; text: string; images?: UserImage[] };

export type Bubble = AssistantBubble | UserBubble | ToolUseBubble | SystemBubble;
