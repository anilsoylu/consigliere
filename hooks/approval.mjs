// The two prompt shapes both re-arming gates (advisor-inject, git-discipline) must agree on.
// Split definitions would re-arm them on different turns.

// The cap stays tight because a wrong reset costs one re-consult, while a wrong keep lets
// unconsulted work through silently.
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
