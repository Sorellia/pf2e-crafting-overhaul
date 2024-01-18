//Import various functions for crafting automation
import { MODULE_NAME, ReagentLevelledValue, localise } from "./constants.js";
import { beginAProject, craftAProject, abandonProject, getProjectsToDisplay, progressProject, editProject } from "./crafting.js";
import { normaliseCoins, subtractCoins } from "./coins.js";
import { getReagents, getReagentValue, changeReagentValue, payWithReagents } from "./reagent.js";
import { projectToChat } from "./dialog.js";

// Expose the initial functions and constants for usage in macros etc.
Hooks.on("init", async () => {
	console.log("[CCO]: INITIALISATION READY!");
	game.pf2eCCO = {
		ReagentLevelledValue,
		beginAProject,
		normaliseCoins,
		subtractCoins
	}
});

// Extends the crafting tab of the character sheet with CCO stuff.
Hooks.on("renderCharacterSheetPF2e", async (data,html) => {
	const craftingTab = html.find(".tab.crafting");
	{
		// Add the 'begin a project' button to each formula.
		const formulas = craftingTab.find(".known-formulas");
		const formulaItems = formulas.find(".formula-item");
		const itemControls = formulaItems.find(".item-controls");
		
		itemControls.prepend(`<a class="item-control" title="${localise("CharSheet.BeginProject")}" data-action="cco-begin-project"><i class="fa-solid fa-fw fa-scroll"></i></a>`);
		
		itemControls.find("a[data-action=cco-begin-project]").on("click", async (event) => {
			const UUID = $(event.currentTarget).parent().parent().attr("data-item-id") || "";
			const batchSize = Number($(event.currentTarget).parent().siblings(".formula-quantity").children("input").val()) || 1;
			const itemDetails = {
				UUID,
				batchSize
			};
			
			await beginAProject(data.actor, itemDetails, false);
		});
	}
	{
		// Adds crafting projects
		const craftingEntries = craftingTab.find(".craftingEntry-list");
		const projects = await getProjectsToDisplay(data.actor);
		
		const template = await renderTemplate(`modules/${MODULE_NAME}/templates/projects.hbs`, { projects, editable: data.isEditable });
		craftingEntries.append(template);
	}
	{
		// Adds functionality to CCO project buttons
		const projectControls = craftingTab.find(".cco-project-controls");
		
		projectControls.find("a[data-action=project-delete]").on("click", async (event) => {
			const UUID = $(event.currentTarget).parent().parent().attr("data-project-id") || "";
			
			await abandonProject(data.actor, UUID);
		});
		
		projectControls.find("a[data-action=project-edit]").on("click", async (event) => {
			const UUID = $(event.currentTarget).parent().parent().attr("data-project-id") || "";
			
			await editProject(data.actor, UUID);
		});
		
		projectControls.find("a[data-action=project-craft]").on("click", async (event) => {
			const projectUUID = $(event.currentTarget).parent().parent().attr("data-project-id") || "";
			const itemUUID = $(event.currentTarget).parent().parent().attr("data-item-id") || "";
			const batchSize = Number($(event.currentTarget).parent().siblings(".formulal-quantity").children("input").val()) || 1;
			const itemDetails = {
				UUID: itemUUID,
				projectUUID,
				batchSize
			};
			
			await craftAProject(data.actor, itemDetails, false);
		});
	}
	{
		// Adds a to-chat rollable button
		const projects = craftingTab.find("[data-container-type=CCOProjects]").find(".formula-item");
		
		projects.find(".rollable").on("click", async (event) => {
			const projectUUID = $(event.currentTarget).parent().attr("data-project-id") || "";
			
			await projectToChat(data.actor, projectUUID);
		});
	}
});

// Used for the crafting message to make the progress / deduction buttons add and remove value from the character's project.
Hooks.on("renderChatMessage", async (data, html) => {
	html.find(".card-buttons .cco-progress-chat-button").on("click", async (event) => {
		event.preventDefault();
		
		const button = $(event.currentTarget);
		const [progress, amount, uuid, actorID] = [
			button.attr("data-action") === "progress-cco-project",
			button.parent().parent().attr("data-cco-progress"),
			button.parent().parent().attr("data-project-uuid"),
			button.parent().parent().attr("data-actor")
		];
		const actor = game.actors.get(actorID)
		
		if (!actor) return;
		if (!game.user.isGM && !actor.isOwner) return;
		
		progressProject(actor, uuid, progress, game.pf2e.Coins.fromString(amount));
		
		button.attr("disabled", "true");
	});
	
	html.find(".card-buttons .cco-craft-chat-button").on("click", async (event) => {
		event.preventDefault();
		
		const button = $(event.currentTarget);
		const actorID = button.parent().parent().attr("data-actor-id");
		
		const itemDetails = {
			UUID: button.attr("data-item-id"),
			projectUUID: button.parent().parent().attr("data-project-id"),
			batchSize: button.attr("data-batch-size")
		};
		
		const actor = game.actors.get(actorID);
		if (!actor) return;
		if (!game.use.character) return;
		
		await craftAProject(game.user.character, itemDetails, false, actor);
	});
});