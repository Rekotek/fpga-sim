// The assistant's conversation (decision 175). The browser runs the tool loop: it sends the conversation to the
// server, runs the tools the model asks for on the live project and sends the results back, at most MAX_CALLS
// times per question. The conversation belongs to the open project and lives in memory only.
import { create } from "zustand";
import { ServerError } from "../build/client";
import type { AssistantBlock, AssistantMessage, AssistantReply } from "../build/types";
import { runTool, type ToolSource } from "./tools";

export const MAX_CALLS = 10;

export interface Turn {
  question: string;
  answer: string;
  tools: string[];
  tokens: number;
  error: string | null; // the server text, or "refused", "cutoff", "noAnswer" (the panel names them)
  stopped: boolean;
  capped: boolean;
}

interface ConversationState {
  turns: Turn[];
  busy: boolean;
  step: string | null; // the tool running now
  history: AssistantMessage[];
  generation: number; // grows on every reset: a late reply of an old conversation is dropped
}

export interface AskDeps {
  call: (messages: AssistantMessage[], language: string) => Promise<AssistantReply>;
  source: ToolSource;
  language: string;
}

export const useConversation = create<ConversationState>(() => ({
  turns: [],
  busy: false,
  step: null,
  history: [],
  generation: 0,
}));

let stopRequested = false;

export function stop(): void {
  stopRequested = true;
}

// Read through a call: stop() changes the flag while ask() waits for the server.
const stopping = (): boolean => stopRequested;

export function resetConversation(): void {
  stopRequested = false;
  useConversation.setState((s) => ({ turns: [], busy: false, step: null, history: [], generation: s.generation + 1 }));
}

// The question joins the last user turn when the previous answer ended on tool results (stop, cap):
// the roles must keep alternating.
function withQuestion(history: AssistantMessage[], question: string): AssistantMessage[] {
  const last = history.at(-1);
  if (last?.role !== "user") return [...history, { role: "user", content: question }];
  const blocks: AssistantBlock[] =
    typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
  return [...history.slice(0, -1), { role: "user", content: [...blocks, { type: "text", text: question }] }];
}

// The server text of a failure; "noAnswer" when there is none (a proxy timeout, no network).
function errorText(e: unknown): string {
  if (e instanceof ServerError && e.code === "NETWORK") return "noAnswer";
  const text = e instanceof Error ? e.message.trim() : "";
  return text || "noAnswer";
}

const toolUses = (content: AssistantBlock[]): AssistantBlock[] => content.filter((b) => b.type === "tool_use");

export async function ask(question: string, deps: AskDeps): Promise<void> {
  const start = useConversation.getState();
  if (start.busy) return;
  const generation = start.generation;
  const index = start.turns.length;
  const turn: Turn = { question, answer: "", tools: [], tokens: 0, error: null, stopped: false, capped: false };
  let history = withQuestion(start.history, question);
  stopRequested = false;
  const current = (): boolean => useConversation.getState().generation === generation;
  const show = (busy: boolean, step: string | null = null): void => {
    useConversation.setState((s) => ({
      busy,
      step,
      turns: [...s.turns.slice(0, index), { ...turn, tools: [...turn.tools] }],
    }));
  };
  show(true);
  try {
    for (let calls = 1; ; calls++) {
      const reply = await deps.call(history, deps.language);
      if (!current()) return;
      const u = reply.usage;
      turn.tokens += u.input + u.output + u.cacheRead + u.cacheWrite;
      history = [...history, { role: "assistant", content: reply.content }];
      const text = reply.content.filter((b) => b.type === "text").map((b) => String(b.text));
      if (text.length > 0) turn.answer = text.join("\n\n");
      const pending = toolUses(reply.content);
      if (reply.stop_reason !== "tool_use" || pending.length === 0) {
        if (text.length === 0) {
          // Refused or cut off before any answer: the turn leaves no trace, the conversation stays valid.
          turn.error = reply.stop_reason === "refusal" ? "refused" : "cutoff";
          history = start.history;
        } else if (pending.length > 0) {
          // Cut off inside a tool call after some text: the calls are closed so that the roles stay valid.
          const closing = pending.map((b) => ({
            type: "tool_result",
            tool_use_id: b.id,
            content: "answer cut off",
            is_error: true,
          }));
          history = [...history, { role: "user", content: closing }];
        }
        break;
      }
      turn.stopped = stopping();
      turn.capped = !turn.stopped && calls >= MAX_CALLS;
      const results = pending.map((b) => {
        if (turn.stopped || turn.capped) {
          const why = turn.stopped ? "stopped by the user" : "call limit reached";
          return { type: "tool_result", tool_use_id: b.id, content: why, is_error: true };
        }
        const name = String(b.name);
        turn.tools.push(name);
        show(true, name);
        let out: { text: string; error: boolean };
        try {
          out = runTool(name, (b.input ?? {}) as Record<string, unknown>, deps.source);
        } catch (e) {
          // A failed reader does not end the answer: the model gets the error and can go on.
          out = { text: `tool failed: ${e instanceof Error ? e.message : String(e)}`, error: true };
        }
        return { type: "tool_result", tool_use_id: b.id, content: out.text, ...(out.error ? { is_error: true } : {}) };
      });
      history = [...history, { role: "user", content: results }];
      if (turn.stopped || turn.capped) break;
      show(true);
    }
  } catch (e) {
    if (!current()) return;
    // The failed turn leaves no trace in the conversation: the next question starts from the last good state.
    turn.error = errorText(e);
    history = start.history;
  }
  if (!current()) return;
  show(false);
  useConversation.setState({ history });
}
