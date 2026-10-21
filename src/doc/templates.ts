// Starter documents for File ▸ New. Plain Djot — what you see is what gets saved.
export type Template = { id: string; name: string; hint: string; src: string };

const today = () => new Date().toISOString().slice(0, 10);

export const templates = (): Template[] => [
  { id: "blank", name: "Blank document", hint: "Start from scratch", src: "" },
  {
    id: "letter",
    name: "Letter",
    hint: "Formal letter, A4",
    src: `\`\`\` =meta
title: Letter
theme: classic
\`\`\`

{align=right}
Your Name\\
Street 1, City\\
${today()}

Recipient Name\\
Company\\
Street 2, City

**Subject: Your subject here**

Dear Ms Smith,

Write your letter here. Keep the first paragraph short and say why you are writing.

Kind regards,

Your Name
`,
  },
  {
    id: "report",
    name: "Report",
    hint: "Title, contents, sections, page numbers",
    src: `\`\`\` =meta
title: Report title
theme: report
footer: {title} | | Page {page} of {pages}
\`\`\`

# Report title

{.muted}
Prepared by Your Name · ${today()}

::: toc
:::

## Summary

One paragraph with the key findings.

## Background

Context and goals.

## Findings

- First finding
- Second finding

## Next steps

1. Step one
2. Step two
`,
  },
  {
    id: "notes",
    name: "Meeting notes",
    hint: "Agenda, decisions, action items",
    src: `# Meeting notes — ${today()}

**Attendees:** Ana, Ben, Chloe

## Agenda

1. Topic one
2. Topic two

## Decisions

- Decision

## Action items

- [ ] Task — owner, due date
- [ ] Task — owner, due date
`,
  },
  {
    id: "invoice",
    name: "Invoice",
    hint: "Line items with live totals",
    src: `\`\`\` =meta
title: Invoice
theme: modern
\`\`\`

# Invoice

**Invoice no.** 2026-001 · **Date** ${today()}

**Bill to:** Customer name, Street, City

{#Items fmt="C:0.00;D:0.00"}
\`\`\` =sheet
| Item          | Qty | Price | Total        |
| Design work   | 10  | 80    | =B2*C2       |
| Hosting       | 12  | 15    | =B3*C3       |
| Total         |     |       | =SUM(D2:D3)  |
\`\`\`

**Amount due: [0]{calc="Items!D4"} EUR**

Payment within 14 days. Thank you!
`,
  },
  {
    id: "slides",
    name: "Presentation",
    hint: "Slides — press F5 to present",
    src: `\`\`\` =meta
title: Presentation
theme: slides
orientation: landscape
\`\`\`

::: slide
# Presentation title

Your Name · ${today()}
:::

::: slide
## The problem

- Point one
- Point two
:::

::: slide
## The solution

What you propose, in one sentence.
:::
`,
  },
];
