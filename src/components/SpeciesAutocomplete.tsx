"use client";

import { useState, useRef, useCallback } from "react";
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

interface Species {
  commonName: string;
  scientificName: string;
  speciesCode: string;
}

interface Props {
  onSelect: (species: Species) => void;
  initialValue?: string;
}

export default function SpeciesAutocomplete({ onSelect, initialValue = "" }: Props) {
  const [query, setQuery] = useState(initialValue);
  const [results, setResults] = useState<Species[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    const res = await fetch(`/api/species?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setResults(data);
    setIsOpen(data.length > 0);
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(value), 300);
  };

  const handleSelect = (species: Species) => {
    setQuery(species.commonName);
    setIsOpen(false);
    onSelect(species);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Species</label>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
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
