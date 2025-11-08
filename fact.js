// commands/fact.js
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { factCheck, queryPerplexity } from "../utils/factcheck.js";
import { normalizeGoogleRating, buildPerplexityEmbed } from "../utils/embeds.js";
import { logFactCheck } from "../utils/logger.js";

export const data = new SlashCommandBuilder()
  .setName("fact")
  .setDescription("Fact-check a statement")
  .addStringOption((opt) =>
    opt
      .setName("statement")
      .setDescription("The statement you want to verify")
      .setRequired(true)
  );

export async function execute(interaction) {
  const statement = interaction.options.getString("statement", true);

  await interaction.deferReply();

  const { results, error } = await factCheck(statement);

  if (error) {
    await interaction.editReply(error);
    return;
  }

  // If Google has results, use the first one as the main answer
  if (results && results.length > 0) {
    const r = results[0];
    const norm = normalizeGoogleRating(r.rating);

    const embed = new EmbedBuilder()
      .setColor(norm.color)
      .setTitle("Fact-Check Result (Google)")
      .addFields(
        { name: "Claim", value: `> ${r.claim}` },
        { name: "Verdict", value: norm.verdict, inline: true },
        { name: "Original Rating", value: r.rating, inline: true },
        { name: "Publisher", value: r.publisher, inline: true },
        { name: "Source", value: `[Link](${r.url})` },
        { name: "Reviewed Date", value: r.date, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logFactCheck({
      source: "google",
      userId: interaction.user.id,
      username: interaction.user.tag,
      verdict: norm.verdict,
      rating: r.rating,
      publisher: r.publisher,
      url: r.url,
      statement
    });

    return;
  }

  // Fallback to Perplexity
  const px = await queryPerplexity(statement);
  if (!px) {
    await interaction.editReply("❌ Could not get a response from Perplexity.");
    return;
  }

  const embed = buildPerplexityEmbed(statement, px, "Fact-Check Result (Perplexity)");
  await interaction.editReply({ embeds: [embed] });

  logFactCheck({
    source: "perplexity",
    userId: interaction.user.id,
    username: interaction.user.tag,
    verdict: px.verdict,
    statement
  });
}
