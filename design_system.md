# Flat Design System Specification

## Design Philosophy
**Flat Design** removes all artifice. It rejects the illusion of three-dimensionality—no drop shadows, no bevels, no realistic gradients, no textures. It relies entirely on **hierarchy through size, color, and typography**. This is not minimalism for the sake of being minimal; it's **confident reduction** that creates visual interest through pure form.

The aesthetic is **digital-native but print-inspired**: crisp edges, solid blocks of color, and a strict reliance on the grid. It communicates clarity, efficiency, and modernity. It is not "boring" or "plain"; it is **boldly reductive and graphic**. Every element exists because it is necessary. Visual interest comes from the strategic interplay of solid shapes, vibrant (but controlled) color palettes, and dynamic scale.

**Core Principles:**
1.  **Zero Artificial Depth**: The Z-axis does not exist. Everything is on the same plane. However, visual hierarchy is created through scale, color contrast, and strategic layering of flat shapes.
2.  **Color as Structure**: Bold background colors define sections and grouping, not lines or shadows. Color transitions are sharp, never blurred or gradual.
3.  **Typography as Interface**: Text size and weight bear the load of hierarchy. Typography is geometric, bold, and demands attention.
4.  **Geometric Purity**: Rectangles, circles, and squares dominate. Rounded corners are consistent and moderate. No organic blobs or complex shapes.
5.  **Interactive Feedback**: Hover states are pronounced through color shifts, scale transformations, and instant transitions—never through shadow depth.
6.  **Strategic Decoration**: Large, subtle geometric shapes in background create visual interest without breaking the flat aesthetic—think poster design.

---

## Design Token System

### Colors (Single Palette: Light Mode)
A vibrant, confident palette that avoids muddy tones. High contrast is essential.
-   **Background**: `#FFFFFF` (Pure White)
-   **Foreground**: `#111827` (Gray 900) - Sharp, high-contrast text.
-   **Primary**: `#3B82F6` (Blue 500) - The "Action" color. Bright, standard digital blue.
-   **Secondary**: `#10B981` (Emerald 500) - Supporting accent.
-   **Accent**: `#F59E0B` (Amber 500) - For highlights/badges.
-   **Muted**: `#F3F4F6` (Gray 100) - Used for secondary backgrounds/blocks.
-   **Border**: `#E5E7EB` (Gray 200) - Used sparingly.

### Typography
-   **Font Family**: **'Outfit', sans-serif** (Geometric sans-serif)
-   **Headings**: Bold (700) or Extra Bold (800). Tight letter-spacing (`-0.02em`).
-   **Body**: Regular (400). Readable, standard spacing.
-   **Labels/Buttons**: Medium (500) or SemiBold (600). Uppercase often used for labels (`tracking-wider`).

### Radius & Shapes
-   **Radius**: `rounded-md` (6px) or `rounded-lg` (8px). Consistent throughout. Not fully rounded (pill) unless it's a tag.
-   **Borders**: generally `0px`. Background colors define edges. If a border is needed (e.g. inputs), use a bold `border-2` or `border-4` solid color.

### Shadows & Effects
-   **Shadows**: `shadow-none`. **ABSOLUTELY NO BOX SHADOWS.**
-   **Gradients**: Only subtle directional gradients for background decoration (e.g. `from-[#F3F4F6] to-transparent`). Never on components (buttons/cards).
-   **Blur**: None. No backdrop-blur effects.
-   **Background Decoration**: Large geometric shapes with low opacity (`bg-white/5` or `bg-blue-500/5`) positioned absolutely.

---

## Component Stylings

### Buttons
-   **Primary**: Solid Primary color background (`#3B82F6`), White text, `rounded-md`, Height `h-14` to `h-16`, transition-all duration-200, hover scale effect (`hover:scale-105`), hover color shift (`hover:bg-blue-600`), no shadow.
-   **Secondary**: Solid Muted background (`#F3F4F6`), Dark text, hover scale effect (`hover:scale-105`), hover color shift (`hover:bg-gray-200`).
-   **Outline**: Bold solid border (`border-4`), text matches border color, transparent bg, hover fill effect (`hover:bg-[color] hover:text-white`).

### Cards
-   **Style**: "Color Block". Solid background color (White on Gray page, or soft tints like `bg-blue-50` or `bg-green-50`). No shadow. No border. Generous padding (`p-6` or `p-8`). Rounded corners `rounded-lg`.
-   **Interaction**: Transition-all duration-200, hover scale effect (`hover:scale-[1.02]`). Colored backgrounds intensify on hover. Icons within cards scale up (`group-hover:scale-110`).

### Inputs
-   **Normal**: Gray 100 background (`bg-gray-100`), no border, text Gray 900, `rounded-md`.
-   **Focus**: White background, `border-2` solid Primary (`#3B82F6`). No focus ring glow, just the hard border.

---

## Iconography
-   **Library**: `lucide-react`.
-   **Style**: Standard to bold stroke (2px to 2.5px for emphasis).
-   **Treatment**: Often placed inside a solid colored circle (e.g. white circle with colored icon on colored bg). Circle size `h-14 w-14` or `h-16 w-16`.

## Layout & Spacing
-   **Container**: `max-w-7xl` centered.
-   **Grid**: Rigid 12-column base.
-   **Spacing**: Comfortable, multiples of 4.

## Motion & Transitions
-   **Vibe**: "Digital", "Snappy", "Direct".
-   **Transitions**: `transition-all duration-200` for interactions, `duration-300` for larger transformations.

## Accessibility
-   **Focus Rings**: High-contrast solid outlines (e.g. `ring-2 ring-offset-2 ring-blue-500`) since there are no shadows.
-   **Contrast**: Always ensure readable contrast between text and background blocks (WCAG AA).
