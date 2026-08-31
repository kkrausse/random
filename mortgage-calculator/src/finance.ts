export type Mode = 'percent' | 'amount'

export type StateCode = 'CA'
export type FilingStatus = 'single' | 'mfj'

export const STATE_LABELS: Record<StateCode, string> = {
  CA: 'California',
}

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  mfj: 'Married, Filing Jointly',
}

export const FEDERAL_INTEREST_CAP = 750_000
// SALT cap on state+local taxes deductible federally. Raised from $10k → $40k
// by OBBBA for 2025–2029. We only model property tax here, so this is an
// upper bound — state income tax would consume part of the cap in reality.
export const FEDERAL_SALT_CAP = 40_000
export const STATE_INTEREST_CAPS: Record<StateCode, number> = {
  CA: 1_000_000,
}

type Bracket = { rate: number; min: number }

// IRS 2025 federal income tax brackets.
const FED_BRACKETS_2025: Record<FilingStatus, Bracket[]> = {
  single: [
    { rate: 0.10, min: 0 },
    { rate: 0.12, min: 11_925 },
    { rate: 0.22, min: 48_475 },
    { rate: 0.24, min: 103_350 },
    { rate: 0.32, min: 197_300 },
    { rate: 0.35, min: 250_525 },
    { rate: 0.37, min: 626_350 },
  ],
  mfj: [
    { rate: 0.10, min: 0 },
    { rate: 0.12, min: 23_850 },
    { rate: 0.22, min: 96_950 },
    { rate: 0.24, min: 206_700 },
    { rate: 0.32, min: 394_600 },
    { rate: 0.35, min: 501_050 },
    { rate: 0.37, min: 751_600 },
  ],
}
const FED_STANDARD_DEDUCTION_2025: Record<FilingStatus, number> = {
  single: 15_000,
  mfj: 30_000,
}

// CA 2025 single-filer brackets. MFJ thresholds are exactly 2× single in CA.
const CA_BRACKETS_2025_SINGLE: Bracket[] = [
  { rate: 0.01, min: 0 },
  { rate: 0.02, min: 10_756 },
  { rate: 0.04, min: 25_499 },
  { rate: 0.06, min: 40_245 },
  { rate: 0.08, min: 55_866 },
  { rate: 0.093, min: 70_606 },
  { rate: 0.103, min: 360_659 },
  { rate: 0.113, min: 432_787 },
  { rate: 0.123, min: 721_314 },
]
const CA_STANDARD_DEDUCTION_2025: Record<FilingStatus, number> = {
  single: 5_540,
  mfj: 11_080,
}
// Mental Health Services Tax: 1% on taxable income over $1M, regardless of status.
const CA_MHST_THRESHOLD = 1_000_000
const CA_MHST_RATE = 0.01

export type Inputs = {
  homePrice: number
  downMode: Mode
  downPaymentPct: number
  downPaymentAmount: number
  interestRate: number
  loanTermYears: number
  propertyTaxRate: number
  insuranceMode: Mode
  homeInsurancePct: number
  homeInsuranceYearly: number
  hoaMonthly: number
  state: StateCode
  incomeYearly: number
  filingStatus: FilingStatus
}

export const defaultInputs: Inputs = {
  homePrice: 1_000_000,
  downMode: 'percent',
  downPaymentPct: 20,
  downPaymentAmount: 100_000,
  interestRate: 6.3,
  loanTermYears: 30,
  propertyTaxRate: 1.1,
  insuranceMode: 'percent',
  homeInsurancePct: 0.3,
  homeInsuranceYearly: 1500,
  hoaMonthly: 0,
  state: 'CA',
  incomeYearly: 300_000,
  filingStatus: 'mfj',
}

