// commands/stats.js
import { SlashCommandBuilder } from "discord.js";
import { readFactChecks } from "../utils/logger.js";
import { buildStatsEmbed } from "../utils/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Show fact-check analytics for CapApp");

export async function execute(interaction) {
  const logs = readFactChecks();
  const total = logs.length;

  const verdictCounts = {};
  for (const entry of logs) {
    const verdict = entry.verdict || "Unknown";
    verdictCounts[verdict] = (verdictCounts[verdict] || 0) + 1;
  }

  const embed = buildStatsEmbed(total, verdictCounts);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
