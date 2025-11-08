// index.js — Fact-Check Bot (Environment-based version)
// ✅ Moves all hard-coded values to Railway environment variables
// ✅ Keeps Google + Perplexity integration, auto-scanning, and alerts intact
// ✅ Safe for deployment on Railway / Render / Docker

import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import fetch from "node-fetch";
import http from "http";

// ------------------------
// CONFIG (all env-based)
// ------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const WATCHED_USER_IDS = process.env.WATCHED_USER_IDS
  ? process.env.WATCHED_USER_IDS.split(",").map((id) => id.trim())
  : [];
const WATCHED_CHANNEL_IDS = process.env.WATCHED_CHANNEL_IDS
  ? process.env.WATCHED_CHANNEL_IDS.split(",").map((id) => id.trim())
  : [];
const NOTIFY_CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID || "";
const AUTHORIZED_USER_ID = process.env.AUTHORIZED_USER_ID || ""; // optional override
const MOD_ROLE_ID = process.env.MOD_ROLE_ID || ""; // optional

const COOLDOWN_SECONDS = Number(process.env.COOLDOWN_SECONDS || 10);
const FACT_CHECK_INTERVAL_MS = Number(process.env.FACT_CHECK_INTERVAL_MS || 60 * 1000);
const BOT_STATUS_TEXT = process.env.BOT_STATUS_TEXT || "👀 Fact-Checking";
const SIMILARITY_THRESHOLD = 0.3;

const COMMANDS = (process.env.COMMANDS || "!cap,!fact,!verify")
  .split(",")
  .map((cmd) => cmd.trim());

// ------------------------
// Data buffers
// ------------------------
const cooldowns = {};
const CHANNEL_BUFFERS = {};
const STOPWORDS = new Set([
  "the","and","is","in","at","of","a","to","for","on","with","as","by","that","this","from",
  "it","an","be","are","was","were","has","have","had","but","or","not","no","if","then",
  "else","when","which","who","whom","where","how","what","why"
]);

// ------------------------
// Helpers
// ------------------------
function extractKeywords(text) {
  text = text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
  return text.split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
}
function similarityScore(a, b) {
  const setA = new Set(a), setB = new Set(b);
  const common = [...setA].filter((x) => setB.has(x));
  const avgLen = (setA.size + setB.size) / 2;
  return avgLen === 0 ? 0 : common.length / avgLen;
}
function splitText(text, maxLength = 1000) {
  const parts = [];
  for (let i = 0; i < text.length; i += maxLength) parts.push(text.slice(i, i + maxLength));
  return parts;
}
function normalizeGoogleRating(rating) {
  if (!rating) return { verdict: "Other", color: 0xffff00 };
  const r = rating.toLowerCase();
  if (r.includes("true") || r.includes("accurate")) return { verdict: "True", color: 0x00ff00 };
  if (r.includes("false") || r.includes("incorrect") || r.includes("hoax"))
    return { verdict: "False", color: 0xff0000 };
  if (r.includes("misleading")) return { verdict: "Misleading", color: 0xffff00 };
  return { verdict: "Other", color: 0xffff00 };
}

// ------------------------
// Google Fact Check
// ------------------------
async function factCheck(statement) {
  const url = `https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(
    statement
  )}&key=${GOOGLE_API_KEY}`;
  try {
    const response = await fetch(url);
    if (!response.ok)
      return { error: `⚠️ Google API error: ${response.status}` };
    const data = await response.json();
    const claims = data.claims || [];
    if (claims.length === 0) return { results: [] };
    const results = [];
    claims.forEach((claim) => {
      claim.claimReview.forEach((review) => {
        results.push({
          claim: claim.text,
          rating: review.textualRating || "Unknown",
          publisher: review.publisher.name,
          url: review.url,
          date: review.publishDate || "Unknown",
        });
      });
    });
    return { results };
  } catch (err) {
    console.error(err);
    return { error: "⚠️ Error contacting Google Fact Check API." };
  }
}

