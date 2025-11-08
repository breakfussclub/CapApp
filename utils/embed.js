// utils/embeds.js
import { EmbedBuilder } from "discord.js";

export function normalizeGoogleRating(rating) {
  if (!rating) return { verdict: "Other", color: 0xffff00 };
  const r = rating.toLowerCase();

  if (r.includes("true") || r.includes("accurate") || r.includes("correct")) {
    return { verdict: "True", color: 0x00ff00 };
  }
  if (r.includes("false") || r.includes("incorrect") || r.includes("hoax") || r.includes("pants on fire")) {
    return { verdict: "False", color: 0xff0000 };
  }
  if (r.includes("misleading")) {
    return { verdict: "Misleading", color: 0xffff00 };
  }
  return { verdict: "Other", color: 0xffff00 };
}

export function buildPerplexityEmbed(statement, pxResult, title = "Fact-Check Result") {
  const embed = new EmbedBuilder()
    .setColor(pxResult.color ?? 0xffff00)
    .setTitle(title)
    .addFields(
      { name: "Claim", value: `> ${statement}` },
      { name: "Verdict", value: pxResult.verdict },
      {
        name: "Reasoning",
        value: (pxResult.reason || "No reasoning provided.").slice(0, 1000)
      }
    )
    .setTimestamp();

  if (pxResult.sources && pxResult.sources.length > 0) {
    embed.addFields({
      name: "Sources",
      value: pxResult.sources.slice(0, 6).join("\n")
    });
  }

  return embed;
}

export function buildStatsEmbed(total, verdictCounts) {
  const fields = Object.entries(verdictCounts).map(([verdict, count]) => ({
    name: verdict,
    value: `${count}`,
    inline: true
  }));

  const embed = new EmbedBuilder()
    .setTitle("📊 Fact-Check Analytics")
    .setDescription(`Total claims checked: **${total}**`)
    .setColor(0x7289da)
    .setTimestamp();

  if (fields.length > 0) {
    embed.addFields(fields);
  }

  return embed;
}
