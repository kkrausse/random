"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { searchSpeciesFuzzy, Species } from "@/lib/fuzzy";

interface Props {
  onSelect: (species: Species) => void;
  initialValue?: string;
}

export default function SpeciesAutocomplete({ onSelect, initialValue = "" }: Props) {
  const [allSpecies, setAllSpecies] = useState<Species[]>([]);
  const [query, setQuery] = useState(initialValue);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    import("../../data/species.json").then(m => setAllSpecies(m.default));
  }, []);

  const results = useMemo(
    () => searchSpeciesFuzzy(allSpecies, query, 50),
    [allSpecies, query],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    setIsOpen(value.length > 0);
  };

  const handleSelect = (species: Species) => {
    setQuery(species.commonName);
    setIsOpen(false);
    onSelect(species);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Species</label>
      <Popover open={isOpen && results.length > 0} onOpenChange={setIsOpen}>
        <PopoverAnchor asChild>
          <Input
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => results.length > 0 && setIsOpen(true)}
            placeholder="Search for a species..."
          />
        </PopoverAnchor>
        <PopoverContent
          className="w-[var(--radix-popover-anchor-width)] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandList>
              {results.length === 0 ? (
                <CommandEmpty>No species found.</CommandEmpty>
              ) : (
                <CommandGroup>
                  {results.map((species) => (
                    <CommandItem
                      key={species.speciesCode}
                      value={species.speciesCode}
                      onSelect={() => handleSelect(species)}
                    >
                      <div>
                        <div className="font-medium">{species.commonName}</div>
                        <div className="text-sm text-muted-foreground italic">{species.scientificName}</div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
