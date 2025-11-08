// index.js
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Collection,
  EmbedBuilder
} from "discord.js";
import http from "http";

import { factCheck, queryPerplexity } from "./utils/factcheck.js";
import { normalizeGoogleRating, buildPerplexityEmbed } from "./utils/embeds.js";
import { logFactCheck } from "./utils/logger.js";
import * as factCommand from "./commands/fact.js";
import * as statsCommand from "./commands/stats.js";

// ------------------------
// CONFIG (from env)
// ------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const WATCHED_USER_IDS = process.env.WATCHED_USER_IDS
  ? process.env.WATCHED_USER_IDS.split(",").map((id) => id.trim()).filter(Boolean)
  : [];

const WATCHED_CHANNEL_IDS = process.env.WATCHED_CHANNEL_IDS
  ? process.env.WATCHED_CHANNEL_IDS.split(",").map((id) => id.trim()).filter(Boolean)
  : [];

const NOTIFY_CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID || "";
const AUTHORIZED_USER_ID = process.env.AUTHORIZED_USER_ID || "";
const MOD_ROLE_ID = process.env.MOD_ROLE_ID || "";

const COOLDOWN_SECONDS = Number(process.env.COOLDOWN_SECONDS || 10);
const FACT_CHECK_INTERVAL_MS = Number(process.env.FACT_CHECK_INTERVAL_MS || 60 * 1000);
const BOT_STATUS_TEXT = process.env.BOT_STATUS_TEXT || "👀 Fact-checking";

const COMMANDS = (process.env.COMMANDS || "!cap,!fact,!verify")
  .split(",")
  .map((cmd) => cmd.trim())
  .filter(Boolean);

// ------------------------
// Internal state
// ------------------------
const cooldowns = {};
// CHANNEL_BUFFERS[channelId][userId] = [messages...]
const CHANNEL_BUFFERS = {};

// ------------------------
// Helper
// ------------------------
function bufferMessage(message) {
  const channelId = message.channel.id;
  const userId = message.author.id;

  if (!CHANNEL_BUFFERS[channelId]) CHANNEL_BUFFERS[channelId] = {};
  if (!CHANNEL_BUFFERS[channelId][userId]) CHANNEL_BUFFERS[channelId][userId] = [];

  CHANNEL_BUFFERS[channelId][userId].push(message.content.trim());
}

// ------------------------
// Periodic autoscan
// ------------------------
setInterval(async () => {
  for (const [channelId, users] of Object.entries(CHANNEL_BUFFERS)) {
    for (const [userId, messages] of Object.entries(users)) {
      if (!messages || messages.length === 0) continue;

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) continue;

      const member = await channel.guild.members.fetch(userId).catch(() => null);
      const username = member ? member.user.tag : `User ${userId}`;

      for (const statement of messages) {
        const { results, error } = await factCheck(statement);
        if (error) {
          console.error(`Autoscan error for ${userId} in ${channelId}:`, error);
          continue;
        }

        const notifyChannel = NOTIFY_CHANNEL_ID
          ? await client.channels.fetch(NOTIFY_CHANNEL_ID).catch(() => null)
          : null;

        if (!results || results.length === 0) {
          const px = await queryPerplexity(statement);
          if (!px) continue;

          const verdictLower = px.verdict?.toLowerCase() || "other";
          if (verdictLower === "false" || verdictLower === "misleading") {
            const embed = buildPerplexityEmbed(
              statement,
              px,
              `Fact-Check Alert for ${username}`
            );

            await channel.send({
              content: `⚠️ False or misleading claim detected from <@${userId}>.`,
              embeds: [embed]
            });

            if (notifyChannel) {
              await notifyChannel.send(
                `⚠️ False or misleading claim detected from <@${userId}> in <#${channelId}>.`
              );
            }

            logFactCheck({
              source: "autoscan-perplexity",
              userId,
              username,
              verdict: px.verdict,
              statement
            });
          }
        } else {
          // Any false/misleading Google verdict?
          const bad = results.find((r) => {
            const norm = normalizeGoogleRating(r.rating);
            return norm.verdict === "False" || norm.verdict === "Misleading";
          });

          if (bad) {
            const norm = normalizeGoogleRating(bad.rating);
            const embed = new EmbedBuilder()
              .setColor(norm.color)
              .setTitle(`Fact-Check Alert for ${username}`)
              .addFields(
                { name: "Claim", value: `> ${bad.claim}` },
                { name: "Verdict", value: norm.verdict, inline: true },
                { name: "Original Rating", value: bad.rating, inline: true },
                { name: "Publisher", value: bad.publisher, inline: true },
                { name: "Source", value: `[Link](${bad.url})` },
                { name: "Reviewed Date", value: bad.date, inline: true }
              )
              .setTimestamp();

            await channel.send({
              content: `⚠️ False or misleading claim detected from <@${userId}>.`,
              embeds: [embed]
            });

            if (notifyChannel) {
              await notifyChannel.send(
                `⚠️ False or misleading claim detected from <@${userId}> in <#${channelId}>.`
              );
            }

            logFactCheck({
              source: "autoscan-google",
              userId,
              username,
              verdict: norm.verdict,
              rating: bad.rating,
              publisher: bad.publisher,
              url: bad.url,
              statement
            });
          }
        }
      }

      CHANNEL_BUFFERS[channelId][userId] = [];
    }
  }
}, FACT_CHECK_INTERVAL_MS);

