import { expandQuestionIdPatterns } from "./api"

export interface QuestionIdValidationResult {
  valid: string[]
  invalid: string[]
  total: number
  expanded: string[]
  patternResults: Record<string, string[]>
}

/**
 * Validates question ID patterns against a benchmark by calling the server's expand-ids endpoint.
 * The server handles all validation — patterns that don't match any questions are reported as invalid.
 */
export async function validateQuestionIdPatterns(
  benchmark: string,
  questionIdsInput: string
): Promise<QuestionIdValidationResult> {
  // Parse input: split by comma, trim, remove empty, deduplicate
  const inputPatterns = questionIdsInput
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
  const uniquePatterns = [...new Set(inputPatterns)]

  // Server expands patterns and validates against the benchmark's questions
  const expansionResult = await expandQuestionIdPatterns(benchmark, uniquePatterns)

  // Patterns that didn't expand to anything are invalid
  const patternsWithNoResults = uniquePatterns.filter(
    (pattern) =>
      !expansionResult.patternResults[pattern] ||
      expansionResult.patternResults[pattern].length === 0
  )

  return {
    valid: expansionResult.expandedIds,
    invalid: patternsWithNoResults,
    total: uniquePatterns.length,
    expanded: expansionResult.expandedIds,
    patternResults: expansionResult.patternResults,
  }
}
