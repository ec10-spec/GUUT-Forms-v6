// Shared by GUUT AI (the panel) and the pages that hand questions to it.

// One-click analyses of the open form's responses (also offered under Responses, Charts).
export const ANALYSES = [
  ["Key insights", "Give me the key insights from this form's responses. Lead with the most important finding."],
  ["Trends and outliers", "What trends, patterns or outliers stand out in this form's responses? Tell me how confident we can be given the sample size."],
  ["Recommended actions", "Based on this form's responses, what should we do next? Give business-context suggestions in priority order."],
  ["Improve this form", "How could I improve this form's questions, options or length based on how people answered and skipped? Offer the changes so I can apply them."],
  ["Free-text themes", "What themes come up in the free-text answers? Group them and say how common each seems."],
];
/** Opens GUUT AI from anywhere; with send it asks straight away. */
export const askGuutAi = (prompt, { send = false, includeRaw } = {}) => window.dispatchEvent(new CustomEvent("guut:assistant-open", { detail: { prompt, send, includeRaw } }));