function monthlyPrincipalInterest(
  principal: number,
  annualRate: number,
  years: number,
) {
  if (principal <= 0) return 0
  const n = years * 12
  const r = annualRate / 100 / 12
  if (r === 0) return principal / n
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

function downPaymentFor(inputs: Inputs, homePrice: number) {
  if (inputs.downMode === 'percent') {
    return homePrice * (inputs.downPaymentPct / 100)
  }
  return Math.min(inputs.downPaymentAmount, homePrice)
}

function yearlyInsuranceFor(inputs: Inputs, homePrice: number) {
  return inputs.insuranceMode === 'percent'
    ? homePrice * (inputs.homeInsurancePct / 100)
    : inputs.homeInsuranceYearly
}

function progressiveTax(taxableIncome: number, brackets: Bracket[]): number {
  if (taxableIncome <= 0) return 0
  let tax = 0
  for (let i = 0; i < brackets.length; i++) {
    const lower = brackets[i].min
    if (taxableIncome <= lower) break
    const upper = i + 1 < brackets.length ? brackets[i + 1].min : Infinity
    tax += (Math.min(taxableIncome, upper) - lower) * brackets[i].rate
  }
  return tax
}

function caBrackets(filingStatus: FilingStatus): Bracket[] {
  const scale = filingStatus === 'mfj' ? 2 : 1
  return CA_BRACKETS_2025_SINGLE.map((b) => ({ ...b, min: b.min * scale }))
}

function caTax(taxableIncome: number, filingStatus: FilingStatus): number {
  const base = progressiveTax(taxableIncome, caBrackets(filingStatus))
  const mhst = Math.max(0, taxableIncome - CA_MHST_THRESHOLD) * CA_MHST_RATE
  return base + mhst
}

// Marginal tax savings from itemizing the mortgage vs. taking standard deduction.
// Compares tax(income - standard) to tax(income - max(standard, itemized)).
function netTaxSavingsYearly(
  income: number,
  filingStatus: FilingStatus,
  fedItemized: number,
  stateItemized: number,
): { fed: number; state: number; total: number } {
  const fedStd = FED_STANDARD_DEDUCTION_2025[filingStatus]
  const fedDed = Math.max(fedStd, fedItemized)
  const fedBrackets = FED_BRACKETS_2025[filingStatus]
  const fed =
    progressiveTax(Math.max(0, income - fedStd), fedBrackets) -
    progressiveTax(Math.max(0, income - fedDed), fedBrackets)

  const stateStd = CA_STANDARD_DEDUCTION_2025[filingStatus]
  const stateDed = Math.max(stateStd, stateItemized)
  const state =
    caTax(Math.max(0, income - stateStd), filingStatus) -
    caTax(Math.max(0, income - stateDed), filingStatus)

  return { fed, state, total: fed + state }
}

export type Breakdown = {
  principalInterestMonthly: number
  propertyTaxYearly: number
  insuranceYearly: number
  hoaYearly: number
  totalMonthly: number
  loan: number
  downPayment: number
  firstYearInterest: number
  deductibleFederalYearly: number
  deductibleStateYearly: number
  netSavingsYearly: number
}

export function computeBreakdown(inputs: Inputs, homePrice: number): Breakdown {
  const down = downPaymentFor(inputs, homePrice)
  const loan = Math.max(homePrice - down, 0)
  const piMonthly = monthlyPrincipalInterest(
    loan,
    inputs.interestRate,
    inputs.loanTermYears,
  )
  const propertyTaxYearly = homePrice * (inputs.propertyTaxRate / 100)
  const insuranceYearly = yearlyInsuranceFor(inputs, homePrice)
  const hoaYearly = inputs.hoaMonthly * 12

  // Sum interest over the first 12 months as principal pays down.
  const r = inputs.interestRate / 100 / 12
  let balance = loan
  let firstYearInterest = 0
  for (let i = 0; i < 12 && balance > 0; i++) {
    const monthInterest = balance * r
    firstYearInterest += monthInterest
    balance -= piMonthly - monthInterest
  }

  const fedDeductibleInterest =
    loan > 0
      ? firstYearInterest * (Math.min(loan, FEDERAL_INTEREST_CAP) / loan)
      : 0
  const stateCap = STATE_INTEREST_CAPS[inputs.state]
  const stateDeductibleInterest =
    loan > 0 ? firstYearInterest * (Math.min(loan, stateCap) / loan) : 0
  const fedDeductibleTax = Math.min(propertyTaxYearly, FEDERAL_SALT_CAP)

  const fedItemized = fedDeductibleInterest + fedDeductibleTax
  const stateItemized = stateDeductibleInterest + propertyTaxYearly
  const savings = netTaxSavingsYearly(
    inputs.incomeYearly,
    inputs.filingStatus,
    fedItemized,
    stateItemized,
  )

  const totalMonthly =
    piMonthly + propertyTaxYearly / 12 + insuranceYearly / 12 + inputs.hoaMonthly

  return {
    principalInterestMonthly: piMonthly,
    propertyTaxYearly,
    insuranceYearly,
    hoaYearly,
    totalMonthly,
    loan,
    downPayment: down,
    firstYearInterest,
    deductibleFederalYearly: fedItemized,
    deductibleStateYearly: stateItemized,
    netSavingsYearly: savings.total,
  }
}
