"use client";

import { useState, useRef, useCallback, useEffect } from "react";
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
  const [isLoading, setIsLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);

  const search = useCallback(async (q: string, currentOffset: number) => {
    if (q.length < 1) {
      setResults([]);
      setTotal(0);
      setIsOpen(false);
      return { results: [], total: 0 };
    }
    const res = await fetch(`/api/species?q=${encodeURIComponent(q)}&offset=${currentOffset}&limit=20`);
    const data = await res.json();
    return data;
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    clearTimeout(timerRef.current);
    if (value.length < 1) {
      setResults([]);
      setIsOpen(false);
      offsetRef.current = 0;
      hasMoreRef.current = true;
      return;
    }
    timerRef.current = setTimeout(async () => {
      setIsLoading(true);
      offsetRef.current = 0;
      hasMoreRef.current = true;
      const data = await search(value, 0);
      setResults(data.results);
      setTotal(data.total);
      offsetRef.current = data.results.length;
      hasMoreRef.current = data.results.length < data.total;
      setIsOpen(data.results.length > 0);
      setIsLoading(false);
    }, 300);
  };

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMoreRef.current) return;
    setIsLoading(true);
    const data = await search(query, offsetRef.current);
    if (data.results.length === 0) {
      hasMoreRef.current = false;
    } else {
      setResults(prev => [...prev, ...data.results]);
      offsetRef.current += data.results.length;
      hasMoreRef.current = offsetRef.current < data.total;
    }
    setIsLoading(false);
  }, [query, isLoading, search]);

  const handleSelect = (species: Species) => {
    setQuery(species.commonName);
    setIsOpen(false);
    onSelect(species);
  };

  useEffect(() => {
    if (!isOpen || results.length === 0) return;
    const listEl = document.querySelector("[data-slot='command-list']");
    if (!listEl) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = listEl as HTMLElement;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        loadMore();
      }
    };
    listEl.addEventListener("scroll", handleScroll);
    return () => listEl.removeEventListener("scroll", handleScroll);
  }, [isOpen, results.length, loadMore]);

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
              {results.length === 0 && !isLoading ? (
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
