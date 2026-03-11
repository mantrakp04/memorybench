import { Tiktoken } from "js-tiktoken"
import cl100k_base from "js-tiktoken/ranks/cl100k_base"
import o200k_base from "js-tiktoken/ranks/o200k_base"
import { countTokens as countAnthropicTokens } from "@anthropic-ai/tokenizer"
import type { ModelConfig } from "./models"

/**
 * Count tokens in a text string based on the model being used
 */
export function countTokens(text: string, modelConfig: ModelConfig): number {
  const provider = modelConfig.provider

  if (provider === "openai") {
    return countOpenAITokens(text, modelConfig.id)
  } else if (provider === "anthropic") {
    return countAnthropicTokens(text)
  } else if (provider === "google") {
    // Google doesn't have a standard tokenizer for JS
    // Use approximation: ~4 characters per token
    return Math.ceil(text.length / 4)
  }

  // Fallback approximation
  return Math.ceil(text.length / 4)
}

/**
 * Count tokens for OpenAI models using tiktoken
 */
function countOpenAITokens(text: string, modelId: string): number {
  // Determine which encoding to use based on model
  // o200k_base is used for GPT-4o and newer models
  // cl100k_base is used for GPT-4, GPT-3.5-turbo
  try {
    let encoding: Tiktoken

    if (
      modelId.includes("gpt-4o") ||
      modelId.includes("gpt-4.1") ||
      modelId.includes("gpt-5")
    ) {
      encoding = new Tiktoken(o200k_base)
    } else {
      // Default to cl100k_base for other GPT-4 models
      encoding = new Tiktoken(cl100k_base)
    }

    const tokens = encoding.encode(text)
    return tokens.length
  } catch (error) {
    // Fallback to approximation if encoding fails
    return Math.ceil(text.length / 4)
  }
}
