import { logger } from "./logger"

export interface ValidateQuestionIdsResult {
  validIds: string[]
  invalidIds: string[]
}

/**
 * Validates a list of question IDs against the full set of questions in a benchmark.
 * Returns valid and invalid IDs separately. Throws if all IDs are invalid.
 */
export function validateQuestionIds(
  questionIds: string[],
  allQuestions: { questionId: string }[],
  benchmarkName: string
): ValidateQuestionIdsResult {
  const allQuestionIdsSet = new Set(allQuestions.map((q) => q.questionId))
  const validIds: string[] = []
  const invalidIds: string[] = []

  for (const id of questionIds) {
    if (allQuestionIdsSet.has(id)) {
      validIds.push(id)
    } else {
      invalidIds.push(id)
    }
  }

  if (invalidIds.length > 0) {
    logger.warn(`Invalid question IDs (will be skipped): ${invalidIds.join(", ")}`)
  }

  if (validIds.length === 0) {
    throw new Error(
      `All provided questionIds are invalid. No matching questions found in benchmark "${benchmarkName}". ` +
        `Invalid IDs: ${invalidIds.join(", ")}`
    )
  }

  logger.info(
    `Using explicit questionIds: ${validIds.length} valid questions` +
      (invalidIds.length > 0 ? ` (${invalidIds.length} invalid skipped)` : "")
  )

  return { validIds, invalidIds }
}
