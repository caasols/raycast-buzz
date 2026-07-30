import { BuzzClient } from "../src/lib/buzz-client";
import { parseSecretKey } from "../src/lib/nostr";

const relayUrl = process.env.BUZZ_RELAY_URL;
const privateKey = process.env.BUZZ_PRIVATE_KEY;

if (!relayUrl || !privateKey) {
  process.stderr.write(
    "Smoke test requires BUZZ_RELAY_URL and BUZZ_PRIVATE_KEY environment variables.\n" +
      "Example: BUZZ_RELAY_URL=https://relay.example.com BUZZ_PRIVATE_KEY=nsec1... npm run smoke\n",
  );
  process.exit(1);
}

async function main() {
  try {
    const secretKey = parseSecretKey(privateKey);
    const client = new BuzzClient(relayUrl, secretKey);

    console.log("Listing channels...");
    const channels = await client.listChannels();
    console.log(`Found ${channels.length} channel(s)`);

    if (channels.length === 0) {
      console.log("No channels available; skipping send/read test (auth verified)");
      process.exit(0);
    }

    const channelId = channels[0].id;
    console.log(`Sending message to channel: ${channelId}`);

    const marker = `smoke-test-${new Date().toISOString()}`;
    await client.sendMessage(channelId, marker);
    console.log(`Message sent with marker: ${marker}`);

    console.log("Reading messages back...");
    const messages = await client.getMessages(channelId, 50);
    const marked = messages.find((msg) => msg.content === marker);

    if (marked) {
      console.log("Reacting to the test message (kind 7)...");
      await client.react(marked.id, channelId, "+");
      console.log("Reaction accepted.");
      console.log("PASS: Marker message found in channel");
      process.exit(0);
    } else {
      console.log("FAIL: Marker message not found in channel");
      process.exit(1);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }
}

main();
