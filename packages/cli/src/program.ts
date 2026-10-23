import { Command } from "commander";
import extremes from "./commands/extremes.js";
import timeline from "./commands/timeline.js";
import stations from "./commands/stations.js";
import currents from "./commands/currents.js";
import serve from "./commands/serve.js";
import pkg from "../package.json" with { type: "json" };

export function createProgram() {
  const program = new Command();

  program
    .name("slackwater")
    .description("Tide and current prediction command line interface")
    .version(pkg.version);

  program.addCommand(extremes);
  program.addCommand(timeline);
  program.addCommand(stations);
  program.addCommand(currents);
  program.addCommand(serve);

  return program;
}
