"use client"

import { useState } from "react"
import {
  validateQuestionIdPatterns,
  type QuestionIdValidationResult,
} from "@/lib/question-id-validation"

interface QuestionIdSelectorProps {
  benchmark: string
  value: string
  onChange: (value: string) => void
  onValidationChange: (result: QuestionIdValidationResult | null) => void
  validation: QuestionIdValidationResult | null
  onError: (error: string | null) => void
}

export function QuestionIdSelector({
  benchmark,
  value,
  onChange,
  onValidationChange,
  validation,
  onError,
}: QuestionIdSelectorProps) {
  const [validating, setValidating] = useState(false)

  async function handleValidate() {
    if (!value.trim()) {
      onError("Please enter at least one question ID")
      return
    }
    if (!benchmark) {
      onError("Please select a benchmark first")
      return
    }

    setValidating(true)
    onError(null)
    try {
      const result = await validateQuestionIdPatterns(benchmark, value)
      onValidationChange(result)

      if (result.invalid.length > 0) {
        onError(`Invalid patterns: ${result.invalid.join(", ")}`)
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to validate question IDs")
    } finally {
      setValidating(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-text-secondary mb-2">
          Question IDs (comma-separated)
        </label>
        <textarea
          className="w-full px-3 py-2 text-sm bg-[#222222] border border-[#444444] rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent font-mono"
          rows={4}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            onValidationChange(null)
          }}
          placeholder="e.g., conv-30, conv-30-q0, conv-30-session_1"
        />
        <p className="text-xs text-text-muted mt-1">
          Enter question IDs, conversation/group prefixes (e.g., conv-26), or session IDs (e.g.,
          conv-26-session_1), separated by commas
        </p>
      </div>

      {/* Validation Button */}
      <button
        type="button"
        onClick={handleValidate}
        disabled={validating || !benchmark || !value.trim()}
        className="px-3 py-1.5 text-sm bg-[#222222] border border-[#444444] rounded text-text-primary hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {validating ? (
          <>
            <div className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin mr-2" />
            Validating...
          </>
        ) : (
          "Validate Question IDs"
        )}
      </button>

      {/* Validation Result */}
      {validation && (
        <div
          className={`p-3 rounded text-sm border ${
            validation.invalid.length === 0
              ? "bg-green-500/10 border-green-500/20 text-green-400"
              : "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
          }`}
        >
          <div className="font-medium mb-1">
            {validation.invalid.length === 0
              ? `✓ Valid: ${validation.total} patterns expanded to ${validation.expanded.length} questions`
              : `⚠ ${validation.valid.length} valid, ${validation.invalid.length} invalid patterns`}
          </div>
          {validation.invalid.length > 0 && (
            <div className="text-xs mt-1">
              Invalid: {validation.invalid.join(", ")}
            </div>
          )}
          {validation.expanded.length > 0 && (
            <div className="text-xs mt-2 opacity-80">
              Sample expanded IDs: {validation.expanded.slice(0, 5).join(", ")}
              {validation.expanded.length > 5 &&
                ` ...and ${validation.expanded.length - 5} more`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
