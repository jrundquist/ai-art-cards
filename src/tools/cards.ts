import { DataService, Card } from "../lib/data_service";

export const cardTools = [
  {
    name: "listCards",
    description:
      "List cards. Returns summary info (IDs, names, and Project IDs). Useful for finding cards.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: {
          type: "STRING",
          description:
            "Optional ID of the project. If omitted, lists cards from ALL projects.",
        },
      },
      required: [],
    },
  },
  {
    name: "getCard",
    description:
      "Get the full details of a specific card, including its full prompt and specific settings.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: { type: "STRING" },
        cardId: { type: "STRING" },
      },
      required: ["projectId", "cardId"],
    },
  },
  {
    name: "findCard",
    description:
      "Find a card by name (fuzzy match). Returns ID, Name, and Project ID. Use this to find a card's location.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "The name or part of the name to search for.",
        },
        projectId: {
          type: "STRING",
          description: "Optional project ID to limit search.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "createCards",
    description: "Create one or more new cards in the project.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: { type: "STRING" },
        cards: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              prompt: { type: "STRING" },
              aspectRatio: { type: "STRING" },
              resolution: { type: "STRING" },
            },
            required: ["name", "prompt"],
          },
        },
      },
      required: ["projectId", "cards"],
    },
  },
  {
    name: "updateCard",
    description: "Update an existing card.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: { type: "STRING" },
        cardId: { type: "STRING" },
        updates: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            prompt: { type: "STRING" },
            aspectRatio: { type: "STRING" },
            resolution: { type: "STRING" },
            inactiveModifiers: {
              type: "ARRAY",
              items: { type: "STRING" },
              description:
                "List of Project Modifier IDs to disable for this specific card.",
            },
          },
        },
      },
      required: ["projectId", "cardId", "updates"],
    },
  },
  {
    name: "listCardImages",
    description:
      "List all generated images for a specific card. Use this to discover existing art before generating new images or to find filenames for navigation.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: { type: "STRING" },
        cardId: { type: "STRING" },
        includeArchived: {
          type: "BOOLEAN",
          description: "Include archived images in the list.",
        },
      },
      required: ["projectId", "cardId"],
    },
  },
];

export async function handleCardTool(
  name: string,
  args: any,
  dataService: DataService
): Promise<any> {
  switch (name) {
    case "listCards": {
      let projectsToList = [];
      if (args.projectId) {
        projectsToList.push({ id: args.projectId });
      } else {
        projectsToList = await dataService.getProjects();
      }

      const allCardsList = [];
      for (const p of projectsToList) {
        try {
          // @ts-ignore
          const cards = await dataService.getCards(p.id);
          allCardsList.push(
            ...cards.map((c) => ({
              id: c.id,
              name: c.name,
              projectId: c.projectId,
            }))
          );
        } catch {}
      }
      return allCardsList;
    }

    case "getCard": {
      const cards = await dataService.getCards(args.projectId);
      return (
        cards.find((c) => c.id === args.cardId) || {
          error: "Not found",
        }
      );
    }

    case "findCard": {
      const query = args.query.toLowerCase();
      let projectsToSearch = [];
      if (args.projectId) {
        projectsToSearch.push({ id: args.projectId });
      } else {
        projectsToSearch = await dataService.getProjects();
      }

      const found = [];
      for (const p of projectsToSearch) {
        // @ts-ignore
        const projectCards = await dataService.getCards(p.id);
        const matches = projectCards.filter((c) =>
          c.name.toLowerCase().includes(query)
        );
        found.push(
          ...matches.map((c) => ({
            id: c.id,
            name: c.name,
            projectId: c.projectId,
          }))
        );
      }
      return found;
    }

    case "createCards": {
      const projects = await dataService.getProjects();
      const project = projects.find((p) => p.id === args.projectId);

      const newCards = [];
      for (const cardData of args.cards) {
        const id = await dataService.generateCardId(args.projectId);
        const newCard: Card = {
          id,
          projectId: args.projectId,
          name: cardData.name,
          prompt: cardData.prompt,
          outputSubfolder: cardData.name.replace(/[^a-z0-9]/gi, "_"),
          aspectRatio:
            cardData.aspectRatio || project?.defaultAspectRatio || "2:3",
          resolution: cardData.resolution || project?.defaultResolution || "2K",
        };
        await dataService.saveCard(newCard);
        newCards.push(newCard);
      }
      return { created: newCards };
    }

    case "updateCard": {
      const allCards = await dataService.getCards(args.projectId);
      const card = allCards.find((c) => c.id === args.cardId);
      if (!card) return { error: "Card not found" };

      Object.assign(card, args.updates);
      await dataService.saveCard(card);
      return { updated: card, clientAction: "refreshCards" };
    }

    case "listCardImages": {
      const { projectId, cardId, includeArchived } = args;
      const { images, count } = await dataService.listCardImages(
        projectId,
        cardId,
        includeArchived
      );

      return {
        count,
        // Map to simpler format for LLM consumption
        images: images.map((img) => ({
          filename: img.filename,
          time: img.time.toISOString(),
          isFavorite: img.isFavorite,
          isArchived: img.isArchived,
        })),
      };
    }
  }
  return null;
}