// ------------------------
// Perplexity fallback
// ------------------------
async function queryPerplexity(statement) {
  const url = "https://api.perplexity.ai/chat/completions";
  const body = {
    model: "sonar",
    messages: [
      {
        role: "system",
        content:
          "Classify the following statement as one of: 'True', 'False', 'Misleading', or 'Other'. Always provide a short reasoning and sources. Format:\nVerdict: True/False/Misleading/Other\nReason: <text>\nSources: <list>",
      },
      { role: "user", content: statement },
    ],
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`Perplexity API error: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const verdictMatch = content.match(/Verdict:\s*(True|False|Misleading|Other)/i);
    const verdict = verdictMatch ? verdictMatch[1] : "Other";
    const color =
      verdict.toLowerCase() === "true"
        ? 0x00ff00
        : verdict.toLowerCase() === "false"
        ? 0xff0000
        : 0xffff00;
    const reasonMatch = content.match(/Reason:\s*([\s\S]*?)(?:Sources:|$)/i);
    const reason = reasonMatch ? reasonMatch[1].trim() : "No reasoning provided.";
    const sourcesMatch = content.match(/Sources:\s*([\s\S]*)/i);
    const sourcesText = sourcesMatch ? sourcesMatch[1].trim() : "";
    const sources = sourcesText.split("\n").filter((s) => s.trim().length > 0);
    return { verdict, color, reason, sources };
  } catch (err) {
    console.error("Perplexity API error:", err);
    return null;
  }
}

// ------------------------
// Periodic scan
// ------------------------
setInterval(async () => {
  for (const [channelId, users] of Object.entries(CHANNEL_BUFFERS)) {
    for (const [userId, messages] of Object.entries(users)) {
      if (!messages?.length) continue;
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) continue;
      const member = await channel.guild.members.fetch(userId).catch(() => null);
      const username = member ? member.user.username : `User ${userId}`;
      for (const statement of messages) {
        const { results, error } = await factCheck(statement);
        if (error) {
          console.error(`Fact-check error for ${userId}:`, error);
          continue;
        }
        if (!results?.length) {
          const px = await queryPerplexity(statement);
          if (px && ["false", "misleading"].includes(px.verdict.toLowerCase())) {
            const embed = new EmbedBuilder()
              .setColor(px.color)
              .setTitle(`Fact-Check Alert for ${username}`)
              .addFields(
                { name: "Claim", value: `> ${statement}` },
                { name: "Verdict", value: px.verdict },
                { name: "Reasoning", value: px.reason.slice(0, 1000) }
              )
              .setTimestamp();
            if (px.sources.length)
              embed.addFields({ name: "Sources", value: px.sources.slice(0, 6).join("\n") });
            await channel.send({
              content: `⚠️ False or misleading claim detected from <@${userId}>.`,
              embeds: [embed],
            });
            const notify = await client.channels.fetch(NOTIFY_CHANNEL_ID).catch(() => null);
            if (notify)
              await notify.send(`⚠️ False or misleading claim detected from <@${userId}> in <#${channelId}>.`);
          }
        }
      }
      CHANNEL_BUFFERS[channelId][userId] = [];
    }
  }
}, FACT_CHECK_INTERVAL_MS);

// ------------------------
// Message handler
// ------------------------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const member = message.member;
  const isAuthorized =
    message.author.id === AUTHORIZED_USER_ID ||
    (MOD_ROLE_ID && member?.roles?.cache?.has(MOD_ROLE_ID));
  const isWatchedUser = WATCHED_USER_IDS.includes(message.author.id);
  const isWatchedChannel = WATCHED_CHANNEL_IDS.includes(message.channel.id);
  const command = COMMANDS.find((c) => message.content.toLowerCase().startsWith(c));

  // Manual command mode
  if (command && isAuthorized) {
    const now = Date.now();
    if (
      cooldowns[message.author.id] &&
      now - cooldowns[message.author.id] < COOLDOWN_SECONDS * 1000
    )
      return message.reply(`⏱ Wait ${COOLDOWN_SECONDS}s between fact-checks.`);
    cooldowns[message.author.id] = now;

    let statement = message.content.slice(command.length).trim();
    if (message.reference && !statement) {
      try {
        const replied = await message.channel.messages.fetch(message.reference.messageId);
        if (replied) statement = replied.content.trim();
      } catch (err) {
        console.error("Fetch replied message failed:", err);
      }
    }
    if (!statement)
      return message.reply("⚠️ Provide a statement to fact-check (e.g., `!fact The sky is green`).");

    await runFactCheck(statement, message.channel, message.author.id);
    return;
  }

  // Auto-buffer watched users
  if (isWatchedUser && isWatchedChannel) {
    if (!CHANNEL_BUFFERS[message.channel.id]) CHANNEL_BUFFERS[message.channel.id] = {};
    if (!CHANNEL_BUFFERS[message.channel.id][message.author.id])
      CHANNEL_BUFFERS[message.channel.id][message.author.id] = [];
    CHANNEL_BUFFERS[message.channel.id][message.author.id].push(message.content.trim());
  }
});

