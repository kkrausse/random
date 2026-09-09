import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn-style Base UI primitive; keep the demo's component surface small.
const buttonVariants = cva("inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium h-9 px-3 border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4", {
  variants: { variant: { default: "bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-700", outline: "bg-white text-neutral-900 border-neutral-300 hover:bg-neutral-100" } },
  defaultVariants: { variant: "outline" },
});
export function Button({ className, variant, ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={twMerge(clsx(buttonVariants({ variant }), className))} {...props} />;
}
