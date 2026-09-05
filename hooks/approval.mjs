// The two prompt shapes git-discipline's re-arming gate turns on, kept out of it so the
// definitions have one home.

// The cap stays tight because a wrong reset only re-arms the workflow gate once, while a
// wrong keep lets an un-gated command through silently.
export const isApproval = (prompt) => {
  const text = prompt.trim();
  return text.length <= 24
    && /^(onayl|onay|evet|devam|tamam|olur|approve|ok\b|okay\b|go\b|yes\b|proceed)/i.test(text);
};

// A background subagent finishing arrives through UserPromptSubmit like real user input, so a
// gate re-arming here would re-arm on the return of the very consult that opened it. Each tag
// carries a sibling token so a user quoting one while debugging still reads as a task.
export const isNotification = (prompt) => {
  const text = prompt.trim();
  return /^\[SYSTEM NOTIFICATION - NOT USER INPUT\]/.test(text)
    || /^<task-notification>\s*<task-id>/.test(text)
    || /^<agent-message [^>]*from="/.test(text);
};
