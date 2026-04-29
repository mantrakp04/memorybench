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
- Treat "triplet" content as remembered graph relationships.
- If the retrieved memories do not answer the question, respond with "I don't know".

Answer:`
  },
}
