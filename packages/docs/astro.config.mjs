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
            { label: "Getting Started", items: [{ autogenerate: { directory: "library/getting-started" } }] },
            { label: "Core Concepts", items: [{ autogenerate: { directory: "library/guides" } }] },
            { label: "Providers", items: [{ autogenerate: { directory: "library/providers" } }] },
            { label: "Advanced", collapsed: true, items: [{ autogenerate: { directory: "library/advanced" } }] },
          ],
        },
        {
          label: "CLI",
          items: [
            { label: "Getting Started", items: [{ autogenerate: { directory: "cli/getting-started" } }] },
            { label: "Commands", items: [{ autogenerate: { directory: "cli/commands" } }] },
            { label: "Configuration", items: [{ autogenerate: { directory: "cli/configuration" } }] },
            { label: "Writing Gadgets", items: [{ autogenerate: { directory: "cli/gadgets" } }] },
            { label: "TUI & Interactivity", items: [{ autogenerate: { directory: "cli/tui" } }] },
          ],
        },
        {
          label: "Testing",
          items: [
            { label: "Getting Started", items: [{ autogenerate: { directory: "testing/getting-started" } }] },
            { label: "Mocking", items: [{ autogenerate: { directory: "testing/mocking" } }] },
            { label: "Testing Gadgets", items: [{ autogenerate: { directory: "testing/gadgets" } }] },
            { label: "Testing Agents", items: [{ autogenerate: { directory: "testing/agents" } }] },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Models & Aliases", link: "/reference/models/" },
            { label: "Environment Variables", link: "/reference/environment/" },
            { label: "Gadget Examples", link: "/reference/gadget-examples/" },
            { label: "Block Format", link: "/reference/block-format/" },
            { label: "Error Types", link: "/reference/errors/" },
          ],
        },
        { label: "Cookbook", items: [{ autogenerate: { directory: "cookbook" } }] },
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
