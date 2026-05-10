// Wire types for Claude Code's stream-json + control protocol.
// Outgoing: written to claude's stdin, one JSON object per line.
// Incoming: parsed from claude's stdout, one JSON object per line.

export type { PermissionMode } from '../shared/types.ts';
import type { PermissionMode } from '../shared/types.ts';

export type ImageContentBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
};
export type TextContentBlock = { type: 'text'; text: string };
export type UserContentBlock = TextContentBlock | ImageContentBlock;

export type OutgoingUserMessage = {
  type: 'user';
  message: { role: 'user'; content: string | UserContentBlock[] };
};

export type ControlRequestEnvelope = {
  type: 'control_request';
  request_id: string;
  request:
    | { subtype: 'initialize'; hooks?: unknown }
    | { subtype: 'set_permission_mode'; mode: PermissionMode }
    | { subtype: 'interrupt' };
};

export type ControlResponseEnvelope = {
  type: 'control_response';
  response:
    | { subtype: 'success'; request_id: string; response?: unknown }
    | { subtype: 'error'; request_id: string; error?: string };
};

export type IncomingMessage =
  | {
      type: 'control_request';
      request_id: string;
      request:
        | {
            subtype: 'can_use_tool';
            tool_name: string;
            input: unknown;
            permission_suggestions?: unknown;
            blocked_paths?: string;
            tool_use_id?: string;
          }
        | {
            subtype: 'hook_callback';
            callback_id: string;
            input: unknown;
            tool_use_id?: string;
          };
    }
  | { type: 'control_response'; response: unknown }
  | { type: 'control_cancel_request'; request_id: string }
  | { type: 'result'; [k: string]: unknown }
  | { type: string; [k: string]: unknown };

// Allow/deny response we send back when claude asks "can I use this tool?"
export type PermissionAllow = {
  behavior: 'allow';
  updatedInput: unknown;
  updatedPermissions?: unknown;
};

export type PermissionDeny = {
  behavior: 'deny';
  message: string;
  interrupt?: boolean;
};

export type PermissionResult = PermissionAllow | PermissionDeny;
