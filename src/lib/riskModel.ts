import { clamp } from './formatters'

export type RiskLabel = 'Low' | 'Moderate' | 'High' | 'Critical'

export type RiskInputs = {
  utilizationStress: number
  debtSkewStress: number
  eventMomentumStress: number
}

export type RiskResult = {
  score: number
  label: RiskLabel
}

export function labelRisk(score: number): RiskLabel {
  if (score >= 75) return 'Critical'
  if (score >= 55) return 'High'
  if (score >= 30) return 'Moderate'
  return 'Low'
}

export function computeCompositeRiskScore(inputs: RiskInputs): RiskResult {
  const utilization = clamp(inputs.utilizationStress, 0, 100)
  const skew = clamp(inputs.debtSkewStress, 0, 100)
  const momentum = clamp(inputs.eventMomentumStress, 0, 100)

  const score = clamp(utilization * 0.45 + skew * 0.35 + momentum * 0.2, 0, 100)
  return {
    score,
    label: labelRisk(score),
  }
}
