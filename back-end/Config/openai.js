import OpenAI from "openai";
import chalk from "chalk";

const apiKey = process.env.OPENAI_API_KEY;
export const openaiEnabled = Boolean(apiKey);
export const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

export const openai = openaiEnabled
  ? new OpenAI({ apiKey })
  : null;

if (openaiEnabled) {
  console.log(chalk.green.bold(`OpenAI enabled (model: ${openaiModel})`));
} else {
  console.log(chalk.yellow.bold("OpenAI disabled — chat will fall back to keyword search"));
}
