import { ChatService } from "../src/lib/chat_service";
import { DataService } from "../src/lib/data_service";
import path from "path";

const dataRoot = path.join(process.cwd(), "data");
const dataService = new DataService(dataRoot);
const chatService = new ChatService("test-key", dataService);
chatService.setDataRoot(dataRoot);

async function run() {
  console.log("Listing conversations...");
  const convs = await chatService.listConversations();
  console.log(`Found ${convs.length} conversations.`);
  convs.forEach((c) =>
    console.log(`- ${c.id}: ${c.title} (Project: ${c.projectId})`)
  );
}

run();
