import fs from "fs";
import path from "path";

const EBIRD_TAXONOMY_URL =
  "https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=csv";

interface Species {
  commonName: string;
  scientificName: string;
  speciesCode: string;
}

const MANUAL_TAXA: Species[] = [
  {
    commonName: "Domestic Chicken",
    scientificName: "Gallus gallus (Domestic type)",
    speciesCode: "redjun1",
  },
];

async function main() {
  console.log("Downloading eBird taxonomy...");
  const res = await fetch(EBIRD_TAXONOMY_URL);
  if (!res.ok) {
    throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
  }
  const csv = await res.text();

  console.log("Parsing CSV...");
  const lines = csv.split("\n");
  const header = lines[0].split(",");

  const commonNameIdx = header.indexOf("COMMON_NAME");
  const sciNameIdx = header.indexOf("SCIENTIFIC_NAME");
  const codeIdx = header.indexOf("SPECIES_CODE");
  const categoryIdx = header.indexOf("CATEGORY");

  if (commonNameIdx === -1 || sciNameIdx === -1 || codeIdx === -1) {
    // Try alternate header format
    console.log("Headers found:", header.join(", "));
    throw new Error("Could not find expected CSV headers");
  }

  const species: Species[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (fields may be quoted)
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current);

    // Only include species (not subspecies, hybrids, etc.)
    const category = categoryIdx !== -1 ? fields[categoryIdx] : "species";
    if (category !== "species") continue;

    const commonName = fields[commonNameIdx]?.trim();
    const scientificName = fields[sciNameIdx]?.trim();
    const speciesCode = fields[codeIdx]?.trim();

    if (commonName && scientificName && speciesCode) {
      species.push({ commonName, scientificName, speciesCode });
    }
  }

  for (const taxon of MANUAL_TAXA) {
    if (!species.some((s) => s.speciesCode === taxon.speciesCode)) {
      const parentIdx = species.findIndex((s) => s.speciesCode === "redjun");
      if (parentIdx === -1) {
        species.push(taxon);
      } else {
        species.splice(parentIdx + 1, 0, taxon);
      }
    }
  }

  const outPath = path.join(process.cwd(), "src", "data", "species.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(species, null, 2));

  console.log(`Wrote ${species.length} species to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
