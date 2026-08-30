import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

function Slider({ className = "", defaultValue, value, min = 0, max = 100, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const values = value ?? defaultValue ?? [min, max];
  return (
    <SliderPrimitive.Root className={`ui-slider ${className}`} defaultValue={defaultValue} value={value} min={min} max={max} {...props}>
      <SliderPrimitive.Track className="ui-slider-track">
        <SliderPrimitive.Range className="ui-slider-range" />
      </SliderPrimitive.Track>
      {values.map((_, index) => <SliderPrimitive.Thumb className="ui-slider-thumb" key={index} />)}
    </SliderPrimitive.Root>
  );
}

export { Slider };
