import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'

type Mode = 'percent' | 'amount'

type Inputs = {
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
}

const defaultInputs: Inputs = {
  homePrice: 500_000,
  downMode: 'percent',
  downPaymentPct: 20,
  downPaymentAmount: 100_000,
  interestRate: 6.5,
  loanTermYears: 30,
  propertyTaxRate: 1.1,
  insuranceMode: 'percent',
  homeInsurancePct: 0.3,
  homeInsuranceYearly: 1500,
  hoaMonthly: 0,
}

// Short URL keys so the querystring stays compact.
const URL_KEYS: Record<keyof Inputs, string> = {
  homePrice: 'hp',
  downMode: 'dm',
  downPaymentPct: 'dp',
  downPaymentAmount: 'da',
  interestRate: 'ir',
  loanTermYears: 'lt',
  propertyTaxRate: 'pt',
  insuranceMode: 'im',
  homeInsurancePct: 'ip',
  homeInsuranceYearly: 'ia',
  hoaMonthly: 'hoa',
}

function readInputsFromUrl(): Inputs {
  if (typeof window === 'undefined') return defaultInputs
  const params = new URLSearchParams(window.location.search)
  const out: Inputs = { ...defaultInputs }
  ;(Object.keys(URL_KEYS) as (keyof Inputs)[]).forEach((key) => {
    const raw = params.get(URL_KEYS[key])
    if (raw === null) return
    if (key === 'downMode' || key === 'insuranceMode') {
      if (raw === 'p') out[key] = 'percent'
      else if (raw === 'a') out[key] = 'amount'
    } else {
      const n = Number(raw)
      if (Number.isFinite(n)) out[key] = n as never
    }
  })
  return out
}

function writeInputsToUrl(inputs: Inputs) {
  const params = new URLSearchParams()
  ;(Object.keys(URL_KEYS) as (keyof Inputs)[]).forEach((key) => {
    const v = inputs[key]
    if (v === defaultInputs[key]) return
    const encoded =
      key === 'downMode' || key === 'insuranceMode'
        ? v === 'percent'
          ? 'p'
          : 'a'
        : String(v)
    params.set(URL_KEYS[key], encoded)
  })
  const qs = params.toString()
  const url = qs ? `?${qs}` : window.location.pathname
  window.history.replaceState(null, '', url)
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
  // Fixed amount — never more than the home price.
  return Math.min(inputs.downPaymentAmount, homePrice)
}

function yearlyInsuranceFor(inputs: Inputs, homePrice: number) {
  return inputs.insuranceMode === 'percent'
    ? homePrice * (inputs.homeInsurancePct / 100)
    : inputs.homeInsuranceYearly
}

function monthlyBreakdown(inputs: Inputs, homePrice: number) {
  const down = downPaymentFor(inputs, homePrice)
  const loan = Math.max(homePrice - down, 0)
  const pi = monthlyPrincipalInterest(
    loan,
    inputs.interestRate,
    inputs.loanTermYears,
  )
  const tax = (homePrice * (inputs.propertyTaxRate / 100)) / 12
  const ins = yearlyInsuranceFor(inputs, homePrice) / 12
  const hoa = inputs.hoaMonthly
  return {
    principalInterest: pi,
    tax,
    insurance: ins,
    hoa,
    total: pi + tax + ins + hoa,
    loan,
    downPayment: down,
  }
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  suffix,
  prefix,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  suffix?: string
  prefix?: string
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="field-input">
        {prefix && <span className="affix">{prefix}</span>}
        <input
          type="number"
          value={value}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="affix">{suffix}</span>}
      </div>
    </label>
  )
}

