"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DEFAULT_PHOTO_SORT,
  PHOTO_SORT_OPTIONS,
  type PhotoSort,
} from "@/lib/photo-sort";
import { cn } from "@/lib/utils";

export default function PhotoSortSelect({
  value,
  className,
}: {
  value: PhotoSort;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedOption =
    PHOTO_SORT_OPTIONS.find((option) => option.value === value) ??
    PHOTO_SORT_OPTIONS[0];

  function updateSort(nextSort: PhotoSort) {
    const params = new URLSearchParams(searchParams.toString());

    if (nextSort === DEFAULT_PHOTO_SORT) {
      params.delete("sort");
    } else {
      params.set("sort", nextSort);
    }

    const query = params.toString();
    const href = (query ? `${pathname}?${query}` : pathname) as Route;
    router.replace(href, {
      scroll: false,
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("gap-1.5", className)}
          aria-label={`Sort photos by ${selectedOption.label}`}
        >
          <ArrowUpDown aria-hidden="true" />
          <span>{selectedOption.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1">
        <Command>
          <CommandList>
            <CommandGroup>
              {PHOTO_SORT_OPTIONS.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  data-checked={option.value === value}
                  onSelect={() => updateSort(option.value)}
                >
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
