// utils/factcheck.js
import fetch from "node-fetch";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// ------------------------
// Google Fact Check Tools
// ------------------------
export async function factCheck(statement) {
  if (!GOOGLE_API_KEY) {
    return { error: "⚠️ GOOGLE_API_KEY is not set in environment variables." };
  }

  const url = `https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(
    statement
  )}&key=${GOOGLE_API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { error: `⚠️ Google Fact Check API error: HTTP ${response.status}` };
    }

    const data = await response.json();
    const claims = data.claims || [];
    if (claims.length === 0) return { results: [] };

    const results = [];
    for (const claim of claims) {
      const reviews = claim.claimReview || [];
      for (const review of reviews) {
        results.push({
          claim: claim.text,
          rating: review.textualRating || "Unknown",
          publisher: review.publisher?.name || "Unknown publisher",
          url: review.url,
          date: review.publishDate || "Unknown date"
        });
      }
    }

    return { results };
  } catch (err) {
    console.error("Google Fact Check error:", err);
    return { error: "⚠️ Error contacting Google Fact Check API." };
  }
}

// ------------------------
// Perplexity fallback
// ------------------------
export async function queryPerplexity(statement) {
  if (!PERPLEXITY_API_KEY) {
    return null;
  }

  const url = "https://api.perplexity.ai/chat/completions";
  const body = {
    model: "sonar",
    messages: [
      {
        role: "system",
        content:
          "Classify the following statement as one of: 'True', 'False', 'Misleading', or 'Other'. Always provide a short reasoning and sources. Format:\nVerdict: True/False/Misleading/Other\nReason: <text>\nSources: <list>"
      },
      { role: "user", content: statement }
    ]
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error(`Perplexity API error: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "";

    const verdictMatch = content.match(/Verdict:\s*(True|False|Misleading|Other)/i);
    const verdict = verdictMatch ? verdictMatch[1] : "Other";

    const reasonMatch = content.match(/Reason:\s*([\s\S]*?)(?:Sources:|$)/i);
    const reason = reasonMatch ? reasonMatch[1].trim() : "No reasoning provided.";

    const sourcesMatch = content.match(/Sources:\s*([\s\S]*)/i);
    const sourcesText = sourcesMatch ? sourcesMatch[1].trim() : "";
    const sources = sourcesText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const color =
      verdict.toLowerCase() === "true"
        ? 0x00ff00
        : verdict.toLowerCase() === "false"
        ? 0xff0000
        : 0xffff00;

    return { verdict, reason, sources, color, raw: content };
  } catch (err) {
    console.error("Perplexity API error:", err);
    return null;
  }
}
