import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
// TODO: Re-enable when starlight-typedoc/typedoc version compatibility is resolved
// import starlightTypeDoc from "starlight-typedoc";

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
      social: {
        github: "https://github.com/zbigniewsobiecki/llmist",
      },
      editLink: {
        baseUrl:
          "https://github.com/zbigniewsobiecki/llmist/edit/main/packages/docs/",
      },
      customCss: ["./src/styles/custom.css"],
      // TODO: Re-enable TypeDoc plugin when version compatibility is resolved
      // plugins: [
      //   starlightTypeDoc({
      //     entryPoints: ["../llmist/src/index.ts"],
      //     tsconfig: "../llmist/tsconfig.json",
      //     sidebar: {
      //       label: "API Reference",
      //       collapsed: true,
      //     },
      //     typeDoc: {
      //       excludePrivate: true,
      //       excludeProtected: true,
      //       excludeInternal: true,
      //     },
      //   }),
      // ],
      sidebar: [
        {
          label: "Getting Started",
          autogenerate: { directory: "getting-started" },
        },
        {
          label: "Core Concepts",
          autogenerate: { directory: "guides" },
        },
        {
          label: "Testing",
          autogenerate: { directory: "testing" },
        },
        {
          label: "CLI",
          autogenerate: { directory: "cli" },
        },
        {
          label: "Advanced",
          collapsed: true,
          autogenerate: { directory: "advanced" },
        },
        {
          label: "Reference",
          collapsed: true,
          autogenerate: { directory: "reference" },
        },
        {
          label: "Cookbook",
          autogenerate: { directory: "cookbook" },
        },
        {
          label: "Examples",
          link: "/examples/",
        },
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
