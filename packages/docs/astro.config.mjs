import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightTypeDoc from "starlight-typedoc";

export default defineConfig({
  site: "https://llmist.dev",
  integrations: [
    starlight({
      title: "llmist",
      description: "TypeScript LLM client with streaming tool execution",
      logo: {
        src: "./src/assets/llmist-icon.png",
        alt: "llmist",
      },
      favicon: "/llmist-icon.png",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/zbigniewsobiecki/llmist" },
      ],
      editLink: {
        baseUrl:
          "https://github.com/zbigniewsobiecki/llmist/edit/main/packages/docs/",
      },
      customCss: ["./src/styles/custom.css"],
      plugins: [
        starlightTypeDoc({
          entryPoints: ["../llmist/src/index.ts"],
          tsconfig: "../llmist/tsconfig.json",
          sidebar: {
            label: "API Reference",
            collapsed: true,
          },
          typeDoc: {
            excludePrivate: true,
            excludeProtected: true,
            excludeInternal: true,
            excludeExternals: true,
            categorizeByGroup: true,
          },
        }),
      ],
      sidebar: [
        { label: "Why llmist?", link: "/why-llmist/" },
        {
          label: "Library",
          items: [
            { label: "Getting Started", autogenerate: { directory: "library/getting-started" } },
            { label: "Core Concepts", autogenerate: { directory: "library/guides" } },
            { label: "Providers", autogenerate: { directory: "library/providers" } },
            { label: "Advanced", collapsed: true, autogenerate: { directory: "library/advanced" } },
            { label: "Reference", collapsed: true, autogenerate: { directory: "library/reference" } },
          ],
        },
        {
          label: "CLI",
          items: [
            { label: "Getting Started", autogenerate: { directory: "cli/getting-started" } },
            { label: "Commands", autogenerate: { directory: "cli/commands" } },
            { label: "Configuration", autogenerate: { directory: "cli/configuration" } },
            { label: "Writing Gadgets", autogenerate: { directory: "cli/gadgets" } },
            { label: "TUI & Interactivity", autogenerate: { directory: "cli/tui" } },
          ],
        },
        {
          label: "Testing",
          items: [
            { label: "Getting Started", autogenerate: { directory: "testing/getting-started" } },
            { label: "Mocking", autogenerate: { directory: "testing/mocking" } },
            { label: "Testing Gadgets", autogenerate: { directory: "testing/gadgets" } },
            { label: "Testing Agents", autogenerate: { directory: "testing/agents" } },
            { label: "Utilities", autogenerate: { directory: "testing/utilities" } },
          ],
        },
        { label: "Cookbook", autogenerate: { directory: "cookbook" } },
        { label: "Examples", link: "/examples/" },
      ],
      head: [
        {
          tag: "meta",
          attrs: { property: "og:image", content: "/og-image.png" },
        },
      ],
    }),
  ],
});