// ------------------------
// Slash command wiring
// ------------------------
client.commands = new Collection();
client.commands.set(factCommand.data.name, factCommand);
client.commands.set(statsCommand.data.name, statsCommand);

// ------------------------
// Events
// ------------------------
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: BOT_STATUS_TEXT, type: 3 }],
    status: "online"
  });
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error running /${interaction.commandName}:`, err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("❌ An error occurred while executing this command.");
    } else {
      await interaction.reply({
        content: "❌ An error occurred while executing this command.",
        ephemeral: true
      });
    }
  }
});

// ------------------------
// Legacy prefix commands + buffering
// ------------------------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const member = message.member;
  const isAuthorized =
    message.author.id === AUTHORIZED_USER_ID ||
    (MOD_ROLE_ID && member?.roles?.cache?.has(MOD_ROLE_ID));

  const isWatchedUser = WATCHED_USER_IDS.includes(message.author.id);
  const isWatchedChannel = WATCHED_CHANNEL_IDS.includes(message.channel.id);

  const contentLower = message.content.toLowerCase();
  const prefixCommand = COMMANDS.find((cmd) => contentLower.startsWith(cmd));

  // Manual prefix fact-check (e.g., !cap / !fact / !verify)
  if (prefixCommand && isAuthorized) {
    const now = Date.now();
    if (
      cooldowns[message.author.id] &&
      now - cooldowns[message.author.id] < COOLDOWN_SECONDS * 1000
    ) {
      return message.reply(
        `⏱ Please wait ${COOLDOWN_SECONDS} seconds between fact-checks.`
      );
    }
    cooldowns[message.author.id] = now;

    let statement = message.content.slice(prefixCommand.length).trim();
    if (message.reference && !statement) {
      try {
        const replied = await message.channel.messages.fetch(
          message.reference.messageId
        );
        if (replied) {
          statement = replied.content.trim();
        }
      } catch (err) {
        console.error("Failed to fetch replied-to message:", err);
      }
    }

    if (!statement) {
      return message.reply(
        "⚠️ Please provide a statement to fact-check. Example: `!cap The sky is green`"
      );
    }

    await runManualFactCheck(statement, message.channel, message.author);
    return;
  }

  // Autoscan watched users in watched channels
  if (isWatchedUser && isWatchedChannel) {
    bufferMessage(message);
  }
});

// ------------------------
// Manual fact-check handler
// ------------------------
async function runManualFactCheck(statement, channel, user) {
  const sent = await channel.send(
    `🧐 Fact-checking: "${statement}"\n\n⏳ Checking...`
  );

  const { results, error } = await factCheck(statement);

  const notifyChannel = NOTIFY_CHANNEL_ID
    ? await channel.client.channels.fetch(NOTIFY_CHANNEL_ID).catch(() => null)
    : null;

  if (error) {
    await sent.edit(`🧐 Fact-checking: "${statement}"\n\n${error}`);
    return;
  }

  if (!results || results.length === 0) {
    const px = await queryPerplexity(statement);
    if (!px) {
      await sent.edit(
        `🧐 Fact-checking: "${statement}"\n\n❌ Could not get a response from Perplexity.`
      );
      return;
    }

    const embed = buildPerplexityEmbed(statement, px, "Fact-Check Result");
    await sent.edit({
      content: `🧐 Fact-checking: "${statement}"`,
      embeds: [embed]
    });

    const verdictLower = px.verdict?.toLowerCase() || "other";
    if (notifyChannel && (verdictLower === "false" || verdictLower === "misleading")) {
      await notifyChannel.send(
        `⚠️ False or misleading claim detected from <@${user.id}> in <#${channel.id}>.`
      );
    }

    logFactCheck({
      source: "manual-perplexity",
      userId: user.id,
      username: user.tag,
      verdict: px.verdict,
      statement
    });

    return;
  }

  // Use the first Google result for the manual path
  const r = results[0];
  const norm = normalizeGoogleRating(r.rating);

  const embed = new EmbedBuilder()
    .setColor(norm.color)
    .setTitle("Fact-Check Result")
    .addFields(
      { name: "Claim", value: `> ${r.claim}` },
      { name: "Verdict", value: norm.verdict, inline: true },
      { name: "Original Rating", value: r.rating, inline: true },
      { name: "Publisher", value: r.publisher, inline: true },
      { name: "Source", value: `[Link](${r.url})` },
      { name: "Reviewed Date", value: r.date, inline: true }
    )
    .setTimestamp();

  await sent.edit({
    content: `🧐 Fact-checking: "${statement}"`,
    embeds: [embed]
  });

  if (notifyChannel && (norm.verdict === "False" || norm.verdict === "Misleading")) {
    await notifyChannel.send(
      `⚠️ False or misleading claim detected from <@${user.id}> in <#${channel.id}>.`
    );
  }

  logFactCheck({
    source: "manual-google",
    userId: user.id,
    username: user.tag,
    verdict: norm.verdict,
    rating: r.rating,
    publisher: r.publisher,
    url: r.url,
    statement
  });
}

// ------------------------
// HTTP server for Railway
// ------------------------
const PORT = process.env.PORT || 8080;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("CapApp is running!");
  })
  .listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
  });

// ------------------------
// Login
// ------------------------
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("DISCORD_TOKEN is not set in env!");
  process.exit(1);
}

client.login(token);
