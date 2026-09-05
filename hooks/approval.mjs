// One definition for both gates that re-arm on a new prompt (advisor-inject, git-discipline):
// two notions of "approval" would re-arm them on different turns. The cap stays tight because
// a wrong reset costs one re-consult, while a wrong keep lets unconsulted work through silently.
export const isApproval = (prompt) =>
  prompt.length <= 24 &&
  /^(onayl|onay|evet|devam|tamam|olur|approve|ok\b|okay\b|go\b|yes\b|proceed)/i.test(prompt);