function DualModeField({
  label,
  mode,
  onModeChange,
  pct,
  onPctChange,
  amount,
  onAmountChange,
  homePrice,
  pctStep = 0.5,
  amountStep = 5000,
  amountSuffix,
  pctDecimals = 2,
}: {
  label: string
  mode: Mode
  onModeChange: (m: Mode) => void
  pct: number
  onPctChange: (v: number) => void
  amount: number
  onAmountChange: (v: number) => void
  homePrice: number
  pctStep?: number
  amountStep?: number
  amountSuffix?: string
  pctDecimals?: number
}) {
  const price = homePrice || 0
  const displayPct = mode === 'percent' ? pct : price > 0 ? (amount / price) * 100 : 0
  const displayAmt = mode === 'amount' ? amount : price * (pct / 100)

  return (
    <div className="field dual-mode">
      <div className="field-label-row">
        <span className="field-label">{label}</span>
        <div className="mode-toggle" role="tablist">
          <button
            type="button"
            className={mode === 'percent' ? 'active' : ''}
            onClick={() => onModeChange('percent')}
          >
            %
          </button>
          <button
            type="button"
            className={mode === 'amount' ? 'active' : ''}
            onClick={() => onModeChange('amount')}
          >
            $
          </button>
        </div>
      </div>
      <div className="dual-mode-inputs">
        <div className={`field-input ${mode === 'percent' ? '' : 'derived'}`}>
          <input
            type="number"
            value={mode === 'percent' ? pct : Number(displayPct.toFixed(pctDecimals))}
            step={pctStep}
            disabled={mode !== 'percent'}
            onChange={(e) => onPctChange(Number(e.target.value))}
          />
          <span className="affix">%</span>
        </div>
        <div className={`field-input ${mode === 'amount' ? '' : 'derived'}`}>
          <span className="affix">$</span>
          <input
            type="number"
            value={mode === 'amount' ? amount : Math.round(displayAmt)}
            step={amountStep}
            disabled={mode !== 'amount'}
            onChange={(e) => onAmountChange(Number(e.target.value))}
          />
          {amountSuffix && <span className="affix">{amountSuffix}</span>}
        </div>
      </div>
      <div className="hint">
        {mode === 'percent'
          ? 'Scales with home price'
          : 'Fixed dollar amount across home prices'}
      </div>
    </div>
  )
}

type ChartDatum = {
  price: number
  downPayment: number
  'Total Monthly': number
  'P&I': number
  'Tax + Ins': number
}

type TooltipItem = {
  dataKey?: string | number
  name?: string | number
  value?: number | string
  color?: string
  payload?: ChartDatum
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipItem[]
  label?: number | string
}) {
  if (!active || !payload || payload.length === 0) return null
  const datum = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-header">
        Home: {fmt(Number(label))}
      </div>
      {datum && (
        <div className="chart-tooltip-sub">
          Down: {fmt(datum.downPayment)}
        </div>
      )}
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="chart-tooltip-row">
          <span
            className="swatch"
            style={{ background: p.color }}
          />
          <span className="name">{String(p.name)}</span>
          <span className="val">{fmt(Number(p.value))}</span>
        </div>
      ))}
    </div>
  )
}

