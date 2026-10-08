#!/usr/bin/env bash
# Fill Apple's D-U-N-S lookup form (developer.apple.com/enroll/duns-lookup) from
# a JSON file of org details, leaving only the CAPTCHA and Continue to the human.
#
# Usage: duns-lookup-fill.sh [org.json]
#   default org.json: ~/.config/duns-lookup/org.json
#
# org.json keys: region, legalEntityName, street, city, state, postalCode,
#   phoneCountryCode, phone, givenName, familyName, email
#
# Values are set through the DOM without focusing any field. Focusing an address
# field opens 1Password's inline menu, which blocks all automation on the tab.
set -euo pipefail

config="${1:-$HOME/.config/duns-lookup/org.json}"
[[ -f "$config" ]] || { echo "No org details at $config" >&2; exit 1; }

script="$(mktemp -t duns-lookup-fill).js"
trap 'rm -f "$script"' EXIT

cat > "$script" <<EOF
const org = $(cat "$config")
await page.goto("https://developer.apple.com/enroll/duns-lookup/")
await page.locator("#countryCode").waitFor({ state: "attached", timeout: 20000 })
await page.waitForTimeout(1500)

const pick = (id, label) => page.evaluate(([id, label]) => {
  const select = document.getElementById(id)
  const option = [...select.options].find((o) => o.text.trim() === label)
  if (!option) throw new Error(\`No "\${label}" option in #\${id}\`)
  select.value = option.value
  for (const type of ["input", "change"]) select.dispatchEvent(new Event(type, { bubbles: true }))
}, [id, label])

// The state list only loads once a region is chosen.
await pick("countryCode", org.region)
await page.waitForTimeout(1500)
await pick("headquartersAddressSubdivision", org.state)
await pick("headquartersAddressPhoneCountryCode", org.phoneCountryCode)
await pick("workContactPhoneCountryCode", org.phoneCountryCode)

const filled = await page.evaluate((fields) => {
  for (const [id, value] of Object.entries(fields)) {
    const input = document.getElementById(id)
    input.value = value
    for (const type of ["input", "change"]) input.dispatchEvent(new Event(type, { bubbles: true }))
  }
  return [...document.querySelectorAll("input, select")]
    .filter((e) => e.id && e.offsetParent)
    .map((e) => \`\${e.id} = \${e.tagName === "SELECT" ? e.selectedOptions[0]?.text : e.value}\`)
}, {
  legalEntityName: org.legalEntityName,
  headquartersAddressStreet: org.street,
  headquartersAddressCity: org.city,
  headquartersAddressPostalCode: org.postalCode,
  headquartersAddressPhoneNumber: org.phone,
  workContactGivenName: org.givenName,
  workContactFamilyName: org.familyName,
  workContactPhoneNumber: org.phone,
  workContactEmail: org.email,
})
await page.bringToFront()
return filled
EOF

browser-control execute --file "$script"
echo "Filled. Type the CAPTCHA and click Continue in the browser."
