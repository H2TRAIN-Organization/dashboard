import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Sistema de botones del dashboard (MT57).
 *
 * Las variantes reproducen el lenguaje visual existente de la app: primario
 * con el degradado azul de tres paradas que usaban los CTA a mano, outline
 * blanco de las acciones secundarias y destructive sólido de los reintentos.
 * Los tamaños fijan altura, padding y radio para que ningún size declare
 * clases en conflicto (cn no fusiona clases con tailwind-merge).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-blue-700",
        primary:
          "bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 font-semibold text-white shadow-lg hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 hover:shadow-xl",
        secondary:
          "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100",
        outline:
          "border-gray-300 bg-white text-gray-700 shadow-sm hover:border-blue-300 hover:bg-gray-50",
        ghost: "text-gray-700 hover:bg-blue-50 hover:text-blue-700",
        destructive: "bg-red-600 font-semibold text-white shadow-sm hover:bg-red-700",
        "destructive-outline":
          "border-red-300 bg-white text-red-700 hover:bg-red-50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-lg px-3 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-9 gap-2 rounded-lg px-4",
        lg: "h-10 gap-2 rounded-xl px-5 text-base",
        xl: "h-12 gap-2 rounded-xl px-6 text-lg",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-9 rounded-lg",
        "icon-lg": "size-10 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