function App() {
  const [inputs, setInputs] = useState<Inputs>(() => readInputsFromUrl())

  useEffect(() => {
    writeInputsToUrl(inputs)
  }, [inputs])

  useEffect(() => {
    const onPop = () => setInputs(readInputsFromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const update = <K extends keyof Inputs>(key: K) => (v: Inputs[K]) =>
    setInputs((s) => ({ ...s, [key]: v }))

  const current = useMemo(
    () => monthlyBreakdown(inputs, inputs.homePrice),
    [inputs],
  )

  const tableRows = useMemo(() => {
    const min = 100_000
    const max = 2_000_000
    const rows: {
      price: number
      downPayment: number
      loan: number
      pi: number
      tax: number
      insurance: number
      hoa: number
      total: number
    }[] = []
    for (let price = min; price <= max; price += 100_000) {
      const b = monthlyBreakdown(inputs, price)
      rows.push({
        price,
        downPayment: b.downPayment,
        loan: b.loan,
        pi: b.principalInterest,
        tax: b.tax,
        insurance: b.insurance,
        hoa: b.hoa,
        total: b.total,
      })
    }
    return rows
  }, [inputs])

  const chartData: ChartDatum[] = tableRows.map((r) => ({
    price: r.price,
    downPayment: Math.round(r.downPayment),
    'Total Monthly': Math.round(r.total),
    'P&I': Math.round(r.pi),
    'Tax + Ins': Math.round(r.tax + r.insurance),
  }))

  return (
    <div className="app">
      <header>
        <h1>Mortgage Visualizer</h1>
        <p className="sub">Tweak the variables. See what it costs.</p>
      </header>

      <section className="inputs">
        <NumberField
          label="Home Price"
          value={inputs.homePrice}
          onChange={update('homePrice')}
          step={10_000}
          prefix="$"
        />
        <DualModeField
          label="Down Payment"
          mode={inputs.downMode}
          onModeChange={(m) => setInputs((s) => ({ ...s, downMode: m }))}
          pct={inputs.downPaymentPct}
          onPctChange={(v) => setInputs((s) => ({ ...s, downPaymentPct: v }))}
          amount={inputs.downPaymentAmount}
          onAmountChange={(v) =>
            setInputs((s) => ({ ...s, downPaymentAmount: v }))
          }
          homePrice={inputs.homePrice}
          pctStep={0.5}
          amountStep={5000}
        />
        <NumberField
          label="Interest Rate"
          value={inputs.interestRate}
          onChange={update('interestRate')}
          step={0.125}
          suffix="%"
        />
        <NumberField
          label="Loan Term"
          value={inputs.loanTermYears}
          onChange={update('loanTermYears')}
          step={1}
          suffix="yrs"
        />
        <NumberField
          label="Property Tax"
          value={inputs.propertyTaxRate}
          onChange={update('propertyTaxRate')}
          step={0.05}
          suffix="% / yr"
        />
        <DualModeField
          label="Home Insurance"
          mode={inputs.insuranceMode}
          onModeChange={(m) => setInputs((s) => ({ ...s, insuranceMode: m }))}
          pct={inputs.homeInsurancePct}
          onPctChange={(v) =>
            setInputs((s) => ({ ...s, homeInsurancePct: v }))
          }
          amount={inputs.homeInsuranceYearly}
          onAmountChange={(v) =>
            setInputs((s) => ({ ...s, homeInsuranceYearly: v }))
          }
          homePrice={inputs.homePrice}
          pctStep={0.05}
          amountStep={100}
          amountSuffix="/ yr"
        />
        <NumberField
          label="HOA"
          value={inputs.hoaMonthly}
          onChange={update('hoaMonthly')}
          step={25}
          prefix="$"
          suffix="/ mo"
        />
      </section>

      <section className="summary">
        <div className="summary-item big">
          <span className="label">Monthly Payment</span>
          <span className="value">{fmt(current.total)}</span>
        </div>
        <div className="summary-item">
          <span className="label">P&I</span>
          <span className="value">{fmt(current.principalInterest)}</span>
        </div>
        <div className="summary-item">
          <span className="label">Taxes</span>
          <span className="value">{fmt(current.tax)}</span>
        </div>
        <div className="summary-item">
          <span className="label">Insurance</span>
          <span className="value">{fmt(current.insurance)}</span>
        </div>
        <div className="summary-item">
          <span className="label">Down Payment</span>
          <span className="value">{fmt(current.downPayment)}</span>
        </div>
        <div className="summary-item">
          <span className="label">Loan Amount</span>
          <span className="value">{fmt(current.loan)}</span>
        </div>
      </section>

      <section className="chart">
        <h2>Monthly payment by home price</h2>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="price"
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              stroke="#aaa"
            />
            <YAxis
              tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
              stroke="#aaa"
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Line type="monotone" dataKey="Total Monthly" stroke="#4ade80" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="P&I" stroke="#60a5fa" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Tax + Ins" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="table-section">
        <h2>Payment by home price (≤ $2M, $100k increments)</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Home Price</th>
                <th>Down Payment</th>
                <th>Loan</th>
                <th>P&I</th>
                <th>Taxes</th>
                <th>Insurance</th>
                <th>HOA</th>
                <th>Total / mo</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.price}>
                  <td>{fmt(r.price)}</td>
                  <td>{fmt(r.downPayment)}</td>
                  <td>{fmt(r.loan)}</td>
                  <td>{fmt(r.pi)}</td>
                  <td>{fmt(r.tax)}</td>
                  <td>{fmt(r.insurance)}</td>
                  <td>{fmt(r.hoa)}</td>
                  <td className="total">{fmt(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default App
