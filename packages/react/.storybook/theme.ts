import { create } from "storybook/internal/theming";

// The logos come from the repo's brand/ directory, which main.ts serves at /brand.
const brand = {
  brandTitle: "Slackwater",
  brandUrl: "https://openwaters.io/tides/slackwater/",
};

export const dark = create({
  base: "dark",
  ...brand,
  brandImage: "brand/slackwater-logo-on-dark.svg",
});
