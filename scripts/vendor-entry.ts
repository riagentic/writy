// One bundle for the editor stack: a single ProseMirror instance (no duplicate
// prosemirror-model), offline dev, identical dev/prod. Rebuild: scripts/vendor.sh
export * as model from "prosemirror-model";
export * as state from "prosemirror-state";
export * as view from "prosemirror-view";
export * as transform from "prosemirror-transform";
export * as commands from "prosemirror-commands";
export * as keymap from "prosemirror-keymap";
export * as history from "prosemirror-history";
export * as inputrules from "prosemirror-inputrules";
export * as schemaList from "prosemirror-schema-list";
export * as tables from "prosemirror-tables";
export * as dropcursor from "prosemirror-dropcursor";
export * as gapcursor from "prosemirror-gapcursor";
export * as cmState from "@codemirror/state";
export * as cmView from "@codemirror/view";
export * as cmCommands from "@codemirror/commands";
export * as cmLanguage from "@codemirror/language";
export * as cmSearch from "@codemirror/search";
export * as lezerHighlight from "@lezer/highlight";
