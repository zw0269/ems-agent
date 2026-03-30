export type AlarmPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type FaultCategory = 'hardware' | 'software';

export interface Alarm {
  alarmId: string;
  alarmType: string;
  faultCategory: FaultCategory;
  deviceId: string;
  timestamp: string;
  priority: AlarmPriority;
}

export interface TelemetryData {
  [key: string]: any;
  timestamp: string;
  deviceId: string;
}

export interface Violation {
  field: string;
  value: any;
  threshold: any;
  message: string;
  timestamp: string;
}

export type LLMResponseType = 'final_answer' | 'tool_call';

export interface LLMResponse {
  type: LLMResponseType;
  text?: string | undefined;
  toolName?: string | undefined;
  toolCallId?: string | undefined;
  args?: any;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * 内部统一消息格式（OpenAI 风格）
 * exactOptionalPropertyTypes: 可选字段使用 T | undefined 明确允许 undefined 值
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string | undefined;
  tool_call_id?: string | undefined;
  tool_calls?: ToolCall[] | undefined;
}
