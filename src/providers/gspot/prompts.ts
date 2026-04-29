import type { ProviderPrompts } from "../../types/prompts"

export const GSPOT_PROMPTS: ProviderPrompts = {
  answerPrompt(question, context, questionDate) {
    return `You are answering from g-spot's local memory graph/vector search results.

Question: ${question}
Question Date: ${questionDate || "Not specified"}

Retrieved memories:
${JSON.stringify(context, null, 2)}

Instructions:
- Use only the retrieved memories.
- Treat "observation" content as remembered conversation facts.
- Prefer "Full conversation session" observations when a question needs adjacent turns, lists, titles, or relative dates.
- Treat "triplet" content as remembered graph relationships.
- For relative dates, anchor phrases like "this week", "last week", and "last year" to the timestamp in the retrieved memory or the Question Date.
- If the memory says "this week", answer with "the week of <date>" instead of a single exact day unless the exact day is explicit.
- If the retrieved memory gives a relative weekday and deriving the exact calendar date would be uncertain, preserve the relative phrasing.
- For list questions, return only the requested items; avoid adding related but unasked activities or symbols.
- If the retrieved memories do not answer the question, respond with "I don't know".

Answer:`
  },
}