// ------------------------
// Manual run command logic
// ------------------------
async function runFactCheck(statement, channel, userId) {
  const sent = await channel.send(`🧐 Fact-checking: "${statement}"\n\n⏳ Checking...`);
  const { results, error } = await factCheck(statement);
  const notify = await client.channels.fetch(NOTIFY_CHANNEL_ID).catch(() => null);

  if (error) return sent.edit(`❌ ${error}`);
  if (!results?.length) {
    const px = await queryPerplexity(statement);
    if (!px) return sent.edit(`❌ No response from Perplexity.`);
    const embed = new EmbedBuilder()
      .setColor(px.color)
      .setTitle("Fact-Check Result")
      .addFields(
        { name: "Claim", value: `> ${statement}` },
        { name: "Verdict", value: px.verdict },
        { name: "Reasoning", value: px.reason.slice(0, 1000) }
      )
      .setTimestamp();
    if (px.sources.length)
      embed.addFields({ name: "Sources", value: px.sources.slice(0, 6).join("\n") });
    await sent.edit({ embeds: [embed], content: `🧐 Fact-checking: "${statement}"` });
    if (notify && ["false", "misleading"].includes(px.verdict.toLowerCase()))
      await notify.send(`⚠️ False or misleading claim detected from <@${userId}> in <#${channel.id}>.`);
    return;
  }

  // Multiple results pagination
  const pages = results.map((r) => ({
    ...r,
    ...normalizeGoogleRating(r.rating),
  }));
  let i = 0;
  const embed = () =>
    new EmbedBuilder()
      .setColor(pages[i].color)
      .setTitle(`Fact-Check Result ${i + 1}/${pages.length}`)
      .addFields(
        { name: "Claim", value: `> ${pages[i].claim}` },
        { name: "Verdict", value: pages[i].verdict, inline: true },
        { name: "Rating", value: pages[i].rating, inline: true },
        { name: "Publisher", value: pages[i].publisher, inline: true },
        { name: "Source", value: `[Link](${pages[i].url})` },
        { name: "Date", value: pages[i].date, inline: true }
      )
      .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("prev")
      .setLabel("◀️ Prev")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId("next")
      .setLabel("Next ▶️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pages.length === 1)
  );

  const msg = await sent.edit({ embeds: [embed()], components: [row] });
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000,
  });
  collector.on("collect", async (btn) => {
    if (btn.customId === "next") i++;
    if (btn.customId === "prev") i--;
    row.components[0].setDisabled(i === 0);
    row.components[1].setDisabled(i === pages.length - 1);
    await btn.update({ embeds: [embed()], components: [row] });
  });
  collector.on("end", async () => {
    row.components.forEach((b) => b.setDisabled(true));
    await msg.edit({ components: [row] });
  });

  if (
    notify &&
    pages.some((p) => ["False", "Misleading"].includes(p.verdict))
  ) {
    await notify.send(`⚠️ False or misleading claim detected from <@${userId}> in <#${channel.id}>.`);
  }
}

// ------------------------
// Startup
// ------------------------
(async () => {
  try {
    const token = process.env.DISCORD_TOKEN;
    if (!token) throw new Error("Missing DISCORD_TOKEN!");
    await client.login(token);
    client.once("ready", () => {
      console.log(`✅ Logged in as ${client.user.tag}`);
      client.user.setPresence({
        activities: [{ name: BOT_STATUS_TEXT, type: 3 }],
        status: "online",
      });
    });
    const PORT = process.env.PORT || 3000;
    http
      .createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Bot is running!");
      })
      .listen(PORT, () => console.log(`Listening on port ${PORT}`));
  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
})();
