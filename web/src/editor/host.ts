// Code editor on CodeMirror 6 (spec section 9.1). One EditorView per workspace; each open
// file has its own state (text, undo history, message markers). Driven from code,
// React only gives it a place on the page.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { StreamLanguage, bracketMatching, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { verilog } from "@codemirror/legacy-modes/mode/verilog";
import { forEachDiagnostic, lintGutter, setDiagnostics, type Diagnostic as Mark } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";

// A message marker on a file line. Line and column count from one, as in the server response.
export interface EditorMark {
  path: string;
  line: number;
  column: number | null;
  severity: "error" | "warning" | "info"; // error, important warning, note
  message: string;
}

export interface EditorEvents {
  onChange(path: string, text: string): void;
  onSave(): void;
  onBuild(): void;
}

const VERILOG_FILE = /\.(v|vh|sv|svh)$/i;

export class EditorHost {
  private view: EditorView | null = null;
  private readonly states = new Map<string, EditorState>();
  private marks: EditorMark[] = [];
  private path: string | null = null;

  constructor(private readonly events: EditorEvents) {}

  mount(parent: HTMLElement): void {
    const state = this.path === null ? undefined : this.states.get(this.path);
    this.view = new EditorView(state ? { parent, state } : { parent });
  }

  unmount(): void {
    this.keep();
    this.view?.destroy();
    this.view = null;
  }

  // Project change: file states of the previous project are erased.
  clear(): void {
    this.states.clear();
    this.marks = [];
    this.path = null;
    this.view?.setState(EditorState.create());
  }

  // Shows a file. The text is needed only on first open: after that the editor state rules.
  open(path: string, text: string): void {
    this.keep();
    let state = this.states.get(path);
    if (!state) {
      state = this.withMarks(path, EditorState.create({ doc: text, extensions: this.extensions(path) }));
      this.states.set(path, state);
    }
    this.path = path;
    this.view?.setState(state);
  }

  // The file text was replaced outside the editor (a dialog wrote fpgasim.json): the open state
  // is created again, and the undo history of this file is erased.
  replace(path: string, text: string): void {
    this.keep();
    if (!this.states.has(path)) return;
    const state = this.withMarks(path, EditorState.create({ doc: text, extensions: this.extensions(path) }));
    this.states.set(path, state);
    if (this.path === path) this.view?.setState(state);
  }

  // The file was deleted or renamed: its state is erased.
  close(path: string): void {
    this.keep();
    this.states.delete(path);
    if (this.path !== path) return;
    this.path = null;
    this.view?.setState(EditorState.create());
  }

  // The file text if it was opened; otherwise undefined.
  text(path: string): string | undefined {
    this.keep();
    return this.states.get(path)?.doc.toString();
  }

  // Replaces message markers in all open files.
  setMarks(marks: EditorMark[]): void {
    this.keep();
    this.marks = marks;
    for (const [path, state] of this.states) {
      // An open file is edited through EditorView: replacing the state would reset scrolling.
      if (path === this.path && this.view) this.view.dispatch(setDiagnostics(state, this.marksFor(path, state)));
      else this.states.set(path, this.withMarks(path, state));
    }
  }

  // Cursor to a line and column of the open file, with scrolling and focus.
  goto(line: number, column: number | null): void {
    const view = this.view;
    if (!view) return;
    const doc = view.state.doc;
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
    const at = Math.min(target.from + Math.max((column ?? 1) - 1, 0), target.to);
    view.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: "center" }) });
    view.focus();
  }

  // Data for window.__fpgasim: the open file, the cursor position, the markers in it.
  snapshot(): { path: string | null; line: number; column: number; marks: { line: number; severity: string }[] } {
    const state = this.view?.state;
    if (!state || this.path === null) return { path: null, line: 0, column: 0, marks: [] };
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const marks: { line: number; severity: string }[] = [];
    forEachDiagnostic(state, (mark, from) => {
      marks.push({ line: state.doc.lineAt(from).number, severity: mark.severity });
    });
    return { path: this.path, line: line.number, column: head - line.from + 1, marks };
  }

  // The state from EditorView returns to the table before any access to it.
  private keep(): void {
    if (this.view && this.path !== null) this.states.set(this.path, this.view.state);
  }

  private withMarks(path: string, state: EditorState): EditorState {
    return state.update(setDiagnostics(state, this.marksFor(path, state))).state;
  }

  private marksFor(path: string, state: EditorState): Mark[] {
    const doc = state.doc;
    return this.marks
      .filter((m) => m.path === path && m.line >= 1 && m.line <= doc.lines)
      .map((m) => {
        const line = doc.line(m.line);
        const from = Math.min(line.from + Math.max((m.column ?? 1) - 1, 0), line.to);
        return { from, to: line.to, severity: m.severity, message: m.message };
      })
      .sort((a, b) => a.from - b.from);
  }

  private extensions(path: string): Extension[] {
    const run = (action: () => void) => () => {
      action();
      return true;
    };
    return [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      bracketMatching(),
      indentUnit.of("    "),
      syntaxHighlighting(classHighlighter),
      search({ top: true }),
      highlightSelectionMatches(),
      lintGutter(),
      VERILOG_FILE.test(path) ? StreamLanguage.define(verilog) : [],
      keymap.of([
        {
          key: "Mod-s",
          run: run(() => {
            this.events.onSave();
          }),
        },
        {
          key: "Mod-Enter",
          run: run(() => {
            this.events.onBuild();
          }),
        },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) this.events.onChange(path, update.state.doc.toString());
      }),
    ];
  }
}
