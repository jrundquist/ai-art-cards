import { DataService } from "../lib/data_service";

export const projectTools = [
  {
    name: "listProjects",
    description:
      "List all available projects. Returns IDs, names, and descriptions/intent.",
  },
  {
    name: "getProject",
    description:
      "Get details of a specific project, including its global settings and description/intent.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: { type: "STRING" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "addProjectModifier",
    description:
      "Safely add a new modifier (prefix or suffix) to the project without overwriting existing ones.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: { type: "STRING" },
        modifier: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            text: { type: "STRING" },
            type: { type: "STRING", enum: ["prefix", "suffix"] },
          },
          required: ["name", "text", "type"],
        },
      },
      required: ["projectId", "modifier"],
    },
  },
  {
    name: "removeProjectModifier",
    description: "Safely remove a modifier from the project by its ID.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: { type: "STRING" },
        modifierId: { type: "STRING" },
      },
      required: ["projectId", "modifierId"],
    },
  },
  {
    name: "updateProject",
    description:
      "Update project-level settings like description. WARNING: Do NOT use this to manage modifiers. Use addProjectModifier/removeProjectModifier if you need to change modifiers.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: { type: "STRING" },
        updates: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            description: { type: "STRING" },
            defaultAspectRatio: { type: "STRING" },
            defaultResolution: { type: "STRING" },
          },
        },
      },
      required: ["projectId", "updates"],
    },
  },
];

export async function handleProjectTool(
  name: string,
  args: any,
  dataService: DataService
): Promise<any> {
  switch (name) {
    case "listProjects":
      const projs = await dataService.getProjects();
      return projs.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
      }));

    case "getProject":
      return (
        (await dataService.getProject(args.projectId)) || {
          error: "Project not found",
        }
      );

    case "updateProject": {
      const projectToUpdate = await dataService.getProject(args.projectId);
      if (!projectToUpdate) return { error: "Project not found" };

      Object.assign(projectToUpdate, args.updates);
      await dataService.saveProject(projectToUpdate);
      return { updated: projectToUpdate, clientAction: "refreshProject" };
    }

    case "addProjectModifier": {
      const p = await dataService.getProject(args.projectId);
      if (!p) return { error: "Project not found" };

      const newMod = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        ...args.modifier,
      };
      p.promptModifiers = [...(p.promptModifiers || []), newMod];
      await dataService.saveProject(p);
      return {
        success: true,
        addedModifier: newMod,
        clientAction: "refreshProject",
      };
    }

    case "removeProjectModifier": {
      const p = await dataService.getProject(args.projectId);
      if (!p) return { error: "Project not found" };

      const initialLen = (p.promptModifiers || []).length;
      p.promptModifiers = (p.promptModifiers || []).filter(
        (m) => m.id !== args.modifierId
      );
      if (p.promptModifiers.length === initialLen) {
        return { error: "Modifier ID not found" };
      } else {
        await dataService.saveProject(p);
        return {
          success: true,
          removedId: args.modifierId,
          clientAction: "refreshProject",
        };
      }
    }
  }
  return null;
}
