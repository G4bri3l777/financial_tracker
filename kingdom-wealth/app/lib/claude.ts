import "server-only";

type ClaudeMessage = { role: string; content: string };

export async function callClaude(messages: ClaudeMessage[], system?: string) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.NEXT_ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: system ?? "",
      messages,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text as string;
}
