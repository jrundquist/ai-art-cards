import { DataService } from "../lib/data_service";
import { logger } from "../lib/logger";
import { projectTools, handleProjectTool } from "./projects";
import { cardTools, handleCardTool } from "./cards";
import { generationTools, handleGenerationTool } from "./generation";
import { uiTools, handleUITool } from "./ui";

export const TOOL_DEFINITIONS = [
  {
    functionDeclarations: [
      ...projectTools,
      ...cardTools,
      ...generationTools,
      ...uiTools,
    ],
  },
];

export async function handleToolCall(
  name: string,
  args: any,
  dataService: DataService,
  dataRoot: string
): Promise<any> {
  try {
    logger.info(`[Tools] Executing tool: ${name}`);
    const startTime = Date.now();

    // Try each handler
    const handlers = [
      () => handleProjectTool(name, args, dataService),
      () => handleCardTool(name, args, dataService),
      () => handleGenerationTool(name, args, dataService, dataRoot),
      () => handleUITool(name, args, dataService),
    ];

    let result;
    for (const handler of handlers) {
      result = await handler();
      if (result) break;
    }

    if (!result) {
      result = { error: "Unknown tool" };
    }

    const duration = Date.now() - startTime;
    logger.info(
      `[Tools] Tool ${name} executed in ${duration}ms. Result keys: ${Object.keys(
        result || {}
      ).join(", ")}`
    );
    return result;
  } catch (e: any) {
    logger.error(`[Tools] Error executing tool ${name}:`, e);
    return { error: e.message };
  }
}
