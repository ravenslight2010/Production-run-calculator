---
name: media-prompt-quality
description: Improve prompts and review criteria for generated or edited raster images. Use alongside the platform media-generation or image-editing skill when a request needs precise composition, style, edit invariants, variants, text handling, or transparent-background planning. This skill does not generate media or choose a provider.
---

# Media Prompt Quality

Use this skill to improve the prompt and acceptance criteria. Use the platform
`media-generation`, `image-editing`, or `remove-image-background` skill for the
actual operation.

## Choose the operation first

- **Generate** when the user needs a new scene, illustration, texture, photo, or bitmap asset.
- **Edit** when an existing image, identity, composition, or product must remain recognizable.
- **Remove background** when transparency is the primary transformation.
- **Use code or vectors instead** when the asset belongs to an existing icon, logo, SVG, or UI system.

Do not switch providers, models, or credential paths. The operating media skill
owns those decisions.

## Build a generation prompt

Include only the dimensions that affect the requested result:

1. **Purpose** — where the asset will be used.
2. **Subject** — the primary object, person, environment, or concept.
3. **Composition** — framing, camera angle, layout, focal point, and intentional negative space.
4. **Visual treatment** — medium, realism, materials, texture, and era.
5. **Lighting and color** — direction, contrast, palette, and mood.
6. **Text** — exact wording, placement, hierarchy, and language, or explicitly no text.
7. **Output constraints** — aspect ratio, orientation, background, edge treatment, and required safe area.
8. **Exclusions** — only defects or elements that are genuinely unacceptable.

Prefer concrete visual instructions over stacked adjectives. Do not add
unrequested branding, copy, people, logos, or decorative elements.

## Build an edit prompt

Separate the requested change from the invariants:

```text
Change:
- [specific transformation]

Preserve:
- [identity, pose, geometry, product details, framing, text, colors, or background]

Output:
- [format, aspect ratio, transparency, and quality requirement]
```

If the user has not said what must remain unchanged, infer only obvious
identity and product invariants. Ask when a wrong assumption would require
recreating the work.

## Transparent-background requests

- Prefer a native transparent output when the operating tool supports it.
- Otherwise generate or edit against a clean, separable background and use the dedicated background-removal workflow.
- Inspect fine edges, holes, hair, shadows, glass, smoke, and semi-transparent materials.
- Do not claim transparency until the saved output actually has an alpha channel.

## Variants

For useful comparisons, keep the subject and purpose fixed and vary one named
dimension at a time, such as composition, palette, realism, or typography.
Label the dimension that changed. Avoid presenting nearly identical random
seeds as meaningful design alternatives.

## Review checklist

- The image satisfies its intended use and aspect ratio.
- The focal point and negative space match the placement context.
- Required identities, products, text, and geometry are preserved.
- Text is exact and legible, or absent when prohibited.
- No unexpected logos, signatures, watermarks, or sensitive details appear.
- Transparency and edge quality are verified when requested.
- Each variant differs along the declared dimension.

## Provenance

This project-owned guidance adapts provider-neutral prompt-structure and
forward-review concepts from the privately reviewed `codexskills` repository
at commit `d1ba64615771faf25d130ce1be2291fefa5787b4`. No upstream scripts,
provider configuration, credentials, Codex paths, installers, or assets were
copied.