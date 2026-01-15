import { DataService } from "../lib/data_service";

export const uiTools = [
  {
    name: "navigateUI",
    description:
      "Control the user interface to show specific projects, cards, or derived assets (images). Use this to direct the user's attention.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: {
          type: "STRING",
          description: "The ID of the project to switch to.",
        },
        cardId: {
          type: "STRING",
          description: "Optional ID of the card to select.",
        },
        filename: {
          type: "STRING",
          description:
            "Optional filename of an image to view (requires cardId).",
        },
      },
      required: ["projectId"],
    },
  },
];

export async function handleUITool(
  name: string,
  args: any,
  dataService: DataService
): Promise<any> {
  if (name === "navigateUI") {
    const cards = await dataService.getCards(args.projectId);
    const selectedCard = args.cardId
      ? cards.find((c) => c.id === args.cardId)
      : null;
    return {
      success: true,
      clientAction: "navigateUI",
      projectId: args.projectId,
      cardId: args.cardId,
      cardName: selectedCard?.name,
      filename: args.filename, // Pass through for frontend
    };
  }
  return null;
}
