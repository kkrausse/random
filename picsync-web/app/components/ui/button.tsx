// shadcn/ui Base UI button, adapted to the gallery palette and 44px touch targets.
// https://ui.shadcn.com/r/styles/base-nova/button.json (MIT)
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const buttonVariants = cva(
  "button group/button inline-flex shrink-0 items-center justify-center rounded-lg bg-clip-padding text-sm font-medium transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-[#c2edb0] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-[#34363a] bg-[#1c1e21] text-[#eceef0] hover:bg-[#2b2e32]",
        ghost: "border-transparent bg-transparent hover:bg-[#2b2e32]",
      },
      size: {
        default: "min-h-11 gap-2 px-3 py-2",
        icon: "size-11 p-2",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={twMerge(clsx(buttonVariants({ variant, size }), className))}
      {...props}
    />
  );
}
export { Button, buttonVariants };
